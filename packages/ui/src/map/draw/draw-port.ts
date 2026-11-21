/**
 * `MapDrawPort`: drawing and editing shapes on the admin's map (docs/research/M2c-interfaces.md §4). The editors see
 * only this port; `terra-draw-adapter.ts` implements it on Terra Draw (the only importer of `terra-draw`) and
 * `FakeMapDraw` (`@hcm/test-support`) for the area modules' tests. Geometry crosses the port as the manifest's
 * `Geometry` (`[lng, lat]`, rings closed), rounded to `DRAW_DECIMALS` places; Terra Draw's own ids, styles and events
 * never leave the adapter.
 */
import type { BBox, Geometry, LngLat } from '@hcm/shared';

import type { MapPort, Unsubscribe } from '../map-port.js';

export type DrawShape = 'point' | 'linestring' | 'polygon' | 'rectangle';

/** `static`: shows the features, no editing; `select`: move features and vertices; `draw-*`: add one shape. */
export type DrawMode = 'static' | 'select' | `draw-${DrawShape}`;

export interface DrawnFeature {
    /** Ours, not Terra Draw's: the POI id, `photo-location`, `photo-target`, `bounds`. */
    readonly id: string;
    /** `[lng, lat]` positions only (the manifest's `geometrySchema`); a rectangle is a closed Polygon ring. */
    readonly geometry: Geometry;
    /** How it is edited (a rectangle keeps its right angles); by default the geometry's own type. */
    readonly shape?: DrawShape;
}

/** The manifest's `Geometry` with read-only positions: what an editor hands to `load` (the port copies it). */
export type GeometryInput =
    | { readonly type: 'Point'; readonly coordinates: LngLat }
    | { readonly type: 'LineString'; readonly coordinates: readonly LngLat[] }
    | { readonly type: 'Polygon'; readonly coordinates: readonly (readonly LngLat[])[] };

/** A feature as an editor hands it to `load`. */
export interface DrawnFeatureInput {
    readonly id: string;
    readonly geometry: GeometryInput;
    readonly shape?: DrawShape;
}

export type DrawRefusal =
    | { readonly kind: 'outside'; readonly bounds: BBox }
    | { readonly kind: 'self-intersection' }
    | { readonly kind: 'too-many-vertices'; readonly max: number }
    | { readonly kind: 'too-many-rings'; readonly max: number }
    | { readonly kind: 'zero-area' };

export interface DrawChange {
    readonly features: readonly DrawnFeature[];
    /** False while a drag moves (per animation frame), true once it ends or a shape is finished. */
    readonly final: boolean;
}

/** The limits every drawn or loaded geometry keeps (`checkGeometry` of `rules.ts`). */
export interface DrawLimits {
    /** Positions must lie inside (the city's bounds plus `PHOTO_LOCATION_SLACK_DEG`, as the manifest rules check). */
    readonly limits: BBox;
    readonly maxVertices: number;
    readonly maxRings: number;
}

export interface DrawOptions extends DrawLimits {
    /** `#rrggbb`: the shapes' colour (the POI category's). */
    readonly color: string;
}

export interface MapDrawPort {
    /** Starts on `map`'s native Mapbox map; drawing layers sit above every overlay. Throws without a mounted Mapbox map. */
    attach(map: MapPort, options: DrawOptions): void;
    readonly mode: DrawMode;
    /**
     * `draw-*` adds one shape: the finished feature gets `drawId` (the POI's id) and the port switches to `select` with it
     * selected. Any mode change resolves a pending `pick` with null.
     */
    setMode(mode: DrawMode, drawId?: string): void;
    /** Replaces what is drawn; a feature that breaks the limits is left out and reported through `refused`. */
    load(features: readonly DrawnFeatureInput[]): void;
    snapshot(): readonly DrawnFeature[];
    select(id: string | null): void;
    /** Deletes the selected feature (a vertex is removed through the editor's draft and `load`). */
    deleteSelected(): void;
    /** The next map click's position (Esc on the map, `cancelPick` or a mode change resolve null): a camera's target. */
    pick(): Promise<LngLat | null>;
    cancelPick(): void;
    setColor(color: string): void;
    on(event: 'change', handler: (change: DrawChange) => void): Unsubscribe;
    on(event: 'select', handler: (id: string | null) => void): Unsubscribe;
    on(event: 'refused', handler: (refusal: DrawRefusal) => void): Unsubscribe;
    /** Stops drawing and removes its layers; `attach` may be called again. */
    detach(): void;
}
