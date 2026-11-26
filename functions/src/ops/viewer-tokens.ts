import {
    FIRESTORE_PATHS,
    MAPBOX_PUBLIC_SCOPES,
    TOKEN_RETIRE_MINUTES,
    cityDocSchema,
    setupStatusDocSchema,
    setupStatusReadSchema,
    systemWriter,
    timestampFromDate,
    type ApiErrorCode,
    type CityDoc,
    type SetupStatusDoc,
} from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import { tokenNote } from '../api/mapbox-token-note.js';
import { UpstreamError, type UpstreamFailure } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';

/**
 * The viewer's Mapbox public token follows the server's viewer origins with no input (M6, `docs/research/M6-interfaces.md`
 * §2.6, hosting; S-A06-HAPPY-VIEWER-ORIGIN, S-A06-BAD-REMINT-REFUSED). Since M6 the public map lives on Firebase Hosting
 * (`https://<project>.web.app/`), so a token minted for the GitHub Pages origin alone would not load there. Each `ops.tick`
 * (its `tokens` step, after the retirement of replaced tokens) compares every city's `mapbox.allowedUrls` (the addresses
 * its viewer token allows, recorded when it was minted) with the server's `viewerOrigins` (`HCM_VIEWER_ORIGINS`); when they
 * differ it mints a new viewer token for them as `setup.rotatePublicToken` does, writes it to the city (whose write
 * republishes the manifest when the city is published) and queues the old one in `setup/status.mapbox.retiring`, deleted
 * `TOKEN_RETIRE_MINUTES` later, so open pages and cached manifests keep working meanwhile.
 *
 * A refused mint (a Mapbox account that cannot mint, `apiError.mapbox.mintRefused`) keeps the old token in the city and
 * its manifest and says why on `setup/status.mapbox` (`detail`, its state unchanged), where Setup (e) shows it with
 * **Replace the visitors' token**; the step then fails with that code and the next tick tries again. Without Mapbox (no
 * bootstrap token or account) there is nothing to mint with, and nothing happens.
 */

export type ViewerTokenDeps = Pick<Ports, 'documents' | 'secrets' | 'mapbox' | 'clock' | 'config' | 'log'>;

type MapboxRecord = NonNullable<SetupStatusDoc['mapbox']>;
type MintedToken = Awaited<ReturnType<Ports['mapbox']['createToken']>>;

/** `setup/status.mapbox.retiring` holds at most this many tokens (its schema's limit). */
const MAX_RETIRING = 10;
const MS_PER_MINUTE = 60_000;
/** The writer of the tick's records. */
const OPS_WRITER = systemWriter('ops');

/** The same addresses, in any order. */
function sameOrigins(allowed: readonly string[], wanted: readonly string[]): boolean {
    const current = new Set(allowed);
    return current.size === new Set(wanted).size && wanted.every((origin) => current.has(origin));
}

/**
 * A city with a viewer token whose recorded addresses are not the server's. A token without its addresses recorded
 * (none of the Setup Assistant's writes leaves them out) is left alone: what it allows is not known here.
 */
function isStale(city: CityDoc, wanted: readonly string[]): boolean {
    const allowed = city.mapbox?.publicTokenId === undefined ? undefined : city.mapbox.allowedUrls;
    return allowed !== undefined && !sameOrigins(allowed, wanted);
}

interface Account {
    readonly user: string;
    readonly secretToken: string;
    readonly retiring: number;
}

function readStatus(reader: Pick<Ports['documents'], 'get'>): Promise<SetupStatusDoc | undefined> {
    return reader.get(FIRESTORE_PATHS.setupStatus, setupStatusReadSchema);
}

async function storedMapbox(deps: ViewerTokenDeps): Promise<MapboxRecord | undefined> {
    return (await readStatus(deps.documents))?.mapbox;
}

/** Who writes and when: the tick (`system:ops`) at its own time. */
function opsStamp(deps: ViewerTokenDeps): Pick<SetupStatusDoc, 'updatedBy' | 'updatedAt'> {
    return { updatedBy: OPS_WRITER, updatedAt: timestampFromDate(deps.clock.now()) };
}

/** Mapbox's refusals of a mint, as the Setup Assistant names them (a demo account, unconfirmed billing, a revoked token). */
const MINT_REFUSALS: Readonly<Partial<Record<UpstreamFailure, ApiErrorCode>>> = {
    forbidden: 'apiError.mapbox.mintRefused',
    invalid: 'apiError.mapbox.mintRefused',
    unauthorized: 'apiError.mapbox.tokenInvalid',
};

/** A new public token for the server's viewer origins; a refusal becomes its `ApiError`, anything else propagates. */
async function mint(deps: ViewerTokenDeps, account: Account, cityId: string): Promise<MintedToken> {
    const request = {
        note: tokenNote(deps.config.projectId, 'viewer', cityId),
        scopes: [...MAPBOX_PUBLIC_SCOPES],
        allowedUrls: [...deps.config.viewerOrigins],
    };
    try {
        return await deps.mapbox.createToken(account.user, account.secretToken, request);
    } catch (error) {
        const code = error instanceof UpstreamError ? MINT_REFUSALS[error.failure] : undefined;
        throw code === undefined ? error : new ApiError(code);
    }
}

function retiringCount(record: MapboxRecord): number {
    return record.retiring?.length ?? 0;
}

/** The Mapbox account the tokens are minted with, or null when Mapbox is not set up. */
async function accountOf(deps: ViewerTokenDeps): Promise<Account | null> {
    const stored = await storedMapbox(deps);
    if (stored?.user === undefined) {
        return null;
    }
    const secretToken = await deps.secrets.read('mapbox-sk-bootstrap');
    return secretToken === undefined ? null : { user: stored.user, secretToken, retiring: retiringCount(stored) };
}

/** The Mapbox record with the replaced token queued and a refusal this re-mint answers cleared. */
function queued(record: MapboxRecord | undefined, oldId: string | undefined, retireAt: Date): MapboxRecord | undefined {
    if (record === undefined || oldId === undefined) {
        return record;
    }
    const kept = record.detail === 'apiError.mapbox.mintRefused' ? withoutDetail(record) : record;
    return { ...kept, retiring: [...(record.retiring ?? []), { tokenId: oldId, retireAt: timestampFromDate(retireAt) }] };
}

function withoutDetail(record: MapboxRecord): MapboxRecord {
    return Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'detail' && key !== 'params')) as MapboxRecord;
}

/**
 * Writes the new token to the city and queues the old one in `setup/status`, in one transaction (both reads first, as
 * Firestore requires); a city deleted meanwhile is left alone.
 */
async function replace(deps: ViewerTokenDeps, cityId: string, minted: MintedToken, now: Date): Promise<void> {
    const retireAt = new Date(now.getTime() + TOKEN_RETIRE_MINUTES * MS_PER_MINUTE);
    const path = FIRESTORE_PATHS.city(cityId);
    await deps.documents.transaction(async (transaction) => {
        const city = await transaction.get(path, cityDocSchema);
        const status = await readStatus(transaction);
        if (city === undefined) {
            return;
        }
        const allowedUrls = [...deps.config.viewerOrigins];
        const mapbox = { ...city.mapbox, publicToken: minted.token, publicTokenId: minted.id, allowedUrls };
        await transaction.set(path, cityDocSchema, { ...city, mapbox, ...opsStamp(deps) });
        const next = statusWithRetiring(status, city.mapbox?.publicTokenId, retireAt);
        if (next !== undefined) {
            await transaction.set(FIRESTORE_PATHS.setupStatus, setupStatusDocSchema, { ...next, ...opsStamp(deps) });
        }
    });
}

/** `setup/status` with the replaced token queued, or undefined when it has no Mapbox area to queue it on (disconnected). */
function statusWithRetiring(status: SetupStatusDoc | undefined, oldId: string | undefined, retireAt: Date): SetupStatusDoc | undefined {
    const mapbox = queued(status?.mapbox, oldId, retireAt);
    return status === undefined || mapbox === undefined ? undefined : { ...status, mapbox };
}

/** Records why the token could not be re-minted on `setup/status.mapbox` (its state unchanged), in a transaction. */
async function recordRefusal(deps: ViewerTokenDeps, code: ApiErrorCode): Promise<void> {
    await deps.documents.transaction(async (transaction) => {
        const current = await readStatus(transaction);
        if (current?.mapbox !== undefined) {
            await transaction.set(FIRESTORE_PATHS.setupStatus, setupStatusDocSchema, {
                ...current,
                mapbox: { ...withoutDetail(current.mapbox), detail: code },
                ...opsStamp(deps),
            });
        }
    });
}

/**
 * Writes `minted` to the city; when the write fails the token is deleted at Mapbox before the failure goes on, so a city
 * that cannot hold it (an address its schema refuses) never leaves a live, unrecorded token behind each tick (finding 3
 * of the M6 security review). The deletion is best effort: its own failure is logged, the write's is what propagates.
 */
async function recordOrDelete(
    deps: ViewerTokenDeps,
    account: Account,
    minted: { cityId: string; token: MintedToken },
    now: Date,
): Promise<void> {
    const { cityId } = minted;
    try {
        await replace(deps, cityId, minted.token, now);
    } catch (error) {
        await deps.mapbox.deleteToken(account.user, account.secretToken, minted.token.id).catch((deleteError: unknown) => {
            deps.log.warn('unrecorded viewer token not deleted', { cityId, id: minted.token.id, error: String(deleteError) });
        });
        throw error;
    }
}

/** One stale city: minted and written, or the refusal's code. */
async function refreshCity(deps: ViewerTokenDeps, account: Account, cityId: string, now: Date): Promise<ApiErrorCode | null> {
    try {
        const minted = await mint(deps, account, cityId);
        await recordOrDelete(deps, account, { cityId, token: minted }, now);
        deps.log.info('viewer token minted for the server origins', { cityId, id: minted.id });
        return null;
    } catch (error) {
        if (!(error instanceof ApiError)) {
            throw error;
        }
        deps.log.warn('viewer token not re-minted', { cityId, code: error.code });
        return error.code;
    }
}

/**
 * The viewer-token part of the `tokens` step: every city whose token's addresses are not the server's gets a new one.
 * Returns how many were replaced; a refusal is recorded and rethrown (as `ApiError`) once every city was tried.
 */
export async function refreshViewerTokens(deps: ViewerTokenDeps, now: Date): Promise<number> {
    const cities = await deps.documents.query(FIRESTORE_PATHS.cities, cityDocSchema);
    const stale = cities.documents.filter((city) => isStale(city.data, deps.config.viewerOrigins));
    const account = stale.length === 0 ? null : await accountOf(deps);
    if (account === null) {
        return 0;
    }
    const room = Math.max(0, MAX_RETIRING - account.retiring);
    const refusals: ApiErrorCode[] = [];
    for (const city of stale.slice(0, room)) {
        const refused = await refreshCity(deps, account, city.id, now);
        refusals.push(...(refused === null ? [] : [refused]));
    }
    return finish(deps, Math.min(stale.length, room) - refusals.length, refusals);
}

async function finish(deps: ViewerTokenDeps, replaced: number, refusals: readonly ApiErrorCode[]): Promise<number> {
    const [first] = refusals;
    if (first === undefined) {
        return replaced;
    }
    await recordRefusal(deps, first);
    throw new ApiError(first);
}
