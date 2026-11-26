/**
 * Drawing by clicks (docs/research/M2c-interfaces.md §4.4, §4.6), shared by both `MapDrawPort`s: the click tools on
 * `MapPort` (`click-draw-adapter.ts`) and the Terra Draw tools (`terra-draw-adapter.ts`), which draw a new shape the same
 * way and leave dragging to Terra Draw's select mode (DECISIONS-for-review.md §34g).
 *
 * - a point is one click; a rectangle two corners; both are then finished (the port switches to `select`);
 * - a line exists from its second click, an area from its third; every further click adds a vertex at the end, until the
 *   editor picks another tool, so Save works at any time and the input budget holds (n clicks for n vertices).
 */
import type { Geometry } from '@hcm/shared';

import type { DrawMode, DrawnFeature, DrawOptions, DrawRefusal, DrawShape } from './draw-port.js';
import { checkGeometry } from './rules.js';

export type Position = [number, number];

/** The positions a line or an area goes on from: a polygon's outer ring without its closing position. */
export function drawnPositions(geometry: Geometry): Position[] {
    switch (geometry.type) {
        case 'Point':
            return [geometry.coordinates];
        case 'LineString':
            return [...geometry.coordinates];
        case 'Polygon':
            return (geometry.coordinates[0] ?? []).slice(0, -1);
    }
}

/** The rectangle between two corners, as a closed ring (south-west first, counter-clockwise). */
function rectangle([first, second]: readonly [Position, Position]): Geometry {
    const [west, east] = [Math.min(first[0], second[0]), Math.max(first[0], second[0])];
    const [south, north] = [Math.min(first[1], second[1]), Math.max(first[1], second[1])];
    return {
        type: 'Polygon',
        coordinates: [
            [
                [west, south],
                [east, south],
                [east, north],
                [west, north],
                [west, south],
            ],
        ],
    };
}

/** The shape `positions` make once there are enough of them; null before. */
export function shapeGeometry(shape: DrawShape, positions: readonly Position[]): Geometry | null {
    const [first, second] = positions;
    if (first === undefined) {
        return null;
    }
    if (shape === 'point') {
        return { type: 'Point', coordinates: first };
    }
    if (second === undefined) {
        return null;
    }
    return shapeOfAtLeastTwo(shape, positions, [first, second]);
}

function shapeOfAtLeastTwo(shape: DrawShape, positions: readonly Position[], corners: readonly [Position, Position]): Geometry | null {
    if (shape === 'linestring') {
        return { type: 'LineString', coordinates: [...positions] };
    }
    if (shape === 'rectangle') {
        return rectangle(corners);
    }
    return positions.length < 3 ? null : { type: 'Polygon', coordinates: [[...positions, corners[0]]] };
}

/** The shape a drawing mode adds; null for `static` and `select`. */
export function shapeOfMode(mode: DrawMode): DrawShape | null {
    return mode.startsWith('draw-') ? (mode.slice('draw-'.length) as DrawShape) : null;
}

/** A shape that a click finishes (a point, a rectangle's second corner); lines and areas go on. */
function finishesAtOnce(shape: DrawShape): boolean {
    return shape === 'point' || shape === 'rectangle';
}

/** What a click while drawing came to. */
export type Growth =
    /** Not a shape yet (a line's first click, an area's first two): the positions so far. */
    | { readonly kind: 'sketch'; readonly positions: readonly Position[] }
    /** The shape with the click added; `finished` for a point and a rectangle. */
    | { readonly kind: 'shape'; readonly feature: DrawnFeature & { readonly shape: DrawShape }; readonly finished: boolean }
    /** The click would break a limit: nothing changes. */
    | { readonly kind: 'refused'; readonly refusal: DrawRefusal };

/** Where a click while drawing `shape` under `id` lands. */
export interface GrowthInput {
    readonly id: string;
    readonly shape: DrawShape;
    /** The shape drawn so far under `id`, if any. */
    readonly drawn: DrawnFeature | undefined;
    /** The positions of a shape that is not one yet. */
    readonly sketch: readonly Position[];
    readonly position: Position;
    readonly options: DrawOptions;
}

/** The click added to the line or area drawn so far, else to the sketch (a point and a rectangle start afresh). */
export function growByClick(input: GrowthInput): Growth {
    const { id, shape, drawn, position, options } = input;
    const start = finishesAtOnce(shape) || drawn === undefined ? input.sketch : drawnPositions(drawn.geometry);
    const positions = [...start, position];
    const geometry = shapeGeometry(shape, positions);
    if (geometry === null) {
        return { kind: 'sketch', positions };
    }
    const refusal = checkGeometry(geometry, options);
    return refusal === null
        ? { kind: 'shape', feature: { id, geometry, shape }, finished: finishesAtOnce(shape) }
        : { kind: 'refused', refusal };
}

/** The sketch as a geometry to show (one position as a point, more as a line); null without one. */
export function sketchGeometry(sketch: readonly Position[]): Geometry | null {
    const [first] = sketch;
    if (first === undefined) {
        return null;
    }
    return sketch.length === 1 ? { type: 'Point', coordinates: first } : { type: 'LineString', coordinates: [...sketch] };
}
