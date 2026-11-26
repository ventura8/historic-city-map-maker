import { describe, expect, it } from 'vitest';

import {
    geometryDocSchema,
    geometryFromDoc,
    geometryPositions,
    geometrySchema,
    geometryToDoc,
    MAX_GEOMETRY_VERTICES,
    type Geometry,
} from '../../src/schemas/geometry.js';
import { validate } from '../../src/schemas/validation.js';
import { squareRing } from '../fixtures/manifest.js';

const point: Geometry = { type: 'Point', coordinates: [26.0872, 44.4285] };
const line: Geometry = {
    type: 'LineString',
    coordinates: [
        [26.085, 44.4256],
        [26.087, 44.4258],
    ],
};
const polygon: Geometry = { type: 'Polygon', coordinates: [squareRing(26.08, 44.42, 0.01), squareRing(26.08, 44.42, 0.002)] };

describe('geometry conversions', () => {
    it.each([[point], [line], [polygon]])('happyPath_firestoreRoundTrip_%#', (geometry) => {
        const doc = geometryToDoc(geometry);

        expect(validate(geometryDocSchema, doc).ok).toBe(true);
        expect(geometryFromDoc(doc)).toEqual(geometry);
    });

    it('happyPath_aPointBecomesLatLng', () => {
        expect(geometryToDoc(point)).toEqual({ type: 'Point', point: { lat: 44.4285, lng: 26.0872 } });
    });

    it('happyPath_aPolygonKeepsItsRingsWithoutNestedArrays', () => {
        const doc = geometryToDoc(polygon);

        expect(doc.type === 'Polygon' && doc.rings.map((ring) => ring.points.length)).toEqual([5, 5]);
    });

    it('happyPath_positionsFlattenEveryRing', () => {
        expect(geometryPositions(point)).toEqual([[26.0872, 44.4285]]);
        expect(geometryPositions(line)).toHaveLength(2);
        expect(geometryPositions(polygon)).toHaveLength(10);
    });

    it('happyPath_positionsAreACopy', () => {
        const positions = geometryPositions(line);
        positions.pop();

        expect(line.coordinates).toHaveLength(2);
    });

    it('happyPath_theManifestSchemaAcceptsEachType', () => {
        expect([point, line, polygon].map((geometry) => validate(geometrySchema, geometry).ok)).toEqual([true, true, true]);
    });
});

describe('Firestore geometry: bad paths', () => {
    function issuesOf(doc: unknown): readonly unknown[] {
        const result = validate(geometryDocSchema, doc);
        return result.ok ? [] : result.issues;
    }

    it('badPath_geoJsonArraysAreNotAFirestoreShape', () => {
        expect(issuesOf(point)).toContainEqual({ path: 'coordinates', code: 'validation.unknownKey' });
    });

    it('badPath_anOpenRing', () => {
        const ring = squareRing(26.08, 44.42).map(([lng, lat]) => ({ lat, lng }));
        ring[4] = { lat: 44.5, lng: 26.1 };

        expect(issuesOf({ type: 'Polygon', rings: [{ points: ring }] })).toEqual([
            { path: 'rings[0].points', code: 'validation.ringClosed' },
        ]);
    });

    it('badPath_ringsTogetherOverTheVertexBudget', () => {
        const half = Math.ceil(MAX_GEOMETRY_VERTICES / 2);
        const points = [...Array.from({ length: half }, (_, index) => ({ lat: 44.4, lng: 26 + index / 10_000 })), { lat: 44.4, lng: 26 }];

        expect(issuesOf({ type: 'Polygon', rings: [{ points }, { points }] })).toEqual([{ path: 'rings', code: 'validation.tooBig' }]);
    });

    it('badPath_aLineOfOnePoint', () => {
        expect(issuesOf({ type: 'LineString', points: [{ lat: 44.4, lng: 26 }] })).toEqual([
            { path: 'points', code: 'validation.tooSmall' },
        ]);
    });

    it('badPath_aLatitudeBeyond90', () => {
        expect(issuesOf({ type: 'Point', point: { lat: 91, lng: 26 } })).toEqual([{ path: 'point.lat', code: 'validation.tooBig' }]);
    });

    it('badPath_anUnknownType', () => {
        expect(issuesOf({ type: 'Circle', point: { lat: 44, lng: 26 } })).toEqual([{ path: 'type', code: 'validation.value' }]);
    });
});
