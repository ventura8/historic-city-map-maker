/**
 * `@hcm/ui/map`: the map both apps draw on (docs/research/M2c-interfaces.md §3.1, CR-M2c-1). `MapPort` is the only map
 * surface the viewer's store and the admin's editors see; `createMapboxPort` implements it on the page's global
 * `mapboxgl` (Mapbox GL JS 3.34.1, never bundled), and `FakeMap` (`@hcm/test-support`) for the tests. It moved here from
 * the engine because the admin may not import the engine (dependency-cruiser `engine-and-admin-independent`). No Lit:
 * the admin's DOM-free logic imports it too.
 */
export { EventListeners, Listeners } from './listeners.js';
export { PHOTOS_OVERLAY_ID } from './map-port.js';
export type {
    FlyOptions,
    MapErrorKind,
    MapEventMap,
    MapOptions,
    MapPadding,
    MapPort,
    MapSlot,
    PhotoConeFeature,
    PhotoFeatureCollection,
    PhotoPointFeature,
    PhotoPointProperties,
    PoiFeature,
    RasterLayerSpec,
    Unsubscribe,
    VectorOverlaySpec,
} from './map-port.js';
export type {
    CameraOffset,
    MapboxCameraOptions,
    MapboxEvent,
    MapboxFeature,
    MapboxGeoJsonSource,
    MapboxGl,
    MapboxListener,
    MapboxMap,
    MapboxMapOptions,
    MapImage,
    MapPoint,
} from './mapbox-types.js';
export { createMapboxPort, nativeMap } from './mapbox-adapter.js';
export { createViewerMapPort } from './viewer-map.js';
export type { ViewerMapPort } from './viewer-map.js';
export type { MyLocationFix } from './my-location.js';
export { CONE_MIN_ZOOM } from './photos.js';
export { MAPBOX_GL_CSS_URL, MAPBOX_GL_SCRIPT_URL, MAPBOX_GL_VERSION, MAPBOX_INTEGRITY_ATTRIBUTE, loadMapboxGl } from './mapbox-loader.js';
export type { MapboxLoaderScope } from './mapbox-loader.js';
export type { FrameScheduler } from './overlay-registry.js';
export { browserAdapterEnv } from './env.js';
export type { AdapterEnv, BrowserScope } from './env.js';
