/**
 * The features of the Terra Draw tools (`terra-draw-adapter.ts`): ours as Terra Draw's store holds them (the shape mode
 * that owns each, `properties.mode`), and Terra Draw's back as the manifest's geometry, rounded. DOM-free and free of
 * Terra Draw itself (only its structural types).
 */
import { geometrySchema, type Geometry, type LngLat } from '@hcm/shared';

import type { DrawnFeature, DrawOptions, DrawRefusal, DrawShape } from './draw-port.js';
import { checkGeometry, roundGeometry } from './rules.js';
import type { TdFeature } from './terra-draw-types.js';

/** A finished shape the manifest cannot hold (a polygon of fewer than three distinct positions). */
const ZERO_AREA: DrawRefusal = { kind: 'zero-area' };

/** The shape a geometry is edited as when its feature names none. */
export function shapeOf(feature: DrawnFeature): DrawShape {
    return feature.shape ?? (feature.geometry.type.toLowerCase() as DrawShape);
}

export function tdFeature(id: string, geometry: Geometry, mode: string): TdFeature {
    return { id, type: 'Feature', geometry, properties: { mode } };
}

/** A polygon's outer ring alone (what Terra Draw can show of a polygon with holes); any other geometry as it is. */
export function outerOnly(geometry: Geometry): Geometry {
    return geometry.type === 'Polygon' ? { type: 'Polygon', coordinates: geometry.coordinates.slice(0, 1) } : geometry;
}

/** Every `[lng, lat]` pair in a GeoJSON `coordinates` value, however deeply nested. */
export function positionsOf(coordinates: unknown): LngLat[] {
    if (!Array.isArray(coordinates)) {
        return [];
    }
    const [lng, lat] = coordinates as unknown[];
    if (typeof lng === 'number' && typeof lat === 'number') {
        return [[lng, lat]];
    }
    return coordinates.flatMap((inner: unknown) => positionsOf(inner));
}

/** A store feature's geometry as the port's, rounded; null for a shape the manifest cannot hold. */
export function geometryOf(feature: TdFeature): Geometry | null {
    const parsed = geometrySchema.safeParse(feature.geometry);
    return parsed.success ? roundGeometry(parsed.data) : null;
}

/** The whole finished shape's first broken limit; a shape the manifest cannot hold has no area. */
export function wholeRefusal(feature: TdFeature, options: DrawOptions): DrawRefusal | null {
    const geometry = geometryOf(feature);
    return geometry === null ? ZERO_AREA : checkGeometry(geometry, options);
}
