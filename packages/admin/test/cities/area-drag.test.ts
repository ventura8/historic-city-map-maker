/** The New city flow's rectangle from a drag on the map (`packages/admin/src/cities/area-drag.ts`). */
import { describe, expect, it } from 'vitest';

import { boundsOfCorners, boundsOfShape, dragBounds, screenToLngLat } from '../../src/cities/area-drag.js';

const VIEW = { center: [26.1, 44.43] as const, zoom: 12, bearing: 0 };
const SIZE = { width: 1000, height: 800 };

describe('the rectangle a drag makes', () => {
    it('happyPath_theMapsMiddleIsItsCentreAndAPixelIsTheZoomsShare', () => {
        const [lng, lat] = screenToLngLat(VIEW, SIZE, { x: 500, y: 400 });
        const right = screenToLngLat(VIEW, SIZE, { x: 1012, y: 400 });

        expect([lng, lat]).toEqual([expect.closeTo(26.1, 9), expect.closeTo(44.43, 9)]);
        // 512 px at zoom 12 are a 4096th of the world's 360 degrees.
        expect(right[0] - lng).toBeCloseTo(360 / 4096, 9);
    });

    it('happyPath_aDragFromAnyCornerGivesTheSameRoundedRectangle', () => {
        const down = dragBounds(VIEW, SIZE, { x: 300, y: 600 }, { x: 700, y: 200 });
        const up = dragBounds(VIEW, SIZE, { x: 700, y: 200 }, { x: 300, y: 600 });

        expect(down).toEqual(up);
        expect(down.west).toBeLessThan(26.1);
        expect(down.east).toBeGreaterThan(26.1);
        expect(down.south).toBeLessThan(44.43);
        expect(down.north).toBeGreaterThan(44.43);
        expect(String(down.west).split('.')[1]?.length).toBeLessThanOrEqual(5);
    });

    it('happyPath_aTurnedMapTurnsTheOffsetBack', () => {
        const turned = screenToLngLat({ ...VIEW, bearing: 90 }, SIZE, { x: 500, y: 300 });
        const straight = screenToLngLat(VIEW, SIZE, { x: 600, y: 400 });

        expect(turned[0]).toBeCloseTo(straight[0], 9);
        expect(turned[1]).toBeCloseTo(44.43, 9);
    });

    it('badPath_thePolesAreClampedToWebMercatorsEdge', () => {
        const [, lat] = screenToLngLat({ center: [0, 90], zoom: 3, bearing: 0 }, SIZE, { x: 500, y: 400 });

        expect(lat).toBeCloseTo(85.051_129, 4);
    });

    it('happyPath_aMovedRectangleIsReadBackAndOtherShapesAreNot', () => {
        const ring = [
            [26, 44.4],
            [26.2, 44.4],
            [26.2, 44.5],
            [26, 44.5],
            [26, 44.4],
        ] as [number, number][];

        expect(boundsOfShape({ type: 'Polygon', coordinates: [ring] })).toEqual({ west: 26, south: 44.4, east: 26.2, north: 44.5 });
        expect(boundsOfShape({ type: 'Point', coordinates: [26, 44] })).toBeNull();
        expect(boundsOfShape(undefined)).toBeNull();
        expect(boundsOfCorners([26.123456789, 44.5], [26, 44.4])).toEqual({ west: 26, south: 44.4, east: 26.12346, north: 44.5 });
    });
});
