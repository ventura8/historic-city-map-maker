# M1 interfaces: the contracts the parallel agents build on

Written on 2026-10-12 by the M1 contracts agent, before the M1 workstreams start in parallel. Read it together with
`docs/ENGINE_API.md` (the public contract: `config.js`, `<hcm-map-viewer>`, the JavaScript API, the URL hash, the
City Manifest v1, versioning), `PLAN.md` (Addenda 1–3) and `M0-handoff.md` (toolchain, how to add a gate or a
workspace).

What is already implemented and tested (100 % lines and branches per file) is marked **done**; everything else is a
contract the owning workstream implements exactly as written. A change to anything here goes through
[Change requests](#change-requests) at the end of this file, never by editing another workstream's files.

Updated on 2026-10-12, still before the parallel build, for PLAN Addendum 3 (POIs, live transparency for every
overlay, raster image adjustments, audited edits): [§11](#11-addendum-3-delta-2026-10-12) lists every change, and the
sections below already read as the current contract.

## 1. Module ownership

Each workstream writes only its own paths. Reading and importing anything is fine; editing a file you do not own is a
change request.

| Workstream | Owns (writes) | Notes |
| --- | --- | --- |
| contracts (**done**) | `packages/shared/**`, `scripts/seed/**`, the migration outputs `seed/bucharest/derived/` and `seed/bucharest/manifest.static.json`, `docs/ENGINE_API.md`, this file | After M1 starts, `packages/shared/**` changes only through a change request (every workstream depends on it). |
| ui-kit | `packages/ui/**` | Already contains `src/theme/dynamic-color.ts` and `scripts/gen-theme.mjs` (**done**, by the contracts agent); their exported API is a contract (§4). |
| engine-core | `packages/engine/src/core/**`, `packages/engine/src/map/**`, `packages/engine/src/telemetry/**`, `packages/engine/src/config/**`, `packages/test-support/src/fake-map.ts` | The only workstream that touches `mapbox-gl` (`map/mapbox-adapter.ts`, dependency-cruiser rule `only-the-map-adapter-imports-mapbox`). |
| engine-ui | `packages/engine/src/ui/**`, `packages/engine/src/index.ts` | Builds the viewer from the ui-kit components and the engine-core store. |
| e2e-infra | `e2e/**` (including `e2e/scenarios.json`), `sites/**`, `starter-kit/**`, `scripts/site/**` | The site build, the starter kit, the Playwright tiers, the mock APIs. |

Shared files without an owner (`package.json`, `package-lock.json`, `tsconfig.json`, the per-package `tsconfig.json`
files, `docs/*.md` other than `docs/ENGINE_API.md`, `.agent/**`, `.agents/**`, `.claude/**`) are edited by the
integrator after the workstreams finish; a workstream that needs a change there files a change request. Ask-first files
(`AGENTS.md` → *Boundaries*) stay ask-first.

Tests live next to the code they test: `packages/<pkg>/test/**` mirrors `src/`; engine-core's tests go under
`packages/engine/test/core/**`, `test/map/**`, `test/telemetry/**`, `test/config/**`, engine-ui's under
`packages/engine/test/ui/**`.

## 2. Engine source layout

```text
packages/engine/src/
  index.ts                 engine-ui: ENGINE_VERSION, MAPBOX_GL_VERSION, mount, defineElements, the IIFE auto-boot
  config/                  engine-core: resolve the configuration, fetch the manifest (timeout), compat + validation
  core/                    engine-core: the viewer store (on the overlay model of @hcm/shared), the timeline, hash sync, map specs
  map/map-port.ts          engine-core: the MapPort interface and its types (§3)
  map/mapbox-adapter.ts    engine-core: createMapboxPort, the only module that imports mapbox-gl
  telemetry/               engine-core: consent, the lazy analytics loader, the error reporter (§6)
  ui/                      engine-ui: <hcm-map-viewer> and the viewer-only elements (§5.2)
packages/test-support/src/fake-map.ts   engine-core: FakeMap implements MapPort (test-only)
```

`mapbox-gl@3.32.0` joins `@hcm/engine` as an exact devDependency (types and the adapter's browser tests only; the build
keeps it external). The engine's browser tests need a second Vitest project (`engine-browser`), which is a
`vitest.config.ts` change: change request CR-2.

## 3. Shared contracts in `@hcm/shared` (done)

Import everything from `@hcm/shared`; the public API is pinned by `packages/shared/test/index.test.ts`.

| Area | Exports | File |
| --- | --- | --- |
| Manifest v1 | `manifestSchema`, `citySchema`, `layerSchema`, `photoSchema`, `themeSchema`; types `Manifest`, `City`, `Layer`, `LayerSource`, `LayerAdjustments`, `LayerAdjustmentName`, `Photo`, `PhotoImage`, `PhotoLink`, `Credit`, `Theme`, `ThemeTokens`, `ThemeScheme`, `Basemap`, `License`, `LayerKind`; constants `MANIFEST_VERSION`, `LICENSES`, `LAYER_KINDS`, `LAYER_ADJUSTMENT_RANGES` (`{min, max, neutral}` per adjustment), `THEME_SCHEMES`, `MAX_LAYERS`, `MAX_PHOTOS` | `packages/shared/src/schemas/manifest.ts` |
| Manifest rules | the cross-value checks `manifestSchema` runs: unique ids, one overlay namespace, places inside the city (`PHOTO_LOCATION_SLACK_DEG`), POI references | `packages/shared/src/schemas/manifest-rules.ts` |
| POIs | `poiCategorySchema`, `poiSchema`, `photosOverlaySchema`; types `PoiCategory`, `Poi`, `PoiIcon`, `PhotosOverlay`; `POI_ICONS` (the bundled Material Symbols), `DEFAULT_POI_ICON` (`location_on`), `ICON_NAME_PATTERN`, `MAX_POIS` (5000), `MAX_POI_CATEGORIES` (50), `MAX_POI_PHOTOS` (20) | `packages/shared/src/schemas/poi.ts` |
| Geometry | `geometrySchema` (GeoJSON `Point`, `LineString`, `Polygon`), `geometryDocSchema` (the Firestore shape without nested arrays: `{type:'Point', point}`, `{type:'LineString', points}`, `{type:'Polygon', rings:[{points}]}`), `geometryToDoc`, `geometryFromDoc`, `geometryPositions`; `GEOMETRY_TYPES`, `MAX_GEOMETRY_VERTICES` (500), `MAX_POLYGON_RINGS` (20); types `Geometry`, `GeometryDoc`, `GeometryType` | `packages/shared/src/schemas/geometry.ts` |
| Overlay model | `overlaysFromManifest`, `findOverlay`, `overlayLabel`, `opacityPercent`, `withOverlayOpacity`, `withOverlayVisibility`, `withHashOpacity`, `hashOverlayOpacity`, `resetOverlays`; `OVERLAY_KINDS` (`raster`, `photos`, `poi`), `DEFAULT_PHOTOS_OPACITY`; types `Overlay`, `OverlayKind`, `OverlayLabel` | `packages/shared/src/overlays/model.ts` |
| Overlay paint | `overlayOpacityPaint(kind, opacity, base?)` → `PaintUpdate[]` (`{layerType, property, value}`), `rasterAdjustmentPaint(adjustments?)` → `RasterAdjustmentPaint`; `OPACITY_PROPERTIES`, `OVERLAY_LAYER_TYPES`, `MAP_LAYER_TYPES`; types `MapLayerType`, `OpacityProperty`, `OpacityBase` | `packages/shared/src/overlays/paint.ts` |
| POI helpers | `poiInYear(poi, year)` (the timeline filter), `poiIcon(name)` (bundled icon or the default pin) | `packages/shared/src/overlays/poi.ts` |
| Embed config | `engineConfigSchema`, `EngineConfig`, `DEFAULT_CONTAINER_SELECTOR` | `packages/shared/src/schemas/config.ts` |
| Firestore (refined in M2) | `cityDocSchema`, `layerDocSchema`, `photoDocSchema`, `poiDocSchema`, `poiCategoryDocSchema`, `historyEntryDocSchema`, `jobDocSchema`, `usgsSceneDocSchema`, `setupStatusDocSchema`, `adminDocSchema`, `timestampSchema` and their types; the enums `FIRESTORE_LICENSES`, `PROCESSING_STATES`, `LAYER_STATUSES`, `JOB_TYPES`, `JOB_STATUSES`, `USGS_DATASETS`, `USGS_SCENE_STATUSES`, `SERVICE_STATES`, `ADMIN_ROLES`, `GEOREF_METHODS`, `HISTORY_ENTITIES`, `HISTORY_ACTIONS`. Every audited document (city, layer, photo, POI, POI category, history entry) requires `updatedBy` and `updatedAt` | `packages/shared/src/schemas/firestore.ts` |
| Validation | `validate(schema, input)`, `validateManifest`, `parseManifestJson`, `toValidationIssues`, `formatPath`, `isValidationCode`; `ValidationIssue = {path, code}`, `ValidationResult<T>`, `ValidationCode` (every `validation.*` i18n key) | `packages/shared/src/schemas/validation.ts` |
| Compatibility | `checkManifestCompat(input, engineVersion)` → `{ok: true}` or `{ok: false, code: 'error.manifest.version' \| 'error.manifest.engineTooOld', minVersion?}`; `compareVersions`, `parseVersion` | `packages/shared/src/schemas/compat.ts` |
| Ids and shared fields | `ID_PATTERN` (`^[A-Za-z0-9_-]{1,40}$`), `isId`, `PHOTOS_OVERLAY_ID` (`photos`), `MAX_LINKS` | `packages/shared/src/schemas/primitives.ts` |
| Geo | `LngLat`, `clamp`, `wrapBearing`, `bearingDelta`, `roundTo`, `toRadians`, `toDegrees`, `EARTH_RADIUS_M`, `MAX_MERCATOR_LAT`; `bearingBetween`, `distanceMeters`, `destinationPoint`; `ViewCone`, `conePolygon(location, cone, segments = 8)`, `coneFromPolygon(ring, apexHint)`, `findConeApex(ring)`, `angularSpan`, `openRing`, `DEFAULT_FOV` (60), `MIN_FOV`, `MAX_FOV`; `BBox`, `BoundsRecord`, `bboxOf`, `bboxContains`, `bboxIntersects`, `bboxExpand`, `bboxCenter`, `clampToBBox`, `bboxToRecord`, `bboxFromRecord` | `packages/shared/src/geo/` |
| URL hash v1 | `encodeHash(state)`, `decodeHash(hash, limits?)`; `HashState`, `DecodedHash` (`legacy` flag), `HashLimits` (with `overlayIds?`: the manifest's overlay ids, so `op=` entries of unknown overlays are dropped), `MapView = {center, zoom, bearing}`, `DEFAULT_HASH_LIMITS`, `MAX_HASH_LENGTH`, `MAX_OVERLAY_ENTRIES` (the encoder writes at most as many as the decoder reads) | `packages/shared/src/url/hash.ts` |
| Text | `parseMarkdown(source)` → `{paragraphs, rejectedLinks}` of `InlineNode`s (`text`, `strong`, `em`, `link`, `break`), `markdownToPlainText`; `isHttpsUrl`, `isRelativeUrl`, `isHostOf`, `toHttpsUrl`, `MAX_URL_LENGTH` | `packages/shared/src/text/` |
| i18n | `translate(locale, key, params)`, `resolveLocale`, `LOCALES`, `DEFAULT_LOCALE`, `MessageKey` (the viewer keys of §7 are in the catalogues) | `packages/shared/src/i18n/` |
| Logging | `createLogger(scope, {sink, minLevel})` (secret-looking keys redacted) | `packages/shared/src/log.ts` |
| Legacy migration | `migrateLegacyPhotos`, `legacyHtmlToText`, `buildStaticManifest`, `photoAuthorsCredit`, `parseLegacyYear`, `slugify`, `uniqueIds`, ... (§8) | `packages/shared/src/migration/` |

Rules for every consumer: render data with Lit templates or `textContent` only; render `about`, `privacy` and POI
descriptions by walking `parseMarkdown(...).paragraphs` into DOM nodes (links get `rel="noopener noreferrer nofollow ugc"` and
`target="_blank"`); show a validation problem as `translate(locale, issue.code)` plus `issue.path`.

## 4. MapPort (engine-core)

```ts
// packages/engine/src/map/map-port.ts
import type {
    BBox,
    Geometry,
    LayerAdjustments,
    LayerSource,
    Locale,
    LngLat,
    MapView,
    RasterAdjustmentPaint,
} from '@hcm/shared';

/** The overlay id of the photo markers and cones (PLAN Addendum 3); defined once, in @hcm/shared. */
export { PHOTOS_OVERLAY_ID } from '@hcm/shared';

/** Mapbox Standard style slots: bottom (above polygons), middle (above roads, below 3D buildings), top (above POI labels). */
export type MapSlot = 'bottom' | 'middle' | 'top';

export interface RasterLayerSpec {
    /** The manifest layer id; the adapter derives its own ids from it (`hcm-raster-<id>`, `hcm-source-<id>`). */
    readonly id: string;
    /** `mapbox` becomes `mapbox://<tilesetId>`; `xyz` a raster source with `tiles` and `tileSize`; `pmtiles` uses the official PMTiles TileProvider. */
    readonly source: LayerSource;
    readonly minzoom: number;
    readonly maxzoom: number;
    readonly bounds?: BBox;
    readonly visible: boolean;
    /** 0..1, `raster-opacity`. */
    readonly opacity: number;
    /** Applied as `rasterAdjustmentPaint(adjustments)` (all four `raster-*` values, absent ones neutral). */
    readonly adjustments?: LayerAdjustments;
    /** Higher draws on top of lower within the slot (the manifest `order`). */
    readonly order: number;
    /** Added to the attribution control while the layer is visible. */
    readonly attribution: string;
}

/** Properties of a photo point; titles are already in the current locale. */
export interface PhotoPointProperties {
    readonly id: string;
    readonly title: string;
    readonly year: number | null;
    /** Rotates the camera icon; null draws an unrotated marker and no cone. */
    readonly bearing: number | null;
}

export interface PhotoPointFeature {
    readonly type: 'Feature';
    readonly geometry: { readonly type: 'Point'; readonly coordinates: LngLat };
    readonly properties: PhotoPointProperties;
}

/** A view cone (`conePolygon` from @hcm/shared), shown from zoom 17. */
export interface PhotoConeFeature {
    readonly type: 'Feature';
    readonly geometry: { readonly type: 'Polygon'; readonly coordinates: readonly (readonly LngLat[])[] };
    readonly properties: { readonly id: string };
}

/** Points and cones in one collection; the adapter splits them (points are clustered, cones are not). */
export interface PhotoFeatureCollection {
    readonly type: 'FeatureCollection';
    readonly features: readonly (PhotoPointFeature | PhotoConeFeature)[];
}

/** One POI on the map; the title is already in the current locale (the label from zoom 16). */
export interface PoiFeature {
    readonly type: 'Feature';
    readonly geometry: Geometry;
    readonly properties: { readonly id: string; readonly title: string };
}

/**
 * A vector overlay (PLAN Addendum 3): today one POI category. The adapter draws its points as `symbol` (icon + label)
 * with a `circle` behind the icon, its LineStrings and polygon outlines as `line`, its polygons as `fill`, all from one
 * GeoJSON source, in the category colour; the store passes only the POIs the timeline shows (`poiInYear`).
 */
export interface VectorOverlaySpec {
    /** The overlay id: the POI category id. */
    readonly id: string;
    readonly kind: 'poi';
    readonly features: readonly PoiFeature[];
    /** `#rrggbb`. */
    readonly color: string;
    /** A bundled Material Symbols name (`poiIcon(category.icon)`), rasterised once per name with `addImage`. */
    readonly icon: string;
    readonly visible: boolean;
    /** 0..1, applied with `overlayOpacityPaint('poi', opacity, base)`. */
    readonly opacity: number;
}

export interface MapOptions {
    /** `basemap.style` of the manifest. */
    readonly style: string;
    /** Mapbox Standard configuration, set on the `basemap` import. */
    readonly config?: Readonly<Record<string, string | number | boolean>>;
    readonly accessToken: string;
    readonly view: MapView;
    readonly minZoom: number;
    readonly maxZoom: number;
    readonly maxBounds?: BBox;
    readonly locale: Locale;
    /** True with `prefers-reduced-motion: reduce`: flyTo jumps instead of animating. */
    readonly reducedMotion: boolean;
}

export type MapErrorKind = 'style' | 'source' | 'tile' | 'webgl' | 'unknown';

export interface MapEventMap {
    moveend: MapView;
    error: { readonly kind: MapErrorKind; readonly layerId?: string; readonly message: string };
    webglcontextlost: undefined;
    webglcontextrestored: undefined;
}

export type Unsubscribe = () => void;

export interface MapPort {
    /** False without WebGL (`mapboxgl.supported()`); the viewer then shows the photo list (scenario V02). */
    isWebGLSupported(): boolean;
    /** Creates the map in `container`; resolves when the style has loaded, rejects with a MapErrorKind message. */
    mount(container: HTMLElement, options: MapOptions): Promise<void>;
    /** Adds or replaces (same id) a historical raster layer in `slot` (the viewer uses 'middle'). */
    addRasterLayer(spec: RasterLayerSpec, slot: MapSlot): void;
    /** Adds or replaces (same id: new features after a year change) a vector overlay in `slot` (the viewer uses 'top'). */
    addVectorOverlay(spec: VectorOverlaySpec, slot: MapSlot): void;
    /** Any overlay id: a raster layer id, PHOTOS_OVERLAY_ID or a vector overlay id; an unknown id is ignored. */
    setOverlayVisibility(overlayId: string, visible: boolean): void;
    /**
     * Any overlay id; clamped to 0..1; coalesced to one paint update per animation frame while a slider moves. Paints
     * `overlayOpacityPaint(kind, opacity, base)` on every map layer of the overlay, `base` being that map layer's
     * designed opacity (a view cone's fill is translucent at full overlay opacity). An unknown id is ignored.
     */
    setOverlayOpacity(overlayId: string, opacity: number): void;
    /** Live raster image adjustments (the admin's preview, the viewer on load); an unknown layer id is ignored. */
    setLayerPaint(layerId: string, paint: RasterAdjustmentPaint): void;
    /** A raster layer or vector overlay id. */
    removeLayer(layerId: string): void;
    /** Replaces every photo marker and cone. */
    setPhotosData(data: PhotoFeatureCollection): void;
    /** A click on a photo marker or cone (a cluster click zooms in instead). */
    onPhotoClick(handler: (photoId: string) => void): Unsubscribe;
    /** A click on a POI's icon, line or fill. */
    onPoiClick(handler: (poiId: string) => void): Unsubscribe;
    /** Moves the camera; animated unless `reducedMotion` or `animate: false`. */
    flyTo(view: Partial<MapView>, options?: { readonly animate?: boolean }): void;
    getView(): MapView;
    on<E extends keyof MapEventMap>(event: E, handler: (payload: MapEventMap[E]) => void): Unsubscribe;
    /** Called by the viewer's ResizeObserver. */
    resize(): void;
    /** Removes the map and every listener; mount may be called again (a new map load). */
    destroy(): void;
    /** How many maps this port has created (each is a billed Mapbox map load): 1 per view. */
    readonly mapLoadCount: number;
}

/** packages/engine/src/map/mapbox-adapter.ts */
export declare function createMapboxPort(gl: typeof import('mapbox-gl').default): MapPort;
```

Adapter rules: `performanceMetricsCollection: false`, `attributionControl` always on (compact: collapsed but reachable),
`testMode` only in tests; 3D objects (`show3dObjects`) off while a historical layer is visible; never `setHTML` (popups
use `setDOMContent`); paint property names come only from `overlayOpacityPaint` and `rasterAdjustmentPaint`, never
from the adapter's own strings. FakeMap (`packages/test-support/src/fake-map.ts`) implements `MapPort` and records
`calls: readonly {method: string; args: readonly unknown[]}[]`, offers `emit(event, payload)`, `clickPhoto(id)` and
`clickPoi(id)`, and lets a test choose `webgl` and whether `mount` rejects.

## 5. UI components

### 5.1 ui-kit (`packages/ui`)

Lit 3 without decorators, `hcm-` prefix, an idempotent `define…(registry = customElements)` per element plus
`defineUiKit(registry)` for all, tokens only (`--md-sys-*`), 48 dp touch targets, RO/EN strings passed in by the app (the
kit has no catalogue of its own). Every event is a bubbling, composed `CustomEvent`.

| Tag | Properties (attribute) | Events (`detail`) | Slots |
| --- | --- | --- | --- |
| `hcm-icon` | `name` (a Material Symbols Rounded name from the bundled subset), `filled` | none | none |
| `hcm-button` | `variant` (`filled`, `tonal`, `outlined`, `text`), `icon`, `disabled` | native `click` | default (label) |
| `hcm-icon-button` | `icon`, `label` (accessible name, required), `toggle`, `selected`, `disabled` | `hcm-change` (`{selected}`) when `toggle` | none |
| `hcm-fab` | `icon`, `label`, `extended`, `size` (`small`, `medium`, `large`) | native `click` | none |
| `hcm-switch` | `checked`, `label`, `disabled` | `hcm-change` (`{checked}`) | none |
| `hcm-slider` | `min`, `max`, `step`, `value`, `label`, `valueText` (`aria-valuetext`) | `hcm-input` (`{value}`, per animation frame while dragging), `hcm-change` (`{value}`) | none |
| `hcm-chip` | `label`, `icon`, `selected` (filter chip) | `hcm-change` (`{selected}`) | none |
| `hcm-segmented-button` | `options` (`{value, label, icon?}[]`), `value`, `label` | `hcm-change` (`{value}`) | none |
| `hcm-card` | `variant` (`elevated`, `filled`, `outlined`) | none | `headline`, default, `actions` |
| `hcm-list`, `hcm-list-item` | item: `headline`, `supportingText`, `interactive` | native `click` on interactive items | item: `leading`, `trailing` |
| `hcm-sheet` | `open`, `label`, `variant` (`bottom` on compact, `side` from medium), `closeLabel` | `hcm-close` | `header`, default, `actions` |
| `hcm-dialog` | `open`, `headline`, `closeLabel` | `hcm-close` (`{returnValue}`) | default, `actions` |
| `hcm-snackbar` | `message`, `actionLabel`, `closeLabel`, `timeoutMs` (default 6000, 0 = until closed) | `hcm-action`, `hcm-dismiss` | none |
| `hcm-progress` | `kind` (`circular`, `linear`), `value` (0..1), `indeterminate`, `label` | none | none |
| `hcm-overlay-list` | `items` (`{id, kind, label, visible, opacity, color?, icon?}[]`: labels already localized, `opacity` 0..1, `color`/`icon` for a POI category's swatch), `groups` (`{kind, label}[]`: the group headings, e.g. `layers.group.historical`, `layers.group.places`; a kind without a heading is listed ungrouped), `toggleLabel`, `opacityLabel` (templates with `{name}`), `valueText` (template with `{percent}`), `changedText` (template with `{name}` and `{percent}`, announced in a polite live region after a change settles) | `hcm-overlay-visibility` (`{id, visible}`), `hcm-overlay-opacity` (`{id, opacity, final}`: `final: false` per animation frame while dragging or on each key press, `true` on release) | none |

`hcm-overlay-list` is the live-transparency list of PLAN Addendum 3, shared by the viewer's Layers panel and the admin's
default-opacity editor (the admin cannot import the engine): one row per item with an `hcm-switch` and an `hcm-slider`
(0 to 100 %, step 1; arrows ±1, PageUp/PageDown ±10, Home/End) whose `aria-valuetext` is `valueText`; a hidden
overlay keeps its slider enabled (moving it does not show the overlay, scenario S-V22-BAD-HIDDEN-OVERLAY). It renders
labels with Lit templates only.

Theme functions (`packages/ui/src/theme/`): `themeFromSeed(seed)` → `ThemeTokenSet` (**done**, also
`schemeFor`, `tokensForScheme`, `tokenName`, `contrastRatio`, `contrastIssues`, `relativeLuminance`, `isHexColor`,
`DEFAULT_SEED_COLOR`, `SPEC_VERSION = '2025'`), imported from the separate entry point `@hcm/ui/dynamic-color`, never
from `@hcm/ui`: `@material/material-color-utilities` 0.4.0 imports without file extensions, which Vite handles but
plain Node (the engine's and admin's node tests, Cloud Functions with external npm dependencies) cannot resolve; a
Cloud Function that needs it must bundle it (`noExternal` in `functions/build.mjs`). Plus, owned by ui-kit, `applyTheme(target: HTMLElement, tokens:
ThemeTokens, mode: 'light' | 'dark' | 'system', highContrast: boolean): void` (sets the custom properties on `target`
and follows `prefers-color-scheme` / `prefers-contrast` for `system`) and the existing `windowClassFor`,
`isCompactHeight`. The viewer never imports `@material/material-color-utilities` (the tokens come precomputed in the
manifest); only the admin calls `themeFromSeed` at run time.

### 5.2 Viewer elements (engine-ui, `packages/engine/src/ui`)

| Tag | Role |
| --- | --- |
| `hcm-map-viewer` | The public element of `docs/ENGINE_API.md`: owns the store, the map container, the layout per window class, the events. |
| `hcm-timeline` | Year scrubber over the layer years plus "today" (`timeline.*` keys); a year without a layer snaps to the nearest stop (V04). |
| `hcm-layer-panel` | The Layers sheet or panel: an `hcm-overlay-list` over `state.overlays` (historical layers, photos, POI categories, with the `layers.group.*` headings; the Places group only when the manifest has categories), the visible layers' attribution lines (`layers.*`). Slider input calls `setOverlayOpacity` per frame; `final: true` also writes the hash and fires `hcm-overlay-change`. |
| `hcm-photo-sheet` | The detail sheet (an `hcm-sheet`) for a photo or a POI: photo title, years, author, licence, rights note, links, thumbnail (`photo.*`, `license.*`); for a POI it renders `hcm-poi-detail`. |
| `hcm-poi-detail` | POI details: title, category (icon and colour), years (`poi.year`, `poi.years`, `poi.yearStart`, `poi.yearEnd`), the Markdown description (walked from `parseMarkdown`), links, linked photo thumbnails that open the photo (`poi.*`). |
| `hcm-lightbox` | Full image, pinch zoom, arrow keys, Esc returns focus (`lightbox.*`, V08). |
| `hcm-photo-list` | The photos without a map (no WebGL, V02) and "photos near this year". |
| `hcm-about-dialog` | About, credits, privacy (Markdown subset), engine version, consent withdrawal (`about.*`, `consent.withdraw`). |
| `hcm-consent-banner` | Analytics consent (`consent.*`, V19). |
| `hcm-error-card` | Boot and configuration errors with Retry (`error.*`, `action.retry`). |

## 6. Viewer store and telemetry (engine-core)

```ts
// packages/engine/src/core/store.ts
import type { DecodedHash, EngineConfig, Locale, Logger, Manifest, MapView, MessageKey, Overlay } from '@hcm/shared';
import type { WindowClass } from '@hcm/ui';

import type { MapPort, Unsubscribe } from '../map/map-port.js';
import type { ConsentState, TelemetryPort } from '../telemetry/telemetry-port.js';

export type ViewerStatus = 'idle' | 'loading' | 'ready' | 'error';
export type ThemeMode = 'system' | 'light' | 'dark';
export type SheetName = 'none' | 'layers' | 'photo' | 'poi' | 'photos' | 'about';

export interface ViewerError {
    readonly code: MessageKey;
    readonly retryable: boolean;
    readonly params?: Readonly<Record<string, string>>;
}

export interface ViewerState {
    readonly status: ViewerStatus;
    readonly error: ViewerError | null;
    readonly locale: Locale;
    readonly manifest: Manifest | null;
    readonly webgl: boolean;
    readonly view: MapView;
    /** The timeline stop; null is "today" (no historical layer). */
    readonly year: number | null;
    /**
     * Every overlay in list order (`overlaysFromManifest`: historical layers, photos, POI categories), updated only with
     * `withOverlayOpacity`, `withOverlayVisibility` and `withHashOpacity`; `[]` before the manifest loads.
     */
    readonly overlays: readonly Overlay[];
    readonly selectedPhotoId: string | null;
    readonly selectedPoiId: string | null;
    readonly lightbox: boolean;
    readonly sheet: SheetName;
    readonly windowClass: WindowClass;
    readonly compactHeight: boolean;
    readonly theme: ThemeMode;
    readonly consent: ConsentState;
    readonly toast: { readonly key: MessageKey; readonly params?: Readonly<Record<string, string>> } | null;
}

export interface ViewerActions {
    /** Fetch (or take the inline) manifest, check compat, validate, mount the map; errors land in state.error. */
    load(): Promise<void>;
    retry(): Promise<void>;
    setLocale(locale: Locale): void;
    setYear(year: number | null): void;
    /** Any overlay id (layer, `photos`, POI category); without `visible` it toggles. The map follows. */
    toggleOverlay(overlayId: string, visible?: boolean): void;
    /** Live: the map follows on the next animation frame; `final` (slider released) also writes the hash. */
    setOverlayOpacity(overlayId: string, opacity: number, final?: boolean): void;
    openPhoto(photoId: string | null): void;
    /** Opens the POI's details in the detail sheet (`sheet: 'poi'`); null closes; an unknown id is ignored. */
    openPoi(poiId: string | null): void;
    setLightbox(open: boolean): void;
    openSheet(sheet: SheetName): void;
    setView(view: MapView): void;
    setWindowSize(width: number, height: number): void;
    setTheme(theme: ThemeMode): void;
    setConsent(consent: 'granted' | 'denied'): void;
    showToast(key: MessageKey, params?: Readonly<Record<string, string>>): void;
    dismissToast(): void;
    /**
     * Applies a decoded URL hash (on load and on `hashchange`; decoded with the manifest's overlay ids as
     * `overlayIds`); opacities through `withHashOpacity`; unknown ids are ignored, an unknown photo shows a toast.
     */
    applyHash(hash: DecodedHash): void;
}

export interface ViewerStore extends ViewerActions {
    getState(): ViewerState;
    subscribe(listener: (state: ViewerState, previous: ViewerState) => void): Unsubscribe;
    destroy(): void;
}

export interface ViewerDeps {
    readonly config: EngineConfig;
    /** `fetch` for the manifest (tests pass a fake); the store applies a 15 s timeout. */
    readonly fetch: (url: string, init: { readonly signal: AbortSignal }) => Promise<Response>;
    readonly map: MapPort;
    readonly telemetry: TelemetryPort;
    /** localStorage-like; preferences live under `hcm:<cityId>:<name>` (`lang`, `theme`, `consent`). */
    readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
    /** Reads and writes the URL hash (history.replaceState). */
    readonly location: { readonly hash: string; replaceHash(hash: string): void };
    readonly log: Logger;
}

export declare function createViewerStore(deps: ViewerDeps): ViewerStore;

/** Photos within this many years of the selected stop are "near this year". */
export const PHOTO_YEAR_WINDOW = 10;
```

The store derives the map from `state.overlays`: `addRasterLayer` per historical layer, `setPhotosData` for the photos,
`addVectorOverlay` per POI category with the POIs `poiInYear(poi, state.year)` keeps (again after every year change),
then `setOverlayVisibility` / `setOverlayOpacity` whenever an overlay changes and `setLayerPaint` with
`rasterAdjustmentPaint(layer.adjustments)` once per raster. The URL hash carries `overlayOpacity:
hashOverlayOpacity(state.overlays)` (only overlays that differ from their default).

```ts
// packages/engine/src/telemetry/telemetry-port.ts
import type { Unsubscribe } from '../map/map-port.js';

export type ConsentState = 'unknown' | 'granted' | 'denied';

export type TelemetryEvent =
    | { readonly name: 'page_view' }
    | { readonly name: 'layer_toggle'; readonly layerId: string; readonly visible: boolean }
    | { readonly name: 'year_change'; readonly year: number | null }
    | { readonly name: 'photo_open'; readonly photoId: string }
    | { readonly name: 'poi_open'; readonly poiId: string }
    | { readonly name: 'share' }
    | { readonly name: 'compare_open' };

export type ErrorSource = 'window' | 'promise' | 'boundary';

export interface TelemetryPort {
    readonly consent: ConsentState;
    /** Stored under `hcm:<cityId>:consent`; withdrawing stops every later analytics request (V19). */
    setConsent(consent: 'granted' | 'denied'): void;
    onConsentChange(listener: (consent: ConsentState) => void): Unsubscribe;
    /** Dropped unless consent is granted and the manifest has a measurementId; the Firebase SDK loads lazily on the first one. */
    logEvent(event: TelemetryEvent): void;
    /** Never throws. Redacted (createLogger's rules plus URL queries), at most 5 per page and one per message per 10 s,
     * POSTed to `analytics.errorEndpoint` when set; a GA4 `exception` event too when consent is granted (V20). */
    reportError(error: unknown, context: { readonly fatal: boolean; readonly source: ErrorSource }): void;
    destroy(): void;
}

/** The body sent to `telemetry.reportError` (M2 HTTPS function). No PII: no hash, no query, no visitor position. */
export interface ErrorReportPayload {
    readonly message: string;
    readonly stack?: string;
    readonly release: string;
    readonly cityId: string;
    /** `location.origin + location.pathname`. */
    readonly page: string;
    readonly viewport: { readonly width: number; readonly height: number };
    readonly windowClass: string;
    readonly locale: string;
    readonly fatal: boolean;
    readonly source: ErrorSource;
}
```

## 7. Viewer i18n keys

All keys are in `packages/shared/src/i18n/ro.ts` and `en.ts` now (128 keys after PLAN Addendum 3, parity checked by
the `i18n` gate); a missing key is a change request. Families:

- `validation.*`: the codes `validate` returns (required, type, tooSmall, tooBig, format, value, unknownKey,
  httpsOnly, assetUrl, bounds, zoomRange, centerOutside, duplicateId, outsideCity, yearRange, markdownLink, cssValue,
  tileTemplate, manifestSource, json, invalid, ringClosed, reference).
- `error.*`: `generic`; `manifest.notFound`, `.network`, `.timeout`, `.invalid` (`{count}`), `.version`,
  `.engineTooOld` (`{version}`); `config.missing`, `.invalid` (`{detail}`), `.cityMismatch` (`{cityId}`,
  `{manifestCityId}`), `.container` (`{selector}`); `webgl`, `mapLoad`, `tiles`, `layer` (`{name}`), `photoImage`,
  `unknownPhoto`; `geolocate.denied`, `.outside`, `.unavailable`.
- `action.*`: `retry`, `close`, `share`, `locate`, `menu`, `previous`, `next`.
- `viewer.loading`, `viewer.mapLabel` (`{city}`), `viewer.skipToTimeline`.
- `timeline.label`, `.year` (`{year}`), `.present`, `.noLayer` (`{year}`).
- `layers.title`, `.toggle` (`{name}`), `.opacity` (`{name}`), `.opacityValue` (`{percent}`), `.photos`,
  `.attribution` (`{attribution}`), `.empty`, `.kind.satellite`, `.kind.aerial`, `.kind.map`; for the overlay list
  `.group.historical`, `.group.places`, `.opacityChanged` (`{name}`, `{percent}`; the live announcement), `.shown`,
  `.hidden` (`{name}`).
- `poi.marker` (`{title}`), `.category` (`{category}`), `.year` (`{year}`), `.years` (`{yearStart}`, `{yearEnd}`),
  `.yearStart` (`{yearStart}`), `.yearEnd` (`{yearEnd}`), `.yearSeen` (`{year}`; M27: traced on that year's plan),
  `.links`, `.photos`, `.openPhoto` (`{title}`).
- `photos.title`, `.list`, `.count.one`, `.count.few`, `.count.other` (`{count}`; pick the form with
  `Intl.PluralRules(locale)`), `.nearYear` (`{year}`).
- `photo.marker` (`{title}`), `.author` (`{author}`), `.year` (`{year}`), `.years` (`{year}`, `{yearEnd}`),
  `.unknownYear`, `.links`, `.rightsReview`, `.openLightbox`.
- `license.<value>` for every value of `LICENSES`.
- `lightbox.label`, `.position` (`{index}`, `{total}`); `share.copied`, `.failed`.
- `about.title`, `.credits`, `.privacy`, `.engine` (`{version}`); `theme.label`, `.system`, `.light`, `.dark`;
  `language.label`, `.ro`, `.en`.
- `consent.title`, `.body`, `.accept`, `.decline`, `.withdraw`, `.granted`, `.denied`; `geolocate.locating`.

A catalogue entry stays on one line of at most 140 columns: Prettier wraps a longer one, and the `i18n` gate then
reports it.

## 8. Legacy migration (done)

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  node scripts/seed/migrate-legacy.mjs   # or: npm run seed:migrate
```

- Input: `seed/bucharest/photos.legacy.geojson` and `seed/bucharest/photos/` (never modified), the city seed
  `scripts/seed/bucharest.city.json` (names, About, credits, privacy, basemap, the `pk.REPLACE_AT_DEPLOY` placeholder).
- Output (rewritten on every run): `seed/bucharest/derived/<id>/web.webp` (2048 px long edge) and `thumb.webp`
  (400 px), metadata stripped by sharp; `seed/bucharest/manifest.static.json`, schema-validated before it is written.
- Result on 2026-10-12: 45 photos (44 points, of which one file is shown from two places, plus one cone without a point,
  `fonteriei`, placed at its apex), 34 cones turned into bearing and field of view, 9.52 MB of derivatives (budget
  15 MB), three originals no feature refers to (reported, not migrated), every photo `permission-legacy` with
  `rightsReview: true`. Links: the Facebook and Flickr sources and the costingheorghe.ro page (http upgraded); the
  "Alte legături:" lead-in is dropped because the link is listed.
- The site build (e2e-infra) serves the manifest with its `derived/` folder next to it: image URLs are relative to the
  manifest.
- Theme: `themeFromSeed('#8B5E3C')` (TonalSpot, SpecVersion 2025), 53 `--md-sys-color-*` tokens per scheme;
  `node packages/ui/scripts/gen-theme.mjs --seed '#8B5E3C'` prints the same `theme` object.

## 9. Scenario rows registered for M1

New rows in `e2e/scenarios.json` (status `planned`, owned by e2e-infra from now on): `S-V01-BAD-ENGINE-TOO-OLD`,
`S-V07-BAD-NO-BEARING`, `S-V09-HAPPY-LEGACY-HASH`, `S-V13-BAD-MARKUP-IS-TEXT`, `S-V17-BAD-CITY-MISMATCH`, and the new
behaviour `V21` (embed API): `S-V21-HAPPY`, `S-V21-BAD-MISSING-CONTAINER`, `S-V21-BAD-AFTER-DESTROY`. V19 (consent) and
V20 (crash reporting) already had happy and bad rows from M0; their texts now match §6.

PLAN Addendum 3 adds three behaviours. The contracts brief called them V21 to V23, but V21 was already the embed API,
so they are **V22 to V24**:

- **V22, live overlay opacity**: `S-V22-HAPPY` (a historical layer), `S-V22-HAPPY-PHOTOS`, `S-V22-HAPPY-POI`,
  `S-V22-BAD-KEYBOARD-LIMITS`, `S-V22-BAD-HIDDEN-OVERLAY`.
- **V23, overlay opacity in the URL hash**: `S-V23-HAPPY`, `S-V23-BAD-OUT-OF-RANGE`, `S-V23-BAD-UNKNOWN-OVERLAY`. The
  two earlier `op=` rows of V05 (`S-V05-HAPPY-OVERLAY-HASH`, `S-V05-BAD-UNKNOWN-OVERLAY`, never implemented) moved here;
  V05 keeps the single historical-layer slider and its `opacity=` clamp.
- **V24, points of interest**: `S-V24-HAPPY` (render and details), `S-V24-HAPPY-YEAR-FILTER`,
  `S-V24-BAD-MARKUP-IS-TEXT`, `S-V24-BAD-INVALID-POI`, `S-V24-BAD-NO-POIS`, `S-V24-BAD-UNBUNDLED-ICON`.

The admin's default-opacity save (admin slider → document → manifest → viewer) and the POI editor are M2 admin
behaviours; their rows join with the admin workstream.

## 10. E2E fixture manifest

The viewer's e2e tiers (e2e-infra) serve one **fixture manifest**, assembled at test start and validated with
`validateManifest` before it is served (an invalid fixture fails the setup, never a scenario):

1. the migrated Bucharest manifest `seed/bucharest/manifest.static.json` with its `derived/` images (45 photos, no
   layers, no POIs);
2. the e2e raster layers of `design-review-testability.md` §4.2: one `mapbox://` tileset and one `xyz` source served by
   the mock APIs as solid colours (no committed binaries);
3. the **POI fixture set** `scripts/seed/e2e-pois.json` (owned by contracts), merged at the top level. Bucharest has no
   real POIs until admins add them in M2. `packages/shared/test/seed/e2e-pois.test.ts` pins that the merge with the seed
   manifest validates and covers what V22–V24 need.

| Fixture | What it is | What it exercises |
| --- | --- | --- |
| `photosOverlay` | `defaultOpacity: 1` | the photos overlay's default (S-V22-HAPPY-PHOTOS, S-V23) |
| category `cladiri` | "Clădiri dispărute" / "Vanished buildings", icon `domain_disabled`, `#8B5E3C`, opacity 1 | a bundled icon; two POIs, a point and a polygon, faded together (S-V22-HAPPY-POI) |
| category `strazi` | "Străzi dispărute" / "Vanished streets", icon `add_road`, `#B3261E`, opacity 0.8 | a default below 1 (S-V23: not written to the hash until changed) |
| category `evenimente` | "Evenimente" / "Events", icon `celebration`, `#386A20`, opacity 1 | an icon the engine does not bundle → the `location_on` pin (S-V24-BAD-UNBUNDLED-ICON) |
| POI `fixture-cladire` | Point near Uranus street, `yearEnd: 1984`, Markdown description with a link and an HTML bold tag, one link, `photoIds` `uranus-colt-mihai-voda` and `mihai-voda-1978` | details with thumbnails (S-V24-HAPPY), markup shown as text (S-V24-BAD-MARKUP-IS-TEXT) |
| POI `fixture-strada` | LineString of three positions, 1850–1985, Romanian title only | a line, the English fallback to Romanian |
| POI `fixture-cvartal` | Polygon (one closed ring), 1900–1986 | a fill; hidden at a timeline stop before 1900 (S-V24-HAPPY-YEAR-FILTER) |
| POI `fixture-eveniment` | Point, no years | shown at every stop |

Shown per timeline stop: today all four; 1890 every one but the block; 1990 only the event. A bad-path spec breaks a
copy of the fixture in the test (an open ring, an unknown category: S-V24-BAD-INVALID-POI) and S-V24-BAD-NO-POIS serves
the seed manifest alone.

## 11. Addendum 3 delta (2026-10-12)

What changed in this file and in `@hcm/shared` for PLAN Addendum 3, before any workstream started:

- **Manifest v1** gains the optional `photosOverlay {defaultOpacity}`, `poiCategories[]` and `pois[]` (§3,
  `docs/ENGINE_API.md`). Layer ids, `photos` and category ids are one overlay namespace (`validation.duplicateId`); a
  POI's category and photos must exist (`validation.reference`); polygon rings are closed (`validation.ringClosed`); POI
  positions lie within the city bounds plus 0.5° (`validation.outsideCity`). The layer adjustments keep their ranges,
  now defined once in `LAYER_ADJUSTMENT_RANGES`. `linkSchema` and `MAX_LINKS` moved to `primitives.ts`,
  `PHOTO_LOCATION_SLACK_DEG` to `manifest-rules.ts` (same public exports).
- **Firestore**: `poiDocSchema`, `poiCategoryDocSchema`, `historyEntryDocSchema` (the `history` subcollection of every
  audited document, written by a server trigger), `cityDocSchema.photosOverlay`; `layerDocSchema` now requires
  `updatedBy`/`updatedAt` like every audited document (server writers stamp `system:<writer>`). Rules: CR-4.
- **Overlay model** in `@hcm/shared` (`overlays/`), not in engine-core: the admin needs it too.
- **URL hash**: `HashLimits.overlayIds` drops `op=` entries of unknown overlays; the encoder writes at most
  `MAX_OVERLAY_ENTRIES`. Every existing hash decodes as before.
- **MapPort** (§4): `PHOTOS_OVERLAY_ID` comes from `@hcm/shared`; `setLayerVisibility`/`setLayerOpacity` became
  `setOverlayVisibility`/`setOverlayOpacity` (any overlay; opacity through `overlayOpacityPaint`); new
  `addVectorOverlay`, `setLayerPaint`, `onPoiClick`; FakeMap gains `clickPoi`.
- **UI** (§5): `hcm-overlay-list` in the ui-kit; `hcm-layer-panel` hosts it; `hcm-photo-sheet` is the detail sheet for
  photos and POIs; new `hcm-poi-detail`.
- **Store and telemetry** (§6): `overlays: readonly Overlay[]`, `selectedPoiId`, sheet `poi`, `toggleOverlay` (was
  `toggleLayer`), `setOverlayOpacity(id, opacity, final?)`, `openPoi`; event `poi_open`. The public controller keeps
  `toggleLayer` and gains `setOverlayOpacity` and `openPoi`; the element fires `hcm-overlay-change` and `hcm-poi-open`
  (`docs/ENGINE_API.md`).
- **i18n** (§7): 16 keys (`validation.ringClosed`, `validation.reference`, `layers.group.*`, `layers.opacityChanged`,
  `layers.shown`, `layers.hidden`, `poi.*`).
- **Scenarios** (§9): V22–V24; the two `op=` rows of V05 moved to V23. **Fixtures** (§10): the POI set.

## 12. Integration (2026-10-12)

The integrator joined the four workstreams after they finished and resolved the change requests below; this section
records what the contract became. The built Bucharest site boots behind the mock APIs with the real Mapbox GL JS in
SwiftShader (S-V16-HAPPY on c360 and l1440).

- **Contract additions accepted as built**: CR-8 (`ViewerDeps.engineVersion`, `mapContainer`, `reducedMotion`, the
  `location` extras, `TelemetryPort.setContext`, `createMapboxPort(gl, env?)` over the structural `MapboxGl`,
  `openCompare`, `createTelemetry`, `readConfig`, `loadManifest`, `hashLimits`) and CR-12 (the kit's additive API,
  `packages/ui/README.md`). The viewer elements of §5.2 live in `packages/ui/src/viewer/` (ownership override: one
  owner per tag), not in `packages/engine/src/ui/`; `hcm-consent-banner` is a kit element.
- **Store (§6) additions, CR-17**: `flyTo(view)` moves a mounted map (animated unless reduced motion) and records the
  view; `setView` stays the `moveend` path and never moves the camera; `logShare()` logs the `share` event after a
  completed share or copy; `destroy()` destroys the map port exactly once. `mount.ts` hands the store to the viewer
  unwrapped (its type is checked against `ViewerStorePort`).
- **Shared**: `isPhotoNearYear` and `PHOTO_YEAR_WINDOW` (`packages/shared/src/overlays/photos.ts`) are the one rule
  for the map's photo filter and the viewer's chip (CR-18b); `firebaseAppIdsSchema` and `city.analytics.firebase`
  (CR-9). i18n: `timeline.empty`, `sheet.resize`, `photo.rightsHolder` (131 keys in each catalogue).
- **No layers yet**: a city without historical layers (Bucharest until M3) shows the note `timeline.empty` ("Straturile
  istorice vin în curând" / "Historical layers coming soon") where the timeline would be (S-V04-HAPPY-NO-LAYERS-NOTE).
- **Found by the viewer smoke** (`docs/LESSONS.md`): the kit's `styleMap` bindings (slider, progress, overlay swatch)
  wrote `style` attributes the page's CSP refused, so they use `cssProperties` now
  (`packages/ui/src/components/css-properties.ts`); the engine build did not ship the kit's fonts (three 404s), so
  `npm run build --workspace @hcm/engine` copies them to `dist/fonts/` (CR-15, without touching `vite.config.ts`).
- **Found in the review screenshots**: the adapter drew POI glyphs with the family `Material Symbols Rounded`, which
  the kit never registers (it is `HCM Material Symbols Rounded`), so every POI was a plain dot; the sprite now uses
  `ICON_FONT_FAMILY` of `@hcm/ui`. Photo markers grew from 16 to 22 CSS px, clusters from 24 to 30. The second capture
  (all four viewports, light and dark) found About's theme choice wrapping "Ca sistemul" at 1440 px and scrolling the
  full-screen dialog sideways at 360 px: `hcm-segmented-button` segments are content-sized now and wrap a long label in
  a narrow container, and the full-screen About drops the theme icons (row S-V15-BAD-LONG-LABELS).
- **Rejected for M1**: the timeline play button and its keys `timeline.play` / `timeline.pause` (CR-18a; PLAN has no
  play button); the compare toggle stays M4.
- **Still open**: CR-1 and CR-4 (M2 rules; the schema side is done, `M2-interfaces.md` §2.3), CR-2 (the engine's browser project), CR-3 (`.htmlvalidate.json`), CR-10
  (the Firebase SDK in the IIFE).

## 13. E2E (2026-10-12)

The e2e author implemented the viewer's scenario matrix (V01–V25 except swipe compare V06, which is M4), the starter kit
(V17), the tour, the a11y specials and the no-WebGL project. What the contract gained or changed on the way, each with
its unit test and its lesson in `docs/LESSONS.md` (#9–#16):

- **Errors**: `error.manifest.invalid` carries `issuePath` and `issueCode` (the first issue) besides `count` and the
  `hcm-error` `detail`; `<hcm-error-card>` shows `path: message` in the visitor's language. A boot error card (an
  invalid or missing `config.js`) speaks the URL's language first, then `config.lang` (`urlLocaleOf` in
  `packages/engine/src/core/boot.ts`, used by `mount.ts`).
- **URL hash**: `withHashOpacity` applies the single `opacity=` to the visible rasters only, as `docs/ENGINE_API.md`
  says (it faded every raster before). `HashWriter` never overwrites a hash the address gained since its last write
  (`sync()` adopts it when the store applies a `hashchange`).
- **Telemetry**: `FirebaseSdk` gains `getApps`; the viewer's Firebase app is the default app unless the page has one
  (Performance Monitoring runs only on the default app), and Performance Monitoring starting in its own `try` never
  stops analytics.
- **i18n**: `map.title`, `map.toggleAttribution`, `map.logo` (Mapbox GL's own UI strings, passed as its `locale`
  option by `mapboxOptions`); `error.manifest.invalid` reads "probleme găsite: {count}" / "problems found: {count}".
- **UI**: the floating controls carry `data-layout-check`; the FAB menu chooses after focusing its button and wraps into
  a second column under `--hcm-fab-menu-max-block-size` (set by the viewer on landscape phones); the slider handle and
  the timeline thumb have 48 px touch targets; list links are 48 px tall; the toast flows in its top dock; the near-year
  chip sits a row above the menu on compact; the lightbox draws its texts on a surface and its arrows are tonal.
- **Shared**: zod runs `jitless` (no `Function('')` probe under the city pages' CSP).
- **E2E world**: the broken tileset answers 503 (Mapbox GL never reports a 404 tile); the mock basemap carries Standard's
  attribution and has a plain variant (`e2e-plain`); the mock APIs serve the Firebase web config and a stand-in gtag.js
  that records each GA4 event as a `g/collect` beacon; specs change a copy of `siteManifestData()` (the built site's
  manifest, with its `media/` paths). The matrix gate also reads `e2e/*.tour.ts`.

## Change requests

A workstream that needs a change outside its paths appends a row here and continues against the current contract;
the integrator (or the owner) applies it. Ids are `CR-<n>`; status `open`, `accepted`, `done` or `rejected`.

| Id | From | Target (owner) | Change | Why | Status |
| --- | --- | --- | --- | --- | --- |
| CR-1 | contracts | `firebase/firestore.rules` (M2) | add `dateText` (i18n, ≤ 100) to `photoFields()`; require `title.ro` | `photoDocSchema` has `dateText` (legacy dates such as `Iulie 1936`) and requires a Romanian title | schema done; rules: `M2-interfaces.md` §2.3, CR-M2-1 |
| CR-2 | contracts | `vitest.config.ts` (ask-first) | an `engine-browser` project (Chromium) for the Mapbox adapter and the Lit viewer, and a `tools` node project for CLI tests | today the engine project is node-only and the CLI tests of `scripts/seed` and `packages/ui/scripts` run from the shared project | open (ask-first proposal, `DECISIONS-for-review.md` §9; the engine's Mapbox adapter is unit-tested against a fake `mapboxgl` meanwhile and runs for real only in the e2e tiers) |
| CR-3 | contracts | `.htmlvalidate.json` (ask-first) | extend `html-validate:prettier` | e2e-infra needs a committed `sites/bucharest/index.html`; until then it is generated from TypeScript templates at build time and validated with the html-validate library in a unit test | open (ask-first, `DECISIONS-for-review.md` §1; the pages are still generated and validated in `scripts/site/test`) |
| CR-4 | contracts | `firebase/firestore.rules` and its rules tests (M2) | `pois/{poi}` and `poiCategories/{category}`: admin-only writes with the fields of `poiDocSchema` / `poiCategoryDocSchema` (geometry type and sizes, `category` an id, `photoIds` ≤ 20, `links` ≤ 5) plus the stamp; `history/{entry}` under every audited document: read for admins, never client-written; `layers`: admins may also change `adjustments` (the four ranges, min ≤ max); `cities/{city}`: `photosOverlay.defaultOpacity` 0–1 | PLAN Addendum 3 (edit anything, POIs, audit); the shapes are fixed in `packages/shared/src/schemas/firestore.ts` | schema done (`CLIENT_WRITES`); rules: `M2-interfaces.md` §2.3, CR-M2-1 |
| CR-5 | ui-kit | engine-ui (information, no change needed) | The kit's module paths: `packages/ui/src/components/<name>.ts` exports `HCM_<NAME>_TAG`, the class `Hcm<Name>` and an idempotent `defineHcm<Name>(registry = customElements)`; `defineUiKit(registry)` in `components/define.ts` registers all; everything is also exported from `@hcm/ui` (`packages/ui/src/index.ts`). Files: `icon`, `button`, `icon-button`, `fab`, `fab-menu`, `switch`, `slider`, `chip`, `segmented-button`, `card`, `list` (`hcm-list`, `hcm-list-item`), `sheet`, `dialog`, `snackbar`, `progress`, `loading-indicator`, `toolbar`, `consent-banner`, `overlay-list`. Theme: `theme/apply.ts` (`applyTheme`), `theme/system.ts` (shape, type, motion, elevation, state tokens); layout: `layout/window-class.ts` (`WindowClassController`); fonts: `fonts/font-faces.ts` (`installFonts`). `hcm-consent-banner` is a kit element (texts and events only); engine-ui wires it to the store and does not define its own | the ownership override puts every Lit element in `packages/ui`; one tag must have one owner | done (information; engine-ui uses the kit's elements) |
| CR-6 | e2e-infra | engine-ui (`packages/engine/src/index.ts`) | The city pages load the ES module build: `<script type="module" src="engine/engine.mjs">` after `mapbox-gl.js` and `config.js` (both deferred classic scripts, so they run first). The auto-boot from `window.HistoricCityMapConfig` must therefore run in `engine.mjs` too, not only in the IIFE build (`docs/ENGINE_API.md` → *Auto-boot* names the IIFE), and `engine.mjs` must not keep a bare `import … from 'mapbox-gl'` (the engine reads the global `mapboxgl`). The viewer smoke `S-V16-HAPPY` (`e2e/specs/smoke/viewer-boot.spec.ts`) expects `<hcm-map-viewer>` in `#historic-city-map`, a `canvas.mapboxgl-canvas` inside it, `hcm-ready` reaching `document`, exactly one `new mapboxgl.Map` and one `map.load` event | the generated page (`scripts/site/src/page.ts`) follows the brief's "loads engine same-origin ./engine/engine.mjs"; the same entry builds both formats, so this holds unless the auto-boot is guarded by format | done (both builds auto-boot; S-V16-HAPPY passes on c360 and l1440, §12) |
| CR-7 | e2e-infra | contracts (`docs/ENGINE_API.md` → config.js) | say that `globalThis.HistoricCityMapConfig = {…}` is the same as `window.…` in a classic script, and that a site build reads `config.js` without running it, so it must be one assignment of literal data (objects, arrays, strings, numbers, booleans, null) | the committed `config.js` files use `globalThis` (ESLint has no browser globals for them, DECISIONS §12b); `scripts/site/src/config-js.ts` parses them with the TypeScript parser (`sonarjs/code-eval` refuses `vm`) | done (`docs/ENGINE_API.md` → *The three files of a city*) |
| CR-8 | engine-core | engine-ui (`packages/engine/src/mount.ts`, `packages/ui/src/viewer/**`); contracts (this file §4, §6) | Additive engine-core API beyond §4/§6, all implemented and tested: `ViewerDeps` (`packages/engine/src/core/deps.ts`) gains **required** `engineVersion` (pass `ENGINE_VERSION`) and `mapContainer: () => HTMLElement \| null` (the element `load()` mounts the map into), optional `reducedMotion: () => boolean`, and on `location` optional `href` (page address: relative pmtiles URLs resolve against the manifest), `search` (`?lang=`) and `subscribe(listener)` (`hashchange`; the store then applies the hash itself); `TelemetryPort.setContext?(TelemetryContext)` (the store passes city id, locale, window class, `measurementId`, `errorEndpoint`); `createMapboxPort(gl, env?)` takes the structural `MapboxGl` of `packages/engine/src/map/mapbox-types.ts` (the real global satisfies it; no `mapbox-gl` import anywhere) and an optional `AdapterEnv` (default: `browserAdapterEnv(window)`); `nativeMap(port)` and `openCompare(main, options, deps)` (`packages/engine/src/map/compare.ts`, mapbox-gl-compare 0.6.0 loaded on demand, second map destroyed by `close()`); `createTelemetry(deps)` (`packages/engine/src/telemetry/telemetry.ts`); `readConfig`, `configFromAttributes`, `loadManifest` (`packages/engine/src/config/load.ts`); `hashLimits(manifest)` (`packages/engine/src/core/url-sync.ts`). `ViewerStore.destroy()` also destroys the map port and telemetry it was given. The adapter observes its container with a ResizeObserver itself (calling `resize()` too is harmless). View cones show from zoom 17 as §4 says (the engine-core brief said 16). Engine-ui's store port in `packages/ui/src/viewer/**` should be satisfied by `ViewerStore` structurally (`packages/ui` cannot import the engine) | the contract's `load()` must mount the map but `ViewerDeps` had no container and no engine version; the rest makes the store, telemetry and adapter testable in node without DOM globals | accepted and done (§12: the additions are the contract now) |
| CR-9 | engine-core | contracts (`packages/shared/src/schemas/manifest.ts` `analyticsSchema`, `docs/ENGINE_API.md`) | add optional `city.analytics.firebase: {apiKey, appId, projectId}` (strict; `apiKey` `^AIza[0-9A-Za-z_-]{35}$`, `appId` `^1:\d+:web:[0-9a-f]+$`, `projectId` an id), written by the M2 manifest builder from the Firebase Management API (`webApps/{id}/config`), never committed (gitleaks flags `AIza` keys; the seed manifest has no analytics ids). Engine-core then passes it in `TelemetryContext.firebase` (the store's `#telemetryContext` in `packages/engine/src/core/boot.ts`, one line) | `firebase/analytics` refuses to start without `appId` and `apiKey` (`no-app-id`, `no-api-key`) and Installations needs `projectId`; with only a `measurementId` the engine logs `analytics off: the manifest has no Firebase app ids` and sends nothing, so **S-V19-HAPPY cannot pass until this lands** | done (§12: `firebaseAppIdsSchema`, `city.analytics.firebase`, passed in `TelemetryContext.firebase`) |
| CR-10 | engine-core | integrator (`packages/engine/vite.config.ts`, ask-first tool config) | keep the Firebase SDK out of `engine.iife.js` (`DECISIONS-for-review.md` §13a) | Vite inlines dynamic imports in IIFE builds (no code splitting), so the IIFE carries the 24 KB gzip SDK (fetched, not run, before consent); `engine.mjs` already loads it as a separate chunk (`firebase-sdk-<hash>.js`), and CR-6 makes the city pages load `engine.mjs`. The site build must copy every file of `packages/engine/dist/`, not only `engine.mjs` and `engine.css` | open (ask-first proposal, `DECISIONS-for-review.md` §13a; the city pages load `engine.mjs`, which keeps the SDK in its lazy chunk) |
| CR-11 | engine-core | e2e-infra (`e2e/scenarios.json`) | register planned rows: `S-V03-HAPPY-3D-OFF` (a visible historical layer turns the Standard style's 3D buildings off, hiding it turns them back on) / `S-V03-BAD-STYLE-WITHOUT-CONFIG` (a style without the `basemap` import is never reconfigured, no console error); `S-V25-HAPPY` (a layer's stored `adjustments` are applied on load: pixel probe brighter/greyer than the raw tile) / `S-V25-BAD-OUT-OF-RANGE` (a crossed brightness min/max from the admin preview is clamped, the image is never inverted); `S-V14-HAPPY-MAP-KEYBOARD` (Enter on the focused map opens the photo under the centre) / `S-V14-BAD-NOTHING-UNDER-CENTRE` (Enter with nothing there does nothing and keeps focus); `S-V20-BAD-TOKEN-REDACTED` (a crash whose message holds a tile URL with `access_token` reaches the mock endpoint without it) | behaviours engine-core added (unit-tested in `packages/engine/test/map/*.test.ts`, `packages/engine/test/telemetry/errors.test.ts`) that no row covers yet; engine-core does not own the registry | done (planned rows in `e2e/scenarios.json`; image adjustments are the new behaviour V25) |
| CR-12 | ui-kit | this file, §5.1 and §5.2 (contracts) | Additive kit API, all implemented and tested in `packages/ui` (`packages/ui/README.md`): `hcm-icon-button` `variant` (`standard`, `filled`, `tonal`, `outlined`: map controls need a container); `disabled` on `hcm-switch`, `hcm-slider`, `hcm-chip`; `hcm-sheet` `modal` (scrim, Tab trap, `role="dialog"`; otherwise a labelled region), `detent` (`peek`, `half`, `full`), `handleLabel` and the event `hcm-detent-change` (`{detent}`); `hcm-dialog` `fullscreen`, the method `close(returnValue)` and the return values `cancel` (Esc), `close`, `scrim`; `hcm-snackbar` `hcm-dismiss` detail `{reason}` (`timeout`, `close`, `action`); `hcm-overlay-list` `shownText` / `hiddenText` (`layers.shown`, `layers.hidden`, announced like `changedText`); new kit tags `hcm-fab-menu`, `hcm-toolbar` (floating, roving focus), `hcm-loading-indicator`, and `hcm-consent-banner` (moves from §5.2 to §5.1: texts and `hcm-consent` `{decision}` only; engine-ui wires it). §5.1 theme: `applyTheme` also writes the system tokens (shape, type, motion, elevation, state) and follows `prefers-contrast: more` in every mode, not only `system`; `clearTheme`; `BASELINE_THEME`; `themeFromSeed(seed, variant = 'tonalSpot')` with `expressive` and `vibrant`. Layout: `WindowClass` keeps `'extra-large'` (the ui-kit brief said `extraLarge`; the done contract wins); new `HeightClass` (`compact` < 480, `medium` < 900, `expanded`), `WindowClassController`, `atLeast`, `onlyWindowClass`. `@m3e/web` and `@material/web` are not used at run time (reasons in `packages/ui/README.md` → *Decisions*) | the brief's M3 Expressive inventory and the a11y rules needed them; nothing in the existing contract changed meaning | accepted and done (§12) |
| CR-13 | ui-kit | `packages/shared/src/i18n/{ro,en}.ts` (contracts) | add `sheet.resize`: ro `Redimensionează panoul`, en `Resize the panel` (the accessible name of `hcm-sheet`'s drag handle, `handleLabel`) | the handle is a focusable button and needs a localized name; no existing key fits | done (`sheet.resize`; the viewer passes it as `handleLabel`) |
| CR-14 | ui-kit | `scripts/ci/pipeline.py` and the gate docs (integrator) | a `fonts` static gate after `i18n`: `Gate("fonts", (*NPM_RUN, "fonts:check", "--workspace", "@hcm/ui"))`; it rebuilds the fonts in memory (byte-identical) and shapes every name of `ICONS` against the committed subset | an icon added to the code but not to the subset would render as nothing; the browser test `packages/ui/test/fonts/font-faces.test.ts` already checks it in the `tests` stage | done (gate `fonts` after `i18n` in the static stage) |
| CR-15 | ui-kit | `packages/engine/vite.config.ts`, `packages/admin` build, `packages/engine/src/mount.ts` (engine-ui), the site CSP (e2e-infra) | copy `packages/ui/fonts/*.woff2` and `packages/ui/fonts/LICENSES.md` into `dist/fonts/`; call `installFonts(document, new URL('fonts/', engineBase).href)` once per document at mount (the kit's only global side effect) and `defineUiKit()` from `defineElements()`; theme the viewer host with `applyTheme(host, BASELINE_THEME, …)` until the manifest's theme arrives; the page CSP's `font-src` must allow the engine's origin (`'self'` only works when the engine is served from the site) | the fonts are self-hosted next to the engine script; `@font-face` in a shadow root is ignored | done (§12: `fonts:copy` in the engine build instead of `vite.config.ts`; `installFonts` at mount; `font-src 'self'` suffices while the engine is served from the site) |
| CR-16 | ui-kit | `.agent/skills/web/ui_m3_adaptive_skill.md`, `.agent/skills/quality/testing_strategy_skill.md`, `docs/research/M0-handoff.md` §2, `docs/TESTING.md`, `docs/LESSONS.md`, `README.md` (integrator) | sync from `packages/ui/README.md`: the element list, fonts (`fonts:build`, `fonts:check`, `installFonts`), the *Decisions*; new pins `harfbuzzjs@1.6.3`, `wawoff2@2.0.1`, `material-symbols@0.48.0`, `@fontsource-variable/roboto-flex@5.3.0` (devDependencies of `@hcm/ui`), `axe-core@4.14.0` (`@hcm/test-support`, entry `@hcm/test-support/axe`); move `@m3e/web` and `@material/web` out of "Not added yet" into a note that they were checked and not adopted (`packages/ui/README.md` → *Decisions*). Lessons: Vitest browser mode's `toHaveTextContent(string)` failed on a live region whose text also held a button label (assert `textContent` with `toContain` instead); a cold Vite cache re-optimises dependencies mid-run ("Vite unexpectedly reloaded a test", "Multiple versions of Lit loaded"), proposal in `DECISIONS-for-review.md` §14 | the ownership map gives these files to the integrator | done (§12) |
| CR-17 | engine-ui | engine-core (`packages/engine/src/core/store.ts`) | (a) a store action that moves the camera, e.g. `flyTo(view)` (or `setView` moving a mounted map when the view differs from `map.getView()`): today `setView` only records the view (it is the `moveend` path), so "show my location" would not move the map; engine-ui wraps the store meanwhile (`viewerPort` in `packages/engine/src/mount.ts`: a `setView` from the viewer also calls `map.flyTo`) and drops the wrapper once the action exists. (b) a way to log the `share` event of §6 (`TelemetryEvent`), e.g. `share()` on the store: the viewer shares through the Web Share API or the clipboard itself and has no telemetry port, so no `share` event is sent yet. (c) `ViewerStore.destroy()` calls `MapPort.destroy()` twice (FakeMap records two calls; harmless with the Mapbox port, which is idempotent) | the viewer UI drives only the store port (`packages/ui/src/viewer/store-port.ts`) | done (§12: `flyTo`, `logShare`, one `MapPort.destroy`; the `viewerPort` wrapper is gone) |
| CR-18 | engine-ui | contracts (`packages/shared`) | (a) i18n keys `timeline.play` / `timeline.pause` (ro `Redă cronologia` / `Oprește`, en `Play the timeline` / `Pause`): the brief's play button of the timeline is not built without an accessible name; `photo.rightsHolder` (ro and en `© {holder}`): the photo sheet shows the licence only, not the rights holder. (b) move `PHOTO_YEAR_WINDOW` and `photosNearYear(photos, year, window)` into `@hcm/shared` (next to `poiInYear`): both `packages/engine/src/core/timeline.ts` and `packages/ui/src/viewer/timeline-model.ts` define the window today (`@hcm/ui` cannot import the engine) | one definition of each user-visible text and rule | done for (b) and `photo.rightsHolder`; the play button and its two keys are rejected for M1 (not in PLAN; §12) |
| CR-19 | engine-ui | ui-kit (`packages/ui/src/icons.ts`) | add `broken_image` to `UI_ICONS` for the missing-photo placeholder of the photo sheet and the lightbox (`image` is used until then); the other viewer icons are bundled (`menu`, `close`, `layers`, `photo_library`, `my_location`, `share`, `translate`, `check`, `chevron_left`, `chevron_right`, `error`, `brightness_auto`, `light_mode`, `dark_mode`, `info`); engine-ui passes `handleLabel` to its sheets once `sheet.resize` (CR-13) lands | an unbundled icon renders as nothing | done (`broken_image` in `UI_ICONS`, subset rebuilt: 75 icons) |
| CR-20 | engine-ui | e2e-infra (`e2e/scenarios.json`) | register `S-V09-BAD-SHARE-FAILED` (clipboard refused and no Web Share API: the toast `share.failed`, nothing else changes) and `S-V04-HAPPY-PHOTOS-NEAR-YEAR` (a stop with photos within 10 years shows the "Fotografii din jurul anului …" chip, which opens the photo list of those years; "today" shows no chip); the rest of the viewer UI is covered by planned V01–V24 rows (V14 skip link, V15 FAB menu on compact and the vertical timeline on landscape phones, V11 and V12 language and theme in the FAB menu and About) | behaviours of the viewer UI without a row | done (planned rows) |
| CR-21 | engine-ui | integrator (`packages/engine/vite.config.ts`; docs and agent assets) | Build: Rolldown replaces `import.meta` with `{}` in the IIFE output (warning `EMPTY_IMPORT_META`); the engine reads its folder from `import.meta.url`, else from `document.currentScript` while it loads (`engineBaseOf` in `packages/engine/src/mount.ts`), so define `import.meta` for the IIFE or accept the warning; copy the kit fonts to `dist/fonts/` (CR-15). Docs to sync: `docs/ENGINE_API.md` (`<hcm-map-viewer>`: engine-set `mapboxCssUrl`, `engineVersion`, `bootError`, `attach(store, controller)`, `detach()`, read-only `mapContainer`; the auto-boot runs in both builds, CR-6; the language switch is in the FAB menu and in About, the theme in About; `setLang` resolves any tag), `.agent/skills/web/engine_viewer_skill.md` (the viewer elements live in `packages/ui/src/viewer/` under the ownership override; `packages/engine/src/mount.ts` is DOM-free behind `MountEnvironment`; public events come from store transitions, a slider drag announces once on release), `.agent/skills/web/ui_m3_adaptive_skill.md` (never Lit `styleMap`: its first render writes a `style` attribute the site CSP refuses; use `cssProperties` of `packages/ui/src/viewer/css-properties.ts`; the viewer sets `--hcm-sheet-z-index`), `.agent/skills/quality/testing_strategy_skill.md` (kit doubles in `packages/ui/test/viewer/doubles.ts`, the real-kit test `packages/ui/test/viewer/kit-integration.test.ts`, test photos served from `seed/bucharest/derived/` by the Vitest server so no test reaches the network). `docs/LESSONS.md`: styleMap against the CSP (above); the open FAB menu lay under the consent banner (z-order, found by the real-kit test); the kit's modal sheet (z-index 2) lay under the floating timeline (found by screenshots); Vitest browser `toHaveTextContent` with a RegExp never matched in the iframe (assert strings) | the ownership map gives these files to the integrator | done (§12; the IIFE keeps Rolldown's `EMPTY_IMPORT_META` warning: `engineBaseOf` falls back to the running script, `DECISIONS-for-review.md` §15b) |
| CR-22 | engine-ui (2026-10-17, layout and accessibility fixes) | engine-core (`packages/engine/src/map/map-port.ts`, `mapbox-adapter.ts`, `lifecycle.ts`, `core/map-sync.ts`; `@hcm/test-support` `FakeMap`) | `MapPort.setLocale(locale)`: the store's language switch reaches the map; the adapter rewrites Mapbox's own UI strings in the map's container (the canvas's `aria-label`, the logo link's, the attribution toggle's and its icon's `title`, `relabelMapbox`) and calls `setLanguage` for the basemap's labels; `MapSync.update` calls it when the locale changes. §4 above stays as recorded; the code is the contract | the tour's i18n check (`docs/research/layout-a11y-findings.md`): Mapbox writes these strings once, so after a switch the page kept "Map", "Mapbox homepage" and the toggle's name in the first language | done (`S-V11-BAD-MAPBOX-LABELS`) |
