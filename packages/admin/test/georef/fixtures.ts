// Pairs of the georeferencer's tests: an exact affine map of 2 m per pixel over București, a place moved east to make
// an error.
import { mercatorToGeo, type Gcp } from '@hcm/shared';

/** A pair on the exact map, its place moved `east` metres (EPSG:3857). */
export function pair(id: string, x: number, y: number, east = 0, enabled = true): Gcp {
    const geo = mercatorToGeo({ x: 2_888_740 + 2 * x + east, y: 5_550_954 - 2 * y });
    return { id, pixel: { x, y }, geo, enabled, origin: 'manual' };
}
