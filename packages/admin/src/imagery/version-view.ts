/**
 * A layer version and its job as the version's page shows them (`docs/research/M3-interfaces.md` §2.2–§2.4, §7, §10.2):
 * where it stands, its georeference and output, the compute-unit estimate and the guard's verdict, how it was approved;
 * the job's steps in the order its type runs them, its progress, wait and error; and the approval card's figures (the
 * checkpoint RMSE against the city's threshold, what publishing costs and what is left this month).
 */
import {
    availableComputeUnits,
    bboxFromRecord,
    helpFlagsOf,
    estimateComputeUnits,
    isApiErrorCode,
    JOB_STEPS,
    jobRetryable,
    rightsAllowPublish,
    type ArchiveReport,
    type BBox,
    type Calibration,
    type CheckpointKind,
    type GeorefTransform,
    type JobDoc,
    type JobStatus,
    type JobWaitReason,
    type JoinPart,
    type JoinReport,
    type LandsatReport,
    type LngLat,
    type LayerVersionDoc,
    type LayerVersionState,
    type PublishChoice,
    type Recalibration,
    type Rights,
    type Sensor,
    type UsageCounters,
    type VersionTiles,
} from '@hcm/shared';

import { isoOf } from '../content/list.js';
import type { Stored } from '../content/services.js';
import { ACTIVE_JOB_STATUSES } from '../jobs/jobs.js';
import type { NoticeInput } from '../state/state.js';
import { isoOrNull, orNull } from './model.js';

export interface VersionView {
    readonly id: string;
    readonly layerId: string;
    readonly label: LayerVersionDoc['label'];
    readonly year: number;
    readonly date: string | null;
    readonly sensor: Sensor | null;
    readonly origin: LayerVersionDoc['origin'];
    readonly state: LayerVersionState;
    readonly georef: {
        readonly method: string;
        readonly transform: GeorefTransform;
        readonly pairs: number;
        readonly fitRmseM: number | null;
        readonly checkpointRmseM: number | null;
        readonly checkpointCount: number | null;
        readonly checkpointKind: CheckpointKind | null;
    } | null;
    /** M9: how `locate` found the frame and what proved it (`docs/research/M9-calibration.md` §8). */
    readonly calibration: Calibration | null;
    /** M25: what `warp` measured of a Landsat scene (its shift from Sentinel-2, the city's cloud); null for every other version. */
    readonly landsat: LandsatReport | null;
    readonly output: {
        readonly bounds: BBox;
        readonly minzoom: number;
        readonly maxzoom: number;
        readonly areaKm2: number;
        readonly previewPath: string;
        readonly studioPath: string | null;
        readonly cogBytes: number;
        readonly coveragePct: number | null;
        /** M12: the version's own tiles (null: none yet); its size is what publishing puts in the public bucket. */
        readonly tiles: { readonly path: string; readonly bytes: number } | null;
        /** The image's measured edge over the city (null: not measured): the map shades what it misses. */
        readonly outline: readonly LngLat[] | null;
    } | null;
    readonly estimate: number | null;
    readonly guard: {
        readonly verdict: 'within' | 'over' | 'tileset-limit' | 'too-large' | 'city-over';
        readonly available: number;
        readonly overageUsd: number | null;
        readonly choice: PublishChoice | null;
        readonly deferUntil: string | null;
    } | null;
    readonly approval: { readonly auto: boolean; readonly by: string; readonly at: string } | null;
    readonly error: NoticeInput | null;
    /** The georeferencer can open it: it has a scan. */
    readonly hasScan: boolean;
    /** The USGS scene it came from. */
    readonly entityId: string | null;
    /** M8: the join that holds this frame, a join's frames, and what the join measured. */
    readonly partOf: string | null;
    readonly parts: readonly JoinPart[];
    readonly join: JoinReport | null;
    /** M16: the version it recalibrates, how and with what figures, and its own public archive (a published one). */
    readonly basedOn: string | null;
    readonly recalibration: Recalibration | null;
    readonly publicUrl: string | null;
    /** Batch 4: an archive series' placement report. */
    readonly archive: ArchiveReport | null;
    /** An archive series waiting with `layout-check`: the tile-import wizard opens it (`helpFlagsOf`, M20 §19). */
    readonly layoutCheck: boolean;
    /** M20 (§216): published with pieces left out of its overview mosaic: Locate again lays it on it again. */
    readonly restitchable: boolean;
    /**
     * M20 (§7): the series' rights as the approval card shows them (null: no rights, USGS and uploads). Approve waits
     * until `allowPublish` (Confirm the rights when `state` is `needs-confirmation`).
     */
    readonly rights: {
        readonly state: Rights['state'];
        readonly licence: Rights['licence'];
        readonly year: string;
        readonly note: string | null;
        readonly confirmedBy: string | null;
        readonly allowPublish: boolean;
    } | null;
    /** Finding of 2026-11-14: an archive map, offered **Join with…**. */
    readonly archiveMap: boolean;
    /** Whether the version's own job cancelled it (e.g. Snap my points with few inliers). */
    readonly selfCancelled: boolean;
}

/** M16: the public archive a published version is drawn from (none once its grace ended and it was removed). */
function publicUrlOf(own: LayerVersionDoc['own']): string | null {
    return own === undefined || own.removedAt !== undefined ? null : own.url;
}

function georefOf(georef: LayerVersionDoc['georef']): VersionView['georef'] {
    if (georef === undefined) {
        return null;
    }
    return {
        ...{ method: georef.method, transform: georef.transform, pairs: georef.gcps.filter((gcp) => gcp.enabled).length },
        ...{
            fitRmseM: orNull(georef.fitRmseM),
            checkpointRmseM: orNull(georef.checkpointRmseM),
            checkpointCount: orNull(georef.checkpointCount),
            checkpointKind: orNull(georef.checkpointKind),
        },
    };
}

function tilesOf(tiles: VersionTiles | undefined): NonNullable<VersionView['output']>['tiles'] {
    return tiles === undefined ? null : { path: tiles.path, bytes: tiles.bytes };
}

/** The edge `export` read off the picture's alpha, else the one `locate` measured through the proved map. */
function outlineOf(version: LayerVersionDoc): readonly LngLat[] | null {
    const outline = version.output?.outline ?? version.calibration?.outline;
    return outline === undefined ? null : outline.map((place): LngLat => [place.lng, place.lat]);
}

function outputOf(version: LayerVersionDoc): VersionView['output'] {
    const { output } = version;
    if (output === undefined) {
        return null;
    }
    return {
        ...{ bounds: bboxFromRecord(output.bounds), minzoom: output.minzoom, maxzoom: output.maxzoom, areaKm2: output.areaKm2 },
        ...{ previewPath: output.previewPath, studioPath: orNull(output.studioPath), cogBytes: output.cogBytes ?? 0 },
        ...{ coveragePct: orNull(output.coveragePct), tiles: tilesOf(output.tiles), outline: outlineOf(version) },
    };
}

function guardOf(guard: LayerVersionDoc['guard']): VersionView['guard'] {
    if (guard === undefined) {
        return null;
    }
    return {
        ...{ verdict: guard.verdict, available: guard.available, overageUsd: orNull(guard.overageUsd), choice: orNull(guard.choice) },
        deferUntil: isoOrNull(guard.deferUntil),
    };
}

function approvalOf(approval: LayerVersionDoc['approval']): VersionView['approval'] {
    return approval === undefined ? null : { auto: approval.auto, by: approval.by, at: isoOf(approval.at) };
}

/** M20: the rights summary the approval card needs (Confirm, and whether Approve may run). */
function rightsOf(rights: LayerVersionDoc['rights']): VersionView['rights'] {
    if (rights === undefined) {
        return null;
    }
    return {
        state: rights.state,
        licence: rights.licence,
        year: rights.year,
        note: orNull(rights.note),
        confirmedBy: orNull(rights.confirmedBy),
        allowPublish: rightsAllowPublish(rights),
    };
}

function errorOf(error: LayerVersionDoc['error']): NoticeInput | null {
    if (error === undefined) {
        return null;
    }
    return error.params === undefined ? { key: error.code } : { key: error.code, params: error.params };
}

/** The estimate the publisher recorded, else the same formula over the output. */
function estimateOf(version: LayerVersionDoc): number | null {
    const output = version.output;
    if (version.estimate !== undefined) {
        return version.estimate.computeUnits;
    }
    return output === undefined ? null : estimateComputeUnits(output.areaKm2, output.maxzoom);
}

/** A version's frames and scene, as its source names them. */
function sourceOf(source: LayerVersionDoc['source']): Pick<VersionView, 'entityId' | 'parts'> {
    if (source?.kind === 'join') {
        return { entityId: null, parts: source.parts };
    }
    return { entityId: source?.kind === 'usgs' ? source.entityId : null, parts: [] };
}

export function versionViewOf(doc: Stored<LayerVersionDoc>): VersionView {
    const version = doc.data;
    return {
        ...{ id: doc.id, layerId: version.layerId, label: version.label, year: version.year, date: orNull(version.date) },
        ...{ sensor: orNull(version.sensor), origin: version.origin, state: version.state, georef: georefOf(version.georef) },
        calibration: orNull(version.calibration),
        landsat: orNull(version.landsat),
        ...{ output: outputOf(version), estimate: estimateOf(version), guard: guardOf(version.guard) },
        ...{ approval: approvalOf(version.approval), error: errorOf(version.error), hasScan: version.scan !== undefined },
        ...{ ...sourceOf(version.source), partOf: orNull(version.partOf), join: orNull(version.join) },
        ...{ basedOn: orNull(version.basedOn), recalibration: orNull(version.recalibration), publicUrl: publicUrlOf(version.own) },
        archive: orNull(version.archive),
        archiveMap: version.source?.kind === 'archive',
        ...helpFlagsOf(version),
        rights: rightsOf(version.rights),
        selfCancelled: version.state === 'cancelled' && version.cancelledBy === 'self',
    };
}

interface JobStepView {
    readonly name: string;
    readonly status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
    /** A running transfer's bytes so far and its total (null: unknown), else null (finding 55 of 2026-11-01). */
    readonly transfer: { readonly received: number; readonly total: number | null } | null;
}

export interface JobView {
    readonly id: string;
    readonly type: JobDoc['type'];
    readonly status: JobStatus;
    readonly finished: boolean;
    readonly progress: number | null;
    readonly step: string | null;
    /** Every step of the job's type, in order, with its state (`pending` until the job records one). */
    readonly steps: readonly JobStepView[];
    readonly waitReason: JobWaitReason | null;
    readonly retryAt: string | null;
    readonly attempt: number;
    readonly cancelRequested: boolean;
    readonly error: { readonly notice: NoticeInput; readonly message: string } | null;
    /** Retry may cure the failure (`jobRetryable`, CR-M3-47). */
    readonly retryable: boolean;
    /** Mapbox was asked to publish (its job recorded, or the call under way): Cancel can no longer stop it. */
    readonly atMapbox: boolean;
    /** An upload the server refused: its job failed before any version (no layer reserved). */
    readonly refusedUpload: boolean;
}

type StepRecord = NonNullable<JobDoc['steps']>[string];

/** The bytes a running step has received, when it reports them. */
function transferOf(step: StepRecord | undefined): JobStepView['transfer'] {
    return step?.status === 'running' && step.bytes !== undefined ? { received: step.bytes, total: orNull(step.totalBytes) } : null;
}

/**
 * A step's state as the page shows it: a step a failed job left `running` (the run died in it: finding 61 of 2026-11-02,
 * an out-of-memory exit the tick failed the job for) is `failed`.
 */
function shownStatus(job: JobDoc, step: StepRecord | undefined): JobStepView['status'] {
    const status = step?.status ?? 'pending';
    return status === 'running' && job.status === 'failed' ? 'failed' : status;
}

function stepsOf(job: JobDoc): JobStepView[] {
    const recorded = job.steps ?? {};
    return JOB_STEPS[job.type].map((name) => {
        const status = shownStatus(job, recorded[name]);
        return { name, status, transfer: status === 'running' ? transferOf(recorded[name]) : null };
    });
}

/** A job's error code as a notice: an `apiError.*` code with its parameters (a code from before M3 reads as internal). */
function jobNotice(error: NonNullable<JobDoc['error']>): NoticeInput {
    if (!isApiErrorCode(error.code)) {
        return { key: 'apiError.internal' };
    }
    return error.params === undefined ? { key: error.code } : { key: error.code, params: error.params };
}

/**
 * The owner's rule of 2026-11-13: a failure whose sentence already says the cause and the fix shows no technical line under it (an
 * archive series' "no record of ar-… on this computer" named an id); the detail stays in the job's record and its log.
 */
const PLAIN_ONLY: ReadonlySet<string> = new Set(['apiError.imagery.archiveMissing']);

/**
 * The job's error: its notice, and its technical detail unless that is only the code again (finding 60 of 2026-11-02: a
 * failure the server wrote with the code as its message, `apiError.imagery.outOfMemory`, showed the raw code under the
 * translated sentence; the code stays in the job's record, which the Jobs page shows).
 */
function jobErrorOf(error: JobDoc['error']): JobView['error'] {
    if (error === undefined) {
        return null;
    }
    const detail = error.message === error.code || isApiErrorCode(error.message) || PLAIN_ONLY.has(error.code) ? '' : error.message;
    return { notice: jobNotice(error), message: detail };
}

/** Mapbox was asked to publish: the MTS job is recorded, or the publish call is (or was) under way. */
function atMapbox(job: JobDoc): boolean {
    const publish = job.steps?.['publish']?.status;
    return job.mapboxJobId !== undefined || publish === 'running' || publish === 'done';
}

export function jobViewOf(doc: Stored<JobDoc>): JobView {
    const job = doc.data;
    return {
        ...{ id: doc.id, type: job.type, status: job.status, finished: !ACTIVE_JOB_STATUSES.includes(job.status) },
        ...{ progress: orNull(job.progress), step: orNull(job.step), steps: stepsOf(job), waitReason: orNull(job.waitReason) },
        ...{ retryAt: isoOrNull(job.retryAt), attempt: orNull(job.attempt) ?? 0, cancelRequested: job.cancelRequested === true },
        ...{ error: jobErrorOf(job.error), retryable: jobRetryable(job), atMapbox: atMapbox(job) },
        refusedUpload: job.status === 'failed' && job.type === 'geotiff-import' && job.layerId === undefined,
    };
}

/** The approval card's numbers. */
export interface ApprovalFigures {
    /** Compute units the publish takes (null: no output yet). */
    readonly estimate: number | null;
    /** Compute units left this month. */
    readonly available: number;
    readonly fits: boolean;
    readonly checkpointRmseM: number | null;
    readonly thresholdM: number;
    /** Over the threshold (or never measured): the version waits for Approve. */
    readonly overThreshold: boolean;
}

/** The checkpoint error: its georeference's, or a join's (its worst frame's; a join has no georeference). */
function checkpointOf(version: VersionView): number | null {
    return version.georef?.checkpointRmseM ?? version.join?.checkpointRmseM ?? null;
}

export function approvalFigures(version: VersionView, usage: UsageCounters | undefined, thresholdM: number): ApprovalFigures {
    const available = availableComputeUnits(usage, version.id);
    const rmse = checkpointOf(version);
    return {
        ...{ estimate: version.estimate, available, fits: (version.estimate ?? 0) <= available },
        ...{ checkpointRmseM: rmse, thresholdM, overThreshold: rmse === null || rmse > thresholdM },
    };
}
