/**
 * The approval policy (`docs/research/M3-interfaces.md` §7.1; S-A17-*): when the pipeline registers a rendered version,
 * its compute-unit estimate is recorded and it is approved on its own, by `system:imagery`, when the city auto-publishes,
 * the georeference was measured (an upload's own georeference never is: S-A17-BAD-EMBEDDED-GEOREF) and its checkpoint
 * error is within the city's threshold over at least three checks. M9 (`docs/research/M9-calibration.md` §11): those checks must be
 * held out from the fit, or a frame checked only on its own points waits (S-A17-BAD-LEAVE-ONE-OUT), and a USGS frame must cover the
 * city (S-A17-BAD-PART-OF-CITY: half a city would go public). The fit must be the proof's own (S-A17-BAD-NOT-PROVED): the matcher's checks
 * come from pairs its RANSAC already filtered, and a pair an admin disabled after reading its residual is no independent check, so
 * `held-out` alone says little off that path. No check of it may have been dropped as gross, and its tiles must span the frame
 * (S-A17-BAD-CHECKS-DROPPED, S-A17-BAD-UNMEASURED-AREA). A missing figure never approves. Otherwise it waits for Approve. M8
 * (`docs/research/M8-join-interfaces.md` §5): a frame made for a join never approves on its own, whether that join is live or
 * ended (half a city would go public), and a join has its own conditions, every one required: it has no georeference. M25
 * (`docs/research/M25-landsat.md` §5): a Landsat scene has none either; it approves on its own within a pixel of Sentinel-2 over a
 * clear city it covers.
 */
import {
    AUTO_MIN_MEASURED_PCT,
    CITY_MIN_COVERAGE_PCT,
    FIRESTORE_PATHS,
    cityDocSchema,
    estimateComputeUnits,
    imagerySettingsOf,
    jobDocSchema,
    landsatClear,
    layerVersionDocSchema,
    mapThresholdM,
    rightsAllowPublish,
    type ArchiveReport,
    precisionOf,
    timestampFromDate,
    type Georef,
    type ImagerySettings,
    type JoinReport,
    type JoinSeam,
    type LayerVersionDoc,
} from '@hcm/shared';

import { compact } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { enqueuePublish, type PublishReason } from './publish-queue.js';
import { replaceWaitingBase } from './recalibrate-replace.js';
import { IMAGERY_WRITER, stampOf, versionIdOf } from './records.js';

export type ApprovalDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'tasks'>;

/** A georeference is trusted on its own only with this many checks behind its checkpoint error. */
const MIN_CHECKPOINTS = 3;
/** A seam closed to more than this stays for an admin's eye, whatever the city's own threshold. */
const JOIN_MAX_SEAM_M = 15;

type Output = NonNullable<LayerVersionDoc['output']>;
type Rendered = LayerVersionDoc & { readonly output: Output };

/** The version's compute-unit estimate (its area at its maximum zoom), as the guard and the approval card read it. */
export function estimateOf(output: Output, now: Date): NonNullable<LayerVersionDoc['estimate']> {
    return {
        computeUnits: estimateComputeUnits(output.areaKm2, output.maxzoom),
        precision: precisionOf(output.maxzoom),
        areaKm2: output.areaKm2,
        at: timestampFromDate(now),
    };
}

/** What a georeference must show to publish on its own, each condition on its own. */
const GEOREF_CONDITIONS: readonly ((georef: Georef, threshold: number) => boolean)[] = [
    (georef) => georef.method === 'auto',
    (georef) => georef.checkpointKind === 'held-out',
    (georef) => (georef.checkpointCount ?? 0) >= MIN_CHECKPOINTS,
    (georef, threshold) => (georef.checkpointRmseM ?? Number.POSITIVE_INFINITY) <= threshold,
];

/** A fit of the proof's own tiles (never an upload's georeference, the matcher's or an admin's points) and within `threshold` over enough of them. */
function measuredWithin(georef: Georef, threshold: number): boolean {
    return GEOREF_CONDITIONS.every((condition) => condition(georef, threshold));
}

/** A USGS frame holds the city (an upload is exempt: a 1911 plan of the centre is whole), a missing figure never does. */
function frameCoversCity(version: Rendered): boolean {
    return version.source?.kind !== 'usgs' || (version.output.coveragePct ?? 0) >= CITY_MIN_COVERAGE_PCT;
}

type Calibration = NonNullable<LayerVersionDoc['calibration']>;

/** How a frame's fit may have come about for it to publish itself: every other has no proof behind its figure. */
const PROVED_HOWS: ReadonlySet<Calibration['how']> = new Set<Calibration['how']>(['votes', 'pass', 'points', 'local-ai']);

/** What `calibration` must show, each condition on its own. */
const CALIBRATION_CONDITIONS: readonly ((calibration: Calibration) => boolean)[] = [
    (calibration) => PROVED_HOWS.has(calibration.how),
    (calibration) => calibration.refusal === undefined,
    (calibration) => (calibration.checksDropped ?? 0) === 0,
    (calibration) => (calibration.measuredPct ?? 0) >= AUTO_MIN_MEASURED_PCT,
];

/** The proof holds the version's fit, none of its checks went as gross, and its tiles span the frame; no record proves nothing. */
function provedWhole({ calibration }: LayerVersionDoc): boolean {
    return calibration !== undefined && CALIBRATION_CONDITIONS.every((condition) => condition(calibration));
}

/**
 * What an archive series' placement must show to publish on its own (M20 §5), each condition on its own: a placement the pipeline
 * made (never the owner's points alone), enough held-out checks within the threshold, none dropped as gross, the rival search
 * clean, and the agreeing checks spanning the map's own extent.
 */
const ARCHIVE_CONDITIONS: readonly ((report: ArchiveReport, threshold: number) => boolean)[] = [
    // Batch 4: a grid placed from its sheets' names alone is its owner's call, never the policy's.
    (report) => report.method !== 'gcps' && report.method !== 'grid-names',
    (report) => report.checkpointCount >= MIN_CHECKPOINTS && report.checksDropped === 0,
    (report, threshold) => (report.checkpointRmseM ?? Number.POSITIVE_INFINITY) <= threshold,
    (report) => report.rivalClean && report.measuredPct >= AUTO_MIN_MEASURED_PCT,
];

function archiveWithin(report: ArchiveReport, threshold: number): boolean {
    return ARCHIVE_CONDITIONS.every((condition) => condition(report, threshold));
}

/** A seam the pipeline measured, corrected, and found closed. */
function seamClosed(seam: JoinSeam): boolean {
    return seam.measured && seam.applied && (seam.afterRmseM ?? Number.POSITIVE_INFINITY) <= JOIN_MAX_SEAM_M;
}

/** What a join must show to publish on its own, each condition on its own. */
const JOIN_CONDITIONS: readonly ((join: JoinReport, threshold: number) => boolean)[] = [
    (join, threshold) => (join.checkpointRmseM ?? Number.POSITIVE_INFINITY) <= threshold,
    (join) => join.checkpointCount >= MIN_CHECKPOINTS,
    (join, threshold) => join.maxShiftM <= threshold,
    (join) => join.seams.length > 0 && join.seams.every(seamClosed),
    (join) => join.coveragePct >= CITY_MIN_COVERAGE_PCT,
];

function joinWithin(join: JoinReport, threshold: number): boolean {
    return JOIN_CONDITIONS.every((condition) => condition(join, threshold));
}

/**
 * A version's own evidence: its georeference, a join's report, or (M25) a Landsat scene's: within a pixel of Sentinel-2 over a clear
 * city that it covers (public domain: no rights to confirm); none means no evidence.
 */
function evidenceWithin(version: Rendered, threshold: number): boolean {
    if (version.landsat !== undefined) {
        return landsatClear(version.landsat) && frameCoversCity(version);
    }
    return version.georef === undefined ? joinEvidenceWithin(version, threshold) : georefEvidenceWithin(version, version.georef, threshold);
}

/** A frame's fit within the threshold, proved whole, over the city. */
function georefEvidenceWithin(version: Rendered, georef: Georef, threshold: number): boolean {
    return measuredWithin(georef, threshold) && provedWhole(version) && frameCoversCity(version);
}

/** A join's report within the threshold; no report is no evidence. */
function joinEvidenceWithin(version: Rendered, threshold: number): boolean {
    return version.join !== undefined && joinWithin(version.join, threshold);
}

/**
 * The threshold the version answers to: the city's, or (M20, `docs/research/M20-import-local.md` §5) for a drawn map of an archive,
 * 1 mm of its paper capped by the city's `mapThresholdMaxM`, none for a map of no known scale (it never publishes itself).
 */
function thresholdOf(version: LayerVersionDoc, settings: ImagerySettings): number | undefined {
    if (version.origin !== 'archive') {
        return settings.rmseThresholdM;
    }
    return mapThresholdM(settings.rmseThresholdM, version.archive?.scaleDenominator, settings.mapThresholdMaxM);
}

/** True when the version may be published without anyone's click. M16: a recalibration is first seen beside the current one, always. */
function autoApproves(version: Rendered, settings: ImagerySettings): boolean {
    if (version.origin === 'archive') {
        return archiveApproves(version, settings);
    }
    return settings.autoPublish && version.recalibration === undefined && evidenceWithin(version, settings.rmseThresholdM);
}

/** M20 (§5, §7): a series publishes itself only with both switches on, its rights clear and its evidence within its own threshold. */
function archiveApproves(version: Rendered, settings: ImagerySettings): boolean {
    const threshold = thresholdOf(version, settings);
    const report = version.archive;
    return archiveAllowed(version, settings) && threshold !== undefined && report !== undefined && archiveWithin(report, threshold);
}

/** Both switches on (`autoPublish`, `mapAutoPublish`) and the series' rights clear. */
function archiveAllowed(version: Rendered, settings: ImagerySettings): boolean {
    return settings.autoPublish && settings.mapAutoPublish && rightsAllowPublish(version.rights);
}

/**
 * The checkpoint error a version answers for: its georeference's, the worst frame's of a join, an archive series' blocked figure, or
 * (M25) a Landsat scene's shift from Sentinel-2.
 */
function measuredRmseOf(version: LayerVersionDoc): number | undefined {
    return version.georef?.checkpointRmseM ?? reportedRmseOf(version) ?? version.landsat?.offsetM;
}

/** A version of many scans: the worst frame's of a join, or an archive series' blocked figure. */
function reportedRmseOf(version: LayerVersionDoc): number | undefined {
    return version.join?.checkpointRmseM ?? version.archive?.checkpointRmseM;
}

/** The version approved: by the policy (`auto`, with the error and the threshold it met) or by an admin. */
export function approved(version: LayerVersionDoc, by: string, now: Date, settings?: ImagerySettings): LayerVersionDoc {
    const approval = compact<NonNullable<LayerVersionDoc['approval']>>({
        auto: settings !== undefined,
        by,
        at: timestampFromDate(now),
        checkpointRmseM: settings === undefined ? undefined : measuredRmseOf(version),
        thresholdM: settings === undefined ? undefined : thresholdOf(version, settings),
    });
    return { ...version, state: 'approved', approval, ...stampOf(by, now) };
}

/** Queues the version's publish; the reason names the task, so a second approval of the same job queues nothing. */
export function queuePublish(deps: ApprovalDeps, cityId: string, jobId: string, reason: PublishReason): Promise<boolean> {
    return enqueuePublish(deps.tasks, { cityId, jobId }, reason);
}

function isRendered(version: LayerVersionDoc | undefined): version is Rendered {
    return version?.state === 'awaiting_approval' && version.output !== undefined;
}

interface Awaiting {
    readonly path: string;
    readonly version: Rendered;
    readonly settings: ImagerySettings;
    /** A join named this frame: the policy records its estimate and leaves it for that join, or for an admin once it ended. */
    readonly held: boolean;
}

/** The job's rendered version while both await approval, with the city's settings. */
async function readAwaiting(transaction: DocumentTransaction, cityId: string, jobId: string): Promise<Awaiting | undefined> {
    const job = await transaction.get(FIRESTORE_PATHS.job(cityId, jobId), jobDocSchema);
    if (job?.status !== 'awaiting_approval') {
        return undefined;
    }
    const path = FIRESTORE_PATHS.layerVersion(cityId, versionIdOf(jobId, job));
    const version = await transaction.get(path, layerVersionDocSchema);
    const city = await transaction.get(FIRESTORE_PATHS.city(cityId), cityDocSchema);
    if (!isRendered(version)) {
        return undefined;
    }
    return { path, version, settings: imagerySettingsOf(city?.imagery), held: version.partOf !== undefined };
}

async function policyIn(transaction: DocumentTransaction, cityId: string, jobId: string, now: Date): Promise<boolean> {
    const awaiting = await readAwaiting(transaction, cityId, jobId);
    if (awaiting === undefined) {
        return false;
    }
    // M16 (docs/research/M16-recalibrate.md §4, §5): a refine of a version waiting for approval replaces it now that it is rendered, and a
    // recalibration keeps its figures only when they measure against the layer's published version.
    const recorded = await replaceWaitingBase(transaction, cityId, awaiting.version, now);
    const estimated: Rendered = {
        ...recorded,
        output: awaiting.version.output,
        estimate: estimateOf(awaiting.version.output, now),
        ...stampOf(IMAGERY_WRITER, now),
    };
    const auto = !awaiting.held && autoApproves(estimated, awaiting.settings);
    await transaction.set(
        awaiting.path,
        layerVersionDocSchema,
        auto ? approved(estimated, IMAGERY_WRITER, now, awaiting.settings) : estimated,
    );
    return auto;
}

/**
 * The policy on a job that just reached `awaiting_approval` (`imagery.onJobWrite`): records the estimate, approves the
 * version when the policy allows and queues its publish. Returns whether it approved.
 */
export async function applyApprovalPolicy(deps: ApprovalDeps, cityId: string, jobId: string): Promise<boolean> {
    const now = deps.clock.now();
    const approvedNow = await deps.documents.transaction((transaction) => policyIn(transaction, cityId, jobId, now));
    if (approvedNow) {
        await queuePublish(deps, cityId, jobId, 'auto');
    }
    deps.log.info('approval policy applied', { cityId, jobId, approved: approvedNow });
    return approvedNow;
}
