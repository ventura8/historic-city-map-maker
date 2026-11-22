/**
 * The photos overlay on the Mapbox map (`PHOTOS_OVERLAY_ID`): clustered camera markers rotated by the photo's bearing,
 * and view cones (fill and outline) from zoom 17. Points and cones come in one collection (`setPhotosData`) and are
 * split into two GeoJSON sources, because only the points are clustered. The cones are emissive, as the markers are by
 * default, so Mapbox Standard's night does not dim them (docs/research/viewer-input.md §4). An aerial photo's viewed
 * area (the owner, 2026-11-22) shares the cones' source and is drawn, translucent and outlined, only while the photo is
 * selected or hovered (its `focus` property), at every zoom.
 */
import type { MapSlot, PhotoAreaFeature, PhotoConeFeature, PhotoFeatureCollection, PhotoPointFeature } from './map-port.js';
import { PHOTO_AERIAL_ICON, PHOTO_CAMERA_ICON, PHOTO_CLUSTER_ICON, PHOTO_DIRECTION_ICON } from './icons.js';
import { layerOpacityPaint, visibilityValue, type MapLayerEntry, type OverlayEntry } from './overlay-registry.js';

export const PHOTO_POINTS_SOURCE = 'hcm-photos-points';
export const PHOTO_CONES_SOURCE = 'hcm-photos-cones';
export const PHOTO_CONE_FILL_LAYER = 'hcm-photos-cone-fill';
export const PHOTO_CONE_LINE_LAYER = 'hcm-photos-cone-line';
export const PHOTO_AREA_FILL_LAYER = 'hcm-photos-area-fill';
const PHOTO_AREA_LINE_LAYER = 'hcm-photos-area-line';
export const PHOTO_CLUSTER_LAYER = 'hcm-photos-cluster';
export const PHOTO_MARKER_LAYER = 'hcm-photos-marker';

/** View cones appear from this zoom (docs/research/M1-interfaces.md §4). */
export const CONE_MIN_ZOOM = 17;

/** Points are clustered up to this zoom; from the next one every marker stands alone. */
const CLUSTER_MAX_ZOOM = 15;

const CONE_COLOR = '#ffb74d';
const AREA_COLOR = '#4fc3f7';

const CONE_FILL: MapLayerEntry = { id: PHOTO_CONE_FILL_LAYER, type: 'fill', base: { 'fill-opacity': 0.25 } };
const CONE_LINE: MapLayerEntry = { id: PHOTO_CONE_LINE_LAYER, type: 'line', base: { 'line-opacity': 0.8 } };
const AREA_FILL: MapLayerEntry = { id: PHOTO_AREA_FILL_LAYER, type: 'fill', base: { 'fill-opacity': 0.2 } };
const AREA_LINE: MapLayerEntry = { id: PHOTO_AREA_LINE_LAYER, type: 'line', base: { 'line-opacity': 0.9 } };
const CLUSTERS: MapLayerEntry = { id: PHOTO_CLUSTER_LAYER, type: 'symbol', base: {} };
const MARKERS: MapLayerEntry = { id: PHOTO_MARKER_LAYER, type: 'symbol', base: {} };

/** The map layers of the photos overlay, bottom first, with their designed opacity. */
export const PHOTO_MAP_LAYERS: readonly MapLayerEntry[] = [AREA_FILL, AREA_LINE, CONE_FILL, CONE_LINE, CLUSTERS, MARKERS];

const EMPTY = { type: 'FeatureCollection', features: [] } as const;

type PhotoFeature = PhotoPointFeature | PhotoConeFeature | PhotoAreaFeature;

function isPoint(feature: PhotoFeature): feature is PhotoPointFeature {
    return feature.geometry.type === 'Point';
}

/** A point without a null bearing or year: Mapbox expressions test `has`, and a null would still count as present. */
function pointForMap(feature: PhotoPointFeature): Readonly<Record<string, unknown>> {
    const { id, title, year, bearing, aerial } = feature.properties;
    const properties = {
        id,
        title,
        ...(year === null ? {} : { year }),
        ...(bearing === null ? {} : { bearing }),
        ...(aerial === true ? { aerial } : {}),
    };
    return { type: 'Feature', geometry: feature.geometry, properties };
}

/** A cone as it is, an area marked `focus` too while its photo is the hovered one. */
function shapeForMap(feature: PhotoConeFeature | PhotoAreaFeature, hovered: string | null): PhotoConeFeature | PhotoAreaFeature {
    const hover = 'area' in feature.properties && feature.properties.id === hovered;
    return hover ? { ...feature, properties: { ...feature.properties, focus: true } } : feature;
}

/** The two GeoJSON collections: clustered points, and unclustered cones and areas (the `hovered` photo's area shown). */
export function splitPhotoData(
    data: PhotoFeatureCollection,
    hovered: string | null = null,
): { readonly points: unknown; readonly cones: unknown } {
    const points = data.features.filter(isPoint).map(pointForMap);
    const cones = data.features
        .filter((feature): feature is PhotoConeFeature | PhotoAreaFeature => !isPoint(feature))
        .map((feature) => shapeForMap(feature, hovered));
    return { points: { type: 'FeatureCollection', features: points }, cones: { type: 'FeatureCollection', features: cones } };
}

export function photoSources(): readonly (readonly [string, Readonly<Record<string, unknown>>])[] {
    return [
        [PHOTO_CONES_SOURCE, { type: 'geojson', data: EMPTY }],
        [PHOTO_POINTS_SOURCE, { type: 'geojson', data: EMPTY, cluster: true, clusterMaxZoom: CLUSTER_MAX_ZOOM, clusterRadius: 40 }],
    ];
}

/** An aerial photo's viewed area: fill and dashed outline, only the focused (selected or hovered) one, at every zoom. */
function areaLayers(slot: MapSlot, visibility: 'visible' | 'none', opacity: number): readonly Readonly<Record<string, unknown>>[] {
    const area = { source: PHOTO_CONES_SOURCE, slot, filter: ['has', 'focus'], layout: { visibility } };
    return [
        {
            ...area,
            id: AREA_FILL.id,
            type: 'fill',
            paint: { 'fill-color': AREA_COLOR, 'fill-emissive-strength': 1, ...layerOpacityPaint('photos', AREA_FILL, opacity) },
        },
        {
            ...area,
            id: AREA_LINE.id,
            type: 'line',
            paint: {
                'line-color': AREA_COLOR,
                'line-width': 2,
                'line-dasharray': [2, 1],
                'line-emissive-strength': 1,
                ...layerOpacityPaint('photos', AREA_LINE, opacity),
            },
        },
    ];
}

/** The six Mapbox layers, bottom first, at the overlay's visibility and opacity. */
export function photoLayers(slot: MapSlot, visible: boolean, opacity: number): readonly Readonly<Record<string, unknown>>[] {
    const visibility = visibilityValue(visible);
    const cone = { source: PHOTO_CONES_SOURCE, slot, minzoom: CONE_MIN_ZOOM, filter: ['!', ['has', 'area']], layout: { visibility } };
    const points = { source: PHOTO_POINTS_SOURCE, slot };
    return [
        ...areaLayers(slot, visibility, opacity),
        {
            ...cone,
            id: CONE_FILL.id,
            type: 'fill',
            paint: { 'fill-color': CONE_COLOR, 'fill-emissive-strength': 1, ...layerOpacityPaint('photos', CONE_FILL, opacity) },
        },
        {
            ...cone,
            id: CONE_LINE.id,
            type: 'line',
            paint: {
                'line-color': CONE_COLOR,
                'line-width': 1.5,
                'line-emissive-strength': 1,
                ...layerOpacityPaint('photos', CONE_LINE, opacity),
            },
        },
        {
            ...points,
            id: CLUSTERS.id,
            type: 'symbol',
            filter: ['has', 'point_count'],
            layout: {
                visibility,
                'icon-image': PHOTO_CLUSTER_ICON,
                'icon-allow-overlap': true,
                'text-field': ['get', 'point_count_abbreviated'],
                'text-size': 13,
                'text-allow-overlap': true,
            },
            paint: { 'text-color': '#ffffff', ...layerOpacityPaint('photos', CLUSTERS, opacity) },
        },
        {
            ...points,
            id: MARKERS.id,
            type: 'symbol',
            filter: ['!', ['has', 'point_count']],
            layout: {
                visibility,
                'icon-image': ['case', ['has', 'aerial'], PHOTO_AERIAL_ICON, ['has', 'bearing'], PHOTO_DIRECTION_ICON, PHOTO_CAMERA_ICON],
                'icon-rotate': ['coalesce', ['get', 'bearing'], 0],
                'icon-rotation-alignment': 'map',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
            },
            paint: layerOpacityPaint('photos', MARKERS, opacity),
        },
    ];
}

export function photoEntry(visible: boolean, opacity: number): OverlayEntry {
    return { kind: 'photos', layers: PHOTO_MAP_LAYERS, sources: [PHOTO_CONES_SOURCE, PHOTO_POINTS_SOURCE], visible, opacity };
}
