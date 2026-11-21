/**
 * Selecting photos and POIs on the map, with the pointer and with the keyboard. Markers are drawn by WebGL, not DOM
 * elements, so keyboard users select what sits under the centre of the map: the map canvas is focusable (Mapbox gives
 * it `tabindex="0"`), the arrow keys pan it, and Enter or Space opens the photo or POI nearest the centre (scenario
 * V14). The photo list stays the full keyboard path to every photo.
 */
import type { LngLat } from '@hcm/shared';

import type { MapboxEvent, MapboxFeature, MapboxMap, MapPoint } from './mapbox-types.js';
import { PHOTO_CLUSTER_LAYER, PHOTO_CONE_FILL_LAYER, PHOTO_CONE_LINE_LAYER, PHOTO_MARKER_LAYER } from './photos.js';
import { isPoiLayer } from './pois.js';

export type Selection =
    | { readonly kind: 'photo'; readonly id: string }
    | { readonly kind: 'poi'; readonly id: string }
    | { readonly kind: 'cluster'; readonly clusterId: number; readonly center: readonly [number, number] | null };

/** Half the side of the box, in CSS pixels, searched around the map centre on Enter or Space. */
export const KEYBOARD_PICK_RADIUS = 24;

const PHOTO_LAYERS = new Set([PHOTO_MARKER_LAYER, PHOTO_CONE_FILL_LAYER, PHOTO_CONE_LINE_LAYER]);

function stringProperty(feature: MapboxFeature, key: string): string | null {
    const value = feature.properties?.[key];
    return typeof value === 'string' ? value : null;
}

function pointCoordinates(feature: MapboxFeature): readonly [number, number] | null {
    const coordinates = feature.geometry?.coordinates;
    return Array.isArray(coordinates) && coordinates.length === 2 ? [Number(coordinates[0]), Number(coordinates[1])] : null;
}

function clusterSelection(feature: MapboxFeature): Selection | null {
    const clusterId = feature.properties?.['cluster_id'];
    return typeof clusterId === 'number' ? { kind: 'cluster', clusterId, center: pointCoordinates(feature) } : null;
}

function idSelection(kind: 'photo' | 'poi', feature: MapboxFeature): Selection | null {
    const id = stringProperty(feature, 'id');
    return id === null ? null : { kind, id };
}

/** What a rendered feature selects, by the layer it was drawn in. */
export function selectionOf(feature: MapboxFeature): Selection | null {
    const layer = feature.layer?.id ?? '';
    if (layer === PHOTO_CLUSTER_LAYER) {
        return clusterSelection(feature);
    }
    return PHOTO_LAYERS.has(layer) ? idSelection('photo', feature) : poiSelection(layer, feature);
}

function poiSelection(layer: string, feature: MapboxFeature): Selection | null {
    return isPoiLayer(layer) ? idSelection('poi', feature) : null;
}

/** The first selectable feature, top-most first (the order `queryRenderedFeatures` returns). */
export function firstSelection(features: readonly MapboxFeature[]): Selection | null {
    for (const feature of features) {
        const selection = selectionOf(feature);
        if (selection !== null) {
            return selection;
        }
    }
    return null;
}

export interface PointerOptions {
    /** The selectable layers that exist right now (querying a missing layer is an error in Mapbox). */
    readonly layers: () => readonly string[];
    readonly select: (selection: Selection) => void;
    /** A click that selected nothing, at its position (the admin's picks and selection). */
    readonly miss?: (position: LngLat) => void;
}

function query(map: MapboxMap, geometry: MapPoint | readonly [MapPoint, MapPoint], layers: readonly string[]): readonly MapboxFeature[] {
    return layers.length === 0 ? [] : map.queryRenderedFeatures(geometry, { layers });
}

/** The pick box around the centre of the canvas. */
function centreBox(canvas: HTMLElement): readonly [MapPoint, MapPoint] {
    const x = canvas.clientWidth / 2;
    const y = canvas.clientHeight / 2;
    return [
        { x: x - KEYBOARD_PICK_RADIUS, y: y - KEYBOARD_PICK_RADIUS },
        { x: x + KEYBOARD_PICK_RADIUS, y: y + KEYBOARD_PICK_RADIUS },
    ];
}

/** Listens for clicks, hover (pointer cursor) and Enter / Space on the canvas; returns the function that stops it. */
export function attachPointer(map: MapboxMap, options: PointerOptions): () => void {
    const canvas = map.getCanvas();
    const pick = (geometry: MapPoint | readonly [MapPoint, MapPoint]): Selection | null =>
        firstSelection(query(map, geometry, options.layers()));
    const missed = ({ lngLat }: MapboxEvent): void => {
        if (lngLat !== undefined) {
            options.miss?.([lngLat.lng, lngLat.lat]);
        }
    };
    const onClick = (event: MapboxEvent): void => {
        const selection = event.point === undefined ? null : pick(event.point);
        if (selection === null) {
            missed(event);
        } else {
            options.select(selection);
        }
    };
    const onMove = (event: { readonly point?: MapPoint }): void => {
        const hit = event.point !== undefined && pick(event.point) !== null;
        canvas.style.cursor = hit ? 'pointer' : '';
    };
    const onKey = (event: KeyboardEvent): void => {
        const selection = event.key === 'Enter' || event.key === ' ' ? pick(centreBox(canvas)) : null;
        if (selection !== null) {
            event.preventDefault();
            options.select(selection);
        }
    };
    map.on('click', onClick);
    map.on('mousemove', onMove);
    canvas.addEventListener('keydown', onKey);
    return () => {
        map.off('click', onClick);
        map.off('mousemove', onMove);
        canvas.removeEventListener('keydown', onKey);
    };
}
