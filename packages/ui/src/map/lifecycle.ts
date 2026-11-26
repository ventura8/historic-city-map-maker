/**
 * Creating a Mapbox map and waiting for its style: the constructor options (`performanceMetricsCollection: false`,
 * the attribution control on, the Standard configuration on the `basemap` import) and the reading of Mapbox `error`
 * events (a style error before `load` fails the mount; source and tile errors never do).
 */
import { translate, type ViewerLocale } from '@hcm/shared';
import { localizedCredit } from '@hcm/shared/credits';

import type { MapOptions, MapEventMap } from './map-port.js';
import type { MapboxEvent, MapboxMap, MapboxMapOptions } from './mapbox-types.js';
import { layerIdOfSource } from './rasters.js';

function rawMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return typeof error === 'string' ? error : 'unknown';
}

/** A Mapbox error message without URL queries (a tile URL carries the access token). */
function errorMessage(error: unknown): string {
    return rawMessage(error).replace(/\?\S*/g, '');
}

function errorKind(event: MapboxEvent, layerId: string | undefined, loaded: boolean): MapEventMap['error']['kind'] {
    if (event.tile !== undefined) {
        return 'tile';
    }
    if (layerId !== undefined) {
        return 'source';
    }
    return loaded ? 'unknown' : 'style';
}

/** A Mapbox `error` event as the port reports it. */
export function classifyError(event: MapboxEvent, loaded: boolean): MapEventMap['error'] {
    const layerId = layerIdOfSource(event.sourceId);
    const kind = errorKind(event, layerId, loaded);
    const message = errorMessage(event.error);
    return layerId === undefined ? { kind, message } : { kind, layerId, message };
}

/**
 * Mapbox GL's UI strings the viewer shows (the map canvas's accessible name, the attribution toggle, the logo link) in
 * the visitor's language: Mapbox's defaults are English, which the tour's i18n check found in every Romanian page.
 * Mapbox reads them when the map and its controls are created; `relabelMapbox` rewrites them after a language switch.
 */
/**
 * The basemap labels' language for a viewer language (docs/ENGINE_API.md → Language): Mapbox's code, the same except
 * Simplified Chinese's script tag. A language Mapbox's style has no names in shows each place's local name, as Romanian
 * does in Bucharest (checked on a real map: docs/MANUAL_TEST_PLAN.md).
 */
export function mapboxLanguage(locale: ViewerLocale): string {
    return locale === 'zh' ? 'zh-Hans' : locale;
}

function mapboxUiStrings(locale: ViewerLocale): Readonly<Record<MapboxUiString, string>> {
    return {
        'Map.Title': translate(locale, 'map.title'),
        'AttributionControl.ToggleAttribution': translate(locale, 'map.toggleAttribution'),
        'LogoControl.Title': translate(locale, 'map.logo'),
    };
}

type MapboxUiString = 'Map.Title' | 'AttributionControl.ToggleAttribution' | 'LogoControl.Title';

/** Where Mapbox GL 3.32 writes each UI string: the element (inside the map's container) and its attribute. */
const LABELLED: readonly { readonly selector: string; readonly attribute: string; readonly key: MapboxUiString }[] = [
    { selector: 'canvas.mapboxgl-canvas', attribute: 'aria-label', key: 'Map.Title' },
    { selector: 'a.mapboxgl-ctrl-logo', attribute: 'aria-label', key: 'LogoControl.Title' },
    { selector: '.mapboxgl-ctrl-attrib-button', attribute: 'aria-label', key: 'AttributionControl.ToggleAttribution' },
    { selector: '.mapboxgl-ctrl-attrib-button .mapboxgl-ctrl-icon', attribute: 'title', key: 'AttributionControl.ToggleAttribution' },
];

/**
 * Rewrites Mapbox's UI strings in `container` (the map's) in `locale`: Mapbox has no API to change them once its
 * controls exist, and a language switch left "Map", "Mapbox homepage" and the toggle's name in the first language.
 */
export function relabelMapbox(container: Pick<ParentNode, 'querySelectorAll'>, locale: ViewerLocale): void {
    const strings = mapboxUiStrings(locale);
    for (const { selector, attribute, key } of LABELLED) {
        for (const element of container.querySelectorAll(selector)) {
            element.setAttribute(attribute, strings[key]);
        }
    }
    for (const credits of container.querySelectorAll('.mapboxgl-ctrl-attrib-inner')) {
        localizeText(credits, locale);
    }
}

/**
 * The layers' credits in Mapbox's attribution line in `locale` (the viewer hands Mapbox each credit in the language of
 * the page's first load, `map-specs.ts` `rasterSpec`): every text node, so the links in the line stay links.
 */
function localizeText(node: Node, locale: ViewerLocale): void {
    if (node.nodeType === Node.TEXT_NODE) {
        node.nodeValue = localizedCredit(node.nodeValue ?? '', locale);
    }
    for (const child of node.childNodes) {
        localizeText(child, locale);
    }
}

export function mapboxOptions(container: HTMLElement, options: MapOptions): MapboxMapOptions {
    const config = options.config === undefined ? {} : { config: { basemap: options.config } };
    const maxBounds = options.maxBounds === undefined ? {} : { maxBounds: options.maxBounds };
    return {
        container,
        style: options.style,
        accessToken: options.accessToken,
        center: options.view.center,
        zoom: options.view.zoom,
        bearing: options.view.bearing,
        minZoom: options.minZoom,
        maxZoom: options.maxZoom,
        language: mapboxLanguage(options.locale),
        locale: mapboxUiStrings(options.locale),
        attributionControl: true,
        performanceMetricsCollection: false,
        ...maxBounds,
        ...config,
    };
}

/**
 * Resolves on `load`; rejects with `Error('style')` on a style error before it. `setAbort` receives the function that
 * rejects it early (the port was destroyed or mounted again first).
 */
export function whenLoaded(map: MapboxMap, setAbort: (abort: (error: Error) => void) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        const onLoad = (): void => {
            map.off('error', onError);
            resolve();
        };
        const onError = (event: MapboxEvent): void => {
            if (classifyError(event, false).kind === 'style') {
                map.off('load', onLoad);
                reject(new Error('style', { cause: event.error }));
            }
        };
        setAbort(reject);
        map.on('load', onLoad);
        map.on('error', onError);
    });
}

/**
 * Removes `map`, after its style has loaded when it has not yet (admin sweep 2026-11-14: Mapbox GL threw "Cannot convert undefined or
 * null to object" in `reloadModels` once, a map removed while its style was still loading, as a visitor leaving swipe compare at
 * once). A map whose style fails is removed on that error.
 */
export function removeWhenSettled(map: MapboxMap, loaded: boolean): void {
    if (loaded) {
        map.remove();
        return;
    }
    const settle = (): void => {
        map.off('load', settle);
        map.off('error', settle);
        map.remove();
    };
    map.on('load', settle);
    map.on('error', settle);
}
