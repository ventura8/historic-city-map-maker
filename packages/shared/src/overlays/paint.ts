/**
 * Which Mapbox GL paint properties draw an overlay at a given opacity, and the raster image adjustments as paint
 * values (PLAN Addendum 3). Pure data for the engine's Mapbox adapter (`setOverlayOpacity`, `setLayerPaint`) and the
 * admin's live preview; neither ever builds a paint property name itself.
 *
 * An overlay is drawn by one or more map layers (a raster layer; the photos' markers and cones; a POI category's
 * icons, labels, lines and fills). Each map layer type has its own opacity properties, and each property is scaled by
 * the map layer's designed opacity (`base`): a view cone drawn at 25 % stays at 25 % of the overlay's opacity.
 */
import { clamp } from '../geo/math.js';
import { LAYER_ADJUSTMENT_RANGES, type LayerAdjustmentName, type LayerAdjustments } from '../schemas/manifest.js';
import type { OverlayKind } from './model.js';

export const MAP_LAYER_TYPES = ['raster', 'symbol', 'circle', 'line', 'fill'] as const;

export type MapLayerType = (typeof MAP_LAYER_TYPES)[number];

export type OpacityProperty =
    'raster-opacity' | 'icon-opacity' | 'text-opacity' | 'circle-opacity' | 'circle-stroke-opacity' | 'line-opacity' | 'fill-opacity';

/** The opacity paint properties of each Mapbox layer type. */
export const OPACITY_PROPERTIES: Readonly<Record<MapLayerType, readonly OpacityProperty[]>> = {
    raster: ['raster-opacity'],
    symbol: ['icon-opacity', 'text-opacity'],
    circle: ['circle-opacity', 'circle-stroke-opacity'],
    line: ['line-opacity'],
    fill: ['fill-opacity'],
};

/**
 * The map layer types each overlay kind draws with: a raster; the photos as symbols (camera icons and cluster
 * counts) plus the view cones' fill and outline; a POI category as symbols (icons and labels), circles (points
 * without an icon at low zoom), lines (LineStrings and polygon outlines) and fills (polygons).
 */
export const OVERLAY_LAYER_TYPES: Readonly<Record<OverlayKind, readonly MapLayerType[]>> = {
    raster: ['raster'],
    photos: ['symbol', 'fill', 'line'],
    poi: ['symbol', 'circle', 'line', 'fill'],
};

export interface PaintUpdate {
    /** Apply to every map layer of this type that belongs to the overlay. */
    readonly layerType: MapLayerType;
    readonly property: OpacityProperty;
    /** 0 to 1: the overlay's opacity times the property's base. */
    readonly value: number;
}

/** A map layer's designed opacity per property (absent: 1). */
export type OpacityBase = Readonly<Partial<Record<OpacityProperty, number>>>;

/** The paint updates that draw an overlay of `kind` at `opacity` (clamped to 0..1), one per opacity property. */
export function overlayOpacityPaint(kind: OverlayKind, opacity: number, base: OpacityBase = {}): readonly PaintUpdate[] {
    const factor = Number.isFinite(opacity) ? clamp(opacity, 0, 1) : 1;
    return OVERLAY_LAYER_TYPES[kind].flatMap((layerType) =>
        OPACITY_PROPERTIES[layerType].map((property) => ({ layerType, property, value: clamp((base[property] ?? 1) * factor, 0, 1) })),
    );
}

/** Mapbox's raster image adjustments, every one present (a removed adjustment returns to its neutral value). */
export interface RasterAdjustmentPaint {
    readonly 'raster-brightness-min': number;
    readonly 'raster-brightness-max': number;
    readonly 'raster-contrast': number;
    readonly 'raster-saturation': number;
}

function adjusted(adjustments: LayerAdjustments, name: LayerAdjustmentName): number {
    const range = LAYER_ADJUSTMENT_RANGES[name];
    const value = adjustments[name];
    return value === undefined || !Number.isFinite(value) ? range.neutral : clamp(value, range.min, range.max);
}

/**
 * The paint values of a layer's adjustments (absent: neutral), each clamped to its range, and the brightness minimum
 * lowered to the maximum when a live slider crossed them (Mapbox would otherwise invert the image).
 */
export function rasterAdjustmentPaint(adjustments: LayerAdjustments = {}): RasterAdjustmentPaint {
    const brightnessMax = adjusted(adjustments, 'brightnessMax');
    return {
        'raster-brightness-min': Math.min(adjusted(adjustments, 'brightnessMin'), brightnessMax),
        'raster-brightness-max': brightnessMax,
        'raster-contrast': adjusted(adjustments, 'contrast'),
        'raster-saturation': adjusted(adjustments, 'saturation'),
    };
}
