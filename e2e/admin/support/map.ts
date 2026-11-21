import { coneFromPolygon, translateAdminContent, type LngLat } from '@hcm/shared';
import { expect, type Page } from '@playwright/test';

import { mapIdle, screenPointOf, type ScreenPoint } from '../../support/map.js';

/**
 * The admin's map in the e2e tier (docs/research/M2c-interfaces.md §12.3, CR-M2c-7): Mapbox GL JS 3.34.1 from the pinned
 * npm package, the mock Standard basemap and the solid-colour tiles, all answered by the mock APIs behind the firewall
 * (Satellite, or any real Mapbox host, would fail the test). The instrumentation's map-instance counter
 * (e2e/support/instrumentation.ts) counts each page visit's map, a billed map load. These helpers read the live map
 * like the viewer's (e2e/support/map.ts: where a coordinate is drawn, what a source holds) and click where a person
 * would; they never drive the map through its API.
 */

/**
 * Waits until the page's admin map exists, shows its own controls (the box shows them once the map and its drawing tools
 * are ready: a click before that draws nothing, as a busy machine showed) and is idle (its style, tiles and drawn data
 * loaded).
 */
export async function adminMapReady(page: Page): Promise<void> {
    await expect
        .poll(() => page.evaluate(() => (window as unknown as { __hcmE2e?: { maps: unknown[] } }).__hcmE2e?.maps.length ?? 0), {
            message: 'the admin map is created',
        })
        .toBe(1);
    const names = (['ro', 'en'] as const).map((lang) => translateAdminContent(lang, 'adminContent.map.zoomIn'));
    const zoomIn = page.locator('hcm-admin-map').getByRole('button', { name: new RegExp(`^(${names.join('|')})$`) });
    await expect(zoomIn.first()).toBeVisible({ timeout: 60_000 });
    await mapIdle(page);
}

/**
 * Where `lngLat` is drawn on the page, once the map box is scrolled into view (an editor's fields scroll its pane, and the
 * map with it) and the map is idle.
 */
export async function mapPointOf(page: Page, lngLat: LngLat): Promise<ScreenPoint> {
    await page.locator('hcm-admin-map').scrollIntoViewIfNeeded();
    await mapIdle(page);
    return screenPointOf(page, lngLat);
}

/** Clicks the map where `lngLat` is drawn (the drawing tools, a pick, a pin), as a person does. */
export async function clickMapAt(page: Page, lngLat: LngLat): Promise<void> {
    const point = await mapPointOf(page, lngLat);
    await page.mouse.click(point.x, point.y);
}

/**
 * Runs in the page: the features of a GeoJSON source of the newest map, as its style holds them; none while the style is
 * still loading, where Mapbox's `getStyle()` throws ("Style is not done loading"): a poll over this reads "not yet" and
 * asks again instead of failing on a page that is still opening its map (docs/LESSONS.md 183).
 */
function sourceFeaturesInPage(source: string): { properties?: Record<string, unknown>; geometry?: { coordinates?: unknown } }[] {
    interface StyleMap {
        getStyle(): { sources: Record<string, { data?: { features?: unknown[] } }> };
    }
    const map = (window as unknown as { __hcmE2e?: { maps: StyleMap[] } }).__hcmE2e?.maps.at(-1);
    const style = (() => {
        try {
            return map?.getStyle();
        } catch {
            return undefined;
        }
    })();
    const data = style?.sources[source]?.data;
    return (data?.features ?? []) as { properties?: Record<string, unknown>; geometry?: { coordinates?: unknown } }[];
}

/** The view cone the admin map draws for a photo (its bearing and field of view, in degrees), or null when it draws none. */
export async function photoCone(page: Page, photoId: string): Promise<{ readonly bearing: number; readonly fov: number } | null> {
    const cones = await page.evaluate(sourceFeaturesInPage, 'hcm-photos-cones');
    const cone = cones.find((feature) => feature.properties?.['id'] === photoId);
    const ring = (cone?.geometry?.coordinates as LngLat[][] | undefined)?.[0];
    const [apex] = ring ?? [];
    const measured = ring === undefined || apex === undefined ? null : coneFromPolygon(ring, apex);
    return measured === null ? null : { bearing: Math.round(measured.bearing), fov: Math.round(measured.fov) };
}

/** Where the admin map draws a photo's marker (`[longitude, latitude]`), or null when it draws none. */
export async function photoMarker(page: Page, photoId: string): Promise<LngLat | null> {
    const points = await page.evaluate(sourceFeaturesInPage, 'hcm-photos-points');
    const point = points.find((feature) => feature.properties?.['id'] === photoId);
    return (point?.geometry?.coordinates as LngLat | undefined) ?? null;
}

/** The ids of the features a vector overlay of the admin map holds (`hcm-import`: an import's preview). */
export async function overlayFeatureIds(page: Page, overlayId: string): Promise<string[]> {
    const features = await page.evaluate(sourceFeaturesInPage, `hcm-source-${overlayId}`);
    return features.map((feature) => String(feature.properties?.['id'])).sort((a, b) => a.localeCompare(b));
}

/** Runs in the page: a paint property of a layer of the newest map (undefined without the layer). */
function paintInPage(query: { readonly layerId: string; readonly property: string }): unknown {
    interface PaintMap {
        getLayer(id: string): unknown;
        getPaintProperty(id: string, property: string): unknown;
    }
    const map = (window as unknown as { __hcmE2e?: { maps: PaintMap[] } }).__hcmE2e?.maps.at(-1);
    return map?.getLayer(query.layerId) === undefined ? undefined : map.getPaintProperty(query.layerId, query.property);
}

/** A paint property of a historical layer on the admin map (`raster-brightness-min` of `hcm-raster-<id>`). */
export async function rasterPaint(page: Page, layerId: string, property: string): Promise<unknown> {
    return mapPaint(page, `hcm-raster-${layerId}`, property);
}

/**
 * A paint property of any style layer of the admin map, by the layer's own id (`hcm-photos-marker`'s `icon-opacity`,
 * `hcm-poi-<category>-circle`'s `circle-opacity`): what an overlay's opacity preview changes.
 */
export async function mapPaint(page: Page, layerId: string, property: string): Promise<unknown> {
    return page.evaluate(paintInPage, { layerId, property });
}

/** Runs in the page: how many of the points have paint on the georeferencer's badge canvas within 4 CSS px of them. */
function badgesInPage(points: readonly (readonly [number, number])[]): number {
    interface BadgedMap {
        project(lngLat: readonly [number, number]): { x: number; y: number };
        getContainer(): HTMLElement;
    }
    const map = (window as unknown as { __hcmE2e?: { maps: BadgedMap[] } }).__hcmE2e?.maps.at(-1);
    const container = map?.getContainer();
    const canvas =
        container?.querySelector('canvas[data-georef-badges]') ?? container?.parentElement?.querySelector('canvas[data-georef-badges]');
    const context = canvas instanceof HTMLCanvasElement ? canvas.getContext('2d') : null;
    if (map === undefined || !(canvas instanceof HTMLCanvasElement) || context === null || canvas.clientWidth === 0) {
        return 0;
    }
    const ratio = canvas.width / canvas.clientWidth;
    const painted = (point: readonly [number, number]): boolean => {
        const at = map.project(point);
        const size = Math.round(9 * ratio);
        const left = Math.round((at.x - 4) * ratio);
        const top = Math.round((at.y - 4) * ratio);
        if (left < 0 || top < 0 || left + size > canvas.width || top + size > canvas.height) {
            return false;
        }
        return context.getImageData(left, top, size, size).data.some((value, index) => index % 4 === 3 && value > 0);
    };
    return points.filter(painted).length;
}

/**
 * How many of `points` (`[longitude, latitude]`) carry a badge on the georeferencer's map: its pairs and suggestions are
 * painted on one canvas over the map (`packages/admin/src/georef/marker-overlay.ts`, DECISIONS-for-review.md §143), not
 * held by a map source, so the test reads the pixels the user sees there.
 */
export async function georefBadgesAt(page: Page, points: readonly LngLat[]): Promise<number> {
    return page.evaluate(badgesInPage, points);
}
