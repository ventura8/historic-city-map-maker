import { BASEMAP_BACKGROUND, E2E_PLAIN_STYLE_ID, E2E_ROADS_OFF_STYLE_ID } from '../fixtures/world.js';

/**
 * The basemap every `mapbox://styles/<owner>/<id>` resolves to in e2e: a local minimal style shaped like Mapbox
 * Standard where the engine depends on it. It is a fragment with a configuration schema, so Mapbox GL imports it as
 * `basemap` exactly as it does Standard (`setConfigProperty('basemap', 'show3dObjects', false)` applies), and it
 * defines Standard's three slots (`bottom`, `middle`, `top`) for the historical rasters and the vector overlays. A
 * solid background makes every pixel the engine does not draw a known colour. Like Standard it credits Mapbox and
 * OpenStreetMap through a source its own (empty) layer uses, so the attribution control is always there (V18). The
 * style id `e2e-plain` is the same style as a plain root style, without the fragment flag and the configuration schema
 * (a city's custom style); `e2e-roads-off` the same fragment with street names off by its own default.
 */

/** Mapbox Standard's attribution, which the viewer must keep visible and reachable (scenario V18). */
const BASEMAP_ATTRIBUTION =
    '<a href="https://www.mapbox.com/about/maps/" target="_blank">© Mapbox</a> ' +
    '<a href="https://www.openstreetmap.org/about/" target="_blank">© OpenStreetMap</a>';

function rgb([red, green, blue]: readonly number[]): string {
    return `rgb(${String(red)}, ${String(green)}, ${String(blue)})`;
}

/** The Standard configuration options the engine may set (docs/ENGINE_API.md → basemap.config). */
const SCHEMA = {
    show3dObjects: { default: true, type: 'boolean' },
    showPlaceLabels: { default: true, type: 'boolean' },
    showPointOfInterestLabels: { default: true, type: 'boolean' },
    showRoadLabels: { default: true, type: 'boolean' },
    showTransitLabels: { default: true, type: 'boolean' },
    lightPreset: { default: 'day', type: 'string', values: ['dawn', 'day', 'dusk', 'night'] },
    theme: { default: 'default', type: 'string', values: ['default', 'faded', 'monochrome'] },
} as const;

export function basemapStyle(owner: string, styleId: string): Record<string, unknown> {
    const schema = styleId === E2E_ROADS_OFF_STYLE_ID ? { ...SCHEMA, showRoadLabels: { default: false, type: 'boolean' } } : SCHEMA;
    const configurable = styleId === E2E_PLAIN_STYLE_ID ? {} : { fragment: true, schema };
    return {
        version: 8,
        name: `HCM e2e basemap (${owner}/${styleId})`,
        ...configurable,
        sources: {
            'e2e-basemap': { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: BASEMAP_ATTRIBUTION },
        },
        sprite: `mapbox://sprites/${owner}/${styleId}`,
        glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
        layers: [
            { id: 'background', type: 'background', paint: { 'background-color': rgb(BASEMAP_BACKGROUND) } },
            { id: 'e2e-basemap-areas', type: 'fill', source: 'e2e-basemap', paint: { 'fill-color': '#000000' } },
            { id: 'bottom', type: 'slot' },
            { id: 'middle', type: 'slot' },
            { id: 'top', type: 'slot' },
        ],
    };
}
