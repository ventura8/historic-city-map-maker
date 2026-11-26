/**
 * A chosen year is never empty on screen (the owner, 2026-11-22: "I can select 1945 but it shows nothing"): when none of
 * the year's layers covers the view's centre, the camera moves to the union of their bounds. A layer without bounds is
 * taken to cover the whole city, so a year with one leaves the camera alone.
 */
import type { Manifest, MapView } from '@hcm/shared';

type Box = readonly [readonly [number, number], readonly [number, number]];

/** About how much of a 512 px tile world a fitted box takes across the window (leaves a margin). */
const FIT_SHARE = 0.8;
const TILE_SIZE = 512;
const MIN_ZOOM = 10;

function covers(box: Box, [lng, lat]: readonly [number, number]): boolean {
    return lng >= box[0][0] && lng <= box[1][0] && lat >= box[0][1] && lat <= box[1][1];
}

function union(boxes: readonly Box[]): Box {
    const west = Math.min(...boxes.map((box) => box[0][0]));
    const south = Math.min(...boxes.map((box) => box[0][1]));
    const east = Math.max(...boxes.map((box) => box[1][0]));
    const north = Math.max(...boxes.map((box) => box[1][1]));
    return [
        [west, south],
        [east, north],
    ];
}

/** The zoom at which `box`'s width fills about 80 % of a window `width` px wide, never below 10 nor above `maxZoom`. */
function fitZoom(box: Box, width: number, maxZoom: number): number {
    const span = Math.max(box[1][0] - box[0][0], 1e-6);
    const zoom = Math.log2((360 * width * FIT_SHARE) / (TILE_SIZE * span));
    return Math.min(maxZoom, Math.max(MIN_ZOOM, Math.floor(zoom * 10) / 10));
}

/** The bounds of `year`'s layers; null when there is no such layer or one has no bounds (it covers the city). */
function yearBoxes(manifest: Manifest | null, year: number | null): readonly Box[] | null {
    const layers = manifest?.layers.filter((layer) => layer.year === year) ?? [];
    const boxes = layers.flatMap((layer) => (layer.bounds === undefined ? [] : [layer.bounds as Box]));
    return boxes.length === 0 || boxes.length < layers.length ? null : boxes;
}

/**
 * Where to move for `year`: the centre and zoom of its layers' bounds when none covers `view`'s centre; null to stay
 * (no manifest, today, no layer that year, a layer without bounds, or one already in view).
 */
export function viewForYear(manifest: Manifest | null, year: number | null, view: MapView, width: number): MapView | null {
    const boxes = yearBoxes(manifest, year);
    if (boxes === null || boxes.some((box) => covers(box, view.center))) {
        return null;
    }
    const box = union(boxes);
    const center: [number, number] = [(box[0][0] + box[1][0]) / 2, (box[0][1] + box[1][1]) / 2];
    return { ...view, center, zoom: fitZoom(box, width, Math.max(view.zoom, MIN_ZOOM)) };
}

/**
 * A place's map (M17 §12): the centre and zoom that fit `layer`'s bounds in a window `width` px wide, never zoomed out
 * past 10 nor in past the layer's own `maxzoom`; null for a layer without bounds (it covers the city).
 */
export function viewForLayer(layer: Manifest['layers'][number], view: MapView, width: number): MapView | null {
    if (layer.bounds === undefined) {
        return null;
    }
    const box = layer.bounds as Box;
    const center: [number, number] = [(box[0][0] + box[1][0]) / 2, (box[0][1] + box[1][1]) / 2];
    return { ...view, center, zoom: fitZoom(box, width, layer.maxzoom) };
}
