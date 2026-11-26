/**
 * The georeferencer's pairs as the admin edits them (`docs/research/M3-interfaces.md` §6.1, §10.4): a pair joins a
 * full-resolution scan pixel and a WGS84 place. A pair is made of two clicks (one on the scan, one on the map, in either
 * order: the first is the **half pair**), or both crosshairs at once from the keyboard; either end moves, a pair is
 * deleted or disabled (kept as a checkpoint). New pairs are `manual` and named `g<n>`; a moved automatic pair becomes
 * `manual` too (its score no longer describes it). Pure: the store keeps the list, the fit reads it.
 */
import { clamp, MAX_GCPS, type Gcp } from '@hcm/shared';

export interface PixelPosition {
    readonly x: number;
    readonly y: number;
}

export interface GeoPosition {
    readonly lat: number;
    readonly lng: number;
}

/** The first click of a pair: on the scan, or on the map. */
export type HalfPair = { readonly pixel: PixelPosition } | { readonly geo: GeoPosition };

/** Scan pixels are kept to a hundredth, places to seven decimals (about 1 cm, as the drawing tools round). */
export function roundPixel(pixel: PixelPosition, width: number, height: number): PixelPosition {
    const keep = (value: number, max: number): number => Math.round(clamp(value, 0, max) * 100) / 100;
    return { x: keep(pixel.x, width), y: keep(pixel.y, height) };
}

export function roundGeo(geo: GeoPosition): GeoPosition {
    return { lat: Math.round(geo.lat * 1e7) / 1e7, lng: Math.round(geo.lng * 1e7) / 1e7 };
}

/** `g<n>`, one past the highest `g` number in use. */
export function nextPairId(pairs: readonly Gcp[]): string {
    const numbers = pairs.map((pair) => /^g(\d+)$/.exec(pair.id)?.[1]).map((digits) => Number(digits ?? 0));
    return `g${String(Math.max(0, ...numbers) + 1)}`;
}

/** The list with a new manual pair; unchanged at `MAX_GCPS`. */
export function withPair(pairs: readonly Gcp[], pixel: PixelPosition, geo: GeoPosition): readonly Gcp[] {
    if (pairs.length >= MAX_GCPS) {
        return pairs;
    }
    return [...pairs, { id: nextPairId(pairs), pixel, geo: roundGeo(geo), enabled: true, origin: 'manual' }];
}

function changed(pairs: readonly Gcp[], id: string, change: (pair: Gcp) => Gcp): readonly Gcp[] {
    return pairs.map((pair) => (pair.id === id ? change(pair) : pair));
}

/** A moved pair: manual from now on, its old score and residual dropped. */
function moved(pair: Gcp, patch: Partial<Pick<Gcp, 'pixel' | 'geo'>>): Gcp {
    return { id: pair.id, pixel: patch.pixel ?? pair.pixel, geo: patch.geo ?? pair.geo, enabled: pair.enabled, origin: 'manual' };
}

export function movePixel(pairs: readonly Gcp[], id: string, pixel: PixelPosition): readonly Gcp[] {
    return changed(pairs, id, (pair) => moved(pair, { pixel }));
}

export function moveGeo(pairs: readonly Gcp[], id: string, geo: GeoPosition): readonly Gcp[] {
    return changed(pairs, id, (pair) => moved(pair, { geo: roundGeo(geo) }));
}

/** Enabled ↔ checkpoint. */
export function togglePair(pairs: readonly Gcp[], id: string): readonly Gcp[] {
    return changed(pairs, id, (pair) => ({ ...pair, enabled: !pair.enabled }));
}

export function withoutPair(pairs: readonly Gcp[], id: string): readonly Gcp[] {
    return pairs.filter((pair) => pair.id !== id);
}

/** A pair as saved: its residual is the server's to compute again. */
function saved(pair: Gcp): Gcp {
    const { id, pixel, geo, enabled, origin, score } = pair;
    return score === undefined ? { id, pixel, geo, enabled, origin } : { id, pixel, geo, enabled, origin, score };
}

/** The pairs as saved (`imagery.saveGcps`). */
export function pairsToSave(pairs: readonly Gcp[]): Gcp[] {
    return pairs.map(saved);
}

/** Whether two lists hold the same pairs (the unsaved guard). */
export function samePairs(a: readonly Gcp[], b: readonly Gcp[]): boolean {
    return JSON.stringify(pairsToSave(a)) === JSON.stringify(pairsToSave(b));
}
