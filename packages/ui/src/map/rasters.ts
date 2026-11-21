/**
 * Historical raster layers on the Mapbox map: one raster source and one raster layer per manifest layer, in the
 * Standard style's `middle` slot (above roads, below 3D buildings and labels), ordered by the manifest `order`.
 * Opacity and image adjustments come only from `overlayOpacityPaint` and `rasterAdjustmentPaint` (@hcm/shared).
 */
import { rasterAdjustmentPaint, type LayerSource } from '@hcm/shared';

import type { MapSlot, RasterLayerSpec } from './map-port.js';
import { layerOpacityPaint, visibilityValue, type MapLayerEntry, type OverlayEntry } from './overlay-registry.js';
import { pmtilesSource } from './pmtiles-source.js';

export function overlaySourceId(id: string): string {
    return `hcm-source-${id}`;
}

export function rasterLayerId(id: string): string {
    return `hcm-raster-${id}`;
}

/** The manifest layer id of an adapter source id (`hcm-source-<id>`), or undefined for any other source. */
export function layerIdOfSource(sourceId: string | undefined): string | undefined {
    return sourceId?.startsWith('hcm-source-') === true ? sourceId.slice('hcm-source-'.length) : undefined;
}

/** The tile part of a raster source for each source type Mapbox GL reads itself. */
function tiles(source: Exclude<LayerSource, { readonly type: 'pmtiles' }>): Readonly<Record<string, unknown>> {
    return source.type === 'mapbox'
        ? { url: `mapbox://${source.tilesetId}`, tileSize: 256 }
        : { tiles: [...source.tiles], tileSize: source.tileSize, scheme: 'xyz' };
}

const ATTRIBUTION_ENTITIES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

/**
 * A layer's attribution as Mapbox GL needs it to show plain text: its attribution control parses a source's
 * `attribution` as HTML (keeping `<a href>` links) and writes it with `innerHTML`. The manifest's attribution is plain
 * text (no HTML from data, security review §1.7), so `&`, `<` and `>` are escaped: markup in the data stays visible
 * text and can never become a link or an element.
 */
export function attributionText(attribution: string): string {
    return attribution.replace(/[&<>]/g, (character) => String(ATTRIBUTION_ENTITIES[character]));
}

/**
 * The raster source: tiles exist from `minzoom` to `maxzoom` inside `bounds`; Mapbox overzooms beyond `maxzoom`. M12: an archive of the
 * project's own bucket is a custom source with its own reader (`pmtiles-source.ts`).
 */
export function rasterSource(spec: RasterLayerSpec): Readonly<Record<string, unknown>> {
    const { source } = spec;
    const fields = {
        minzoom: spec.minzoom,
        maxzoom: spec.maxzoom,
        attribution: attributionText(spec.attribution),
        ...(spec.bounds === undefined ? {} : { bounds: [...spec.bounds[0], ...spec.bounds[1]] }),
    };
    return source.type === 'pmtiles'
        ? pmtilesSource(overlaySourceId(spec.id), source.url, fields)
        : { type: 'raster', ...tiles(source), ...fields };
}

function rasterMapLayer(spec: RasterLayerSpec): MapLayerEntry {
    return { id: rasterLayerId(spec.id), type: 'raster', base: {} };
}

/** M12: from this zoom the picture's own pixels stay square (`sharpFrom`, the admin's look at what it approves). */
function resampling(spec: RasterLayerSpec): Readonly<Record<string, unknown>> {
    return spec.sharpFrom === undefined ? {} : { 'raster-resampling': ['step', ['zoom'], 'linear', spec.sharpFrom, 'nearest'] };
}

/** The Mapbox layer: visibility, opacity, adjustments; no fade (a scrubbed timeline must not flicker), lit like the day. */
export function rasterLayer(spec: RasterLayerSpec, slot: MapSlot): Readonly<Record<string, unknown>> {
    return {
        id: rasterLayerId(spec.id),
        type: 'raster',
        source: overlaySourceId(spec.id),
        slot,
        layout: { visibility: visibilityValue(spec.visible) },
        paint: {
            ...layerOpacityPaint('raster', rasterMapLayer(spec), spec.opacity),
            ...rasterAdjustmentPaint(spec.adjustments),
            ...resampling(spec),
            'raster-fade-duration': 0,
            'raster-emissive-strength': 1,
        },
    };
}

export function rasterEntry(spec: RasterLayerSpec): OverlayEntry {
    return {
        kind: 'raster',
        layers: [rasterMapLayer(spec)],
        sources: [overlaySourceId(spec.id)],
        visible: spec.visible,
        opacity: spec.opacity,
    };
}

/**
 * The Mapbox layer to insert before so that a higher `order` draws on top: the raster with the lowest order above
 * `order` (ties: the one added first stays below). Undefined puts the layer on top of its slot.
 */
export function rasterBeforeId(orders: ReadonlyMap<string, number>, order: number): string | undefined {
    const above = [...orders].filter(([, other]) => other > order).sort((a, b) => a[1] - b[1]);
    const first = above[0];
    return first === undefined ? undefined : rasterLayerId(first[0]);
}
