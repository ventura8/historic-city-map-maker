import {
    FIRESTORE_PATHS,
    MAPBOX_PUBLIC_SCOPES,
    TOKEN_RETIRE_MINUTES,
    setupStatusDocSchema,
    setupStatusReadSchema,
    systemWriter,
    timestampFromDate,
    type SetupStatusDoc,
} from '@hcm/shared';

import { tokenNote } from '../api/mapbox-token-note.js';
import type { Ports } from '../ports/index.js';

/**
 * The admin's Mapbox public token follows the server's admin origins with no input (the admin on its own site,
 * `DECISIONS-for-review.md` §210): Mapbox answers a URL-restricted token only on the addresses it allows, so once the
 * server's `adminOrigins` gain the admin's own site (`<project>-admin`), a token minted for the public map's origins alone
 * would leave the admin's map blank there. Each `ops.tick` (its `tokens` step, beside the viewer's tokens) compares
 * `setup/status.mapbox.adminAllowedUrls` (recorded when the token was minted) with them and, when they differ, mints a new
 * admin token as `setup.rotatePublicToken` does and queues the old one in `mapbox.retiring`, deleted
 * `TOKEN_RETIRE_MINUTES` later, so the admin's open tabs keep working meanwhile.
 *
 * Nothing happens without Mapbox (no bootstrap token or account), for a token whose addresses were never recorded, or
 * while the retiring list is full; a refused mint is logged with its reason and tried again by the next tick (the admin
 * keeps the old token, and Setup (e)'s Replace the admin's token stays).
 */

export type AdminTokenDeps = Pick<Ports, 'documents' | 'secrets' | 'mapbox' | 'clock' | 'config' | 'log'>;

type MapboxRecord = NonNullable<SetupStatusDoc['mapbox']>;

interface Minted {
    readonly id: string;
    readonly token: string;
}

/** `setup/status.mapbox.retiring` holds at most this many tokens (its schema's limit). */
const MAX_RETIRING = 10;
const MS_PER_MINUTE = 60_000;

function sameOrigins(allowed: readonly string[], wanted: readonly string[]): boolean {
    const current = new Set(allowed);
    return current.size === new Set(wanted).size && wanted.every((origin) => current.has(origin));
}

/** Whether the admin token's recorded addresses are known and not the server's. */
function addressesDiffer(record: MapboxRecord, wanted: readonly string[]): boolean {
    const allowed = record.adminTokenId === undefined ? undefined : record.adminAllowedUrls;
    return allowed !== undefined && !sameOrigins(allowed, wanted);
}

/** Whether the retiring list has room for one more token. */
function hasRoom(record: MapboxRecord): boolean {
    return (record.retiring?.length ?? 0) < MAX_RETIRING;
}

/** The record when its admin token allows other addresses than the server's admin origins and a new one fits. */
function stale(record: MapboxRecord | undefined, wanted: readonly string[]): record is MapboxRecord & { readonly user: string } {
    return record?.user !== undefined && hasRoom(record) && addressesDiffer(record, wanted);
}

/** `setup/status` with the new admin token and the old one queued for retirement. */
function withToken(
    status: SetupStatusDoc & { readonly mapbox: MapboxRecord },
    minted: Minted,
    deps: AdminTokenDeps,
    now: Date,
): SetupStatusDoc {
    const { mapbox } = status;
    const retireAt = timestampFromDate(new Date(now.getTime() + TOKEN_RETIRE_MINUTES * MS_PER_MINUTE));
    const old = mapbox.adminTokenId === undefined ? [] : [{ tokenId: mapbox.adminTokenId, retireAt }];
    return {
        ...status,
        mapbox: {
            ...mapbox,
            adminToken: minted.token,
            adminTokenId: minted.id,
            adminAllowedUrls: [...deps.config.adminOrigins],
            retiring: [...(mapbox.retiring ?? []), ...old],
        },
        updatedBy: systemWriter('ops'),
        updatedAt: timestampFromDate(now),
    };
}

/** Writes the new token and queues the old one, in a transaction (a Mapbox area removed meanwhile is left alone). */
async function record(deps: AdminTokenDeps, minted: Minted, now: Date): Promise<void> {
    await deps.documents.transaction(async (transaction) => {
        const status = await transaction.get(FIRESTORE_PATHS.setupStatus, setupStatusReadSchema);
        if (status?.mapbox !== undefined) {
            await transaction.set(
                FIRESTORE_PATHS.setupStatus,
                setupStatusDocSchema,
                withToken({ ...status, mapbox: status.mapbox }, minted, deps, now),
            );
        }
    });
}

/** The account and the bootstrap token when the stored admin token needs replacing, else null. */
async function accountFor(deps: AdminTokenDeps): Promise<{ readonly user: string; readonly secretToken: string } | null> {
    const stored = (await deps.documents.get(FIRESTORE_PATHS.setupStatus, setupStatusReadSchema))?.mapbox;
    if (!stale(stored, deps.config.adminOrigins)) {
        return null;
    }
    const secretToken = await deps.secrets.read('mapbox-sk-bootstrap');
    return secretToken === undefined ? null : { user: stored.user, secretToken };
}

/** The admin-token part of the `tokens` step: true when a new token was minted for the server's admin origins. */
export async function refreshAdminToken(deps: AdminTokenDeps, now: Date): Promise<boolean> {
    const account = await accountFor(deps);
    if (account === null) {
        return false;
    }
    const request = {
        note: tokenNote(deps.config.projectId, 'admin'),
        scopes: [...MAPBOX_PUBLIC_SCOPES],
        allowedUrls: [...deps.config.adminOrigins],
    };
    try {
        const minted = await deps.mapbox.createToken(account.user, account.secretToken, request);
        await record(deps, minted, now);
        deps.log.info('admin token minted for the server origins', { id: minted.id, origins: request.allowedUrls.length });
        return true;
    } catch (error) {
        deps.log.warn('admin token not re-minted: the next tick tries again', { error: String(error) });
        return false;
    }
}
