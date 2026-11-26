import { TOKEN_RETIRE_MINUTES, timestampFromDate, type CallableRequest, type CallableResponse } from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import type { VerifiedCaller } from '../api/access.js';
import type { Ports } from '../ports/index.js';
import { SECRET_FAILURES, upstream } from './failures.js';
import { mintPublicToken, tokenNote, type MintedToken } from './mapbox-tokens.js';
import { commitCityAndStatus, commitStatus, readSetupStatus, requireCity, stampOf, type SetupStatusFields, type Stamp } from './records.js';

export type RotatePublicTokenDeps = Pick<Ports, 'documents' | 'secrets' | 'mapbox' | 'clock' | 'config' | 'log'>;

type Request = CallableRequest<'setup.rotatePublicToken'>;
type Response = CallableResponse<'setup.rotatePublicToken'>;
type MapboxRecord = NonNullable<SetupStatusFields['mapbox']>;

/** `setup/status.mapbox.retiring` holds at most this many tokens (its schema's limit): ten rotations in ten minutes. */
const MAX_RETIRING = 10;
const MS_PER_MINUTE = 60_000;

/** The new token and when the one it replaces is deleted. */
interface Replacement {
    readonly minted: MintedToken;
    readonly retireAt: Date;
}

interface Rotation {
    readonly user: string;
    readonly bootstrap: string;
    readonly stored: MapboxRecord;
}

/** The bootstrap token and its account (both written by `setup.saveMapbox`); without them there is nothing to mint with. */
async function readRotation(deps: RotatePublicTokenDeps): Promise<Rotation> {
    const bootstrap = await upstream(deps.secrets.read('mapbox-sk-bootstrap'), SECRET_FAILURES);
    const stored = (await readSetupStatus(deps.documents))?.mapbox;
    if (bootstrap === undefined || stored?.user === undefined) {
        throw new ApiError('apiError.mapbox.notConfigured');
    }
    checkRetiringRoom(stored);
    return { user: stored.user, bootstrap, stored };
}

/** A panic-clicked button must not overflow the retiring list (its tokens would never be deleted). */
function checkRetiringRoom(stored: MapboxRecord): void {
    if ((stored.retiring?.length ?? 0) >= MAX_RETIRING) {
        throw new ApiError('apiError.rateLimited');
    }
}

/**
 * The Mapbox record with `oldId` queued for deletion at `retireAt`. The record is read again inside the transaction;
 * if it vanished meanwhile (Mapbox disconnected), the rotation stops.
 */
function retiring(record: MapboxRecord | undefined, oldId: string | undefined, retireAt: Date): MapboxRecord {
    if (record === undefined) {
        throw new ApiError('apiError.mapbox.notConfigured');
    }
    const queued = record.retiring ?? [];
    return oldId === undefined ? record : { ...record, retiring: [...queued, { tokenId: oldId, retireAt: timestampFromDate(retireAt) }] };
}

/** The viewer's token lives in the city (the manifest carries it); the status queues the old one. */
async function writeViewer(deps: RotatePublicTokenDeps, stamp: Stamp, cityId: string, { minted, retireAt }: Replacement): Promise<boolean> {
    const written = await commitCityAndStatus(deps.documents, stamp, cityId, {
        city: (current) => ({
            ...current,
            mapbox: { ...current.mapbox, publicToken: minted.token, publicTokenId: minted.id, allowedUrls: [...deps.config.viewerOrigins] },
        }),
        status: (current, city) => ({ ...current, mapbox: retiring(current.mapbox, city.mapbox?.publicTokenId, retireAt) }),
    });
    return written.city.published;
}

/** The admin's token lives in `setup/status` only. */
async function writeAdmin(deps: RotatePublicTokenDeps, stamp: Stamp, { minted, retireAt }: Replacement): Promise<boolean> {
    await commitStatus(deps.documents, stamp, (current) => ({
        ...current,
        mapbox: {
            ...retiring(current.mapbox, current.mapbox?.adminTokenId, retireAt),
            adminToken: minted.token,
            adminTokenId: minted.id,
            adminAllowedUrls: [...deps.config.adminOrigins],
        },
    }));
    return false;
}

/** The id being replaced, as read before minting (the transaction re-reads it for the write). */
async function currentTokenId(deps: RotatePublicTokenDeps, request: Request, stored: MapboxRecord): Promise<string | undefined> {
    return request.audience === 'viewer' ? (await requireCity(deps.documents, request.cityId)).mapbox?.publicTokenId : stored.adminTokenId;
}

/**
 * `setup.rotatePublicToken` (admin, App Check consumed; security review §1.3, scenario S-A06-HAPPY-ROTATE): the panic
 * button. Mints a new URL-restricted public token with the same scopes and origins, writes it where its audience reads
 * it (the city for the viewer, whose write queues a manifest rebuild when the city is published; `setup/status` for
 * the admin), and queues the old id in `setup/status.mapbox.retiring`; `ops.tick` deletes it `TOKEN_RETIRE_MINUTES`
 * later, so cached manifests and open pages keep working meanwhile.
 */
export async function rotatePublicToken(deps: RotatePublicTokenDeps, caller: VerifiedCaller, request: Request): Promise<Response> {
    const rotation = await readRotation(deps);
    const oldId = await currentTokenId(deps, request, rotation.stored);
    const minted = await mintPublicToken(
        deps.mapbox,
        { user: rotation.user, secretToken: rotation.bootstrap },
        {
            note: tokenNote(deps.config.projectId, request.audience, request.cityId),
            allowedUrls: request.audience === 'viewer' ? deps.config.viewerOrigins : deps.config.adminOrigins,
        },
    );
    const retireAt = new Date(deps.clock.now().getTime() + TOKEN_RETIRE_MINUTES * MS_PER_MINUTE);
    const stamp = stampOf(caller.uid, deps);
    const replacement = { minted, retireAt };
    const published =
        request.audience === 'viewer'
            ? await writeViewer(deps, stamp, request.cityId, replacement)
            : await writeAdmin(deps, stamp, replacement);
    deps.log.info('mapbox public token rotated', { uid: caller.uid, audience: request.audience, id: minted.id });
    return { tokenId: minted.id, retiresOldAt: oldId === undefined ? null : retireAt.toISOString(), manifestQueued: published };
}
