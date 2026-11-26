/**
 * `imagery.tick`'s `ownTiles` part (`docs/research/M12-own-tiles.md`; S-A71-*): what was rendered or approved before tiles came from the
 * project's own bucket finds its way there, one version a tick. A version already `approved` and not at Mapbox, with its tiles, has its
 * compute-unit verdict and its choice cleared (nothing was charged by any of them) and publishes on its recorded approval. A rendered
 * version without tiles gets a `layer-tiles` job, one at a time, made from its COG; one only awaiting approval then waits, with its
 * picture, for its Approve. A frame a live join holds gets its picture and never publishes. A city that chose Mapbox is left alone.
 */
import {
    FIRESTORE_PATHS,
    cityDocSchema,
    fnv1a32,
    imagerySettingsOf,
    isSideJob,
    jobDocSchema,
    layerVersionDocSchema,
    timestampFromDate,
    timestampToDate,
    type JobDoc,
    type LayerVersionDoc,
} from '@hcm/shared';

import { omit } from '../api/objects.js';
import type { StoredDocument } from '../ports/documents.js';
import { UpstreamError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';
import { liveJoinOf } from './join-parts.js';
import { enqueuePublish } from './publish-queue.js';
import { IMAGERY_WRITER, stampOf } from './records.js';

export type OwnTilesSweepDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'tasks'>;

type StoredVersion = StoredDocument<LayerVersionDoc>;

/** Five minutes' rest after a version's last write: its own publish task may be on its way, and the sweep must not run beside it. */
const SETTLE_MS = 300_000;

/** The job of a version's tiles: one per version, so a failed one waits for its Retry instead of being made again each tick. */
export function tilesJobId(cityId: string, versionId: string): string {
    return `tiles-${fnv1a32([cityId, versionId].join('/'))}`;
}

async function versionsToSee(deps: OwnTilesSweepDeps, cityId: string): Promise<readonly StoredVersion[]> {
    const found = await deps.documents.query(FIRESTORE_PATHS.layerVersions(cityId), layerVersionDocSchema, {
        where: [['state', 'in', ['approved', 'awaiting_approval']]],
    });
    return found.documents;
}

function settled(version: LayerVersionDoc, now: Date): boolean {
    return timestampToDate(version.updatedAt).getTime() <= now.getTime() - SETTLE_MS;
}

/** Approved, with its tiles, and not at Mapbox. */
function readyToPublish({ data }: StoredVersion, now: Date): boolean {
    return data.state === 'approved' && data.output?.tiles !== undefined && data.mapbox === undefined && settled(data, now);
}

/** In one transaction: the verdict and the choice gone, the job back to waiting on nothing but this publish; false when it moved on. */
async function clearVerdict(deps: OwnTilesSweepDeps, cityId: string, stored: StoredVersion): Promise<boolean> {
    const versionPath = FIRESTORE_PATHS.layerVersion(cityId, stored.id);
    const jobPath = FIRESTORE_PATHS.job(cityId, stored.data.jobId);
    const stamp = stampOf(IMAGERY_WRITER, deps.clock.now());
    return deps.documents.transaction(async (transaction) => {
        const version = await transaction.get(versionPath, layerVersionDocSchema);
        const job = await transaction.get(jobPath, jobDocSchema);
        if (version?.state !== 'approved' || job?.status !== 'awaiting_approval') {
            return false;
        }
        await transaction.set(versionPath, layerVersionDocSchema, { ...omit(version, ['guard']), ...stamp });
        await transaction.set(jobPath, jobDocSchema, { ...job, waitReason: 'approval', ...stamp });
        return true;
    });
}

/** One approved version on its way; true when one was. A frame a live join holds waits for that join. */
async function publishOne(deps: OwnTilesSweepDeps, cityId: string, versions: readonly StoredVersion[], now: Date): Promise<boolean> {
    for (const version of versions.filter((candidate) => readyToPublish(candidate, now))) {
        const held = (await liveJoinOf(deps.documents, cityId, version.data)) !== undefined;
        if (!held && (await clearVerdict(deps, cityId, version))) {
            await enqueuePublish(deps.tasks, { cityId, jobId: version.data.jobId }, `own-${String(now.getTime())}`);
            deps.log.info('approved version goes to its own tiles', { cityId, versionId: version.id });
            return true;
        }
    }
    return false;
}

/** A version whose tiles can be made: rendered with a COG, none yet. */
function owesTiles({ data }: StoredVersion): boolean {
    return data.output !== undefined && data.output.tiles === undefined && data.output.cogPath !== undefined;
}

/** The queued job that makes them (`imagery.onJobWrite` dispatches it, with every limit a raster job has). */
function tilesJob(version: StoredVersion, now: Date): JobDoc {
    return {
        type: 'layer-tiles',
        status: 'queued',
        params: { versionId: version.id },
        createdBy: IMAGERY_WRITER,
        createdAt: timestampFromDate(now),
        layerId: version.data.layerId,
        versionId: version.id,
        ...stampOf(IMAGERY_WRITER, now),
    };
}

/** Made once: a job that exists, however it ended, is not made again. */
async function createTilesJob(deps: OwnTilesSweepDeps, cityId: string, version: StoredVersion, now: Date): Promise<boolean> {
    const jobId = tilesJobId(cityId, version.id);
    try {
        await deps.documents.create(FIRESTORE_PATHS.job(cityId, jobId), jobDocSchema, tilesJob(version, now));
        deps.log.info('tiles job queued', { cityId, jobId, versionId: version.id });
        return true;
    } catch (error) {
        if (error instanceof UpstreamError && error.failure === 'conflict') {
            return false;
        }
        throw error;
    }
}

const FINISHED: ReadonlySet<JobDoc['status']> = new Set<JobDoc['status']>(['succeeded', 'failed', 'cancelled']);

/** A tiles job that is still running or queued: the next one waits for it. */
async function tilesJobUnderWay(deps: OwnTilesSweepDeps, cityId: string): Promise<boolean> {
    const jobs = await deps.documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, { where: [['type', '==', 'layer-tiles']] });
    return jobs.documents.some((job) => isSideJob(job.data.type) && !FINISHED.has(job.data.status));
}

/** The version that owes the most first: one approved stands in front of one that may still be rejected. */
function approvedFirst(left: StoredVersion, right: StoredVersion): number {
    return Number(right.data.state === 'approved') - Number(left.data.state === 'approved');
}

async function queueOne(deps: OwnTilesSweepDeps, cityId: string, versions: readonly StoredVersion[], now: Date): Promise<void> {
    if (await tilesJobUnderWay(deps, cityId)) {
        return;
    }
    for (const version of versions.filter(owesTiles).sort(approvedFirst)) {
        if (await createTilesJob(deps, cityId, version, now)) {
            return;
        }
    }
}

/** One step of the way for this city. */
export async function sweepOwnTiles(deps: OwnTilesSweepDeps, cityId: string, now: Date): Promise<void> {
    const city = await deps.documents.get(FIRESTORE_PATHS.city(cityId), cityDocSchema);
    if (imagerySettingsOf(city?.imagery).publishThroughMapbox) {
        return;
    }
    const versions = await versionsToSee(deps, cityId);
    if (!(await publishOne(deps, cityId, versions, now))) {
        await queueOne(deps, cityId, versions, now);
    }
}
