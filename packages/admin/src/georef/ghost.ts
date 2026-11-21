/**
 * The georeferencer's ghost (the owner, 2026-11-12): while a pair waits for its second click, the place the pairs so far expect it on
 * the other pane, drawn there as a dashed ring the owner may click onto (the panes no longer move to it: a fast second click landed
 * 1 km off). Through the fit when there is one; with only two pairs and no fit yet, through the similarity (a shift, a turn and one
 * scale) that carries the two latest enabled pairs' scan points onto their places, in Web Mercator with north up. Part of the lazy
 * chunk (`georef-extras.ts`), so the `georef` chunk keeps its budget.
 */
import { geoToMercator, mercatorToGeo, type FittedTransform, type Gcp } from '@hcm/shared';

import type { GeoPosition, HalfPair, PixelPosition } from './pairs.js';

/** Where the pending pair's other end is expected: a scan pixel (the map was clicked first) or a place (the scan was). */
export type Ghost = { readonly pixel: PixelPosition } | { readonly geo: GeoPosition };

export type GhostMapping = Pick<FittedTransform, 'toGeo' | 'toPixel'>;

/** A point of the plane as a complex number: a similarity is then `w = a·z + b`. */
interface Complex {
    readonly re: number;
    readonly im: number;
}

const plus = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
const minus = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });
const times = (a: Complex, b: Complex): Complex => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });

function over(a: Complex, b: Complex): Complex {
    const size = b.re * b.re + b.im * b.im;
    return { re: (a.re * b.re + a.im * b.im) / size, im: (a.im * b.re - a.re * b.im) / size };
}

const ofPixel = (pixel: PixelPosition): Complex => ({ re: pixel.x, im: pixel.y });

/** A place in Web Mercator metres, south up as a scan's rows go down (so a scan seen from above needs no mirror). */
function ofGeo(geo: GeoPosition): Complex {
    const at = geoToMercator(geo);
    return { re: at.x, im: -at.y };
}

/** The similarity through the two latest enabled pairs; null with fewer, or with two at one pixel or one place. */
export function similarityOf(pairs: readonly Gcp[]): GhostMapping | null {
    const [first, second] = pairs.filter((pair) => pair.enabled).slice(-2);
    if (first === undefined || second === undefined) {
        return null;
    }
    const [z0, w0] = [ofPixel(first.pixel), ofGeo(first.geo)];
    const [dz, dw] = [minus(ofPixel(second.pixel), z0), minus(ofGeo(second.geo), w0)];
    if (Math.hypot(dz.re, dz.im) === 0 || Math.hypot(dw.re, dw.im) === 0) {
        return null;
    }
    const a = over(dw, dz);
    return {
        toGeo: (pixel) => {
            const w = plus(times(a, minus(ofPixel(pixel), z0)), w0);
            return mercatorToGeo({ x: w.re, y: -w.im });
        },
        toPixel: (geo) => {
            const z = plus(over(minus(ofGeo(geo), w0), a), z0);
            return { x: z.re, y: z.im };
        },
    };
}

const finite = (values: readonly number[]): boolean => values.every((value) => Number.isFinite(value));

/** The other end of `half` through `mapping`; null where it has no finite answer (far outside the pairs). */
function endOf(half: HalfPair, mapping: GhostMapping): Ghost | null {
    if ('pixel' in half) {
        const geo = mapping.toGeo(half.pixel);
        return finite([geo.lat, geo.lng]) ? { geo } : null;
    }
    const pixel = mapping.toPixel(half.geo);
    return finite([pixel.x, pixel.y]) ? { pixel } : null;
}

/** The ghost of `half` through `fit`, else the pairs' similarity; null without a pending pair, a mapping or a finite answer. */
export function ghostOf(half: HalfPair | null, pairs: readonly Gcp[], fit: GhostMapping | null): Ghost | null {
    const mapping = fit ?? similarityOf(pairs);
    return half === null || mapping === null ? null : endOf(half, mapping);
}
