import { expect, type Page } from '@playwright/test';
import sharp from 'sharp';

import type { Rgb } from '../fixtures/world.js';

/**
 * Reading the map as the user sees it (docs/research/design-review-testability.md §4.2): map assertions are pixel
 * probes on known synthetic colours, plus what the live Mapbox map reports about itself (where a coordinate is drawn,
 * which features are rendered, the basemap configuration). The map comes from the read-only instrumentation
 * (`window.__hcmE2e.maps`, support/instrumentation.ts); these helpers never move the camera or change the map: specs
 * drive the viewer through its controls, its URL and its public API only.
 */

export type LngLat = readonly [lng: number, lat: number];

/** A point in CSS pixels of the page (what `page.mouse` and screenshots use). */
export interface ScreenPoint {
    readonly x: number;
    readonly y: number;
}

/** The colour tolerance of a probe: SwiftShader blends, rounds and dithers by a few levels per channel. */
const PROBE_TOLERANCE = 6;

/** Runs in the page: resolves once the newest map has rendered a frame with nothing left to load. */
function idleInPage(): Promise<boolean> {
    interface IdleMap {
        once(type: string, listener: () => void): unknown;
        triggerRepaint(): void;
    }
    const maps = (window as unknown as { __hcmE2e?: { maps: IdleMap[] } }).__hcmE2e?.maps ?? [];
    const map = maps.at(-1);
    if (map === undefined) {
        return Promise.resolve(false);
    }
    return new Promise((resolve) => {
        map.once('idle', () => {
            resolve(true);
        });
        map.triggerRepaint();
    });
}

/**
 * Waits until the viewer's map is idle (its tiles, sprites and paint updates drawn); `timeout` beyond the default for a
 * page drawing two maps (swipe compare at 3840 px under SwiftShader on a loaded machine took longer than 15 s).
 */
export async function mapIdle(page: Page, timeout?: number): Promise<void> {
    await expect
        .poll(() => page.evaluate(idleInPage), {
            message: 'the map renders and becomes idle',
            ...(timeout === undefined ? {} : { timeout }),
        })
        .toBe(true);
}

/** Runs in the page: the page position of each coordinate on the newest map (null without a map). */
function projectInPage(points: readonly (readonly [number, number])[]): { x: number; y: number }[] | null {
    interface ProjectingMap {
        project(lngLat: readonly [number, number]): { x: number; y: number };
        getContainer(): HTMLElement;
    }
    const map = (window as unknown as { __hcmE2e?: { maps: ProjectingMap[] } }).__hcmE2e?.maps.at(-1);
    if (map === undefined) {
        return null;
    }
    const box = map.getContainer().getBoundingClientRect();
    return points.map((point) => {
        const projected = map.project(point);
        return { x: box.left + projected.x, y: box.top + projected.y };
    });
}

/** Where `lngLat` is drawn on the page. */
export async function screenPointOf(page: Page, lngLat: LngLat): Promise<ScreenPoint> {
    const [point] = (await page.evaluate(projectInPage, [lngLat])) ?? [];
    if (point === undefined) {
        throw new Error('no map on the page');
    }
    return point;
}

/** Runs in the page: the box of the newest map's container in page CSS pixels. */
function mapBoxInPage(): { x: number; y: number; width: number; height: number } | null {
    const map = (window as unknown as { __hcmE2e?: { maps: { getContainer(): HTMLElement }[] } }).__hcmE2e?.maps.at(-1);
    if (map === undefined) {
        return null;
    }
    const box = map.getContainer().getBoundingClientRect();
    return { x: box.left, y: box.top, width: box.width, height: box.height };
}

/** The page point at a fraction of the map's own box (`0.5, 0.5` is its centre). */
export async function mapFraction(page: Page, fx: number, fy: number): Promise<ScreenPoint> {
    const box = await page.evaluate(mapBoxInPage);
    if (box === null) {
        throw new Error('no map on the page');
    }
    return { x: Math.round(box.x + box.width * fx), y: Math.round(box.y + box.height * fy) };
}

function median(values: readonly number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * The colour the user sees around `point`: the per-channel median of a 7×7 CSS-pixel square, so a tile's z/x/y label
 * or an antialiased edge under one pixel does not decide the answer.
 */
export async function probeArea(page: Page, point: ScreenPoint, radius = 3): Promise<Rgb> {
    const size = radius * 2 + 1;
    const png = await page.screenshot({
        clip: { x: Math.round(point.x) - radius, y: Math.round(point.y) - radius, width: size, height: size },
        scale: 'css',
        animations: 'disabled',
        caret: 'hide',
    });
    const { data } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const channels = [0, 1, 2].map((channel) => {
        const values: number[] = [];
        for (let offset = channel; offset < data.length; offset += 3) {
            values.push(Number(data[offset]));
        }
        return median(values);
    });
    return [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0];
}

/**
 * How many CSS pixels of the square of half side `radius` around `point` show `colour` (within `tolerance` per
 * channel): the strokes of an icon glyph, which a median probe would average away.
 */
export async function pixelsOfColour(page: Page, point: ScreenPoint, colour: Rgb, radius = 6, tolerance = 40): Promise<number> {
    const size = radius * 2 + 1;
    const png = await page.screenshot({
        clip: { x: Math.round(point.x) - radius, y: Math.round(point.y) - radius, width: size, height: size },
        scale: 'css',
        animations: 'disabled',
        caret: 'hide',
    });
    const { data } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let count = 0;
    for (let offset = 0; offset + 2 < data.length; offset += 3) {
        const pixel: Rgb = [Number(data[offset]), Number(data[offset + 1]), Number(data[offset + 2])];
        count += colourDistance(pixel, colour) <= tolerance ? 1 : 0;
    }
    return count;
}

/** The largest per-channel difference between two colours. */
export function colourDistance(actual: Rgb, expected: Rgb): number {
    return Math.max(...actual.map((channel, index) => Math.abs(channel - Number(expected[index]))));
}

/** `top` blended over `bottom` at `alpha` (0..1), as the GPU composites a translucent layer. */
export function blend(top: Rgb, bottom: Rgb, alpha: number): Rgb {
    const mix = (index: number): number => Math.round(Number(top[index]) * alpha + Number(bottom[index]) * (1 - alpha));
    return [mix(0), mix(1), mix(2)];
}

export interface ProbeOptions {
    /** Half the side of the probed square (3: 7×7 CSS px; 0: one pixel, for a thin line). */
    readonly radius?: number;
    readonly tolerance?: number;
}

/** Polls the probe at `point` until it shows `expected` (within the tolerance); the probe is the polled value. */
export async function expectColourAt(
    page: Page,
    point: ScreenPoint,
    expected: Rgb,
    message: string,
    options: ProbeOptions = {},
): Promise<void> {
    const { radius = 3, tolerance = PROBE_TOLERANCE } = options;
    await expect
        .poll(async () => colourDistance(await probeArea(page, point, radius), expected), {
            message: `${message}: expected ${expected.join(',')}`,
        })
        .toBeLessThanOrEqual(tolerance);
}

/**
 * Runs in the page: the features the newest map renders in the layers whose id starts with `prefix`, as their `id`
 * property (a cluster as `cluster`).
 */
function renderedIdsInPage(prefix: string): string[] | null {
    interface QueryMap {
        getStyle(): { layers: { id: string }[] };
        queryRenderedFeatures(options: { layers: string[] }): { properties?: Record<string, unknown> | null }[];
    }
    const map = (window as unknown as { __hcmE2e?: { maps: QueryMap[] } }).__hcmE2e?.maps.at(-1);
    if (map === undefined) {
        return null;
    }
    const layers = map
        .getStyle()
        .layers.map((layer) => layer.id)
        .filter((id) => id.startsWith(prefix));
    const ids = map.queryRenderedFeatures({ layers }).map((feature) => {
        const properties = feature.properties ?? {};
        const id = properties['id'];
        if ('cluster_id' in properties) {
            return 'cluster';
        }
        return typeof id === 'string' ? id : '';
    });
    return [...new Set(ids)].filter((id) => id !== '').sort((a, b) => a.localeCompare(b));
}

/** The ids of the features drawn in the map layers whose id starts with `prefix` (`hcm-poi-` for every POI). */
export async function renderedFeatureIds(page: Page, prefix: string): Promise<string[]> {
    return (await page.evaluate(renderedIdsInPage, prefix)) ?? [];
}

/** Runs in the page: what the newest map says about its camera, its layers and the basemap configuration. */
function mapFactsInPage(): MapFacts | null {
    interface FactsMap {
        getZoom(): number;
        getCenter(): { lng: number; lat: number };
        getBearing(): number;
        isMoving(): boolean;
        getStyle(): { layers: { id: string; type: string }[] };
        getLayoutProperty(id: string, name: string): unknown;
        getConfigProperty?(importId: string, name: string): unknown;
    }
    const map = (window as unknown as { __hcmE2e?: { maps: FactsMap[] } }).__hcmE2e?.maps.at(-1);
    if (map === undefined) {
        return null;
    }
    const center = map.getCenter();
    const layers = map.getStyle().layers.filter((layer) => layer.id.startsWith('hcm-'));
    const visible = layers.filter((layer) => map.getLayoutProperty(layer.id, 'visibility') !== 'none').map((layer) => layer.id);
    const basemapConfig = (): unknown => {
        try {
            return map.getConfigProperty?.('basemap', 'show3dObjects') ?? null;
        } catch {
            return null;
        }
    };
    const show3dObjects = basemapConfig();
    return {
        zoom: map.getZoom(),
        center: [center.lng, center.lat],
        bearing: map.getBearing(),
        moving: map.isMoving(),
        layers: layers.map((layer) => layer.id),
        visibleLayers: visible,
        show3dObjects,
    };
}

export interface MapFacts {
    readonly zoom: number;
    readonly center: readonly [number, number];
    readonly bearing: number;
    readonly moving: boolean;
    /** The engine's map layers (`hcm-…`), bottom first. */
    readonly layers: readonly string[];
    readonly visibleLayers: readonly string[];
    /** The Standard style's `show3dObjects` on the `basemap` import (null when the style has no such import). */
    readonly show3dObjects: unknown;
}

export async function mapFacts(page: Page): Promise<MapFacts> {
    const facts = await page.evaluate(mapFactsInPage);
    if (facts === null) {
        throw new Error('no map on the page');
    }
    return facts;
}

/** Runs in the page: what Standard's two label properties read on each live map (null: the style has no such property). */
function mapLabelFlagsInPage(): { streets: unknown; pois: unknown }[] {
    interface ConfigMap {
        getConfigProperty(importId: string, name: string): unknown;
    }
    const maps = (window as unknown as { __hcmE2e?: { maps: ConfigMap[] } }).__hcmE2e?.maps ?? [];
    return maps.map((map) => ({
        streets: map.getConfigProperty('basemap', 'showRoadLabels'),
        pois: map.getConfigProperty('basemap', 'showPointOfInterestLabels'),
    }));
}

/** Each live map's basemap labels, as Mapbox GL itself reports them (V31). */
export async function mapLabelFlags(page: Page): Promise<readonly { readonly streets: unknown; readonly pois: unknown }[]> {
    return page.evaluate(mapLabelFlagsInPage);
}

/** Runs in the page: what Standard's transit stations property reads on each live map (null: the style has no such property). */
function mapTransitFlagsInPage(): unknown[] {
    interface ConfigMap {
        getConfigProperty(importId: string, name: string): unknown;
    }
    const maps = (window as unknown as { __hcmE2e?: { maps: ConfigMap[] } }).__hcmE2e?.maps ?? [];
    return maps.map((map) => map.getConfigProperty('basemap', 'showTransitLabels'));
}

/** Each live map's transit stations (tram, metro), which follow the points of interest switch, as Mapbox GL reports them (V31). */
export async function mapTransitFlags(page: Page): Promise<readonly unknown[]> {
    return page.evaluate(mapTransitFlagsInPage);
}

export interface RenderedPoint {
    /** The photo or POI id; null for a cluster. */
    readonly id: string | null;
    readonly properties: Readonly<Record<string, unknown>>;
    readonly lngLat: LngLat;
}

/** Runs in the page: the point features the newest map renders in the map layer `layerId`. */
function renderedPointsInPage(layerId: string): RenderedPoint[] | null {
    interface PointMap {
        getLayer(id: string): unknown;
        queryRenderedFeatures(options: { layers: string[] }): {
            properties?: Record<string, unknown> | null;
            geometry?: { type: string; coordinates?: unknown };
        }[];
    }
    const map = (window as unknown as { __hcmE2e?: { maps: PointMap[] } }).__hcmE2e?.maps.at(-1);
    if (map === undefined) {
        return null;
    }
    if (map.getLayer(layerId) === undefined) {
        return [];
    }
    return map
        .queryRenderedFeatures({ layers: [layerId] })
        .filter((feature) => feature.geometry?.type === 'Point')
        .map((feature) => {
            const properties = feature.properties ?? {};
            const coordinates = feature.geometry?.coordinates as [number, number];
            const id = typeof properties['id'] === 'string' ? properties['id'] : null;
            return { id, properties, lngLat: [coordinates[0], coordinates[1]] as const };
        });
}

/** The points drawn in one map layer (`hcm-photos-cluster`, `hcm-photos-marker`, `hcm-poi-<category>-symbol`). */
export async function renderedPoints(page: Page, layerId: string): Promise<RenderedPoint[]> {
    return (await page.evaluate(renderedPointsInPage, layerId)) ?? [];
}

/** Runs in the page: a layout property of one map layer and whether the map has a sprite image. */
function styleFactsInPage(query: { layerId: string; property: string; image: string }): { layout: unknown; hasImage: boolean } | null {
    interface StyleMap {
        getLayer(id: string): unknown;
        getLayoutProperty(id: string, name: string): unknown;
        hasImage(id: string): boolean;
    }
    const map = (window as unknown as { __hcmE2e?: { maps: StyleMap[] } }).__hcmE2e?.maps.at(-1);
    if (map === undefined) {
        return null;
    }
    const layout = map.getLayer(query.layerId) === undefined ? undefined : map.getLayoutProperty(query.layerId, query.property);
    return { layout: layout ?? null, hasImage: map.hasImage(query.image) };
}

/** A layout property of the map layer `layerId` (null when the layer does not exist) and whether `image` is loaded. */
export async function styleFacts(
    page: Page,
    layerId: string,
    property: string,
    image: string,
): Promise<{ layout: unknown; hasImage: boolean }> {
    const facts = await page.evaluate(styleFactsInPage, { layerId, property, image });
    if (facts === null) {
        throw new Error('no map on the page');
    }
    return facts;
}

/** What one live map draws of the visitor's position ("Show my location", V10). */
export interface MyLocationDrawn {
    /** Where the blue dot is drawn; null without one. */
    readonly dot: LngLat | null;
    /** Whether the accuracy circle (or the heading cone) is drawn. */
    readonly area: boolean;
    /** The geometry type of each feature the dot layer draws: one Point, never a dot at each vertex of the circle. */
    readonly dots: readonly string[];
    /** The area layer's type ('fill': the circle is a translucent fill, not dots). */
    readonly areaType: string | null;
}

/** Runs in the page: on each live map (a removed one throws and is skipped), the dot and the circle it draws. */
function myLocationInPage(): MyLocationDrawn[] {
    interface QueryMap {
        getLayer(id: string): { type: string } | undefined;
        queryRenderedFeatures(options: { layers: string[] }): { geometry?: { type: string; coordinates?: unknown } }[];
    }
    const drawn = (map: QueryMap): MyLocationDrawn | null => {
        try {
            if (map.getLayer('hcm-my-location-dot') === undefined) {
                return { dot: null, area: false, dots: [], areaType: null };
            }
            const dots = map.queryRenderedFeatures({ layers: ['hcm-my-location-dot'] });
            const coordinates = dots[0]?.geometry?.coordinates as [number, number] | undefined;
            const area = map.queryRenderedFeatures({ layers: ['hcm-my-location-area'] }).length > 0;
            return {
                dot: coordinates === undefined ? null : [coordinates[0], coordinates[1]],
                area,
                dots: dots.map((feature) => feature.geometry?.type ?? ''),
                areaType: map.getLayer('hcm-my-location-area')?.type ?? null,
            };
        } catch {
            return null;
        }
    };
    const maps = (window as unknown as { __hcmE2e?: { maps: QueryMap[] } }).__hcmE2e?.maps ?? [];
    return maps.map(drawn).filter((entry): entry is MyLocationDrawn => entry !== null);
}

/** The visitor's position as each live map draws it, oldest map first (the viewer's map, then compare's). */
export async function myLocationDrawn(page: Page): Promise<MyLocationDrawn[]> {
    return page.evaluate(myLocationInPage);
}

/** Waits until the viewer's map rings a photo's place (Show on map, V51) and its camera has arrived and drawn everything. */
export async function photoMarkDrawn(page: Page): Promise<void> {
    await expect.poll(async () => (await renderedPoints(page, 'hcm-photo-mark')).length, { message: 'a ring marks the place' }).toBe(1);
    await expect.poll(async () => (await mapFacts(page)).moving, { message: 'the camera has arrived' }).toBe(false);
    await mapIdle(page);
}
