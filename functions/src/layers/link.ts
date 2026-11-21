import '../global-options.js';

import {
    FIRESTORE_PATHS,
    cityDocSchema,
    freeOverlayId,
    layerDocSchema,
    layerSourceRefusal,
    poiCategoryDocSchema,
    timestampFromDate,
    type CallableRequest,
    type CallableResponse,
    type CityDoc,
    type LayerDoc,
    type LayerSource,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { compact } from '../api/objects.js';
import type { StoredDocument } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';

export type LayerLinkDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Request = CallableRequest<'layers.link'>;

/** Mapbox raster tilesets are cut down to zoom 22 at most; a tile server that says nothing gets the same range. */
const DEFAULT_MAXZOOM = 22;

/** Two sources draw the same tiles: the same tileset, or the same tile addresses. */
function sameSource(a: LayerSource, b: LayerSource): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/** The Mapbox account `setup.saveMapbox` recorded for the city, or null before Mapbox is set up. */
function mapboxUserOf(city: CityDoc): string | null {
    return city.mapbox?.user ?? null;
}

/** The city's Mapbox account (refusing a missing city) and, with `layerSourceRefusal`, a source it may not link. */
async function checkSource(deps: LayerLinkDeps, request: Request): Promise<void> {
    const city = await deps.documents.get(FIRESTORE_PATHS.city(request.cityId), cityDocSchema);
    if (city === undefined) {
        throw new ApiError('apiError.notFound');
    }
    const refusal = layerSourceRefusal(request.source, mapboxUserOf(city));
    if (refusal !== null) {
        throw new ApiError(refusal.code, 'params' in refusal ? refusal.params : undefined);
    }
}

/** The name the pipeline gives every tileset it makes (`tilesetName`: `hcm-<city>-<layer>`, one layer of one city). */
const PIPELINE_TILESET = /^[^.]+\.hcm-/;

/**
 * A tileset the pipeline made belongs to one layer of one city: only a layer of the request's city that records it
 * (`mapbox.tilesetId`) may name it. Every city shares the project's Mapbox account, so the owner check alone would let
 * an editor of one city publish another city's unpublished imagery, or its uploaded scans that the export leaves out for
 * their unknown rights, whose names follow from public USGS metadata (`docs/LESSONS.md` 244). Every city's public token
 * still reads every tileset of that account; the limit is recorded in `docs/ARCHITECTURE.md`.
 */
function refuseOtherCitysTileset(layers: readonly StoredDocument<LayerDoc>[], source: LayerSource): void {
    if (source.type !== 'mapbox' || !PIPELINE_TILESET.test(source.tilesetId)) {
        return;
    }
    if (!layers.some((layer) => layer.data.mapbox?.tilesetId === source.tilesetId)) {
        throw new ApiError('apiError.layers.otherCityTileset');
    }
}

function refuseDuplicate(layers: readonly StoredDocument<LayerDoc>[], source: LayerSource): void {
    const linked = layers.find((layer) => sameSource(layer.data.source, source));
    if (linked !== undefined) {
        throw new ApiError('apiError.layers.alreadyLinked', { layer: linked.data.label.ro });
    }
}

/** The new layer's place: above every other one (the viewer draws the highest `order` on top). */
function topOrder(layers: readonly StoredDocument<LayerDoc>[]): number {
    return layers.reduce((top, layer) => Math.max(top, layer.data.order + 1), 0);
}

function layerOf(request: Request, order: number, caller: VerifiedCaller, now: Date): LayerDoc {
    const at = timestampFromDate(now);
    return compact<LayerDoc>({
        year: request.year,
        date: undefined,
        label: request.label,
        description: undefined,
        kind: request.kind,
        sensor: undefined,
        attribution: request.attribution,
        source: request.source,
        minzoom: request.minzoom ?? 0,
        maxzoom: request.maxzoom ?? DEFAULT_MAXZOOM,
        bounds: request.bounds,
        order,
        opacity: 1,
        defaultVisible: false,
        adjustments: undefined,
        rights: undefined,
        status: 'ready',
        published: false,
        provenance: undefined,
        mapbox: undefined,
        currentVersion: undefined,
        pendingVersion: undefined,
        retired: undefined,
        createdAt: at,
        updatedBy: caller.uid,
        updatedAt: at,
    });
}

/**
 * `layers.link` (admins; `docs/research/M2c-interfaces.md` §8.1, CR-M2c-27; S-A15-*): a ready, unpublished layer over
 * a Mapbox tileset of the city's own account or a tile server's https template, on top of the others, its id taken
 * from its Romanian label in the overlay namespace. Refused: a tileset of another Mapbox account (Mapbox's own and
 * the old site's account included: `apiError.layers.foreignTileset`), a tileset the pipeline made for a layer this city
 * does not have (`apiError.layers.otherCityTileset`), a credential in a tile address (it would be published:
 * `apiError.layers.secretInAddress`), a source another layer already shows (`apiError.layers.alreadyLinked`).
 * The admin publishes it from the layer editor once its preview looks right.
 */
async function layersLink(deps: LayerLinkDeps, caller: VerifiedCaller, request: Request): Promise<CallableResponse<'layers.link'>> {
    await checkSource(deps, request);
    const layers = (await deps.documents.query(FIRESTORE_PATHS.layers(request.cityId), layerDocSchema)).documents;
    refuseOtherCitysTileset(layers, request.source);
    refuseDuplicate(layers, request.source);
    const categories = await deps.documents.query(FIRESTORE_PATHS.poiCategories(request.cityId), poiCategoryDocSchema);
    const taken = new Set([...layers, ...categories.documents, ...categories.invalid].map((document) => document.id));
    const layerId = freeOverlayId(request.label.ro, taken, 'layer');
    const layer = layerOf(request, topOrder(layers), caller, deps.clock.now());
    await deps.documents.create(FIRESTORE_PATHS.layer(request.cityId, layerId), layerDocSchema, layer);
    deps.log.info('layer linked', { uid: caller.uid, cityId: request.cityId, layerId, source: request.source.type });
    return { layerId };
}

/** The `layers-link` callable. */
export function layerLinkFunction(getDeps: () => LayerLinkDeps & CallableDeps) {
    return defineCallable('layers.link', layersLink, getDeps);
}
