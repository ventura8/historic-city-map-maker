import type { Page } from '@playwright/test';

import { BASEMAP_BACKGROUND, E2E_TILESET_LAYER, E2E_XYZ_LAYER } from '../../fixtures/world.js';
import {
    bothAtRest,
    cameras,
    closeCompare,
    compareBar,
    compareChooser,
    countedMoves,
    countMoves,
    divider,
    dragDivider,
    expectMapCounts,
    liveMaps,
} from '../../support/compare.js';
import { blend, expectColourAt, mapFraction, mapIdle } from '../../support/map.js';
import { expect, test } from '../../support/test.js';
import { callController, engineEvents, hashParam, openLayers, openViewer, opacitySlider, t, viewer } from '../../support/viewer.js';

/**
 * Swipe compare (behaviour V06; docs/research/M4-interfaces.md §3, docs/ENGINE_API.md → Compare): the viewer's map beside
 * the same map with another historical layer, or today, split by a divider. Each test sets the window it needs (a second
 * map only from 600 px wide, a toggle below), so the spec runs at one functional project per push. Pixel probes read
 * the synthetic tile colours in an empty corner of the city, where only the basemap and the rasters draw; the
 * map-instance counter proves one map per view (a second map only while comparing on a wide window).
 */

const WIDE = { width: 1280, height: 800 };
const COMPACT = { width: 360, height: 800 };
const EMPTY_VIEW = '15/44.37000/25.97000';
const RED = E2E_TILESET_LAYER.colour;
/** The 1980 layer draws at its manifest opacity, 0.8, over the basemap. */
const GREEN = blend(E2E_XYZ_LAYER.colour, BASEMAP_BACKGROUND, 0.8);
const LAYER_1966 = 'Corona 1966 (e2e)';
const LAYER_1980 = { ro: 'Fotografie aeriană 1980 (e2e)', en: 'Aerial photo 1980 (e2e)' } as const;

/** Opens the viewer at a wide window on `hash`, waits for the map, and for the second map when the hash compares. */
async function openWide(page: Page, lang: 'ro' | 'en', hash: string): Promise<void> {
    await page.setViewportSize(WIDE);
    await openViewer(page, { lang, hash: `${EMPTY_VIEW}&${hash}` });
}

test.describe('swipe compare', () => {
    test(
        'Compare in the Layers panel creates the second map only then and splits the map at the divider',
        { tag: '@S-V06-HAPPY' },
        async ({ page, lang }) => {
            await openWide(page, lang, `layers=${E2E_TILESET_LAYER.id}`);
            await expectMapCounts(page, 1, 0);

            await openLayers(page, lang);
            await viewer(page)
                .getByRole('button', { name: t(lang, 'compare.open'), exact: true })
                .click();
            await expectMapCounts(page, 2, 0);
            await mapIdle(page);
            await expectColourAt(page, await mapFraction(page, 0.25, 0.3), RED, 'the main side, left of the divider');
            await expectColourAt(page, await mapFraction(page, 0.75, 0.3), BASEMAP_BACKGROUND, 'today, right of the divider');
            await expect.poll(() => hashParam(page, 'cmp')).toBe('');

            await dragDivider(page, lang, 0.7);
            await expect(divider(page, lang)).toHaveAttribute('aria-valuenow', '70');
            await expectColourAt(page, await mapFraction(page, 0.6, 0.3), RED, 'the main side grew with the divider');
            await expect.poll(() => hashParam(page, 'sw')).toBe('70');
            expect((await engineEvents(page, 'hcm-compare-change')).at(-1)).toEqual({
                open: true,
                mode: 'swipe',
                layerId: null,
                position: 0.7,
            });
        },
    );

    test(
        'The divider works from the keyboard and names both sides for a screen reader',
        { tag: '@S-V06-HAPPY-KEYBOARD' },
        async ({ page, lang }) => {
            await openWide(page, lang, `layers=${E2E_TILESET_LAYER.id}&cmp=`);
            const handle = divider(page, lang);
            await expect(handle).toHaveAttribute(
                'aria-valuetext',
                t(lang, 'compare.value', { left: LAYER_1966, a: '50', right: t(lang, 'compare.today'), b: '50' }),
            );

            await handle.focus();
            await handle.press('ArrowRight');
            await expect(handle).toHaveAttribute('aria-valuenow', '51');
            await handle.press('Shift+ArrowLeft');
            await expect(handle).toHaveAttribute('aria-valuenow', '41');
            await handle.press('Home');
            await expect(handle).toHaveAttribute('aria-valuenow', '0');
            await expectColourAt(page, await mapFraction(page, 0.2, 0.3), BASEMAP_BACKGROUND, 'today fills the map');
            await handle.press('End');
            await expect(handle).toHaveAttribute('aria-valuenow', '100');
            await expectColourAt(page, await mapFraction(page, 0.8, 0.3), RED, 'the main side fills the map');

            const box = await handle.boundingBox();
            expect(box?.width).toBeGreaterThanOrEqual(48);
            expect(box?.height).toBeGreaterThanOrEqual(48);
            expect(await handle.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
        },
    );

    test(
        'A shared link reopens compare on its layer with the divider where it was',
        { tag: '@S-V06-HAPPY-DEEP-LINK' },
        async ({ page, lang }) => {
            await openWide(page, lang, `layers=${E2E_TILESET_LAYER.id}&cmp=${E2E_XYZ_LAYER.id}&sw=30`);

            await expectMapCounts(page, 2, 0);
            await expect(divider(page, lang)).toHaveAttribute('aria-valuenow', '30');
            await expect(compareChooser(page, lang)).toHaveValue(E2E_XYZ_LAYER.id);
            await mapIdle(page);
            await expectColourAt(page, await mapFraction(page, 0.15, 0.3), RED, '1966 left of the divider');
            await expectColourAt(page, await mapFraction(page, 0.6, 0.3), GREEN, '1980 right of it');
            expect(await engineEvents(page, 'hcm-compare-change')).toEqual([
                { open: true, mode: 'swipe', layerId: E2E_XYZ_LAYER.id, position: 0.3 },
            ]);
        },
    );

    test(
        'A link comparing a layer the map does not have opens the map without compare',
        { tag: '@S-V06-BAD-UNKNOWN-LAYER' },
        async ({ page, lang }) => {
            await openWide(page, lang, `layers=${E2E_TILESET_LAYER.id}&cmp=no-such-layer&sw=30`);

            await expect.poll(() => hashParam(page, 'cmp')).toBeNull();
            expect(await hashParam(page, 'sw')).toBeNull();
            expect(await hashParam(page, 'layers')).toBe(E2E_TILESET_LAYER.id);
            await expect(compareBar(page, lang)).toHaveCount(0);
            await expectMapCounts(page, 1, 0);
        },
    );

    test(
        'Each side keeps its overlays opacity, and a slider moved while comparing changes its side live',
        { tag: '@S-V06-HAPPY-OPACITY' },
        async ({ page, lang }) => {
            await openWide(page, lang, `layers=${E2E_TILESET_LAYER.id}&op=${E2E_TILESET_LAYER.id}:40&cmp=${E2E_XYZ_LAYER.id}`);
            await expectMapCounts(page, 2, 0);
            await mapIdle(page);
            await expectColourAt(page, await mapFraction(page, 0.25, 0.3), blend(RED, BASEMAP_BACKGROUND, 0.4), '1966 at 40 %');
            await expectColourAt(page, await mapFraction(page, 0.75, 0.3), GREEN, '1980 at its own 80 %');

            await openLayers(page, lang);
            await opacitySlider(page, lang, LAYER_1980[lang]).press('Home');
            await expectColourAt(page, await mapFraction(page, 0.75, 0.3), BASEMAP_BACKGROUND, '1980 at 0 % on the compared side');
            await expectColourAt(page, await mapFraction(page, 0.25, 0.3), blend(RED, BASEMAP_BACKGROUND, 0.4), 'the main side unchanged');
        },
    );

    test('Both sides move together, without a feedback loop', { tag: '@S-V06-HAPPY-CAMERA-SYNC' }, async ({ page, lang }) => {
        await openWide(page, lang, `cmp=${E2E_TILESET_LAYER.id}`);
        await expectMapCounts(page, 2, 0);
        await mapIdle(page);
        await countMoves(page);
        const start = await mapFraction(page, 0.75, 0.5);

        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x - 200, start.y + 60, { steps: 8 });
        await page.mouse.up();
        await viewer(page).locator('.map canvas.mapboxgl-canvas').press('Equal');

        await expect.poll(() => bothAtRest(page), { message: 'both maps rest on the same camera' }).toBe(true);
        const [main] = await cameras(page);
        expect(main?.zoom).toBeGreaterThan(15);
        expect(await countedMoves(page)).toBeLessThan(400);
    });
});

test.describe('leaving compare', () => {
    test(
        'Close, Esc on the divider and the controller each destroy the second map',
        { tag: '@S-V06-BAD-EXIT-DESTROYS-MAP' },
        async ({ page, lang }) => {
            await openWide(page, lang, 'cmp=');
            await expectMapCounts(page, 2, 0);

            await closeCompare(page, lang).click();
            await expectMapCounts(page, 2, 1);
            await expect.poll(() => hashParam(page, 'cmp')).toBeNull();
            await callController(page, 'openCompare', E2E_XYZ_LAYER.id);
            await expectMapCounts(page, 3, 1);
            await divider(page, lang).press('Escape');
            await expectMapCounts(page, 3, 2);
            await expect(compareBar(page, lang)).toHaveCount(0);

            await callController(page, 'openCompare', null);
            await expectMapCounts(page, 4, 2);
            await callController(page, 'destroy');
            await expect.poll(() => liveMaps(page)).toBe(0);
        },
    );

    test(
        'A compact window compares with a toggle on its one map; a wider one makes the second map, a narrower one hides it',
        { tag: '@S-V06-BAD-COMPACT-WIDTH' },
        async ({ page, lang }) => {
            await page.setViewportSize(COMPACT);
            await openViewer(page, { lang, hash: `${EMPTY_VIEW}&layers=${E2E_TILESET_LAYER.id}` });
            await openLayers(page, lang);
            await viewer(page)
                .getByRole('button', { name: t(lang, 'compare.open'), exact: true })
                .click();

            const toggle = compareBar(page, lang).getByRole('radiogroup', { name: t(lang, 'compare.toggle'), exact: true });
            await expect(toggle).toBeVisible();
            await expect(divider(page, lang)).toHaveCount(0);
            await expectColourAt(page, await mapFraction(page, 0.5, 0.3), RED, 'the main side on the one map');
            await toggle.getByRole('radio', { name: t(lang, 'compare.today') }).click();
            await expectColourAt(page, await mapFraction(page, 0.5, 0.3), BASEMAP_BACKGROUND, 'the compared side on the one map');
            await expect.poll(() => hashParam(page, 'sw')).toBe('0');
            await expectMapCounts(page, 1, 0);

            await page.setViewportSize(WIDE);
            await expectMapCounts(page, 2, 0);
            await expect(divider(page, lang)).toBeVisible();
            // Narrower again: the second map is hidden for a minute, not destroyed, so a window that widens again (a phone
            // turned back) shows it with no new map load; Close destroys it at once (the minute's end: the engine's test).
            await page.setViewportSize(COMPACT);
            await expect(toggle).toBeVisible();
            await expectMapCounts(page, 2, 0);
            await page.setViewportSize(WIDE);
            await expect(divider(page, lang)).toBeVisible();
            await expectMapCounts(page, 2, 0);
            await page.setViewportSize(COMPACT);
            await closeCompare(page, lang).click();
            await expectMapCounts(page, 2, 1);
        },
    );
});
