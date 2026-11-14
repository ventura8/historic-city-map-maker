/**
 * `MapPort` on Mapbox GL JS 3.34.1, the global `mapboxgl` the page loads from api.mapbox.com (never bundled). The only
 * module that drives Mapbox (dependency-cruiser `only-the-map-adapter-imports-mapbox`); the helpers next to it build
 * the layers (`rasters.ts`, `photos.ts`, `pois.ts`), the sprite images (`icons.ts`), the overlay paint
 * (`overlay-registry.ts`), the 3D-objects switch (`basemap.ts`) and the selection (`pointer.ts`).
 *
 * Rules (docs/research/M1-interfaces.md §4): `performanceMetricsCollection: false`; the attribution control always
 * on (Mapbox collapses it on narrow maps, still reachable); 3D objects off while a historical layer is visible; one
 * map per mount, counted in `mapLoadCount` (every map is a billed map load); paint property names only from
 * `overlayOpacityPaint` and `rasterAdjustmentPaint`.
 */
import { wrapBearing, type BBox, type LngLat, type ViewerLocale, type MapView, type RasterAdjustmentPaint } from '@hcm/shared';

import { Basemap3dObjects } from './basemap.js';
import { animates, cameraMove, fitCamera, moveCamera } from './camera.js';
import { browserAdapterEnv, type AdapterEnv } from './env.js';
import { ensureIcon, PHOTO_CAMERA_ICON, PHOTO_CLUSTER_ICON, PHOTO_DIRECTION_ICON, poiIconId } from './icons.js';
import { EventListeners, Listeners } from './listeners.js';
import {
    PHOTOS_OVERLAY_ID,
    type FlyOptions,
    type MapEventMap,
    type MapOptions,
    type MapPadding,
    type MapPort,
    type MapSlot,
    type PhotoFeatureCollection,
    type RasterLayerSpec,
    type Unsubscribe,
    type VectorOverlaySpec,
} from './map-port.js';
import { guardContextRestore } from './context-restore.js';
import { classifyError, mapboxLanguage, mapboxOptions, relabelMapbox, removeWhenSettled, whenLoaded } from './lifecycle.js';
import type { MapboxEvent, MapboxGl, MapboxMap } from './mapbox-types.js';
import { OverlayRegistry } from './overlay-registry.js';
import {
    PHOTO_CONE_FILL_LAYER,
    PHOTO_CONES_SOURCE,
    PHOTO_POINTS_SOURCE,
    photoEntry,
    photoLayers,
    photoSources,
    splitPhotoData,
} from './photos.js';
import { attachPointer, type Selection } from './pointer.js';
import { poiData, poiEntry, poiLayers } from './pois.js';
import { overlaySourceId, rasterBeforeId, rasterEntry, rasterLayer, rasterLayerId, rasterSource } from './rasters.js';

/** The slot of the photo markers and cones: above the POI labels of the basemap. */
const PHOTO_SLOT: MapSlot = 'top';

const DEFAULT_VIEW: MapView = { center: [0, 0], zoom: 0, bearing: 0 };

/** A subscriber that throws is the subscriber's problem: the map goes on (the store logs its own failures). */
const ignore = (): void => undefined;

interface Session {
    readonly map: MapboxMap;
    /** The element the map was mounted into (Mapbox's controls live inside it). */
    readonly container: HTMLElement;
    readonly options: MapOptions;
    readonly registry: OverlayRegistry;
    /** The manifest `order` of every raster layer on the map. */
    readonly orders: Map<string, number>;
    /** The colour and icon each POI overlay was drawn with: the same ones only need new data. */
    readonly vectorStyles: Map<string, string>;
    /** Vector overlays whose clicks pass through to the map (`clickable: false`). */
    readonly passThrough: Set<string>;
    readonly cleanups: (() => void)[];
    basemap: Basemap3dObjects | null;
    abortLoad: (error: Error) => void;
}

class MapboxPort implements MapPort {
    /** Mapbox GL once the page has it (it may load after the engine: `createMapboxPort`); the first mount waits for it. */
    #gl: MapboxGl | null;
    readonly #glReady: Promise<MapboxGl>;
    readonly #env: AdapterEnv;
    readonly #events = new EventListeners<MapEventMap>(ignore);
    readonly #photoClicks = new Listeners<[string]>(ignore);
    readonly #poiClicks = new Listeners<[string]>(ignore);
    readonly #mapClicks = new Listeners<[LngLat]>(ignore);
    /** Kept across mounts: the compact editor sets it before its map exists. */
    #padding: MapPadding | null = null;
    #session: Session | null = null;
    #loaded = false;
    #loads = 0;
    #lastView: MapView = DEFAULT_VIEW;

    constructor(gl: MapboxGl | null, glReady: Promise<MapboxGl>, env: AdapterEnv) {
        this.#gl = gl;
        this.#glReady = glReady;
        this.#env = env;
    }

    get mapLoadCount(): number {
        return this.#loads;
    }

    isWebGLSupported(): boolean {
        const gl = this.#gl;
        return gl?.supported === undefined ? this.#env.probeWebGL() : gl.supported();
    }

    async mount(container: HTMLElement, options: MapOptions): Promise<void> {
        const gl = this.#gl ?? (await this.#glReady);
        this.#gl = gl;
        this.#close();
        let map: MapboxMap;
        try {
            map = new gl.Map(mapboxOptions(container, options));
        } catch (error) {
            throw new Error('webgl', { cause: error });
        }
        this.#loads += 1;
        this.#lastView = options.view;
        const session = this.#open(map, options, container);
        await whenLoaded(map, (abort) => {
            session.abortLoad = abort;
        });
        if (this.#session !== session) {
            throw new Error('unknown');
        }
        this.#loaded = true;
        this.#prepare(session);
    }

    /** The Mapbox map of the current mount (the drawing tools, the admin's image sources); null without one. */
    get native(): MapboxMap | null {
        return this.#session?.map ?? null;
    }

    #open(map: MapboxMap, options: MapOptions, container: HTMLElement): Session {
        const registry = new OverlayRegistry(map, this.#env.frames);
        const session: Session = {
            map,
            container,
            options,
            registry,
            orders: new Map(),
            vectorStyles: new Map(),
            passThrough: new Set(),
            cleanups: [],
            basemap: null,
            abortLoad: ignore,
        };
        this.#session = session;
        if (this.#padding !== null) {
            map.setPadding(this.#padding);
        }
        this.#forward(session, 'move', () => {
            this.#events.emit('move', this.getView());
        });
        this.#forward(session, 'moveend', () => {
            this.#events.emit('moveend', this.getView());
        });
        this.#forward(session, 'error', (event) => {
            this.#events.emit('error', classifyError(event, this.#loaded));
        });
        this.#forward(session, 'webglcontextlost', () => {
            this.#events.emit('webglcontextlost', undefined);
        });
        this.#forward(session, 'webglcontextrestored', () => {
            this.#events.emit('webglcontextrestored', undefined);
        });
        session.cleanups.push(guardContextRestore(map));
        this.#forward(session, 'idle', () => {
            this.#events.emit('idle', undefined);
        });
        // At once, in the observer's callback (after layout, before paint, at most once a frame): resized a frame later,
        // the canvas kept its old width while a pane opened, which the tour caught at 2560 and 3840 px.
        session.cleanups.push(
            this.#env.observeResize(container, () => {
                session.map.resize();
            }),
        );
        return session;
    }

    #forward(session: Session, type: string, listener: (event: MapboxEvent) => void): void {
        session.map.on(type, listener);
        session.cleanups.push(() => session.map.off(type, listener));
    }

    /** After `load`: sprite images, the photo sources and layers, the 3D switch, selection. */
    #prepare(session: Session): void {
        const { map, registry } = session;
        for (const icon of [PHOTO_CAMERA_ICON, PHOTO_DIRECTION_ICON, PHOTO_CLUSTER_ICON]) {
            this.#ensureIcon(session, icon);
        }
        for (const [id, source] of photoSources()) {
            map.addSource(id, source);
        }
        for (const layer of photoLayers(PHOTO_SLOT, true, 1)) {
            map.addLayer(layer);
        }
        registry.set(PHOTOS_OVERLAY_ID, photoEntry(true, 1));
        session.basemap = new Basemap3dObjects(map);
        const clickable = ([id, entry]: readonly [string, { readonly kind: string }]): boolean =>
            entry.kind !== 'raster' && !session.passThrough.has(id);
        const layers = (): readonly string[] =>
            registry
                .entries()
                .filter(clickable)
                .flatMap(([, entry]) => entry.layers.map((layer) => layer.id));
        const select = (selection: Selection): void => {
            this.#select(session, selection);
        };
        const miss = (position: LngLat): void => {
            this.#mapClicks.emit(position);
        };
        session.cleanups.push(attachPointer(map, { layers, select, miss }));
    }

    #ensureIcon(session: Session, id: string): void {
        ensureIcon(session.map, id, this.#env.icons, () => this.#session === session).catch(ignore);
    }

    #select(session: Session, selection: Selection): void {
        if (selection.kind === 'photo') {
            this.#photoClicks.emit(selection.id);
        } else if (selection.kind === 'poi') {
            this.#poiClicks.emit(selection.id);
        } else {
            this.#zoomIntoCluster(session, selection.clusterId, selection.center);
        }
    }

    #zoomIntoCluster(session: Session, clusterId: number, center: readonly [number, number] | null): void {
        session.map.getSource(PHOTO_POINTS_SOURCE)?.getClusterExpansionZoom?.(clusterId, (error, zoom) => {
            if (error === null || error === undefined) {
                this.flyTo(center === null ? { zoom } : { center, zoom });
            }
        });
    }

    /** The session once the style has loaded; null before (calls are ignored then). */
    #ready(): Session | null {
        return this.#loaded ? this.#session : null;
    }

    #updateBasemap(session: Session): void {
        const visible = session.registry.entries().some(([, entry]) => entry.kind === 'raster' && entry.visible);
        session.basemap?.update(visible);
    }

    addRasterLayer(spec: RasterLayerSpec, slot: MapSlot): void {
        const session = this.#ready();
        if (session === null) {
            return;
        }
        this.removeLayer(spec.id);
        session.map.addSource(overlaySourceId(spec.id), rasterSource(spec));
        session.map.addLayer(rasterLayer(spec, slot), rasterBeforeId(session.orders, spec.order));
        session.orders.set(spec.id, spec.order);
        session.registry.set(spec.id, rasterEntry(spec));
        this.#updateBasemap(session);
    }

    addVectorOverlay(spec: VectorOverlaySpec, slot: MapSlot): void {
        const session = this.#ready();
        if (session === null) {
            return;
        }
        this.#ensureIcon(session, poiIconId(spec.icon));
        if (spec.clickable === false) {
            session.passThrough.add(spec.id);
        } else {
            session.passThrough.delete(spec.id);
        }
        const style = `${spec.color} ${spec.icon} ${slot}`;
        if (session.vectorStyles.get(spec.id) === style) {
            session.map.getSource(overlaySourceId(spec.id))?.setData(poiData(spec));
            this.setOverlayVisibility(spec.id, spec.visible);
            this.setOverlayOpacity(spec.id, spec.opacity);
            return;
        }
        this.removeLayer(spec.id);
        this.#drawVectorOverlay(session, spec, slot);
        session.vectorStyles.set(spec.id, style);
    }

    #drawVectorOverlay(session: Session, spec: VectorOverlaySpec, slot: MapSlot): void {
        session.map.addSource(overlaySourceId(spec.id), { type: 'geojson', data: poiData(spec) });
        // In the photos' slot the POIs go below the photo markers and cones, which stay the topmost thing to click.
        const beforeId = slot === PHOTO_SLOT ? PHOTO_CONE_FILL_LAYER : undefined;
        for (const layer of poiLayers(spec, slot)) {
            session.map.addLayer(layer, beforeId);
        }
        session.registry.set(spec.id, poiEntry(spec));
    }

    setOverlayVisibility(overlayId: string, visible: boolean): void {
        const session = this.#ready();
        if (session?.registry.setVisibility(overlayId, visible) === true) {
            this.#updateBasemap(session);
        }
    }

    setOverlayOpacity(overlayId: string, opacity: number): void {
        this.#ready()?.registry.setOpacity(overlayId, opacity);
    }

    setLayerPaint(layerId: string, paint: RasterAdjustmentPaint): void {
        const session = this.#ready();
        if (session?.registry.get(layerId)?.kind !== 'raster') {
            return;
        }
        for (const [property, value] of Object.entries(paint)) {
            session.map.setPaintProperty(rasterLayerId(layerId), property, value);
        }
    }

    setLayerOrder(layerId: string, order: number): void {
        const session = this.#ready();
        const current = session?.orders.get(layerId);
        if (session === null || current === undefined || current === order) {
            return;
        }
        session.orders.delete(layerId);
        session.map.moveLayer(rasterLayerId(layerId), rasterBeforeId(session.orders, order));
        session.orders.set(layerId, order);
    }

    removeLayer(layerId: string): void {
        const session = this.#ready();
        if (session === null || layerId === PHOTOS_OVERLAY_ID) {
            return;
        }
        session.registry.remove(layerId);
        session.orders.delete(layerId);
        session.vectorStyles.delete(layerId);
        this.#updateBasemap(session);
    }

    setPhotosData(data: PhotoFeatureCollection): void {
        const session = this.#ready();
        if (session === null) {
            return;
        }
        const { points, cones } = splitPhotoData(data);
        session.map.getSource(PHOTO_POINTS_SOURCE)?.setData(points);
        session.map.getSource(PHOTO_CONES_SOURCE)?.setData(cones);
    }

    onPhotoClick(handler: (photoId: string) => void): Unsubscribe {
        return this.#photoClicks.add(handler);
    }

    onPoiClick(handler: (poiId: string) => void): Unsubscribe {
        return this.#poiClicks.add(handler);
    }

    onMapClick(handler: (position: LngLat) => void): Unsubscribe {
        return this.#mapClicks.add(handler);
    }

    flyTo(view: Partial<MapView>, options?: FlyOptions): void {
        const session = this.#session;
        if (session !== null) {
            moveCamera(session.map, view, cameraMove(options, session.options.reducedMotion));
        }
    }

    fitBounds(bounds: BBox, options?: { readonly padding?: number; readonly animate?: boolean }): void {
        const session = this.#session;
        if (session !== null) {
            fitCamera(session.map, bounds, options?.padding ?? 0, animates(options, session.options.reducedMotion));
        }
    }

    setPadding(padding: MapPadding): void {
        this.#padding = padding;
        this.#session?.map.setPadding(padding);
    }

    getView(): MapView {
        const map = this.#session?.map;
        if (map !== undefined) {
            const center = map.getCenter();
            this.#lastView = { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: wrapBearing(map.getBearing()) };
        }
        return this.#lastView;
    }

    on<E extends keyof MapEventMap>(event: E, handler: (payload: MapEventMap[E]) => void): Unsubscribe {
        return this.#events.on(event, handler);
    }

    setLocale(locale: ViewerLocale): void {
        const session = this.#session;
        if (session === null) {
            return;
        }
        relabelMapbox(session.container, locale);
        session.map.setLanguage(mapboxLanguage(locale));
    }

    resize(): void {
        this.#session?.map.resize();
    }

    destroy(): void {
        this.#close();
        this.#events.clear();
        this.#photoClicks.clear();
        this.#poiClicks.clear();
        this.#mapClicks.clear();
    }

    /** Removes the current map (a pending mount rejects); the port's own listeners stay. */
    #close(): void {
        const session = this.#session;
        if (session === null) {
            return;
        }
        this.getView();
        const loaded = this.#loaded;
        this.#session = null;
        this.#loaded = false;
        session.abortLoad(new Error('unknown'));
        for (const cleanup of session.cleanups) {
            cleanup();
        }
        session.registry.destroy();
        removeWhenSettled(session.map, loaded);
    }
}

/** The Mapbox map behind a port made by `createMapboxPort`; null for any other port or before `mount`. */
export function nativeMap(port: MapPort): MapboxMap | null {
    return port instanceof MapboxPort ? port.native : null;
}

/**
 * The MapPort of the viewer (and, from M4, of swipe compare's second map). `env` defaults to the page's `window`; the node
 * tests pass fakes (`@hcm/test-support`). `gl` may still be on its way (the public page loads Mapbox GL `async`, so the
 * viewer paints before it: the cold load of 2026-11-12): `mount` waits for it, and fails as it does.
 */
export function createMapboxPort(gl: MapboxGl | Promise<MapboxGl>, env?: AdapterEnv): MapPort {
    const ready = Promise.resolve(gl);
    // A Mapbox GL that never arrives fails the mount that waits for it, not the page (no unhandled rejection).
    ready.catch(() => undefined);
    return new MapboxPort(gl instanceof Promise ? null : gl, ready, env ?? browserAdapterEnv(globalThis));
}
