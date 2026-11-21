/**
 * Pictures on the admin map (`docs/research/M3-interfaces.md` §10.2, §10.4): a scene's browse image over its corners, a
 * version's preview over its output bounds, the georeferencer's reference images and its warped preview. Each is a
 * Mapbox **canvas source** of a decoded picture (`./pictures.ts`) with a raster layer in the `middle` slot, under the
 * places and labels; its opacity comes from `overlayOpacityPaint`, as every overlay's does. The admin's map reaches
 * Mapbox here through `nativeMap` (the port has no image sources), and a port that is not Mapbox's (the tests' `FakeMap`,
 * or no map yet) shows nothing. Never a Satellite source: the pictures are ours.
 */
import { overlayOpacityPaint, type LngLat } from '@hcm/shared';
import { nativeMap, type MapboxMap, type MapPort } from '@hcm/ui/map';

import type { Picture } from './files.js';

/** A picture's corners on the ground: north-west, north-east, south-east, south-west. */
export type Corners = readonly [LngLat, LngLat, LngLat, LngLat];

export interface PictureOverlay {
    /** Ours (`browse`, `preview`, `reference`, `warped`); the map's ids derive from it. */
    readonly id: string;
    readonly picture: Picture;
    readonly corners: Corners;
    readonly opacity: number;
}

/** A canvas source as Mapbox exposes it (`play` and `pause` re-upload a canvas that changed). */
interface CanvasSource {
    play?(): void;
    pause?(): void;
}

const sourceId = (id: string): string => `hcm-picture-${id}`;
const layerId = (id: string): string => `hcm-picture-layer-${id}`;

function paintOf(opacity: number): Record<string, number> {
    return Object.fromEntries(overlayOpacityPaint('raster', opacity).map((update) => [update.property, update.value]));
}

/** The four corners of a box (`[[west, south], [east, north]]`). */
export function cornersOfBox(box: readonly [LngLat, LngLat]): Corners {
    const [[west, south], [east, north]] = box;
    return [
        [west, north],
        [east, north],
        [east, south],
        [west, south],
    ];
}

export class PictureOverlays {
    readonly #port: () => MapPort | null;
    readonly #shown = new Set<string>();

    constructor(port: () => MapPort | null) {
        this.#port = port;
    }

    /** Adds the picture, or replaces the one with the same id. */
    show(overlay: PictureOverlay): void {
        const map = this.#native();
        if (map === null) {
            return;
        }
        this.#drop(map, overlay.id);
        map.addSource(sourceId(overlay.id), {
            type: 'canvas',
            canvas: overlay.picture.canvas,
            coordinates: overlay.corners,
            animate: false,
        });
        map.addLayer({
            id: layerId(overlay.id),
            type: 'raster',
            source: sourceId(overlay.id),
            slot: 'middle',
            paint: { ...paintOf(overlay.opacity), 'raster-fade-duration': 0 },
        });
        this.#shown.add(overlay.id);
    }

    setOpacity(id: string, opacity: number): void {
        const map = this.#native();
        if (map === null || !this.#shown.has(id)) {
            return;
        }
        for (const [property, value] of Object.entries(paintOf(opacity))) {
            map.setPaintProperty(layerId(id), property, value);
        }
    }

    /** The picture's canvas was drawn again: Mapbox uploads it on the next frame. */
    refresh(id: string): void {
        const map = this.#native();
        if (map === null || !this.#shown.has(id)) {
            return;
        }
        const source = map.getSource(sourceId(id)) as CanvasSource;
        source.play?.();
        source.pause?.();
        map.triggerRepaint();
    }

    remove(id: string): void {
        const map = this.#native();
        if (map !== null) {
            this.#drop(map, id);
        }
    }

    /** Every picture off the map (the page changed); a map that is gone already needs nothing. */
    clear(): void {
        for (const id of [...this.#shown]) {
            this.remove(id);
        }
        this.#shown.clear();
    }

    has(id: string): boolean {
        return this.#shown.has(id);
    }

    #native(): MapboxMap | null {
        const port = this.#port();
        return port === null ? null : nativeMap(port);
    }

    #drop(map: MapboxMap, id: string): void {
        if (!this.#shown.delete(id)) {
            return;
        }
        map.removeLayer(layerId(id));
        map.removeSource(sourceId(id));
    }
}
