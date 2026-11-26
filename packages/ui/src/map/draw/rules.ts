/**
 * The limits a drawn or loaded geometry keeps (docs/research/M2c-interfaces.md §4.5), DOM-free so the admin's editors
 * check the keyboard path (the vertex list) with the same rules as the map: every position inside the limits, at most
 * `maxVertices` positions and `maxRings` rings, a polygon with an area and without crossing edges. The manifest
 * accepts a self-crossing polygon, but the viewer draws it as a broken fill, so the admin never saves one.
 */
import { bboxContains, geometryPositions, roundTo, type Geometry, type LngLat } from '@hcm/shared';

import type { DrawLimits, DrawRefusal, GeometryInput } from './draw-port.js';

/** Decimal places kept for every position (about 1 cm): a round trip through the map is never a change. */
export const DRAW_DECIMALS = 7;

/** A polygon whose area is below this (in square degrees, about 1 cm²) has none. */
const MIN_AREA_DEG2 = 1e-14;

type Position = readonly [number, number];
type Segment = readonly [Position, Position];

export function roundPosition(position: LngLat): [number, number] {
    return [roundTo(position[0], DRAW_DECIMALS), roundTo(position[1], DRAW_DECIMALS)];
}

/** A copy of the geometry with every position rounded to `DRAW_DECIMALS` places. */
export function roundGeometry(geometry: Geometry | GeometryInput): Geometry {
    switch (geometry.type) {
        case 'Point':
            return { type: 'Point', coordinates: roundPosition(geometry.coordinates) };
        case 'LineString':
            return { type: 'LineString', coordinates: geometry.coordinates.map(roundPosition) };
        case 'Polygon':
            return { type: 'Polygon', coordinates: geometry.coordinates.map((ring) => ring.map(roundPosition)) };
    }
}

/** The sign of the turn a → b → c: 1 left, -1 right, 0 straight. */
function turn(a: Position, b: Position, c: Position): number {
    return Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
}

/** Whether `c`, collinear with `a` and `b`, lies on the segment between them. */
function between(a: Position, b: Position, c: Position): boolean {
    const inLng = Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]);
    return inLng && Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);
}

function onSegment([a, b]: Segment, point: Position): boolean {
    return turn(a, b, point) === 0 && between(a, b, point);
}

/** Whether an endpoint of one segment lies on the other. */
function touches(first: Segment, second: Segment): boolean {
    return first.some((point) => onSegment(second, point)) || second.some((point) => onSegment(first, point));
}

/** Whether the ends of `other` lie strictly on both sides of the line through `segment`. */
function straddles([start, end]: Segment, [from, to]: Segment): boolean {
    return turn(start, end, from) * turn(start, end, to) < 0;
}

/** Whether two segments cross or touch (an endpoint on the other segment counts). */
export function segmentsMeet(first: Segment, second: Segment): boolean {
    const crosses = straddles(first, second) && straddles(second, first);
    return crosses || touches(first, second);
}

/** The edges of a closed ring, in order. */
function edges(ring: readonly LngLat[]): Segment[] {
    return ring.slice(1).map((position, index): Segment => [ring[index] as Position, position]);
}

/** Two edges of one ring that share a vertex: the next one, or the last and the first. */
function adjacent(first: number, second: number, count: number): boolean {
    return second === first + 1 || (first === 0 && second === count - 1);
}

function ringCrossesItself(ring: readonly LngLat[]): boolean {
    const sides = edges(ring);
    return sides.some((side, first) =>
        sides.some((other, second) => second > first && !adjacent(first, second, sides.length) && segmentsMeet(side, other)),
    );
}

function ringsCross(first: readonly LngLat[], second: readonly LngLat[]): boolean {
    const others = edges(second);
    return edges(first).some((side) => others.some((other) => segmentsMeet(side, other)));
}

/** Whether a polygon's edges cross: within a ring, or between two of its rings. */
export function polygonCrossesItself(rings: readonly (readonly LngLat[])[]): boolean {
    return rings.some((ring, index) => ringCrossesItself(ring) || rings.some((other, next) => next > index && ringsCross(ring, other)));
}

/** The area of a ring in square degrees (shoelace), always positive. */
export function ringArea(ring: readonly LngLat[]): number {
    const twice = edges(ring).reduce((sum, [a, b]) => sum + a[0] * b[1] - b[0] * a[1], 0);
    return Math.abs(twice) / 2;
}

/** What a shape still being drawn must keep: every position inside the limits, not too many of them. */
export function checkPositions(positions: readonly LngLat[], limits: DrawLimits): DrawRefusal | null {
    if (!positions.every((position) => bboxContains(limits.limits, position))) {
        return { kind: 'outside', bounds: limits.limits };
    }
    return positions.length > limits.maxVertices ? { kind: 'too-many-vertices', max: limits.maxVertices } : null;
}

function tooManyRings(geometry: Geometry, limits: DrawLimits): DrawRefusal | null {
    const rings = geometry.type === 'Polygon' ? geometry.coordinates.length : 0;
    return rings > limits.maxRings ? { kind: 'too-many-rings', max: limits.maxRings } : null;
}

function badPolygon(geometry: Geometry): DrawRefusal | null {
    if (geometry.type !== 'Polygon') {
        return null;
    }
    const outer = geometry.coordinates[0] ?? [];
    if (ringArea(outer) < MIN_AREA_DEG2) {
        return { kind: 'zero-area' };
    }
    return polygonCrossesItself(geometry.coordinates) ? { kind: 'self-intersection' } : null;
}

/** The first limit `geometry` breaks, or null when it keeps them all. */
export function checkGeometry(geometry: Geometry, limits: DrawLimits): DrawRefusal | null {
    return checkPositions(geometryPositions(geometry), limits) ?? tooManyRings(geometry, limits) ?? badPolygon(geometry);
}
