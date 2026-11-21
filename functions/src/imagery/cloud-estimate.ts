/**
 * The clouds a USGS browse image shows over the city (the owner's report of 2026-11-13: a bought 1964 scan was useless, all
 * cloud). Declassified records rarely carry USGS's cloud cover, so the browse copy is measured once, when it is copied
 * (`browse.ts`, the harvest's prefetch included) or first read without a measure: a grey copy at most `GREY_EDGE` pixels long,
 * each pixel placed on the ground through the frame's four corners, and the share of those inside the city's bounds that are
 * bright and flat. An estimate, worded "probably": the browse image's orientation against the corners is **UNVERIFIED** for
 * frames without corner metadata (the footprint's north-western vertex is taken as the image's top left).
 */
import { CLOUD_ESTIMATE_VERSION, type BoundsRecord, type CloudEstimate, type UsgsSceneDoc } from '@hcm/shared';

import type { GreyImage } from '../ports/image-processor.js';

/** The grey copy's long edge: 128 px is about 16,000 samples, plenty for a share, and cheap in a function. */
export const GREY_EDGE = 128;
/** A pixel at least this bright (0 to 255) can be cloud; the film's ground sits far below it on a summer frame. */
const BRIGHT = 150;
/** …and at least this far above the frame's median, so an overexposed frame is not all cloud… */
const ABOVE_MEDIAN = 60;
/** …though never brighter than this: a frame all cloud has a white median. */
const BRIGHTEST = 210;
/** …and flat: its 3 × 3 neighbourhood varies less than this (a bright road, a river's glint or the frame's edge are not cloud). */
const FLAT = 45;
/** Fewer samples inside the city than this and the frame is said to be unmeasured (it barely reaches the city). */
const MIN_SAMPLES = 24;

interface Point {
    readonly lat: number;
    readonly lng: number;
}

/** The image's corners on the ground: top left, top right, bottom right, bottom left. */
type Quad = readonly [Point, Point, Point, Point];

function cross(point: Point, next: Point): number {
    return point.lng * next.lat - next.lng * point.lat;
}

/** Twice the signed area of a four-vertex ring in (lng, lat): negative when it turns clockwise with north up. */
function signedArea([a, b, c, d]: Quad): number {
    return cross(a, b) + cross(b, c) + cross(c, d) + cross(d, a);
}

/** How far towards the north-west a vertex lies (the image's top left is the frame's north-western corner). */
function northWestness(point: Point): number {
    return point.lat - point.lng * Math.cos((point.lat * Math.PI) / 180);
}

function isFour(points: readonly Point[]): points is readonly [Point, Point, Point, Point] {
    return points.length === 4;
}

/** Four vertices in clockwise order, starting from the north-western one. */
function clockwiseFromNorthWest(points: readonly [Point, Point, Point, Point]): Quad {
    const [a, b, c, d]: Quad = signedArea(points) > 0 ? [points[3], points[2], points[1], points[0]] : points;
    const rotations: readonly [Quad, Quad, Quad, Quad] = [
        [a, b, c, d],
        [b, c, d, a],
        [c, d, a, b],
        [d, a, b, c],
    ];
    // The first rotation whose start lies furthest north-west (ties keep the earlier one).
    return rotations.reduce((best, rotation) => (northWestness(rotation[0]) > northWestness(best[0]) ? rotation : best));
}

/** The frame's corners from its metadata, else its four-vertex footprint, else its footprint's box. */
export function frameQuad(scene: Pick<UsgsSceneDoc, 'corners' | 'footprint'>): Quad {
    if (scene.corners !== undefined) {
        return [scene.corners.nw, scene.corners.ne, scene.corners.se, scene.corners.sw];
    }
    if (isFour(scene.footprint)) {
        return clockwiseFromNorthWest(scene.footprint);
    }
    const lats = scene.footprint.map((point) => point.lat);
    const lngs = scene.footprint.map((point) => point.lng);
    const [south, north, west, east] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
    return [
        { lat: north, lng: west },
        { lat: north, lng: east },
        { lat: south, lng: east },
        { lat: south, lng: west },
    ];
}

/** The ground point of the image's fraction (`u` across, `v` down), between the four corners. */
function groundOf([topLeft, topRight, bottomRight, bottomLeft]: Quad, u: number, v: number): Point {
    const mix = (a: number, b: number, c: number, d: number): number => (1 - v) * ((1 - u) * a + u * b) + v * ((1 - u) * d + u * c);
    return {
        lat: mix(topLeft.lat, topRight.lat, bottomRight.lat, bottomLeft.lat),
        lng: mix(topLeft.lng, topRight.lng, bottomRight.lng, bottomLeft.lng),
    };
}

function inBounds(point: Point, bounds: BoundsRecord): boolean {
    return point.lat >= bounds.south && point.lat <= bounds.north && point.lng >= bounds.west && point.lng <= bounds.east;
}

function medianOf(pixels: Uint8Array): number {
    const counts = new Array<number>(256).fill(0);
    pixels.forEach((value) => {
        counts[value] = Number(counts[value]) + 1;
    });
    let seen = 0;
    return counts.findIndex((count) => {
        seen += count;
        return seen * 2 >= pixels.length;
    });
}

/** The widest spread of the pixel's 3 × 3 neighbourhood (the image's edge reads as its nearest pixels). */
function spreadAt(image: GreyImage, x: number, y: number): number {
    const values: number[] = [];
    for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
            const column = Math.min(image.width - 1, Math.max(0, x + dx));
            const row = Math.min(image.height - 1, Math.max(0, y + dy));
            values.push(Number(image.pixels[row * image.width + column]));
        }
    }
    return Math.max(...values) - Math.min(...values);
}

/** The pixels of the image whose ground lies inside the city's bounds, as `[x, y]`. */
function cityPixels(image: GreyImage, quad: Quad, bounds: BoundsRecord): (readonly [number, number])[] {
    const pixels: (readonly [number, number])[] = [];
    for (let index = 0; index < image.width * image.height; index += 1) {
        const [x, y] = [index % image.width, Math.floor(index / image.width)];
        if (inBounds(groundOf(quad, (x + 0.5) / image.width, (y + 0.5) / image.height), bounds)) {
            pixels.push([x, y]);
        }
    }
    return pixels;
}

/** The city's samples of the image and how many of them look like cloud (bright and flat). */
function countOver(image: GreyImage, quad: Quad, bounds: BoundsRecord): { readonly samples: number; readonly cloudy: number } {
    const bright = Math.max(BRIGHT, Math.min(BRIGHTEST, medianOf(image.pixels) + ABOVE_MEDIAN));
    const pixels = cityPixels(image, quad, bounds);
    const cloudy = pixels.filter(([x, y]) => Number(image.pixels[y * image.width + x]) >= bright && spreadAt(image, x, y) < FLAT);
    return { samples: pixels.length, cloudy: cloudy.length };
}

/**
 * The share of the city the browse image shows clouded, 0 to 100, or undefined when the frame
 * reaches the city with too few pixels to say.
 */
export function estimateClouds(
    image: GreyImage,
    scene: Pick<UsgsSceneDoc, 'corners' | 'footprint'>,
    bounds: BoundsRecord,
): CloudEstimate | undefined {
    const { samples, cloudy } = countOver(image, frameQuad(scene), bounds);
    return samples < MIN_SAMPLES ? undefined : { percent: Math.round((cloudy / samples) * 100), version: CLOUD_ESTIMATE_VERSION };
}
