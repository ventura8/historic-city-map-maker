import type { Locale } from '@hcm/shared';
import { expect, type Locator, type Page } from '@playwright/test';

import { readInstrumentation } from './instrumentation.js';
import { t } from './viewer.js';

/**
 * Swipe compare as the visitor meets it (M4, scenario V06; docs/research/M4-interfaces.md §3): its divider, its bar and the
 * two live maps the instrumentation keeps (the viewer's map first, the second map last). The helpers read the maps; the
 * specs drive compare through its controls, the URL and the public API only.
 */

/** The divider between the two maps (a slider). */
export function divider(page: Page, lang: Locale): Locator {
    return page.getByRole('slider', { name: t(lang, 'compare.divider'), exact: true });
}

/** The compare bar (a group named for the comparison). */
export function compareBar(page: Page, lang: Locale): Locator {
    return page.getByRole('group', { name: t(lang, 'compare.title'), exact: true });
}

/** The chooser of the compared side in the bar. */
export function compareChooser(page: Page, lang: Locale): Locator {
    return compareBar(page, lang).getByRole('combobox', { name: t(lang, 'compare.choose'), exact: true });
}

/** Close in the compare bar. */
export function closeCompare(page: Page, lang: Locale): Locator {
    return compareBar(page, lang).getByRole('button', { name: t(lang, 'compare.close'), exact: true });
}

/** How many maps are alive now (each a billed map load while it lives). */
export async function liveMaps(page: Page): Promise<number> {
    const { mapsCreated, mapsRemoved } = await readInstrumentation(page);
    return mapsCreated - mapsRemoved;
}

/** Waits until the counter shows `created` maps made and `removed` taken away. */
export async function expectMapCounts(page: Page, created: number, removed: number): Promise<void> {
    await expect
        .poll(
            async () => {
                const counts = await readInstrumentation(page);
                return [counts.mapsCreated, counts.mapsRemoved];
            },
            { message: `maps created and removed: ${String(created)}, ${String(removed)}` },
        )
        .toEqual([created, removed]);
}

/** Drags the divider's handle with the mouse to `fraction` of the map's width (the handle is the only drag target). */
export async function dragDivider(page: Page, lang: Locale, fraction: number): Promise<void> {
    const handle = await divider(page, lang).boundingBox();
    const map = await page.locator('hcm-map-viewer .map').boundingBox();
    if (handle === null || map === null) {
        throw new Error('no divider to drag');
    }
    const y = handle.y + handle.height / 2;
    await page.mouse.move(handle.x + handle.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(map.x + map.width * fraction, y, { steps: 5 });
    await page.mouse.up();
}

/** The camera of every live map, the viewer's first: centre (5 decimals), zoom (3), bearing (1), and whether it moves. */
export interface Camera {
    readonly center: readonly [number, number];
    readonly zoom: number;
    readonly bearing: number;
    readonly moving: boolean;
}

/** Runs in the page: the camera of each live map. */
function camerasInPage(): Camera[] {
    interface CameraMap {
        getCenter(): { lng: number; lat: number };
        getZoom(): number;
        getBearing(): number;
        isMoving(): boolean;
    }
    const maps = (window as unknown as { __hcmE2e?: { maps: CameraMap[] } }).__hcmE2e?.maps ?? [];
    const round = (value: number, digits: number): number => Number(value.toFixed(digits));
    return maps.map((map) => ({
        center: [round(map.getCenter().lng, 5), round(map.getCenter().lat, 5)],
        zoom: round(map.getZoom(), 3),
        bearing: round(map.getBearing(), 1),
        moving: map.isMoving(),
    }));
}

/** The cameras of the live maps, the viewer's map first. */
export async function cameras(page: Page): Promise<Camera[]> {
    return page.evaluate(camerasInPage);
}

/** Whether the viewer's map and the second map rest on one camera (both still, same centre, zoom and bearing). */
export async function bothAtRest(page: Page): Promise<boolean> {
    const [main, second, ...more] = await cameras(page);
    const still = main?.moving === false && second?.moving === false && more.length === 0;
    return still && JSON.stringify(main) === JSON.stringify(second);
}

/** Runs in the page: counts every `move` of every live map from now on (read back with `countedMoves`). */
function countMovesInPage(): void {
    interface MovingMap {
        on(type: string, listener: () => void): unknown;
    }
    const target = window as unknown as { __hcmE2e?: { maps: MovingMap[] }; __hcmMoves?: number };
    target.__hcmMoves = 0;
    for (const map of target.__hcmE2e?.maps ?? []) {
        map.on('move', () => {
            target.__hcmMoves = (target.__hcmMoves ?? 0) + 1;
        });
    }
}

/** Starts counting the live maps' `move` events (a read-only listener, as the map helpers read the map). */
export async function countMoves(page: Page): Promise<void> {
    await page.evaluate(countMovesInPage);
}

/** The `move` events counted since `countMoves`. */
export async function countedMoves(page: Page): Promise<number> {
    return page.evaluate(() => (window as unknown as { __hcmMoves?: number }).__hcmMoves ?? 0);
}
