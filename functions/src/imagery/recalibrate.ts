import '../global-options.js';

import {
    type CallableRequest,
    type CallableResponse,
    type Georef,
    type LayerVersionDoc,
    type LayerVersionState,
    type Recalibration,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { gcpsInside } from './geometry.js';
import { requireCity, requireVersion } from './records.js';
import { startRegeoref, type RegeorefDeps } from './regeoref.js';

/**
 * `imagery.recalibrate` (a city's editor; `docs/research/M16-recalibrate.md`; S-A89-*): a published version, or one
 * waiting for approval, calibrated again from its scan. **Refine automatically** (`auto`) reruns the proof and the dense matching from the
 * current fit and renders only a better one; **Snap my points** (`points`) starts from the admin's rough points. Either is a new `regeoref`
 * version of the same layer that waits for Approve. A base waiting for approval stays until the new version is rendered (`replaces`, §5). A
 * join has no scan and cannot be calibrated again yet (`apiError.imagery.joinRecalibrate` says so; the re-join of §6 is not built, and its
 * frames, `joined` or held by a waiting join, are refused too).
 */
export type RecalibrateDeps = RegeorefDeps;

type Request = CallableRequest<'imagery.recalibrate'>;
type Response = CallableResponse<'imagery.recalibrate'>;

/** The states a version is calibrated again from. */
const FROM: ReadonlySet<LayerVersionState> = new Set<LayerVersionState>(['published', 'awaiting_approval']);

/** The version's fit, which the new one starts from: a rendered version with a scan and pairs; a join is refused in words. */
function refuseOthers(version: LayerVersionDoc): void {
    if (version.origin === 'join') {
        throw new ApiError('apiError.imagery.joinRecalibrate');
    }
    if (!FROM.has(version.state)) {
        throw new ApiError('apiError.imagery.versionState');
    }
}

function requireFit(version: LayerVersionDoc): Georef {
    refuseOthers(version);
    const georef = version.scan === undefined ? undefined : version.georef;
    if (georef === undefined || georef.method === 'embedded') {
        throw new ApiError('apiError.imagery.noScan');
    }
    return georef;
}

/** What the new version records of how it was asked for. */
function recalibrationOf(request: Request, version: LayerVersionDoc): Recalibration {
    return {
        route: request.route,
        ...(version.state === 'awaiting_approval' ? { replaces: version.jobId } : {}),
        ...(request.points === undefined ? {} : { points: request.points }),
    };
}

async function imageryRecalibrate(deps: RecalibrateDeps, caller: VerifiedCaller, request: Request): Promise<Response> {
    const city = await requireCity(deps.documents, request.cityId);
    const version = await requireVersion(deps.documents, request.cityId, request.versionId);
    const georef = requireFit(version);
    const scan = version.scan ?? { width: 0, height: 0 };
    if (!gcpsInside(request.points ?? [], scan, city.bounds)) {
        throw new ApiError('apiError.imagery.gcpOutside');
    }
    const recalibration = recalibrationOf(request, version);
    const started = await startRegeoref(deps, {
        cityId: request.cityId,
        base: version,
        origin: 'regeoref',
        georef,
        by: caller.uid,
        recalibration,
    });
    deps.log.info('layer version recalibrating', {
        uid: caller.uid,
        cityId: request.cityId,
        versionId: request.versionId,
        route: request.route,
    });
    return started;
}

/** The `imagery-recalibrate` callable. */
export function recalibrateFunction(getDeps: () => RecalibrateDeps & CallableDeps) {
    return defineCallable('imagery.recalibrate', imageryRecalibrate, getDeps);
}
