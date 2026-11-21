/**
 * The photos page's map (`docs/research/M2c-interfaces.md` §3, §4.4, §5.2, §6.3): one map per page visit from the
 * admin's factory (Standard style, never Satellite), every loaded photo as a marker with its view cone, the edited
 * photo drawn from its draft (place, direction and field of view live, nothing written), the pin selected in the drawing
 * tools' `select` mode (dragged, or moved by a click on the map with the click tools) and the camera's target picked with
 * one click (`pick`). Without a factory, a token or
 * WebGL the map reports why and every field of the editor still works (§1.4).
 */
import {
    bboxExpand,
    conePolygon,
    DEFAULT_FOV,
    PHOTO_LOCATION_SLACK_DEG,
    roundTo,
    type BBox,
    type LngLat,
    type UiLocale,
    type MapView,
} from '@hcm/shared';

import type { Unsubscribe } from '../app/ports.js';
import type { DrawChange, PhotoCone, PhotoDrawPort, PhotoFeatures, PhotoMapFactory, PhotoMapHandle, PhotoPoint } from './ports.js';

/** The length of a cone's sides, as the viewer draws them (the engine's `CONE_LENGTH_M`). */
const CONE_LENGTH_M = 60;

/** Our id of the edited photo's pin in the drawing tools. */
export const PIN_FEATURE_ID = 'photo-location';

/** The pin's colour on the map (the drawing tools take a hex colour). */
const PIN_COLOR = '#B3261E';

/** Coordinates are rounded to 7 decimals (about 1 cm), so a round trip through the map never shows a false change. */
export function rounded(position: LngLat): LngLat {
    return [roundTo(position[0], 7), roundTo(position[1], 7)];
}

/** A photo as the map draws it (the title already in the admin's language). */
export interface MapPhoto {
    readonly id: string;
    readonly title: string;
    readonly year: number | null;
    readonly location: { readonly lat: number; readonly lng: number };
    readonly bearing: number | null;
    readonly fov: number | null;
}

function point(photo: MapPhoto): PhotoPoint {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [photo.location.lng, photo.location.lat] },
        properties: { id: photo.id, title: photo.title, year: photo.year, bearing: photo.bearing },
    };
}

function cone(photo: MapPhoto): PhotoCone[] {
    if (photo.bearing === null) {
        return [];
    }
    const ring = conePolygon([photo.location.lng, photo.location.lat], {
        bearing: photo.bearing,
        fov: photo.fov ?? DEFAULT_FOV,
        distanceM: CONE_LENGTH_M,
    });
    return [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { id: photo.id } }];
}

/** Every photo's marker, then every cone (the viewer's `photoFeatures`, without the timeline's filter). */
export function photoFeatures(photos: readonly MapPhoto[]): PhotoFeatures {
    return { type: 'FeatureCollection', features: [...photos.map(point), ...photos.flatMap(cone)] };
}

export type MapStatus = 'none' | 'loading' | 'ready' | 'unavailable' | 'no-token' | 'no-webgl' | 'failed';

export interface PhotoMapEvents {
    readonly status: (status: MapStatus) => void;
    /** A marker or cone was clicked: open that photo. */
    readonly select: (photoId: string) => void;
    /** The pin moves (`final` once the drag ends). */
    readonly pin: (position: LngLat, final: boolean) => void;
    /** The pin was dragged outside the city: it went back, the admin is told. */
    readonly refused: () => void;
}

/** The pin's position from a change of the drawing tools, if the change carries it. */
function pinOf(change: DrawChange): LngLat | null {
    const feature = change.features.find((candidate) => candidate.id === PIN_FEATURE_ID);
    const coordinates = feature?.geometry.type === 'Point' ? feature.geometry.coordinates : null;
    return Array.isArray(coordinates) && coordinates.length >= 2 ? rounded([Number(coordinates[0]), Number(coordinates[1])]) : null;
}

export class PhotoMapSession {
    readonly #factory: PhotoMapFactory | null;
    readonly #events: PhotoMapEvents;
    #handle: PhotoMapHandle | null = null;
    #draw: PhotoDrawPort | null = null;
    #limits: BBox | null = null;
    #stops: Unsubscribe[] = [];
    #photos: readonly MapPhoto[] = [];
    #alive = true;
    /** The open photo the camera last went to (null: none since the editor closed). */
    #revealed: string | null = null;

    constructor(factory: PhotoMapFactory | null, events: PhotoMapEvents) {
        this.#factory = factory;
        this.#events = events;
    }

    /** Creates the page's map in `container` (once per page visit). */
    async attach(
        container: HTMLElement,
        options: { readonly bounds: BBox; readonly view: MapView; readonly locale: UiLocale },
    ): Promise<void> {
        if (this.#factory === null) {
            this.#events.status('unavailable');
            return;
        }
        this.#limits = bboxExpand(options.bounds, PHOTO_LOCATION_SLACK_DEG);
        this.#events.status('loading');
        const result = await this.#factory.create(container, options);
        if (!result.ok) {
            this.#events.status(result.reason);
            return;
        }
        if (!this.#alive) {
            result.map.destroy();
            return;
        }
        this.#mounted(result.map);
    }

    #mounted(handle: PhotoMapHandle): void {
        this.#handle = handle;
        this.#stops.push(
            handle.port.onPhotoClick((photoId) => {
                this.#events.select(photoId);
            }),
        );
        handle.port.setPhotosData(photoFeatures(this.#photos));
        this.#events.status('ready');
    }

    /** Draws `photos` (the edited one from its draft). */
    show(photos: readonly MapPhoto[]): void {
        this.#photos = photos;
        this.#handle?.port.setPhotosData(photoFeatures(photos));
    }

    /** Moves the camera to a photo. */
    focus(location: { readonly lat: number; readonly lng: number }): void {
        this.#handle?.port.flyTo({ center: [location.lng, location.lat] });
    }

    /**
     * Brings the open photo `id` into view once: the first time it is shown on a ready map, the camera centres on it (its
     * zoom kept, no animation). A photo of the list may lie outside the city's starting view, so its pin was off the map.
     */
    reveal(id: string, location: { readonly lat: number; readonly lng: number }): void {
        const port = this.#handle?.port;
        if (port === undefined || this.#revealed === id) {
            return;
        }
        this.#revealed = id;
        port.flyTo({ center: [location.lng, location.lat] }, { animate: false });
    }

    /** One zoom step in (+1) or out (-1), from the map box's buttons. */
    zoomBy(delta: number): void {
        const port = this.#handle?.port;
        port?.flyTo({ zoom: port.getView().zoom + delta });
    }

    /** The map's centre: the keyboard's placement point (the crosshair). */
    centre(): LngLat | null {
        return this.#handle?.port.getView().center ?? null;
    }

    /** Shows the edited photo's pin, draggable; null takes it away. */
    async editPin(location: { readonly lat: number; readonly lng: number } | null): Promise<void> {
        if (location === null) {
            this.#revealed = null;
        }
        const draw = await this.#drawing();
        if (draw === null) {
            return;
        }
        if (location === null) {
            draw.load([]);
            draw.setMode('static');
            return;
        }
        draw.load([{ id: PIN_FEATURE_ID, geometry: { type: 'Point', coordinates: [location.lng, location.lat] } }]);
        draw.setMode('select');
        // Selected: it is dragged (Terra Draw), or a click on the map puts it there (the click tools, WCAG 2.5.7).
        draw.select(PIN_FEATURE_ID);
    }

    /** The next click on the map (null when cancelled or without a map): what the camera looked at. */
    async pick(): Promise<LngLat | null> {
        const draw = await this.#drawing();
        const target = draw === null ? null : await draw.pick();
        return target === null ? null : rounded(target);
    }

    cancelPick(): void {
        this.#draw?.cancelPick();
    }

    /** The drawing tools, loaded and attached on first use. */
    async #drawing(): Promise<PhotoDrawPort | null> {
        const handle = this.#handle;
        if (this.#draw !== null || handle === null || this.#limits === null) {
            return this.#draw;
        }
        const draw = await handle.draw();
        draw.attach(handle.port, { limits: this.#limits, color: PIN_COLOR, maxVertices: 1, maxRings: 1 });
        this.#stops.push(
            draw.on('change', (change) => {
                this.#changed(change);
            }),
            draw.on('refused', () => {
                this.#events.refused();
            }),
        );
        this.#draw = draw;
        return draw;
    }

    #changed(change: DrawChange): void {
        const position = pinOf(change);
        if (position !== null) {
            this.#events.pin(position, change.final);
        }
    }

    /** The route left the page: the map is destroyed (every map load is billed, §3.5). */
    detach(): void {
        this.#alive = false;
        for (const stop of this.#stops.splice(0)) {
            stop();
        }
        this.#draw?.detach();
        this.#handle?.destroy();
        this.#draw = null;
        this.#handle = null;
        this.#events.status('none');
    }
}
