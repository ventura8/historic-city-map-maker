import '../global-options.js';

import {
    FIRESTORE_PATHS,
    layerDocSchema,
    type CallableRequest,
    type CallableResponse,
    type LayerDoc,
    type LayerVersionDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { ringTouches, selfIntersects } from './geometry.js';
import { requireVersion } from './records.js';
import { startRegeoref, type RegeorefDeps } from './regeoref.js';

/**
 * `imagery.crop` (admin; `docs/research/M3-interfaces.md` §6.4; S-A16-HAPPY-CROP, S-P02-HAPPY-CROP): the layer's current
 * version rendered again inside a polygon (`gdalwarp -cutline`), with its own points, as a new `regeoref` job; the layer
 * keeps its tiles until the cropped version is published. A linked layer has no scan to crop (`apiError.imagery.noScan`);
 * a polygon that misses the layer or crosses itself is refused as the page refuses it.
 */
type Request = CallableRequest<'imagery.crop'>;

async function requireLayer(deps: RegeorefDeps, request: Request): Promise<LayerDoc> {
    const layer = await deps.documents.get(FIRESTORE_PATHS.layer(request.cityId, request.layerId), layerDocSchema);
    if (layer === undefined) {
        throw new ApiError('apiError.notFound');
    }
    return layer;
}

/** The layer's current version, with the scan and the georeference a crop renders again. */
async function requireCropBase(
    deps: RegeorefDeps,
    request: Request,
    layer: LayerDoc,
): Promise<LayerVersionDoc & { georef: NonNullable<LayerVersionDoc['georef']> }> {
    if (layer.currentVersion === undefined) {
        throw new ApiError('apiError.imagery.noScan');
    }
    const base = await requireVersion(deps.documents, request.cityId, layer.currentVersion);
    if (base.scan === undefined || base.georef === undefined) {
        throw new ApiError('apiError.imagery.noScan');
    }
    return { ...base, georef: base.georef };
}

/** The ring must touch the layer's bounds and must not cross itself. */
function checkRing(request: Request, layer: LayerDoc): void {
    if (layer.bounds !== undefined && !ringTouches(request.ring, layer.bounds)) {
        throw new ApiError('apiError.imagery.cropOutsideLayer');
    }
    if (selfIntersects(request.ring)) {
        throw new ApiError('apiError.invalidRequest', undefined, [{ path: 'ring', code: 'validation.value' }]);
    }
}

async function imageryCrop(deps: RegeorefDeps, caller: VerifiedCaller, request: Request): Promise<CallableResponse<'imagery.crop'>> {
    const layer = await requireLayer(deps, request);
    const base = await requireCropBase(deps, request, layer);
    checkRing(request, layer);
    return startRegeoref(deps, { cityId: request.cityId, base, origin: 'crop', georef: base.georef, crop: request.ring, by: caller.uid });
}

/** The `imagery-crop` callable. */
export function cropFunction(getDeps: () => RegeorefDeps & CallableDeps) {
    return defineCallable('imagery.crop', imageryCrop, getDeps);
}
