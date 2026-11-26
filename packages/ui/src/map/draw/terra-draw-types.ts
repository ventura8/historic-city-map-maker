/**
 * The part of Terra Draw 1.38.0 and `terra-draw-mapbox-gl-adapter` 1.5.0 the draw adapter uses, typed structurally
 * (as `mapbox-types.ts` types the global `mapboxgl`): `terra-draw-adapter.ts` takes these constructors from its lazy
 * loader (`loadTerraDraw`), its Node-free unit tests take a fake of them, and a browser test drives the real ones
 * (`packages/ui/test/map/draw/terra-draw-real.test.ts`). The names and shapes are the installed 1.x API
 * (`new TerraDraw({adapter, modes, idStrategy})`, `start`, `setMode`, `getSnapshot`, `addFeatures`,
 * `updateFeatureGeometry`, `removeFeatures`, `selectFeature`, `setModeStyles`, `getFeaturesAtLngLat`, the `change`,
 * `finish`, `select` and `deselect` events; modes with `styles` and `validation`, the select mode's per-mode `flags`,
 * `keyEvents` and `allowManualDeselection`), as read from the installed declarations (DECISIONS-for-review.md §34g). The
 * real constructors take wider options (Mapbox's own map type), so the loader hands them over as these types and the
 * browser test with the real Terra Draw is what proves the match.
 */

export type TdFeatureId = string | number;

/** A feature of Terra Draw's store: GeoJSON whose `properties.mode` names the mode that owns it. */
export interface TdFeature {
    readonly id?: TdFeatureId;
    readonly type: 'Feature';
    readonly geometry: { readonly type: string; readonly coordinates: unknown };
    readonly properties: Readonly<Record<string, unknown>>;
}

export interface TdValidationResult {
    readonly valid: boolean;
    readonly reason?: string;
}

/** A mode's `validation` option: called for every new or moved coordinate; an invalid result refuses the change. */
export type TdValidation = (feature: TdFeature, context: { readonly updateType?: string }) => TdValidationResult;

/** What `finish` reports: `draw` for a new shape, `dragFeature`, `dragCoordinate` and the like for an edit. */
export interface TdFinishContext {
    readonly mode: string;
    readonly action: string;
}

export interface TdAddResult {
    readonly id?: TdFeatureId;
    readonly valid: boolean;
    readonly reason?: string;
}

interface TdIdStrategy {
    isValidId(id: TdFeatureId): boolean;
    getId(): TdFeatureId;
}

export interface TdInstance {
    start(): void;
    stop(): void;
    setMode(mode: string): void;
    getSnapshot(): readonly TdFeature[];
    addFeatures(features: TdFeature[]): readonly TdAddResult[];
    hasFeature(id: TdFeatureId): boolean;
    /** Throws for a geometry of another type or one its mode refuses. */
    updateFeatureGeometry(id: TdFeatureId, geometry: TdFeature['geometry']): void;
    removeFeatures(ids: TdFeatureId[]): void;
    selectFeature(id: TdFeatureId): void;
    deselectFeature(id: TdFeatureId): void;
    setModeStyles(mode: string, styles: TdStyles): void;
    /** The features drawn within `pointerDistance` CSS px of a position. */
    getFeaturesAtLngLat(
        lngLat: { readonly lng: number; readonly lat: number },
        options: { readonly pointerDistance: number },
    ): readonly TdFeature[];
    /**
     * `context.origin` is `api` for a change the port made itself (`addFeatures`, `updateFeatureGeometry`); `context.target`
     * is `properties` for a change of a feature's marks (selected or not), `geometry` for a move.
     */
    on(
        event: 'change',
        listener: (ids: readonly TdFeatureId[], type: string, context?: { readonly origin?: string; readonly target?: string }) => void,
    ): void;
    on(event: 'finish', listener: (id: TdFeatureId, context: TdFinishContext) => void): void;
    on(event: 'select', listener: (id: TdFeatureId) => void): void;
    on(event: 'deselect', listener: () => void): void;
}

export interface TdOptions {
    readonly adapter: unknown;
    readonly modes: readonly unknown[];
    readonly idStrategy: TdIdStrategy;
}

/** Styles of the point, line and polygon modes (Terra Draw colours are `#rrggbb`). */
export type TdStyles = Readonly<Record<string, string | number>>;

export interface TdModeOptions {
    readonly modeName?: string;
    readonly styles?: TdStyles;
    readonly validation?: TdValidation;
    readonly flags?: Readonly<Record<string, unknown>>;
    /** The select mode's own keys (Delete, Escape): null leaves the keyboard to the editor's tools. */
    readonly keyEvents?: null;
    /** The select mode: false keeps the selection when the map is clicked elsewhere (a click then moves a point). */
    readonly allowManualDeselection?: boolean;
}

type TdModeConstructor = new (options?: TdModeOptions) => unknown;

/** The constructors the adapter needs: `terra-draw`'s and the Mapbox GL adapter's. */
export interface TerraDrawModules {
    readonly TerraDraw: new (options: TdOptions) => TdInstance;
    readonly TerraDrawPointMode: TdModeConstructor;
    readonly TerraDrawLineStringMode: TdModeConstructor;
    readonly TerraDrawPolygonMode: TdModeConstructor;
    readonly TerraDrawRectangleMode: TdModeConstructor;
    readonly TerraDrawSelectMode: TdModeConstructor;
    readonly TerraDrawRenderMode: TdModeConstructor;
    readonly TerraDrawMapboxGLAdapter: new (options: { readonly map: unknown; readonly coordinatePrecision: number }) => unknown;
}
