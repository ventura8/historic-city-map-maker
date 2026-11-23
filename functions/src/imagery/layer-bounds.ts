/**
 * A layer's bounds where its image holds data (live 2026-11-22: joins and USGS renders over the city's window published the
 * window as their bounds, so the year view flew to the whole city and the layer's box was wrong). The pipeline now writes the
 * alpha's extent (`steps/export.py`, `valid_bounds`), which is what a layer gets; only a version written before that, whose
 * bounds are the window, is read through its measured `outline`. `imagery.tick` corrects the layers published with the city's
 * window or with an outline's box (live 2026-11-23: the edges of the map cut off), once each.
 */
import { FIRESTORE_PATHS, cityDocSchema, layerDocSchema, layerVersionDocSchema, type LayerDoc, type LayerVersionDoc } from '@hcm/shared';

import type { Ports } from '../ports/index.js';

type Bounds = NonNullable<LayerDoc['bounds']>;
type Output = NonNullable<LayerVersionDoc['output']>;

/** The box around the measured outline, within the output's own bounds; without an outline, the output's bounds. */
function outlineBoxOf(output: Output): Bounds {
    const outline = output.outline;
    if (outline === undefined) {
        return output.bounds;
    }
    const box = {
        west: Math.max(output.bounds.west, Math.min(...outline.map((place) => place.lng))),
        south: Math.max(output.bounds.south, Math.min(...outline.map((place) => place.lat))),
        east: Math.min(output.bounds.east, Math.max(...outline.map((place) => place.lng))),
        north: Math.min(output.bounds.north, Math.max(...outline.map((place) => place.lat))),
    };
    return box.west < box.east && box.south < box.north ? box : output.bounds;
}

function same(one: Bounds | undefined, other: Bounds): boolean {
    return one?.west === other.west && one.south === other.south && one.east === other.east && one.north === other.north;
}

/**
 * A layer's bounds from its version's output: the raster's full extent (the pipeline's `valid_bounds`). The outline is a
 * simplified ring whose corners lie inside the raster (live 2026-11-23: the 1965 plan's north at 44.5607 for a raster up to
 * 44.5842, and the viewer clips the tiles to the layer's bounds), so it is used only for a version written before
 * `valid_bounds`, whose bounds are still the city's `window`.
 */
export function dataBoundsOf(output: Output, window?: Bounds): Bounds {
    return window !== undefined && same(output.bounds, window) ? outlineBoxOf(output) : output.bounds;
}

export type LayerBoundsDeps = Pick<Ports, 'documents' | 'log'>;

/** True when the layer's bounds are a wrong guess: the city's window, or the box of a simplified outline. */
function wronglyBounded(layer: LayerDoc, output: Output, window: Bounds): boolean {
    return same(layer.bounds, window) || (output.outline !== undefined && same(layer.bounds, outlineBoxOf(output)));
}

/** The layer's corrected bounds, when they are the city's window or its outline's box instead of its raster's extent. */
async function corrected(deps: LayerBoundsDeps, cityId: string, layer: LayerDoc, window: Bounds): Promise<Bounds | undefined> {
    if (layer.currentVersion === undefined) {
        return undefined;
    }
    const version = await deps.documents.get(FIRESTORE_PATHS.layerVersion(cityId, layer.currentVersion), layerVersionDocSchema);
    const output = version?.output;
    if (output === undefined || !wronglyBounded(layer, output, window)) {
        return undefined;
    }
    const bounds = dataBoundsOf(output, window);
    return same(layer.bounds, bounds) ? undefined : bounds;
}

/** `imagery.tick`'s part: every layer bounded by the city's window or by its outline's box gets its raster's extent. */
export async function correctLayerBounds(deps: LayerBoundsDeps, cityId: string): Promise<void> {
    const city = await deps.documents.get(FIRESTORE_PATHS.city(cityId), cityDocSchema);
    if (city === undefined) {
        return;
    }
    const layers = await deps.documents.query(FIRESTORE_PATHS.layers(cityId), layerDocSchema);
    for (const layer of layers.documents) {
        const bounds = await corrected(deps, cityId, layer.data, city.bounds);
        if (bounds !== undefined) {
            await deps.documents.set(FIRESTORE_PATHS.layer(cityId, layer.id), layerDocSchema, { ...layer.data, bounds });
            deps.log.info('layer bounds corrected to its raster', { cityId, layerId: layer.id, ...bounds });
        }
    }
}
