/**
 * The vertex list's edits (docs/research/M2c-interfaces.md §4.6): a place's positions as the list shows them (a point's
 * one, a line's in order, an area's outer ring without its closing position; holes are kept as they are), and the edits
 * the keyboard and single-pointer path makes: set a position, move one up or down, remove one, add one after another
 * (Add at map centre). An edit that would leave too few positions for the shape is refused (null); the shape exists once
 * there are enough positions (a line from two, an area from three), before that they are the sketch.
 */
import type { Geometry, LngLat } from '@hcm/shared';
import { drawnPositions, shapeGeometry, type DrawShape } from '@hcm/ui/map/draw';

/** The shapes a place is drawn as. */
export type PlaceShape = Extract<DrawShape, 'point' | 'linestring' | 'polygon'>;

type Position = [number, number];

/** Positions a shape needs at least. */
const MIN_POSITIONS: Readonly<Record<PlaceShape, number>> = { point: 1, linestring: 2, polygon: 3 };

export function placeShapeOf(geometry: Geometry): PlaceShape {
    if (geometry.type === 'Point') {
        return 'point';
    }
    return geometry.type === 'LineString' ? 'linestring' : 'polygon';
}

/** The positions the vertex list shows for a geometry. */
export function listedPositions(geometry: Geometry | null): Position[] {
    return geometry === null ? [] : drawnPositions(geometry);
}

/** A polygon's holes, kept by every edit of its outer ring. */
function holesOf(geometry: Geometry | null): Position[][] {
    return geometry?.type === 'Polygon' ? geometry.coordinates.slice(1) : [];
}

/** The geometry `positions` make as `shape` (holes of `previous` kept), or null when there are too few. */
export function geometryFrom(shape: PlaceShape, positions: readonly Position[], previous: Geometry | null): Geometry | null {
    const geometry = shapeGeometry(shape, positions);
    if (geometry?.type !== 'Polygon') {
        return geometry;
    }
    return { type: 'Polygon', coordinates: [...geometry.coordinates, ...holesOf(previous)] };
}

export type VertexEdit =
    | { readonly kind: 'set'; readonly index: number; readonly position: LngLat }
    | { readonly kind: 'move'; readonly index: number; readonly by: -1 | 1 }
    | { readonly kind: 'remove'; readonly index: number }
    /** After `index` (-1: first); a point's one position is replaced. */
    | { readonly kind: 'add'; readonly index: number; readonly position: LngLat };

function moved(positions: readonly Position[], index: number, by: -1 | 1): Position[] | null {
    const other = index + by;
    const here = positions[index];
    const there = positions[other];
    if (here === undefined || there === undefined) {
        return null;
    }
    const next = [...positions];
    next[index] = there;
    next[other] = here;
    return next;
}

function inRange(positions: readonly Position[], index: number): boolean {
    return index >= 0 && index < positions.length;
}

function added(shape: PlaceShape, positions: readonly Position[], edit: Extract<VertexEdit, { kind: 'add' }>): Position[] {
    const position: Position = [edit.position[0], edit.position[1]];
    if (shape === 'point') {
        return [position];
    }
    const at = Math.min(Math.max(edit.index + 1, 0), positions.length);
    return [...positions.slice(0, at), position, ...positions.slice(at)];
}

function removed(shape: PlaceShape, positions: readonly Position[], index: number): Position[] | null {
    const enough = positions.length > MIN_POSITIONS[shape] || positions.length < MIN_POSITIONS[shape];
    return inRange(positions, index) && enough ? positions.filter((_position, at) => at !== index) : null;
}

function set(positions: readonly Position[], index: number, position: LngLat): Position[] | null {
    return inRange(positions, index) ? positions.map((current, at) => (at === index ? [position[0], position[1]] : current)) : null;
}

/** The positions after `edit`, or null when it is refused (out of range, or too few positions left for the shape). */
export function editedPositions(shape: PlaceShape, positions: readonly Position[], edit: VertexEdit): Position[] | null {
    switch (edit.kind) {
        case 'set':
            return set(positions, edit.index, edit.position);
        case 'move':
            return moved(positions, edit.index, edit.by);
        case 'remove':
            return removed(shape, positions, edit.index);
        case 'add':
            return added(shape, positions, edit);
    }
}
