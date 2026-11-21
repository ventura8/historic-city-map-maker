/**
 * The maintenance parts of `imagery.tick` (`docs/research/M3-interfaces.md` §3.5, §4.6 steps 4–7): deferred publishes
 * whose month came and publishes the budget guard paused (the guard runs again), due layer deletions, the files of
 * versions ended more than 30 days ago, and the monthly USGS harvest of a city whose recorded attempt says it is due
 * (`ops/harvest-{city}`; before any attempt was recorded, of a city whose newest scene is older than `HARVEST_EVERY_DAYS`;
 * never of a city not yet harvested: its first visit does that). A harvest USGS refuses for the credentials or the
 * access marks `setup/status.usgs` (CR-M3-47), which stops the tick's harvests until the admin fixes it in Setup.
 */
import {
    ENDED_VERSION_STATES,
    FIRESTORE_PATHS,
    HARVEST_EVERY_DAYS,
    jobDocSchema,
    layerVersionDocSchema,
    timestampToDate,
    usageMonth,
    usgsSceneDocSchema,
    type LayerVersionDoc,
    type LayerVersionState,
} from '@hcm/shared';

import type { StoredDocument } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { dueByState, harvestStateOf } from './harvest-state.js';
import { harvestCity, type HarvestDeps } from './harvest.js';
import { runLayerDelete, type LayerDeleteDeps } from './layer-delete.js';
import { enqueuePublish } from './publish-queue.js';
import { IMAGERY_WRITER, stampOf, usgsRecord } from './records.js';
import { noteUsgsRefusal } from './usgs-status.js';
import { usgsSearchable } from './usgs-session.js';

export type TickMaintenanceDeps = Pick<Ports, 'tasks'> & LayerDeleteDeps & HarvestDeps;

const DAY_MS = 86_400_000;
/** An ended version's files are kept this long (a revert of a rejection, a look at what failed). */
const SWEEP_AFTER_DAYS = 30;
/** M8: a `joined` frame keeps its files: its layer's delete removes them (`layer-delete.ts`). */
const KEPT_FROM_SWEEP: ReadonlySet<LayerVersionState> = new Set<LayerVersionState>(['published', 'joined']);
const ENDED_FOR_SWEEP: readonly LayerVersionState[] = ENDED_VERSION_STATES.filter((state) => !KEPT_FROM_SWEEP.has(state));
const SWEPT: ReadonlySet<LayerVersionState> = new Set(ENDED_FOR_SWEEP);

/** A version the admin deferred, whose month has come. */
function deferralDue(version: LayerVersionDoc, now: Date): boolean {
    const guard = version.guard;
    return guard?.choice === 'defer' && guard.deferUntil !== undefined && timestampToDate(guard.deferUntil) <= now;
}

/** The publish the budget guard paused (it runs while the guard is green): queued once per pause (the job's stamp). */
async function resumePaused(deps: TickMaintenanceDeps, cityId: string, jobId: string): Promise<void> {
    const job = await deps.documents.get(FIRESTORE_PATHS.job(cityId, jobId), jobDocSchema);
    if (job?.status === 'awaiting_approval' && job.waitReason === 'guard') {
        await enqueuePublish(deps.tasks, { cityId, jobId }, `resumed-${String(timestampToDate(job.updatedAt).getTime())}`);
    }
}

/** Step 4: approved versions deferred to a month that has come, and those the budget guard paused, are published again. */
export async function publishDeferred(deps: TickMaintenanceDeps, cityId: string, now: Date): Promise<void> {
    const approved = await deps.documents.query(FIRESTORE_PATHS.layerVersions(cityId), layerVersionDocSchema, {
        where: [['state', '==', 'approved']],
    });
    for (const { data } of approved.documents) {
        await (deferralDue(data, now)
            ? enqueuePublish(deps.tasks, { cityId, jobId: data.jobId }, `deferred-${usageMonth(now)}`)
            : resumePaused(deps, cityId, data.jobId));
    }
}

/** Step 5: `layer-delete` jobs past their grace. */
export async function runDeletions(deps: TickMaintenanceDeps, cityId: string): Promise<void> {
    const due = await deps.documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, { where: [['type', '==', 'layer-delete']] });
    for (const { id } of due.documents.filter((job) => job.data.status === 'queued')) {
        await runLayerDelete(deps, cityId, id);
    }
}

/** The version's files under `rasters/{city}/{layer}/{version}/`, deleted; its stamp moves so the sweep skips it a month. */
async function sweep(deps: TickMaintenanceDeps, cityId: string, version: StoredDocument<LayerVersionDoc>): Promise<void> {
    const paths = await deps.blobs.list('private', `rasters/${cityId}/${version.data.layerId}/${version.id}/`);
    await Promise.all(paths.map((path) => deps.blobs.delete('private', path)));
    const touched = { ...version.data, ...stampOf(IMAGERY_WRITER, deps.clock.now()) };
    await deps.documents.set(FIRESTORE_PATHS.layerVersion(cityId, version.id), layerVersionDocSchema, touched);
}

function sweepable(version: LayerVersionDoc, limit: number): boolean {
    return SWEPT.has(version.state) && timestampToDate(version.updatedAt).getTime() < limit;
}

/**
 * True while another version still reads the scan in this version's folder: a re-georeference or a crop keeps its base's scan
 * (`regeoref.ts`) while the base ends `cancelled` or `superseded`, so the frame the admin sees, and any join of it, would lose it.
 */
async function scanStillRead(deps: TickMaintenanceDeps, cityId: string, version: StoredDocument<LayerVersionDoc>, limit: number) {
    const path = version.data.scan?.path;
    if (path?.startsWith(`rasters/${cityId}/${version.data.layerId}/${version.id}/`) !== true) {
        return false;
    }
    const readers = await deps.documents.query(FIRESTORE_PATHS.layerVersions(cityId), layerVersionDocSchema, {
        where: [['scan.path', '==', path]],
    });
    return readers.documents.some((reader) => reader.id !== version.id && !sweepable(reader.data, limit));
}

/** Step 6: the files of versions rejected, cancelled, failed or superseded more than 30 days ago, unless a later version reads their scan. */
export async function sweepEnded(deps: TickMaintenanceDeps, cityId: string, now: Date): Promise<void> {
    const limit = now.getTime() - SWEEP_AFTER_DAYS * DAY_MS;
    const ended = await deps.documents.query(FIRESTORE_PATHS.layerVersions(cityId), layerVersionDocSchema, {
        where: [['state', 'in', [...ENDED_FOR_SWEEP]]],
    });
    for (const version of ended.documents.filter((candidate) => sweepable(candidate.data, limit))) {
        if (!(await scanStillRead(deps, cityId, version, limit))) {
            await sweep(deps, cityId, version);
        }
    }
}

/** Before any recorded attempt: the city was harvested before and its newest scene is older than `HARVEST_EVERY_DAYS`. */
async function dueByScenes(deps: TickMaintenanceDeps, cityId: string, now: Date): Promise<boolean> {
    const newest = await deps.documents.query(FIRESTORE_PATHS.usgsScenes(cityId), usgsSceneDocSchema, {
        orderBy: ['harvestedAt', 'desc'],
        limit: 1,
    });
    const last = newest.documents[0]?.data.harvestedAt;
    return last !== undefined && timestampToDate(last).getTime() <= now.getTime() - HARVEST_EVERY_DAYS * DAY_MS;
}

/**
 * True when the city's recorded attempt says the next harvest is due; before any recorded attempt, when its newest scene
 * is older than `HARVEST_EVERY_DAYS`. A city never harvested waits for the Imagery area's first visit (CR-M3-44).
 */
async function harvestDue(deps: TickMaintenanceDeps, cityId: string, now: Date): Promise<boolean> {
    return dueByState(await harvestStateOf(deps, cityId), now) ?? dueByScenes(deps, cityId, now);
}

/** Step 7: the monthly harvest, while USGS can be searched (searching works before downloads are approved). */
export async function monthlyHarvest(deps: TickMaintenanceDeps, cityId: string, now: Date): Promise<void> {
    if (!usgsSearchable(await usgsRecord(deps.setup)) || !(await harvestDue(deps, cityId, now))) {
        return;
    }
    await harvestCity(deps, { cityId }).catch(async (error: unknown) => {
        await noteUsgsRefusal(deps, error, now);
        throw error;
    });
}
