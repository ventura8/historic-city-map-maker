/**
 * POI geometries (PLAN Addendum 3): GeoJSON `Point`, `LineString` and `Polygon` in the manifest, and the same
 * shapes without nested arrays for Firestore, which cannot store an array directly inside an array. Positions are
 * `[lng, lat]` in the manifest (GeoJSON order) and `{lat, lng}` in Firestore, like photo locations.
 *
 * Every object is strict (no GeoJSON `bbox`, no foreign members, no altitude), a polygon ring is closed and has at
 * least four positions, and one geometry holds at most `MAX_GEOMETRY_VERTICES` positions: the viewer draws every
 * POI of a category from one GeoJSON source, so the size of each feature is bounded.
 */
import { z } from 'zod';

import type { LngLat } from '../geo/math.js';
import { coded, latLngSchema, lngLatSchema } from './primitives.js';

/** Positions in one geometry, all rings of a polygon together. */
export const MAX_GEOMETRY_VERTICES = 500;

/** The outer ring plus at most 19 holes. */
export const MAX_POLYGON_RINGS = 20;

export const GEOMETRY_TYPES = ['Point', 'LineString', 'Polygon'] as const;

type LatLng = z.infer<typeof latLngSchema>;

/** A mutable `[lng, lat]` pair, the type zod gives GeoJSON positions. */
function toLngLat(position: LatLng): [number, number] {
    return [position.lng, position.lat];
}

function toLatLng(position: LngLat): LatLng {
    return { lat: position[1], lng: position[0] };
}

/** A closed ring ends where it starts (GeoJSON, RFC 7946 §3.1.6); positions compare by their exact decimal text. */
function isClosed(ring: readonly LngLat[]): boolean {
    return ring.length > 0 && String(ring[0]) === String(ring.at(-1));
}

function totalPositions(rings: readonly (readonly unknown[])[]): number {
    return rings.reduce((sum, ring) => sum + ring.length, 0);
}

const ringSchema = z.array(lngLatSchema).min(4).max(MAX_GEOMETRY_VERTICES).refine(isClosed, coded('validation.ringClosed'));

const pointGeometrySchema = z.strictObject({ type: z.literal('Point'), coordinates: lngLatSchema });

const lineStringGeometrySchema = z.strictObject({
    type: z.literal('LineString'),
    coordinates: z.array(lngLatSchema).min(2).max(MAX_GEOMETRY_VERTICES),
});

const polygonGeometrySchema = z
    .strictObject({ type: z.literal('Polygon'), coordinates: z.array(ringSchema).min(1).max(MAX_POLYGON_RINGS) })
    .refine((polygon) => totalPositions(polygon.coordinates) <= MAX_GEOMETRY_VERTICES, coded('validation.tooBig', ['coordinates']));

/** The geometry of a manifest POI. */
export const geometrySchema = z.discriminatedUnion('type', [pointGeometrySchema, lineStringGeometrySchema, polygonGeometrySchema]);

function isClosedDoc(ring: readonly LatLng[]): boolean {
    return isClosed(ring.map(toLngLat));
}

const ringDocSchema = z.strictObject({
    points: z.array(latLngSchema).min(4).max(MAX_GEOMETRY_VERTICES).refine(isClosedDoc, coded('validation.ringClosed')),
});

/** The geometry of a Firestore POI document (`cities/{city}/pois/{poi}`): no array inside an array. */
export const geometryDocSchema = z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('Point'), point: latLngSchema }),
    z.strictObject({ type: z.literal('LineString'), points: z.array(latLngSchema).min(2).max(MAX_GEOMETRY_VERTICES) }),
    z
        .strictObject({ type: z.literal('Polygon'), rings: z.array(ringDocSchema).min(1).max(MAX_POLYGON_RINGS) })
        .refine(
            (polygon) => totalPositions(polygon.rings.map((ring) => ring.points)) <= MAX_GEOMETRY_VERTICES,
            coded('validation.tooBig', ['rings']),
        ),
]);

export type Geometry = z.infer<typeof geometrySchema>;
export type GeometryType = (typeof GEOMETRY_TYPES)[number];
export type GeometryDoc = z.infer<typeof geometryDocSchema>;

/** Every position of a geometry, rings flattened (for bounds checks and bounding boxes). */
export function geometryPositions(geometry: Geometry): LngLat[] {
    switch (geometry.type) {
        case 'Point':
            return [geometry.coordinates];
        case 'LineString':
            return [...geometry.coordinates];
        case 'Polygon':
            return geometry.coordinates.flat();
    }
}

/** The Firestore shape of a manifest geometry (the admin writes it). */
export function geometryToDoc(geometry: Geometry): GeometryDoc {
    switch (geometry.type) {
        case 'Point':
            return { type: 'Point', point: toLatLng(geometry.coordinates) };
        case 'LineString':
            return { type: 'LineString', points: geometry.coordinates.map(toLatLng) };
        case 'Polygon':
            return { type: 'Polygon', rings: geometry.coordinates.map((ring) => ({ points: ring.map(toLatLng) })) };
    }
}

/** The GeoJSON geometry of a Firestore POI (the manifest builder and the admin map read it). */
export function geometryFromDoc(doc: GeometryDoc): Geometry {
    switch (doc.type) {
        case 'Point':
            return { type: 'Point', coordinates: toLngLat(doc.point) };
        case 'LineString':
            return { type: 'LineString', coordinates: doc.points.map(toLngLat) };
        case 'Polygon':
            return { type: 'Polygon', coordinates: doc.rings.map((ring) => ring.points.map(toLngLat)) };
    }
}
