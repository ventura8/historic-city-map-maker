import '../global-options.js';

import {
    EXPORT_LIMITS,
    EXPORT_QUEUE,
    FIRESTORE_PATHS,
    OPEN_EXPORT_STATES,
    STORAGE_PATHS,
    cityDocSchema,
    cityExportDocSchema,
    opsGuardDocSchema,
    systemWriter,
    timestampFromDate,
    timestampToDate,
    type CallableRequest,
    type CallableResponse,
    type CityExportDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { UpstreamError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';

export type ExportStartDeps = Pick<Ports, 'documents' | 'blobs' | 'tasks' | 'clock' | 'log' | 'kit'>;

type Request = CallableRequest<'export.start'>;

const MINUTE_MS = 60_000;

/**
 * An open export older than its build may run, plus the queue's own delay, is not waiting for anything any more: it no
 * longer blocks a new one (`ops.tick`'s `exports` step marks it failed).
 */
const STALE_OPEN_EXPORT_MS = (EXPORT_LIMITS.buildMinutes + 10) * MINUTE_MS;

/** The first instant of `now`'s UTC day. */
function utcDayStart(now: Date): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * `x-<YYYYMMDD>-<n>`: the day's `n`-th export of the city. Two owners racing for the same `n` compute the same id, so the
 * second create conflicts (`apiError.export.busy`) instead of building twice.
 */
export function exportIdFor(now: Date, ordinal: number): string {
    return `x-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${String(ordinal)}`;
}

/** The task's id: the city and the export (Cloud Tasks ids are per queue, and two cities share export ids). */
export function exportTaskId(cityId: string, exportId: string): string {
    return `${cityId}--${exportId}`;
}

/** `apiError.export.noManifest` until the city has been published once (no manifest in the public bucket). */
async function refuseUnpublished(deps: ExportStartDeps, cityId: string): Promise<void> {
    if ((await deps.blobs.stat('public', STORAGE_PATHS.manifest(cityId))) === undefined) {
        throw new ApiError('apiError.export.noManifest');
    }
}

async function refuseRedGuard(deps: ExportStartDeps): Promise<void> {
    if ((await deps.documents.get(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema))?.state === 'red') {
        throw new ApiError('apiError.guardPaused');
    }
}

/** `apiError.export.busy` while an export of the city is queued or building (one stuck past its time does not count). */
async function refuseOpenExport(deps: ExportStartDeps, cityId: string, now: Date): Promise<void> {
    const open = await deps.documents.query(FIRESTORE_PATHS.cityExports(cityId), cityExportDocSchema, {
        where: [['state', 'in', [...OPEN_EXPORT_STATES]]],
    });
    const waiting = open.documents.filter(
        (record) => now.getTime() - timestampToDate(record.data.createdAt).getTime() < STALE_OPEN_EXPORT_MS,
    );
    if (waiting.length > 0) {
        throw new ApiError('apiError.export.busy');
    }
}

/** The city's exports a day (`limits.exportsPerDay`, set by `cities.setLimits`), else the default share. */
async function dailyLimitOf(deps: ExportStartDeps, cityId: string): Promise<number> {
    const city = await deps.documents.get(FIRESTORE_PATHS.city(cityId), cityDocSchema);
    if (city === undefined) {
        throw new ApiError('apiError.notFound');
    }
    return Math.min(city.limits?.exportsPerDay ?? EXPORT_LIMITS.perDayDefault, EXPORT_LIMITS.perDayMax);
}

/** The ordinal of today's next export; `apiError.export.dailyLimit {limit}` when today's are used up. */
async function nextOrdinal(deps: ExportStartDeps, cityId: string, now: Date): Promise<number> {
    const limit = await dailyLimitOf(deps, cityId);
    const today = await deps.documents.count(FIRESTORE_PATHS.cityExports(cityId), [
        ['createdAt', '>=', timestampFromDate(utcDayStart(now))],
    ]);
    if (today >= limit) {
        throw new ApiError('apiError.export.dailyLimit', { limit: String(limit) });
    }
    return today + 1;
}

async function createRecord(deps: ExportStartDeps, path: string, record: CityExportDoc): Promise<void> {
    try {
        await deps.documents.create(path, cityExportDocSchema, record);
    } catch (error) {
        throw error instanceof UpstreamError && error.failure === 'conflict' ? new ApiError('apiError.export.busy') : error;
    }
}

/** A task that could not be queued leaves a failed record, so the card offers Export again at once. */
async function enqueueBuild(deps: ExportStartDeps, cityId: string, exportId: string, record: CityExportDoc): Promise<void> {
    try {
        await deps.tasks.enqueue(EXPORT_QUEUE, { cityId, exportId }, { id: exportTaskId(cityId, exportId) });
    } catch (error) {
        deps.log.error('export task not queued', { cityId, exportId, error: String(error) });
        const failed = { ...record, state: 'failed', error: 'apiError.unavailable', updatedBy: systemWriter('export') } as const;
        await deps.documents.set(FIRESTORE_PATHS.cityExport(cityId, exportId), cityExportDocSchema, failed);
        throw new ApiError('apiError.unavailable');
    }
}

/**
 * `export.start` (a city's owners; `docs/research/M5-interfaces.md` §5.3; S-A53-*): refuses a city never published
 * (`apiError.export.noManifest`), a red budget guard (`apiError.guardPaused`), an export already under way
 * (`apiError.export.busy`) and the city's exports of the day used up (`apiError.export.dailyLimit {limit}`); then records
 * the export `queued` and queues its build on `EXPORT_QUEUE`.
 */
async function exportStart(deps: ExportStartDeps, caller: VerifiedCaller, request: Request): Promise<CallableResponse<'export.start'>> {
    const { cityId } = request;
    const now = deps.clock.now();
    await refuseUnpublished(deps, cityId);
    await refuseRedGuard(deps);
    await refuseOpenExport(deps, cityId, now);
    const exportId = exportIdFor(now, await nextOrdinal(deps, cityId, now));
    const record: CityExportDoc = {
        state: 'queued',
        requestedBy: caller.uid,
        rasters: request.rasters,
        engineVersion: await deps.kit.engineVersion(),
        createdAt: timestampFromDate(now),
        updatedBy: caller.uid,
        updatedAt: timestampFromDate(now),
    };
    await createRecord(deps, FIRESTORE_PATHS.cityExport(cityId, exportId), record);
    await enqueueBuild(deps, cityId, exportId, record);
    deps.log.info('export queued', { uid: caller.uid, cityId, exportId, rasters: request.rasters });
    return { exportId };
}

/** The `export-start` callable. */
export function exportStartFunction(getDeps: () => ExportStartDeps & CallableDeps) {
    return defineCallable('export.start', exportStart, getDeps);
}
