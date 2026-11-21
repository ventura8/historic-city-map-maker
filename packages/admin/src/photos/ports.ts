/**
 * What the photos area needs from the admin (`docs/research/M2c-interfaces.md` §2.2, §3.3, §4.3): the editors' services
 * (`ContentServices` of `../content/services.ts`: Firestore through the content store, the callables, the clock,
 * `localStorage`, the snackbar, who is signed in), the photos' own resumable uploads, and the page's map with its
 * drawing tools. The map types keep only what the photos use of the contract's `AdminMapFactory` and `MapDrawPort`
 * (pois), so the real ones satisfy them structurally; until the factory is wired the page shows the unavailable map and
 * every field still works. DOM-free: an `HTMLElement` only travels from the page to the map factory.
 */
import type { BBox, UiLocale, LngLat, MapView } from '@hcm/shared';

import type { Unsubscribe } from '../app/ports.js';
import type { ContentServices } from '../content/services.js';
import type { UploadPort } from '../firebase/uploads.js';

/** A photo's marker on the map (`PhotoPointFeature` of `@hcm/ui/map`): the title already in the admin's language. */
export interface PhotoPoint {
    readonly type: 'Feature';
    readonly geometry: { readonly type: 'Point'; readonly coordinates: LngLat };
    readonly properties: { readonly id: string; readonly title: string; readonly year: number | null; readonly bearing: number | null };
}

/** A photo's view cone (`PhotoConeFeature`). */
export interface PhotoCone {
    readonly type: 'Feature';
    readonly geometry: { readonly type: 'Polygon'; readonly coordinates: readonly (readonly LngLat[])[] };
    readonly properties: { readonly id: string };
}

/** Markers and cones in one collection (`PhotoFeatureCollection`), what `MapPort.setPhotosData` takes. */
export interface PhotoFeatures {
    readonly type: 'FeatureCollection';
    readonly features: readonly (PhotoPoint | PhotoCone)[];
}

/** One feature the drawing tools hold: ours (`photo-location`), as the manifest's geometry. */
export interface DrawnPoint {
    readonly id: string;
    readonly geometry: { readonly type: 'Point'; readonly coordinates: LngLat };
}

export interface DrawChange {
    readonly features: readonly { readonly id: string; readonly geometry: { readonly type: string; readonly coordinates: unknown } }[];
    /** False while a drag moves, true once it ends. */
    readonly final: boolean;
}

/** A position the drawing tools refused (`outside` the city's bounds plus the slack). */
export interface DrawRefusal {
    readonly kind: string;
}

/** The part of `MapDrawPort` (§4.3) the photo editor uses: the pin in `select` mode and one pick for the direction. */
export interface PhotoDrawPort {
    attach(
        map: PhotoMapPort,
        options: { readonly limits: BBox; readonly color: string; readonly maxVertices: number; readonly maxRings: number },
    ): void;
    setMode(mode: 'static' | 'select'): void;
    load(features: readonly DrawnPoint[]): void;
    /** Selects the pin (dragged with Terra Draw, moved by a click on the map with the click tools). */
    select(id: string | null): void;
    pick(): Promise<LngLat | null>;
    cancelPick(): void;
    on(event: 'change', handler: (change: DrawChange) => void): Unsubscribe;
    on(event: 'refused', handler: (refusal: DrawRefusal) => void): Unsubscribe;
    detach(): void;
}

/** The part of `MapPort` (`@hcm/ui/map`) the photos use. */
export interface PhotoMapPort {
    setPhotosData(data: PhotoFeatures): void;
    onPhotoClick(handler: (photoId: string) => void): Unsubscribe;
    flyTo(view: Partial<MapView>, options?: { readonly animate?: boolean }): void;
    getView(): MapView;
}

/** The page's map (`AdminMapHandle`, §3.3). */
export interface PhotoMapHandle {
    readonly port: PhotoMapPort;
    /** The drawing tools, loaded on first use. */
    draw(): Promise<PhotoDrawPort>;
    destroy(): void;
}

export type PhotoMapResult =
    { readonly ok: true; readonly map: PhotoMapHandle } | { readonly ok: false; readonly reason: 'no-token' | 'no-webgl' | 'failed' };

/** `AdminMapFactory` (§3.3): one map per page visit, Standard style, the admin's token. */
export interface PhotoMapFactory {
    create(
        container: HTMLElement,
        options: { readonly bounds: BBox; readonly view: MapView; readonly locale: UiLocale },
    ): Promise<PhotoMapResult>;
}

/** The members of `ContentServices` the photos use. */
type CoreServices = Pick<
    ContentServices,
    | 'cityId'
    | 'store'
    | 'callables'
    | 'clock'
    | 'local'
    | 'log'
    | 'user'
    | 'locale'
    | 'notify'
    | 'denied'
    | 'people'
    | 'readOnly'
    | 'cityRole'
>;

/** The services the photos area is created with: the editors' own, the photos' uploads, and the pois' map factory. */
export interface PhotosServices extends CoreServices {
    /** Resumable uploads to the private bucket (`../firebase/uploads.ts`). */
    readonly uploads: UploadPort;
    /** The admin map's factory (pois); absent or null until it is wired: the map is then "unavailable". */
    readonly maps?: PhotoMapFactory | null;
}
