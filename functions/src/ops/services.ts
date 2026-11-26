/**
 * The `health` and `tokens` steps of `ops.tick` (`docs/research/M2-interfaces.md` §3.7): a daily check of the stored
 * Mapbox token and USGS credentials (a `pending` USGS role is checked again every `USGS_RECHECK_HOURS` and turns `ok`
 * once USGS approves it), and the deletion of replaced public Mapbox tokens once their `retireAt` has passed. Results
 * land in `setup/status` as non-secret health; secrets are read from Secret Manager and never leave the function.
 */
import {
    FIRESTORE_PATHS,
    USGS_RECHECK_HOURS,
    setupStatusDocSchema,
    setupStatusReadSchema,
    systemWriter,
    timestampFromDate,
    timestampToDate,
    usgsRoleFromPermissions,
    type ApiErrorCode,
    type ServiceState,
    type SetupStatusDoc,
    type TimestampLike,
    type UsgsRole,
} from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import { emitNotification } from '../api/notification-event.js';
import { UpstreamError, type UpstreamFailure } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';
import { omit } from '../api/objects.js';

export type ServicesDeps = Pick<Ports, 'log' | 'clock' | 'documents' | 'secrets' | 'mapbox' | 'usgs'>;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

interface Health {
    readonly state: ServiceState;
    readonly detail?: ApiErrorCode;
}

interface UsgsHealth extends Health {
    readonly role?: UsgsRole;
    readonly nextCheckAt?: Date;
}

type MapboxArea = NonNullable<SetupStatusDoc['mapbox']>;
type UsgsArea = NonNullable<SetupStatusDoc['usgs']>;

/** The reason a `pending` USGS card shows (CR-M2-16): the account has no M2M download access yet. */
const ACCESS_PENDING = 'apiError.usgs.accessPending';

const USGS_FAILURES: Readonly<Partial<Record<UpstreamFailure, UsgsHealth>>> = {
    unauthorized: { state: 'invalid', detail: 'apiError.usgs.credentials' },
    // A login refused with AUTH_UNAUTHORIZED: the credentials work, M2M access is not approved yet (as setup.saveUsgs).
    forbidden: { state: 'pending', role: 'search', detail: ACCESS_PENDING },
    maintenance: { state: 'unavailable', detail: 'apiError.usgs.maintenance' },
    rateLimited: { state: 'unavailable', detail: 'apiError.rateLimited' },
};

function upstreamOnly(error: unknown): UpstreamError {
    if (error instanceof UpstreamError) {
        return error;
    }
    throw error;
}

function mapboxFailure(error: unknown): Health {
    return upstreamOnly(error).failure === 'unauthorized'
        ? { state: 'invalid', detail: 'apiError.mapbox.tokenInvalid' }
        : { state: 'unavailable', detail: 'apiError.mapbox.unavailable' };
}

/** A failed check; USGS not answering (maintenance, rate limit, 5xx) or no M2M access yet is checked again in `USGS_RECHECK_HOURS`. */
function usgsFailure(error: unknown, now: Date): UsgsHealth {
    const health = USGS_FAILURES[upstreamOnly(error).failure] ?? { state: 'unavailable', detail: 'apiError.usgs.unavailable' };
    return RECHECKED.has(health.state) ? { ...health, nextCheckAt: inRecheckHours(now) } : health;
}

/** A verified (or failed) service is checked again once a day; a `missing` one has nothing to check. */
function dailyDue(area: { readonly state: ServiceState; readonly checkedAt?: TimestampLike | undefined } | undefined, now: Date): boolean {
    return (
        area !== undefined &&
        area.state !== 'missing' &&
        (area.checkedAt === undefined || now.getTime() - timestampToDate(area.checkedAt).getTime() >= DAY_MS)
    );
}

/** The USGS states `setup.*` and this step check again at `nextCheckAt`: waiting for approval, or USGS not answering. */
const RECHECKED: ReadonlySet<ServiceState> = new Set(['pending', 'unavailable']);

/** At `nextCheckAt` while pending or unavailable (CR-M2-18), a pending role without one at once, else once a day. */
function usgsDue(area: UsgsArea | undefined, now: Date): boolean {
    if (area === undefined) {
        return false;
    }
    if (RECHECKED.has(area.state) && area.nextCheckAt !== undefined) {
        return timestampToDate(area.nextCheckAt) <= now;
    }
    return area.state === 'pending' || dailyDue(area, now);
}

function inRecheckHours(now: Date): Date {
    return new Date(now.getTime() + USGS_RECHECK_HOURS * HOUR_MS);
}

async function mapboxHealth(deps: ServicesDeps): Promise<Health | undefined> {
    const secret = await deps.secrets.read('mapbox-sk-bootstrap');
    if (secret === undefined) {
        return undefined;
    }
    return deps.mapbox.retrieveToken(secret).then((): Health => ({ state: 'ok' }), mapboxFailure);
}

/** `login-token`, `permissions`, then `logout` whatever happened: the role decides `ok` or `pending` (re-checked later). */
async function usgsRole(deps: ServicesDeps, username: string, token: string, now: Date): Promise<UsgsHealth> {
    const apiKey = await deps.usgs.login(username, token);
    try {
        const role = usgsRoleFromPermissions(await deps.usgs.permissions(apiKey));
        return role === 'download'
            ? { state: 'ok', role }
            : { state: 'pending', role, detail: ACCESS_PENDING, nextCheckAt: inRecheckHours(now) };
    } finally {
        await deps.usgs.logout(apiKey);
    }
}

async function usgsHealth(deps: ServicesDeps, now: Date): Promise<UsgsHealth | undefined> {
    const [username, token] = await Promise.all([deps.secrets.read('usgs-username'), deps.secrets.read('usgs-app-token')]);
    if (username === undefined || token === undefined) {
        return undefined;
    }
    return usgsRole(deps, username, token, now).catch((error: unknown) => usgsFailure(error, now));
}

function checked<A extends { readonly detail?: ApiErrorCode | undefined; readonly params?: unknown }>(area: A, health: Health, now: Date) {
    return {
        ...omit(area, ['detail', 'params']),
        state: health.state,
        checkedAt: timestampFromDate(now),
        ...(health.detail === undefined ? {} : { detail: health.detail }),
    };
}

function withMapbox(area: MapboxArea | undefined, health: Health | undefined, now: Date): Pick<SetupStatusDoc, 'mapbox'> {
    return area === undefined || health === undefined ? {} : { mapbox: checked(area, health, now) };
}

function withUsgs(area: UsgsArea | undefined, health: UsgsHealth | undefined, now: Date): Pick<SetupStatusDoc, 'usgs'> {
    if (area === undefined || health === undefined) {
        return {};
    }
    const next = health.nextCheckAt === undefined ? {} : { nextCheckAt: timestampFromDate(health.nextCheckAt) };
    return {
        usgs: {
            ...checked(omit(area, ['nextCheckAt']), health, now),
            ...(health.role === undefined ? {} : { role: health.role }),
            ...next,
        },
    };
}

/** Rewrites `setup/status` inside a transaction (a `setup.*` callable may be writing it), stamped `system:ops`. */
async function updateStatus(deps: ServicesDeps, now: Date, change: (current: SetupStatusDoc) => Partial<SetupStatusDoc>): Promise<void> {
    await deps.documents.transaction(async (transaction) => {
        const current = await transaction.get(FIRESTORE_PATHS.setupStatus, setupStatusReadSchema);
        if (current !== undefined) {
            await transaction.set(FIRESTORE_PATHS.setupStatus, setupStatusDocSchema, {
                ...current,
                ...change(current),
                updatedBy: systemWriter('ops'),
                updatedAt: timestampFromDate(now),
            });
        }
    });
}

interface DueChecks {
    readonly mapbox: Health | undefined;
    readonly usgs: UsgsHealth | undefined;
}

async function runDueChecks(deps: ServicesDeps, status: SetupStatusDoc | undefined, now: Date): Promise<DueChecks> {
    return {
        mapbox: dailyDue(status?.mapbox, now) ? await mapboxHealth(deps) : undefined,
        usgs: usgsDue(status?.usgs, now) ? await usgsHealth(deps, now) : undefined,
    };
}

function stateOf(health: Health | undefined): string {
    return health?.state ?? 'skipped';
}

/**
 * M4 (`docs/research/M4-interfaces.md` §5.1, assists-notify): USGS granting downloads is news for every admin, emitted once
 * (`usgs.approved~download`) when a check turns the role `download`.
 */
async function noticeApproval(deps: ServicesDeps, before: SetupStatusDoc | undefined, usgs: UsgsHealth | undefined): Promise<void> {
    if (approvedNow(before, usgs)) {
        await emitNotification(deps, 'ops', { kind: 'usgs.approved', parts: ['download'], link: '#/imagery' });
    }
}

/** This check found the download role, which `setup/status` did not record before. */
function approvedNow(before: SetupStatusDoc | undefined, usgs: UsgsHealth | undefined): boolean {
    return usgs?.role === 'download' && before?.usgs?.role !== 'download';
}

/** The `health` step: checks what is due and records each result on its area. */
export async function checkServices(deps: ServicesDeps, now: Date): Promise<void> {
    const status = await deps.documents.get(FIRESTORE_PATHS.setupStatus, setupStatusReadSchema);
    const checks = await runDueChecks(deps, status, now);
    if (checks.mapbox === undefined && checks.usgs === undefined) {
        return;
    }
    await updateStatus(deps, now, (current) => ({
        ...withMapbox(current.mapbox, checks.mapbox, now),
        ...withUsgs(current.usgs, checks.usgs, now),
    }));
    deps.log.info('services checked', { mapbox: stateOf(checks.mapbox), usgs: stateOf(checks.usgs) });
    await noticeApproval(deps, status, checks.usgs);
}

/** Deletes each token; the ones Mapbox could not delete stay listed for the next tick. */
async function deleteTokens(deps: ServicesDeps, user: string, secret: string, tokenIds: readonly string[]): Promise<ReadonlySet<string>> {
    const deleted = new Set<string>();
    for (const tokenId of tokenIds) {
        await deps.mapbox.deleteToken(user, secret, tokenId).then(
            () => deleted.add(tokenId),
            (error: unknown) => {
                deps.log.warn('retired token not deleted', { tokenId, error: String(upstreamOnly(error)) });
            },
        );
    }
    return deleted;
}

function withoutRetired(area: MapboxArea | undefined, deleted: ReadonlySet<string>): Pick<SetupStatusDoc, 'mapbox'> {
    if (area?.retiring === undefined) {
        return {};
    }
    const retiring = area.retiring.filter((token) => !deleted.has(token.tokenId));
    return { mapbox: retiring.length === 0 ? omit(area, ['retiring']) : { ...area, retiring } };
}

function dueTokens(mapbox: MapboxArea | undefined, now: Date): string[] {
    return (mapbox?.retiring ?? []).filter((token) => timestampToDate(token.retireAt) <= now).map((token) => token.tokenId);
}

/** The Mapbox user and the bootstrap token the Tokens API needs; without either, Mapbox is not connected. */
async function credentials(
    deps: ServicesDeps,
    mapbox: MapboxArea | undefined,
): Promise<{ readonly user: string; readonly secret: string }> {
    const secret = await deps.secrets.read('mapbox-sk-bootstrap');
    if (mapbox?.user === undefined || secret === undefined) {
        throw new ApiError('apiError.mapbox.notConfigured');
    }
    return { user: mapbox.user, secret };
}

/**
 * The `tokens` step: deletes the replaced public tokens whose `retireAt` has passed (security review §1.3). A token
 * Mapbox did not delete stays listed and fails the step (`apiError.mapbox.unavailable`); without the bootstrap token
 * or the Mapbox user it fails with `apiError.mapbox.notConfigured`.
 */
export async function retireTokens(deps: ServicesDeps, now: Date): Promise<void> {
    const mapbox = (await deps.documents.get(FIRESTORE_PATHS.setupStatus, setupStatusReadSchema))?.mapbox;
    const due = dueTokens(mapbox, now);
    if (due.length === 0) {
        return;
    }
    const { user, secret } = await credentials(deps, mapbox);
    const deleted = await deleteTokens(deps, user, secret, due);
    await updateStatus(deps, now, (current) => withoutRetired(current.mapbox, deleted));
    if (deleted.size < due.length) {
        throw new ApiError('apiError.mapbox.unavailable');
    }
}
