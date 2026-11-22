/**
 * A POI category on the Mapbox map (PLAN Addendum 3): two GeoJSON sources and nine layers, bottom first: polygon fills,
 * a white casing under every line and area outline, the line and outline strokes in the category colour, point discs,
 * point icons (labelled from zoom 16), cluster discs and their counts, and the labels of lines and areas from zoom 16. The casing keeps a line legible on
 * a satellite photo, where a thin stroke in the category colour almost disappeared (the live manual test of 2026-11-01,
 * finding 36): the category colour is dark by rule (the white glyph reads on it at 3:1), so the stroke stands on the white
 * band on any basemap. Every layer's opacity scales with the overlay's (`layerOpacityPaint`): at 0 the casing goes too.
 * Points come from a second, clustered source (as the photos' markers do): up to `POI_CLUSTER_MAX_ZOOM` nearby points
 * merge into a disc in the category colour with their count, a click zooms in. Every POI of the category is drawn; titles
 * are already localized. Fills, lines and discs are emissive, as icons and
 * text are by default: on Mapbox Standard's night a city owner's colour would otherwise go dark (docs/research/viewer-input.md §4).
 */
import type { MapLayerType, OpacityBase } from '@hcm/shared';

import type { MapSlot, VectorOverlaySpec } from './map-port.js';
import { poiIconId } from './icons.js';
import { layerOpacityPaint, visibilityValue, type MapLayerEntry, type OverlayEntry } from './overlay-registry.js';
import { overlaySourceId } from './rasters.js';

/** Labels appear from this zoom (docs/ENGINE_API.md → pois). */
export const POI_LABEL_MIN_ZOOM = 16;
/** Points are clustered up to this zoom, as the photos are; from the next one every point stands alone. */
export const POI_CLUSTER_MAX_ZOOM = 15;
const POI_CLUSTER_RADIUS = 40;
const CLUSTERED = ['has', 'point_count'];
const SINGLE = ['!', CLUSTERED];

const POI_LAYER_PREFIX = 'hcm-poi-';

type Style = Readonly<Record<string, unknown>>;

interface PoiStyle {
    readonly filter: unknown;
    readonly layout: Style;
    readonly paint: Style;
}

interface PoiLayerKind {
    readonly suffix: string;
    /** The clustered points' source instead of the shapes' one. */
    readonly points?: true;
    readonly type: MapLayerType;
    readonly base: OpacityBase;
    readonly style: (spec: VectorOverlaySpec) => PoiStyle;
}

/** A filter keeping the features of these geometry types (the POI layers, Show my location's dot). */
export function geometryIs(...types: readonly string[]): unknown {
    return ['in', ['geometry-type'], ['literal', types]];
}

/** The title from zoom 16, nothing below. */
const LABEL = ['step', ['zoom'], '', POI_LABEL_MIN_ZOOM, ['get', 'title']];

const LABEL_LAYOUT: Style = { 'text-field': LABEL, 'text-size': 13, 'text-max-width': 12, 'text-optional': true };
const LABEL_PAINT: Style = { 'text-color': '#ffffff', 'text-halo-color': '#1d1b1a', 'text-halo-width': 1.5 };

/** A width that grows with the zoom: `[zoom, width]` stops, linear between them. */
function byZoom(...stops: readonly (readonly [number, number])[]): unknown {
    return ['interpolate', ['linear'], ['zoom'], ...stops.flat()];
}

/** The stroke of lines and area outlines in the category colour (CSS px). */
export const POI_LINE_WIDTH = byZoom([12, 2], [16, 4], [20, 7]);
/** The white casing under it: two to three and a half pixels wider on each side. */
export const POI_CASING_WIDTH = byZoom([12, 6], [16, 10], [20, 14]);

const LINE_LAYOUT: Style = { 'line-cap': 'round', 'line-join': 'round' };

const POI_LAYER_KINDS: readonly PoiLayerKind[] = [
    {
        suffix: 'fill',
        type: 'fill',
        base: { 'fill-opacity': 0.35 },
        style: (spec) => ({ filter: geometryIs('Polygon'), layout: {}, paint: { 'fill-color': spec.color, 'fill-emissive-strength': 1 } }),
    },
    {
        suffix: 'casing',
        type: 'line',
        base: { 'line-opacity': 0.9 },
        style: () => ({
            filter: geometryIs('LineString', 'Polygon'),
            layout: LINE_LAYOUT,
            paint: { 'line-color': '#ffffff', 'line-width': POI_CASING_WIDTH, 'line-emissive-strength': 1 },
        }),
    },
    {
        suffix: 'line',
        type: 'line',
        base: {},
        style: (spec) => ({
            filter: geometryIs('LineString', 'Polygon'),
            layout: LINE_LAYOUT,
            paint: { 'line-color': spec.color, 'line-width': POI_LINE_WIDTH, 'line-emissive-strength': 1 },
        }),
    },
    {
        suffix: 'circle',
        type: 'circle',
        points: true,
        base: {},
        style: (spec) => ({
            filter: SINGLE,
            layout: {},
            paint: {
                'circle-color': spec.color,
                'circle-radius': 13,
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2,
                'circle-emissive-strength': 1,
            },
        }),
    },
    {
        suffix: 'symbol',
        type: 'symbol',
        points: true,
        base: {},
        style: (spec) => ({
            filter: SINGLE,
            layout: {
                ...LABEL_LAYOUT,
                'icon-image': poiIconId(spec.icon),
                'icon-allow-overlap': true,
                'text-offset': [0, 1.6],
                'text-anchor': 'top',
            },
            paint: LABEL_PAINT,
        }),
    },
    {
        suffix: 'cluster',
        type: 'circle',
        points: true,
        base: {},
        style: (spec) => ({
            filter: CLUSTERED,
            layout: {},
            paint: {
                'circle-color': spec.color,
                'circle-radius': ['step', ['get', 'point_count'], 15, 10, 18, 50, 22],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2,
                'circle-emissive-strength': 1,
            },
        }),
    },
    {
        suffix: 'cluster-count',
        type: 'symbol',
        points: true,
        base: {},
        style: () => ({
            filter: CLUSTERED,
            layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 13, 'text-allow-overlap': true },
            paint: { 'text-color': '#ffffff' },
        }),
    },
    {
        suffix: 'label-line',
        type: 'symbol',
        base: {},
        style: () => ({
            filter: geometryIs('LineString'),
            layout: { ...LABEL_LAYOUT, 'symbol-placement': 'line-center' },
            paint: LABEL_PAINT,
        }),
    },
    {
        suffix: 'label-area',
        type: 'symbol',
        base: {},
        style: () => ({ filter: geometryIs('Polygon'), layout: LABEL_LAYOUT, paint: LABEL_PAINT }),
    },
];

function layerId(id: string, kind: PoiLayerKind): string {
    return `${POI_LAYER_PREFIX}${id}-${kind.suffix}`;
}

function mapLayer(id: string, kind: PoiLayerKind): MapLayerEntry {
    return { id: layerId(id, kind), type: kind.type, base: kind.base };
}

/** True for a layer id of any POI category (click and keyboard selection). */
export function isPoiLayer(id: string): boolean {
    return id.startsWith(POI_LAYER_PREFIX);
}

/** The clustered points' source of a category. */
export function poiPointsSourceId(id: string): string {
    return `${overlaySourceId(id)}-points`;
}

const CLUSTER_SUFFIX = '-cluster';

/** The clustered source behind a POI cluster layer (a click zooms into it); null for any other layer. */
export function poiClusterSource(layerId: string): string | null {
    if (!isPoiLayer(layerId) || !layerId.endsWith(CLUSTER_SUFFIX)) {
        return null;
    }
    return poiPointsSourceId(layerId.slice(POI_LAYER_PREFIX.length, -CLUSTER_SUFFIX.length));
}

function isPoint(feature: VectorOverlaySpec['features'][number]): boolean {
    return feature.geometry.type === 'Point';
}

/** The category's lines and areas (the shapes' source). */
export function poiData(spec: VectorOverlaySpec): unknown {
    return { type: 'FeatureCollection', features: spec.features.filter((feature) => !isPoint(feature)) };
}

/** The category's points (the clustered source). */
export function poiPointData(spec: VectorOverlaySpec): unknown {
    return { type: 'FeatureCollection', features: spec.features.filter(isPoint) };
}

/** The two GeoJSON sources of a category: its shapes, and its points clustered. */
export function poiSources(spec: VectorOverlaySpec): readonly (readonly [string, Style])[] {
    return [
        [overlaySourceId(spec.id), { type: 'geojson', data: poiData(spec) }],
        [
            poiPointsSourceId(spec.id),
            {
                type: 'geojson',
                data: poiPointData(spec),
                cluster: true,
                clusterMaxZoom: POI_CLUSTER_MAX_ZOOM,
                clusterRadius: POI_CLUSTER_RADIUS,
            },
        ],
    ];
}

/** The nine Mapbox layers of a category, bottom first, at its visibility and opacity. */
export function poiLayers(spec: VectorOverlaySpec, slot: MapSlot): readonly Style[] {
    return POI_LAYER_KINDS.map((kind) => {
        const style = kind.style(spec);
        return {
            id: layerId(spec.id, kind),
            type: kind.type,
            source: kind.points === true ? poiPointsSourceId(spec.id) : overlaySourceId(spec.id),
            slot,
            filter: style.filter,
            layout: { ...style.layout, visibility: visibilityValue(spec.visible) },
            paint: { ...style.paint, ...layerOpacityPaint('poi', mapLayer(spec.id, kind), spec.opacity) },
        };
    });
}

export function poiEntry(spec: VectorOverlaySpec): OverlayEntry {
    return {
        kind: 'poi',
        layers: POI_LAYER_KINDS.map((kind) => mapLayer(spec.id, kind)),
        sources: [overlaySourceId(spec.id), poiPointsSourceId(spec.id)],
        visible: spec.visible,
        opacity: spec.opacity,
    };
}
