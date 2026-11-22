/**
 * A layer's bounds where its image holds data (live 2026-11-22: joins and USGS renders over the city's window published the
 * window as their bounds, so the year view flew to the whole city and the layer's box was wrong). The pipeline now writes the
 * alpha's extent (`steps/export.py`, `valid_bounds`); a version written before that is read through its measured `outline`
 * (the alpha's edge over the city), and `imagery.tick` corrects the layers published with the city's window, once each.
 */
import { FIRESTORE_PATHS, cityDocSchema, layerDocSchema, layerVersionDocSchema, type LayerDoc, type LayerVersionDoc } from '@hcm/shared';

import type { Ports } from '../ports/index.js';

type Bounds = NonNullable<LayerDoc['bounds']>;
type Output = NonNullable<LayerVersionDoc['output']>;

/** The box around the measured outline, within the output's own bounds; without an outline, the output's bounds. */
export function dataBoundsOf(output: Output): Bounds {
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

export type LayerBoundsDeps = Pick<Ports, 'documents' | 'log'>;

/** The layer's corrected bounds, when its current version measured a smaller footprint than the city's window. */
async function corrected(deps: LayerBoundsDeps, cityId: string, layer: LayerDoc): Promise<Bounds | undefined> {
    if (layer.currentVersion === undefined) {
        return undefined;
    }
    const version = await deps.documents.get(FIRESTORE_PATHS.layerVersion(cityId, layer.currentVersion), layerVersionDocSchema);
    const output = version?.output;
    if (output === undefined) {
        return undefined;
    }
    const bounds = dataBoundsOf(output);
    return same(layer.bounds, bounds) ? undefined : bounds;
}

/** `imagery.tick`'s part: every layer published with the city's window as its bounds gets the bounds of its own data. */
export async function correctLayerBounds(deps: LayerBoundsDeps, cityId: string): Promise<void> {
    const city = await deps.documents.get(FIRESTORE_PATHS.city(cityId), cityDocSchema);
    if (city === undefined) {
        return;
    }
    const layers = await deps.documents.query(FIRESTORE_PATHS.layers(cityId), layerDocSchema);
    for (const layer of layers.documents.filter(({ data }) => same(data.bounds, city.bounds))) {
        const bounds = await corrected(deps, cityId, layer.data);
        if (bounds !== undefined) {
            await deps.documents.set(FIRESTORE_PATHS.layer(cityId, layer.id), layerDocSchema, { ...layer.data, bounds });
            deps.log.info('layer bounds corrected to its data', { cityId, layerId: layer.id, ...bounds });
        }
    }
}
