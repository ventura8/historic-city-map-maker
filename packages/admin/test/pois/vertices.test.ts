import type { Geometry } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { editedPositions, geometryFrom, listedPositions, placeShapeOf } from '../../src/pois/vertices.js';
import { AREA, POINT, SQUARE } from './world.js';

type Position = [number, number];

const A: Position = [26.1, 44.43];
const B: Position = [26.11, 44.43];
const C: Position = [26.11, 44.44];

describe('the vertex list', () => {
    it('happyPath_positionsAreListedPerShape', () => {
        const hole: Position[] = [
            [26.102, 44.432],
            [26.104, 44.432],
            [26.104, 44.434],
            [26.102, 44.432],
        ];

        expect(listedPositions(null)).toEqual([]);
        expect(listedPositions(POINT)).toEqual([A]);
        expect(listedPositions(AREA)).toEqual(SQUARE.slice(0, -1));
        expect(geometryFrom('polygon', [A, B, C], { type: 'Polygon', coordinates: [SQUARE, hole] })).toEqual({
            type: 'Polygon',
            coordinates: [[A, B, C, A], hole],
        });
        expect(geometryFrom('linestring', [A], null)).toBeNull();
        expect(geometryFrom('point', [A], AREA)).toEqual(POINT);
        expect(([POINT, AREA, { type: 'LineString', coordinates: [A, B] }] satisfies Geometry[]).map(placeShapeOf)).toEqual([
            'point',
            'polygon',
            'linestring',
        ]);
    });

    it('happyPath_setMoveAddAndRemove', () => {
        expect(editedPositions('linestring', [A, B], { kind: 'set', index: 1, position: C })).toEqual([A, C]);
        expect(editedPositions('linestring', [A, B, C], { kind: 'move', index: 0, by: 1 })).toEqual([B, A, C]);
        expect(editedPositions('linestring', [A, B, C], { kind: 'move', index: 2, by: -1 })).toEqual([A, C, B]);
        expect(editedPositions('linestring', [A, B], { kind: 'add', index: 0, position: C })).toEqual([A, C, B]);
        expect(editedPositions('linestring', [A, B], { kind: 'add', index: -1, position: C })).toEqual([C, A, B]);
        expect(editedPositions('linestring', [A, B], { kind: 'add', index: 9, position: C })).toEqual([A, B, C]);
        expect(editedPositions('point', [A], { kind: 'add', index: 0, position: C })).toEqual([C]);
        expect(editedPositions('polygon', [A, B, C, A], { kind: 'remove', index: 3 })).toEqual([A, B, C]);
        expect(editedPositions('polygon', [A], { kind: 'remove', index: 0 })).toEqual([]);
    });

    it('badPath_editsOutOfRangeOrBelowTheShapesMinimumAreRefused', () => {
        expect(editedPositions('linestring', [A, B], { kind: 'set', index: 2, position: C })).toBeNull();
        expect(editedPositions('linestring', [A, B], { kind: 'move', index: 1, by: 1 })).toBeNull();
        expect(editedPositions('linestring', [A, B], { kind: 'move', index: 0, by: -1 })).toBeNull();
        expect(editedPositions('linestring', [A, B], { kind: 'remove', index: 0 })).toBeNull();
        expect(editedPositions('polygon', [A, B, C], { kind: 'remove', index: 1 })).toBeNull();
        expect(editedPositions('point', [A], { kind: 'remove', index: 0 })).toBeNull();
        expect(editedPositions('polygon', [A, B], { kind: 'remove', index: 5 })).toBeNull();
    });
});
