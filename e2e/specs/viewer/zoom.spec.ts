import type { Locale } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { bothAtRest, cameras, compareBar, countedMoves, countMoves } from '../../support/compare.js';
import { mapIdle } from '../../support/map.js';
import { expect, test } from '../../support/test.js';
import { currentHash, openViewer, t, waitForEngineEvent } from '../../support/viewer.js';
import { sitePath } from '../../support/site.js';

/**
 * The map's zoom buttons (behaviour V52, the owner on 2026-11-08): Zoom in and Zoom out over the map, by the menu button.
 * Each moves the camera one level, animated as the map moves, and the address follows; at the city's zoom limits (10 and
 * 20 in the fixture) the button says it is disabled, keeps the focus and changes nothing. In swipe compare the second map
 * follows the first, so the one pair zooms both. Where the buttons sit at every window size is the tour's (viewer.tour.ts).
 */

const CENTRE = '44.42704/26.0853';
/** Two maps under SwiftShader take longer to settle (as the tour's compare states). */
const TWO_MAPS_IDLE_MS = 60_000;

function zoomIn(page: Page, lang: Locale): Locator {
    return page.getByRole('button', { name: t(lang, 'viewer.zoomIn'), exact: true });
}

function zoomOut(page: Page, lang: Locale): Locator {
    return page.getByRole('button', { name: t(lang, 'viewer.zoomOut'), exact: true });
}

/**
 * A pointer's click on the middle of `button`: Playwright's own `click` waits for an `aria-disabled` button to be enabled,
 * a visitor's pointer does not.
 */
async function pointerClick(page: Page, button: Locator): Promise<void> {
    const box = await button.boundingBox();
    expect(box, 'the button is on screen').not.toBeNull();
    await page.mouse.click((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2);
}

/** The zoom the address says. */
async function hashZoom(page: Page): Promise<number> {
    return Number((await currentHash(page)).split('/')[0]);
}

async function expectHashZoom(page: Page, zoom: number): Promise<void> {
    await expect.poll(() => hashZoom(page), { message: `the address says zoom ${String(zoom)}` }).toBe(zoom);
}

test(
    'Zoom in and Zoom out move the map one level each, by pointer and by keyboard',
    { tag: '@S-V52-HAPPY-ZOOM-BUTTONS' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: `14.5/${CENTRE}` });
        await expect(zoomIn(page, lang)).not.toHaveAttribute('aria-disabled', 'true');

        await zoomIn(page, lang).click();
        await expectHashZoom(page, 15.5);
        await mapIdle(page);

        await zoomOut(page, lang).focus();
        await page.keyboard.press('Enter');
        await expectHashZoom(page, 14.5);
        await mapIdle(page);
        await page.keyboard.press('Enter');
        await expectHashZoom(page, 13.5);
        await expect(zoomOut(page, lang)).toBeFocused();
        expect((await currentHash(page)).split('&')[0]).toBe(`13.5/${CENTRE}`);
    },
);

test('In swipe compare the one pair zooms both maps', { tag: '@S-V52-HAPPY-COMPARE' }, async ({ page, lang }) => {
    await page.goto(sitePath('bucharest', { lang, hash: `15/${CENTRE}&layers=e2e-1966&cmp=` }));
    await waitForEngineEvent(page, 'hcm-ready');
    await expect(compareBar(page, lang)).toBeVisible();
    await mapIdle(page, TWO_MAPS_IDLE_MS);

    await zoomIn(page, lang).click();

    // Two maps where the window swipes (600 px and wider), one toggled map on a phone: each ends at the new zoom, at rest.
    const zooms = async (): Promise<readonly number[]> => (await cameras(page)).map((camera) => camera.zoom);
    await expect.poll(async () => (await zooms()).every((zoom) => zoom === 16), { timeout: TWO_MAPS_IDLE_MS }).toBe(true);
    await expect.poll(async () => (await zooms()).length < 2 || bothAtRest(page), { timeout: TWO_MAPS_IDLE_MS }).toBe(true);
    await expectHashZoom(page, 16);
});

test(
    'At the city zoom limits the button says it is disabled, keeps the focus and changes nothing',
    { tag: '@S-V52-BAD-ZOOM-AT-LIMIT' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: `20/${CENTRE}` });
        await expect(zoomIn(page, lang)).toHaveAttribute('aria-disabled', 'true');
        await expect(zoomOut(page, lang)).not.toHaveAttribute('aria-disabled', 'true');

        await pointerClick(page, zoomIn(page, lang));
        await zoomIn(page, lang).focus();
        await page.keyboard.press('Enter');
        await mapIdle(page);

        await expect(zoomIn(page, lang)).toBeFocused();
        expect(await hashZoom(page)).toBe(20);
        expect((await cameras(page))[0]?.zoom).toBe(20);

        // In forced colours the soft-disabled button turns GrayText as a disabled one does, unlike its enabled neighbour.
        await page.emulateMedia({ forcedColors: 'active' });
        const colour = (button: Locator): Promise<string> => button.evaluate((control) => getComputedStyle(control).color);
        expect(await colour(zoomIn(page, lang))).not.toBe(await colour(zoomOut(page, lang)));
        await page.emulateMedia({ forcedColors: 'none' });

        // Zoom out's limit: the city's minZoom (10), or higher where the bounds already just cover the map, which is where
        // Mapbox stops (about 10.8 on a phone, 11.6 at 1440 px): a hash at 10 opens there.
        await openViewer(page, { lang, hash: `10/${CENTRE}` });
        await expect(zoomOut(page, lang)).toHaveAttribute('aria-disabled', 'true');
        await expect(zoomIn(page, lang)).not.toHaveAttribute('aria-disabled', 'true');
        await mapIdle(page);
        // The press changes nothing at all: no flight Mapbox clamps back (it moved the map and rewrote the address).
        const floor = await currentHash(page);
        const camera = await cameras(page);
        await countMoves(page);
        await pointerClick(page, zoomOut(page, lang));
        await page.keyboard.press('Enter');
        await mapIdle(page);
        await expect(zoomOut(page, lang)).toBeFocused();
        expect(await countedMoves(page)).toBe(0);
        expect(await currentHash(page)).toBe(floor);
        expect(await cameras(page)).toEqual(camera);
    },
);
