/**
 * The map of a frame fitted over terrain (`docs/research/M15-calibration-accuracy.md`, *Terrain*): what its layer shows, so the
 * georeferencer previews that and no other. A place goes to the scan through the frame's RPC00B (`georef.terrain.rpc`) at the height
 * its stored cells give there (`georef.terrain.heights`), exactly as GDAL's RPC transformer reads them for the warp (`RPC_DEM`,
 * bilinear between cell centres, the edge's value beyond them); the pipeline's `pipeline/src/hcm_pipeline/georef/rpc.py` and
 * `calibrate/terrain.py` `Heights.at` are the reference. A scan pixel goes back through `start`, the lattice: the same map sampled on
 * its nodes. Only the preview's frame reads it (the box of the scan's border), within 18 m on the real frames: under one of the
 * preview's pixels (24 to 30 m); what the preview draws in that frame goes through `toPixel`.
 */
import { clamp } from '../geo/math.js';
import type { Georef } from '../schemas/georef.js';
import type { FittedTransform, PixelPoint } from './fit.js';
import { geoToMercator, type GeoPoint } from './mercator.js';

type Terrain = NonNullable<Georef['terrain']>;

/** Coordinates clip this short of the last centre, so a cell and the next always blend (the last all but a billionth). */
const LAST_CENTRE = 1 + 1e-9;

/** The twenty RPC00B terms of normalised longitude, latitude and height, in GDAL's order. */
function terms(l: number, p: number, h: number): readonly number[] {
    return [
        1,
        l,
        p,
        h,
        l * p,
        l * h,
        p * h,
        l * l,
        p * p,
        h * h,
        p * l * h,
        l ** 3,
        l * p * p,
        l * h * h,
        l * l * p,
        p ** 3,
        p * h * h,
        l * l * h,
        p * p * h,
        h ** 3,
    ];
}

/** The frame's map over terrain (module docstring). */
export function terrainTransform({ rpc, heights: h }: Terrain, start: FittedTransform): FittedTransform {
    const { offset, scale } = rpc;
    /** Each cell's decimetres above `baseDm`, row by row from the north (little-endian, as every browser is). */
    const cells = new Uint16Array(Uint8Array.from(atob(h.valuesDm), (char) => char.charCodeAt(0)).buffer);
    /** A coordinate in cells from the first centre, clipped to the centres. */
    const clipped = (position: number, count: number): number => clamp(position - 0.5, 0, count - LAST_CENTRE);
    const toPixel = (geo: GeoPoint): PixelPoint => {
        const at = geoToMercator(geo);
        const u = clipped((at.x - h.left) / h.cell, h.columns);
        const v = clipped((h.top - at.y) / h.cell, h.rows);
        const first = Math.floor(v) * h.columns + Math.floor(u);
        const read = (index: number): number => (cells[index] ?? 0) * (1 - (u % 1)) + (cells[index + 1] ?? 0) * (u % 1);
        const height = (h.baseDm + read(first) * (1 - (v % 1)) + read(first + h.columns) * (v % 1)) / 10;
        const values = terms(
            (geo.lng - offset.lng) / scale.lng,
            (geo.lat - offset.lat) / scale.lat,
            (height - offset.height) / scale.height,
        );
        const dot = (coefficients: readonly number[]): number => coefficients.reduce((sum, c, i) => sum + c * (values[i] ?? 0), 0);
        /** GDAL reads RPC lines and samples at pixel centres; scan pixels here have their corner at 0 (+ 0.5). */
        const axis = (key: 'samp' | 'line'): number => (dot(rpc[`${key}Num`]) / dot(rpc[`${key}Den`])) * scale[key] + offset[key] + 0.5;
        return { x: axis('samp'), y: axis('line') };
    };
    return { ...start, toPixel };
}
