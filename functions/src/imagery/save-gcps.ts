import '../global-options.js';

import {
    FIRESTORE_PATHS,
    JOB_MAX_ATTEMPTS,
    MIN_GCPS,
    fitTransform,
    jobDocSchema,
    layerVersionDocSchema,
    type CallableRequest,
    type CallableResponse,
    type FitRefusal,
    type Gcp,
    type Georef,
    type JobDoc,
    type LayerVersionDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import { gcpsInside } from './geometry.js';
import { requireCity, requireVersion, stampOf } from './records.js';
import { startRegeoref, type RegeorefDeps } from './regeoref.js';

/**
 * `imagery.saveGcps` (admin; `docs/research/M3-interfaces.md` §4.1, §6; S-A16-*, S-P02-*): the georeferencer's points,
 * refitted server-side with the same mathematics the page used (`fitTransform`), each pair on the scan and in the city.
 * A version waiting for points (`needs_gcps`) continues its own job from `georef`, with a run of its own even when the runs before
 * used up `JOB_MAX_ATTEMPTS` (an archive series from `place`, S-P20-HAPPY-OWNER-PAIRS) (S-A16-HAPPY-POINTS-AFTER-ATTEMPTS: Locate again spends them, and the points were accepted and then
 * failed the job for good); the layer's current version or one awaiting approval gets a new `regeoref` job and version, and the
 * layer keeps its tiles until that one is published.
 */
export type SaveGcpsDeps = RegeorefDeps;

type Request = CallableRequest<'imagery.saveGcps'>;
type Response = CallableResponse<'imagery.saveGcps'>;

/** The states a version is georeferenced again from (besides `needs_gcps`, which continues its own job). */
const REGEOREF_FROM: ReadonlySet<LayerVersionDoc['state']> = new Set<LayerVersionDoc['state']>(['published', 'awaiting_approval']);

function requireScan(version: LayerVersionDoc): NonNullable<LayerVersionDoc['scan']> {
    if (version.scan === undefined) {
        throw new ApiError('apiError.imagery.noScan');
    }
    return version.scan;
}

/** The pairs with the residuals of the fitted transform (an enabled pair that alone fixes it has none). */
function withResiduals(gcps: readonly Gcp[], residuals: ReadonlyMap<string, number>): Gcp[] {
    return gcps.map((gcp) => {
        const residualM = residuals.get(gcp.id);
        return residualM === undefined ? omit(gcp, ['residualM']) : { ...gcp, residualM };
    });
}

/** The code of each refusal of `fitTransform` (the request schema already counts the enabled pairs, as the page does). */
const REFUSALS: Readonly<Record<FitRefusal, (request: Request) => ApiError>> = {
    'too-few': (request) => new ApiError('apiError.imagery.tooFewGcps', { min: String(MIN_GCPS[request.transform]) }),
    degenerate: () => new ApiError('apiError.imagery.degenerateGcps'),
};

/** The points refitted: the transform's errors and every pair's residual, or the refusal the page also shows. */
function refitted(request: Request): Georef {
    const fit = fitTransform(request.transform, request.gcps);
    if (!fit.ok) {
        throw REFUSALS[fit.reason](request);
    }
    const checkpoint = fit.checkpointRmseM === null ? {} : { checkpointRmseM: fit.checkpointRmseM };
    // M9 (docs/research/M9-calibration.md §11): the policy tells checks held out of the fit from the pairs against each other.
    const kind = fit.checkpointKind === null ? {} : { checkpointKind: fit.checkpointKind };
    const gcps = withResiduals(request.gcps, fit.residuals);
    return {
        method: 'gcps',
        transform: request.transform,
        gcps,
        fitRmseM: fit.fitRmseM,
        ...checkpoint,
        checkpointCount: fit.checkpointCount,
        ...kind,
    };
}

interface Resume {
    readonly request: Request;
    readonly georef: Georef;
    readonly by: string;
    readonly now: Date;
}

/**
 * The version waiting for points and its job waiting with it, else `apiError.imagery.versionState`. An archive series whose tiles
 * wait (`layout-check`, `docs/research/M20-import-local.md` §19.11) takes no points: its scan is the doubtful low-resolution preview,
 * and points on it would place a mosaic nobody checked (`apiError.imagery.layoutWaits`; the tile-import wizard answers it first).
 */
function requireWaiting(version: LayerVersionDoc | undefined, job: JobDoc | undefined): readonly [LayerVersionDoc, JobDoc] {
    if (version?.state !== 'needs_gcps' || job?.status !== 'awaiting_gcps') {
        throw new ApiError('apiError.imagery.versionState');
    }
    refuseWaitingTiles(version);
    return [version, job];
}

/** `apiError.imagery.layoutWaits` for a series whose tiles wait for the owner (`help.reason` `layout-check`). */
function refuseWaitingTiles(version: LayerVersionDoc): void {
    if (version.help?.reason === 'layout-check') {
        throw new ApiError('apiError.imagery.layoutWaits');
    }
}

/** The attempts the job goes on with: the dispatcher starts one more, for the admin's points, whatever the runs before them used. */
function attemptForPoints(job: JobDoc): Pick<JobDoc, 'attempt'> {
    return (job.attempt ?? 0) >= JOB_MAX_ATTEMPTS ? { attempt: JOB_MAX_ATTEMPTS - 1 } : {};
}

/**
 * The step the points resume: `georef` for a frame; `place` for an archive series, whose steps have no `georef` and which places the
 * series from the owner's pairs (`pipeline/src/hcm_pipeline/placing/owner.py`; a stray `georef` step was written before 2026-11-10).
 */
function resumedStep(job: JobDoc): 'georef' | 'place' {
    return job.type === 'archive-series' ? 'place' : 'georef';
}

/** A `needs_gcps` version continues its own job (the dispatcher starts it again; the pipeline fits from `georef`). */
async function resumeIn(transaction: DocumentTransaction, resume: Resume): Promise<Response> {
    const { request, georef } = resume;
    const versionPath = FIRESTORE_PATHS.layerVersion(request.cityId, request.versionId);
    const jobPath = FIRESTORE_PATHS.job(request.cityId, request.versionId);
    const [version, job] = requireWaiting(
        await transaction.get(versionPath, layerVersionDocSchema),
        await transaction.get(jobPath, jobDocSchema),
    );
    const stamp = stampOf(resume.by, resume.now);
    const crop = request.crop === undefined ? {} : { crop: request.crop };
    await transaction.set(versionPath, layerVersionDocSchema, {
        ...omit(version, ['error']),
        state: 'processing',
        georef,
        ...crop,
        ...stamp,
    });
    const steps = { ...job.steps, [resumedStep(job)]: { status: 'pending' as const } };
    await transaction.set(jobPath, jobDocSchema, {
        ...omit(job, ['waitReason', 'error', 'placingPoints']),
        ...attemptForPoints(job),
        status: 'queued',
        steps,
        ...stamp,
    });
    return { jobId: version.jobId, versionId: request.versionId, resumed: true };
}

/** Where the points go: the waiting job itself, or a new rendition of the version. */
async function save(deps: SaveGcpsDeps, caller: VerifiedCaller, request: Request, version: LayerVersionDoc): Promise<Response> {
    const georef = refitted(request);
    if (version.state === 'needs_gcps') {
        return deps.documents.transaction((transaction) =>
            resumeIn(transaction, { request, georef, by: caller.uid, now: deps.clock.now() }),
        );
    }
    if (!REGEOREF_FROM.has(version.state)) {
        throw new ApiError('apiError.imagery.versionState');
    }
    const crop = request.crop === undefined ? {} : { crop: request.crop };
    const started = await startRegeoref(deps, {
        cityId: request.cityId,
        base: version,
        origin: 'regeoref',
        georef,
        ...crop,
        by: caller.uid,
        // M16: every pair editable, the manual route; the pipeline measures both fits on its disabled pairs.
        recalibration: { route: 'manual' },
    });
    return { ...started, resumed: false };
}

async function imagerySaveGcps(deps: SaveGcpsDeps, caller: VerifiedCaller, request: Request): Promise<Response> {
    const city = await requireCity(deps.documents, request.cityId);
    const version = await requireVersion(deps.documents, request.cityId, request.versionId);
    if (!gcpsInside(request.gcps, requireScan(version), city.bounds)) {
        throw new ApiError('apiError.imagery.gcpOutside');
    }
    const response = await save(deps, caller, request, version);
    deps.log.info('georeferencing points saved', {
        uid: caller.uid,
        cityId: request.cityId,
        versionId: request.versionId,
        resumed: response.resumed,
    });
    return response;
}

/** The `imagery-saveGcps` callable. */
export function saveGcpsFunction(getDeps: () => SaveGcpsDeps & CallableDeps) {
    return defineCallable('imagery.saveGcps', imagerySaveGcps, getDeps);
}
