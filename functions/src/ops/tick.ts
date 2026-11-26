import { runAs } from '../global-options.js';

import {
    API_ERRORS,
    FIRESTORE_PATHS,
    OPS_STEPS,
    OPS_TICK_SCHEDULE,
    opsGuardDocSchema,
    systemWriter,
    timestampFromDate,
    timestampToDate,
    type ApiErrorCode,
    type OpsGuardDoc,
    type OpsStep,
} from '@hcm/shared';
import { onSchedule } from 'firebase-functions/scheduler';

import { ApiError } from '../api/api-error.js';
import { UpstreamError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';
import { expireInvites, removeStaleUsers } from './accounts.js';
import { refreshAdminToken } from './admin-token.js';
import { checkCrashSpike } from './crash-spike.js';
import { refreshCountrySources } from './country-sources.js';
import { expireExports } from './exports.js';
import { nightlyManifests } from './manifests.js';
import { migrateMemberships } from './memberships.js';
import { checkServices, retireTokens } from './services.js';
import { refreshViewerTokens } from './viewer-tokens.js';

export type OpsDeps = Pick<
    Ports,
    'log' | 'clock' | 'config' | 'documents' | 'blobs' | 'tasks' | 'auth' | 'secrets' | 'mapbox' | 'usgs' | 'errors' | 'remote' | 'geocoder'
>;

type TickStep = NonNullable<OpsGuardDoc['lastTick']>['steps'][number];

interface TickContext {
    readonly now: Date;
    /** The last nightly run, from `ops/guard` as the tick found it. */
    readonly lastNightlyAt: Date | undefined;
}

/** What a step changes on `ops/guard` besides the tick record (the nightly step sets `lastNightlyAt`). */
type GuardChanges = Partial<Pick<OpsGuardDoc, 'lastNightlyAt'>>;

type Step = (deps: OpsDeps, context: TickContext) => Promise<GuardChanges>;

function stamp(now: Date): Pick<OpsGuardDoc, 'updatedBy' | 'updatedAt'> {
    return { updatedBy: systemWriter('ops'), updatedAt: timestampFromDate(now) };
}

/** `guard`: creates `ops/guard` green when it does not exist (a fresh project). */
async function ensureGuard(deps: OpsDeps, context: TickContext): Promise<GuardChanges> {
    await deps.documents.transaction(async (transaction) => {
        if ((await transaction.get(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema)) === undefined) {
            await transaction.set(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema, {
                state: 'green',
                since: timestampFromDate(context.now),
                ...stamp(context.now),
            });
        }
    });
    return {};
}

/** `jobs` and `mts` belong to the raster pipeline (M3): nothing to do yet. */
function nothingYet(): Promise<GuardChanges> {
    return Promise.resolve({});
}

async function manifests(deps: OpsDeps, context: TickContext): Promise<GuardChanges> {
    const ranAt = await nightlyManifests(deps, context.now, context.lastNightlyAt);
    return ranAt === undefined ? {} : { lastNightlyAt: timestampFromDate(ranAt) };
}

/** Each step, in `OPS_STEPS` order (`docs/research/M2-interfaces.md` §3.7). */
const STEPS: Readonly<Record<OpsStep, Step>> = {
    guard: ensureGuard,
    jobs: nothingYet,
    mts: nothingYet,
    manifests,
    health: async (deps, context) => {
        await checkServices(deps, context.now);
        // M4 (docs/research/M4-interfaces.md §5.1, assists-notify): many new crash reports within the hour.
        await checkCrashSpike(deps, context.now);
        return {};
    },
    tokens: async (deps, context) => {
        await retireTokens(deps, context.now);
        // M6 (docs/research/M6-interfaces.md §2.6; owner: hosting): each city's viewer token follows the server's origins.
        deps.log.info('viewer tokens replaced', { count: await refreshViewerTokens(deps, context.now) });
        // §210: the admin's token follows the server's admin origins (the admin's own site among them).
        await refreshAdminToken(deps, context.now);
        return {};
    },
    invites: async (deps, context) => {
        deps.log.info('expired invitations deleted', { count: await expireInvites(deps, context.now) });
        return {};
    },
    users: async (deps, context) => {
        deps.log.info('stale accounts deleted', { count: await removeStaleUsers(deps, context.now) });
        return {};
    },
    // M5 (docs/research/M5-interfaces.md §1.2; owner: multi-city): the admins from before M5 get their cities.
    memberships: async (deps) => {
        deps.log.info('admin memberships migrated', { count: await migrateMemberships(deps) });
        return {};
    },
    // M5 (docs/research/M5-interfaces.md §5.3; owner: export): the static exports past their time.
    exports: async (deps, context) => {
        deps.log.info('exports expired or failed', { count: await expireExports(deps, context.now) });
        return {};
    },
    // M28 (docs/research/M28-sources.md §10): where each city's country keeps its old maps and images, refreshed monthly.
    sources: async (deps, context) => {
        await refreshCountrySources(deps, context.now);
        return {};
    },
};

/** The code a failed step records: its own `ApiError`, the generic code of an upstream failure, else `internal`. */
function detailOf(error: unknown): ApiErrorCode {
    if (error instanceof ApiError) {
        return error.code;
    }
    const transient = error instanceof UpstreamError && ['unavailable', 'rateLimited', 'maintenance'].includes(error.failure);
    return transient ? 'apiError.unavailable' : 'apiError.internal';
}

/** One step, isolated: a failure is logged and recorded, and the next step runs. */
async function runStep(
    deps: OpsDeps,
    step: OpsStep,
    context: TickContext,
): Promise<{ readonly result: TickStep; readonly changes: GuardChanges }> {
    try {
        return { result: { step, ok: true }, changes: await STEPS[step](deps, context) };
    } catch (error) {
        const detail = detailOf(error);
        deps.log.error('ops step failed', { step, detail, retryable: API_ERRORS[detail].retryable, error: String(error) });
        return { result: { step, ok: false, detail }, changes: {} };
    }
}

async function lastNightly(deps: OpsDeps): Promise<Date | undefined> {
    const guard = await deps.documents.get(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema).catch(() => undefined);
    return guard?.lastNightlyAt === undefined ? undefined : timestampToDate(guard.lastNightlyAt);
}

/**
 * Records what the tick did on `ops/guard` (`lastTick`), keeping the guard's state as `ops.onBudget` may have set it;
 * a guard document that no longer validates is never overwritten (it might be red): the tick then fails, logged.
 */
async function recordTick(deps: OpsDeps, now: Date, steps: readonly TickStep[], changes: GuardChanges): Promise<void> {
    await deps.documents.transaction(async (transaction) => {
        const current = await transaction.get(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema);
        await transaction.set(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema, {
            ...(current ?? { state: 'green', since: timestampFromDate(now) }),
            ...changes,
            lastTick: { ranAt: timestampFromDate(now), steps: [...steps] },
            ...stamp(now),
        });
    });
}

/** `ops.tick`: every step of `OPS_STEPS` in order, each isolated, then the tick record. Returns the steps' results. */
export async function runTick(deps: OpsDeps): Promise<readonly TickStep[]> {
    const now = deps.clock.now();
    const context: TickContext = { now, lastNightlyAt: await lastNightly(deps) };
    const results: TickStep[] = [];
    let changes: GuardChanges = {};
    for (const step of OPS_STEPS) {
        const ran = await runStep(deps, step, context);
        results.push(ran.result);
        changes = { ...changes, ...ran.changes };
    }
    await recordTick(deps, now, results, changes);
    return results;
}

/** `ops-tick`: one Cloud Scheduler job every 15 minutes (inside the free three), one instance, no retry (the next tick). */
export function tickFunction(getDeps: () => OpsDeps) {
    const options = {
        schedule: OPS_TICK_SCHEDULE,
        timeZone: 'UTC',
        retryCount: 0,
        maxInstances: 1,
        timeoutSeconds: 540,
        ...runAs('ops.tick'),
    } as const;
    return onSchedule(options, async () => {
        await runTick(getDeps());
    });
}
