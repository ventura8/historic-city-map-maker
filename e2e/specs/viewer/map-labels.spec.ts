import { translateMapLabels } from '@hcm/shared/map-labels';
import type { Locale } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { siteManifestData, type Json } from '../../fixtures/manifest.js';
import { E2E_PLAIN_STYLE_ID, E2E_ROADS_OFF_STYLE_ID, E2E_TILESET_LAYER } from '../../fixtures/world.js';
import { compareBar, expectMapCounts } from '../../support/compare.js';
import { mapIdle, mapLabelFlags, mapTransitFlags } from '../../support/map.js';
import { expect, test } from '../../support/test.js';
import {
    callController,
    currentHash,
    engineEvents,
    hashParam,
    openLayers,
    openViewer,
    serveManifest,
    viewer,
} from '../../support/viewer.js';

/**
 * The basemap's own labels (behaviour V31, docs/ENGINE_API.md → Map labels): street names and points of interest, Mapbox
 * Standard's `showRoadLabels` and `showPointOfInterestLabels`, with its transit stations (`showTransitLabels`). The e2e
 * basemap is a fragment with Standard's schema and draws no text, so what these specs read is what the real Mapbox GL reports
 * it applied (`mapLabelFlags`, `mapTransitFlags`); the map-instance counter proves a switch makes no new map load. Each test that compares sets a wide window: a second map only from 600 px.
 */

const VIEW = '15/44.37000/25.97000';
const WIDE = { width: 1280, height: 800 };
const BOTH_DRAWN = { streets: true, pois: true };

function streets(page: Page, lang: Locale): Locator {
    return page.getByRole('switch', { name: translateMapLabels(lang, 'mapLabels.streets'), exact: true });
}

function pois(page: Page, lang: Locale): Locator {
    return page.getByRole('switch', { name: translateMapLabels(lang, 'mapLabels.pois'), exact: true });
}

function withBasemap(change: Json): Json {
    const manifest = siteManifestData();
    Object.assign((manifest['city'] as Json)['basemap'] as Json, change);
    return manifest;
}

const CUSTOM_BASEMAP = { style: `mapbox://styles/hcm-e2e/${E2E_PLAIN_STYLE_ID}` };

test('The two switches turn the labels off and on live, with no new map load', { tag: '@S-V31-HAPPY' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: VIEW });
    await openLayers(page, lang);
    await expect(page.getByRole('group', { name: translateMapLabels(lang, 'mapLabels.group'), exact: true })).toBeVisible();
    await expect(page.getByText(translateMapLabels(lang, 'mapLabels.notePlaces'))).toBeVisible();
    await expect(streets(page, lang)).toHaveAttribute('aria-checked', 'true');

    await streets(page, lang).click();
    await expect.poll(() => mapLabelFlags(page)).toEqual([{ streets: false, pois: true }]);
    await expect.poll(() => hashParam(page, 'labels')).toBe('pois');

    await pois(page, lang).click();
    await expect.poll(() => mapLabelFlags(page)).toEqual([{ streets: false, pois: false }]);
    await expect.poll(() => hashParam(page, 'labels')).toBe('');

    await streets(page, lang).click();
    await pois(page, lang).click();
    await expect.poll(() => mapLabelFlags(page)).toEqual([BOTH_DRAWN]);
    await expect.poll(async () => (await currentHash(page)).includes('labels')).toBe(false);
    await expectMapCounts(page, 1, 0);
});

test('The switches work from the keyboard', { tag: '@S-V31-HAPPY-KEYBOARD' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: VIEW });
    await openLayers(page, lang);

    await pois(page, lang).focus();
    await page.keyboard.press('Space');

    await expect(pois(page, lang)).toHaveAttribute('aria-checked', 'false');
    await expect.poll(() => mapLabelFlags(page)).toEqual([{ streets: true, pois: false }]);
});

test(
    'The place categories keep their own switches, apart from the labels',
    { tag: '@S-V31-BAD-CATEGORIES-UNTOUCHED' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: VIEW });
        await openLayers(page, lang);
        const overlays = viewer(page).locator('hcm-overlay-list').getByRole('switch');
        const before = await overlays.count();

        await pois(page, lang).click();
        await streets(page, lang).click();

        await expect(overlays).toHaveCount(before);
        const states = await overlays.evaluateAll((switches) => switches.map((element) => element.getAttribute('aria-checked')));
        expect(states).not.toContain(null);
        await expect.poll(async () => hashParam(page, 'op')).toBeNull();
    },
);

test("A shared link restores the choice from the map's first frame", { tag: '@S-V31-HAPPY-HASH-RESTORED' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: `${VIEW}&labels=streets` });

    expect(await mapLabelFlags(page)).toEqual([{ streets: true, pois: false }]);
    expect((await engineEvents(page, 'hcm-map-labels-change')).at(-1)).toEqual({ streets: true, pois: false });
    await openLayers(page, lang);
    await expect(pois(page, lang)).toHaveAttribute('aria-checked', 'false');
    await expect.poll(() => hashParam(page, 'labels')).toBe('streets');
    await expectMapCounts(page, 1, 0);
});

test('A link from before map labels keeps working and gains nothing', { tag: '@S-V31-HAPPY-OLD-LINK' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: `${VIEW}&layers=${E2E_TILESET_LAYER.id}&op=photos:50` });
    await mapIdle(page);

    expect(await mapLabelFlags(page)).toEqual([BOTH_DRAWN]);
    expect(await hashParam(page, 'labels')).toBeNull();
    expect(await hashParam(page, 'layers')).toBe(E2E_TILESET_LAYER.id);
});

test(
    'An invalid hash value is ignored and the viewer rewrites the hash without it',
    { tag: '@S-V31-BAD-HASH-INVALID' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: `${VIEW}&labels=nonsense,__proto__` });
        await openLayers(page, lang);

        expect(await mapLabelFlags(page)).toEqual([BOTH_DRAWN]);
        await expect(streets(page, lang)).toHaveAttribute('aria-checked', 'true');
        await expect.poll(async () => (await currentHash(page)).includes('labels')).toBe(false);
    },
);

test("The city's basemap.config is the default the hash leaves out", { tag: '@S-V31-HAPPY-CITY-DEFAULT' }, async ({ page, lang }) => {
    await serveManifest(page, withBasemap({ config: { showRoadLabels: false } }));
    await openViewer(page, { lang, hash: VIEW });
    await openLayers(page, lang);

    await expect(streets(page, lang)).toHaveAttribute('aria-checked', 'false');
    expect(await mapLabelFlags(page)).toEqual([{ streets: false, pois: true }]);
    expect(await hashParam(page, 'labels')).toBeNull();

    await streets(page, lang).click();
    await expect.poll(() => mapLabelFlags(page)).toEqual([BOTH_DRAWN]);
    await expect.poll(() => hashParam(page, 'labels')).toBe('streets,pois');
});

test(
    "A custom basemap offers no switch, drops the link's choice and is never written to",
    { tag: '@S-V31-BAD-CUSTOM-BASEMAP' },
    async ({ page, lang }) => {
        await serveManifest(page, withBasemap(CUSTOM_BASEMAP));
        await openViewer(page, { lang, hash: `${VIEW}&labels=` });
        await openLayers(page, lang);

        await expect(viewer(page).locator('hcm-overlay-list')).toBeVisible();
        await expect(page.getByRole('group', { name: translateMapLabels(lang, 'mapLabels.group'), exact: true })).toHaveCount(0);
        await expect(streets(page, lang)).toHaveCount(0);
        expect(await mapLabelFlags(page)).toEqual([{ streets: null, pois: null }]);
        await expect.poll(async () => (await currentHash(page)).includes('labels')).toBe(false);

        await callController(page, 'setMapLabels', { streets: false });
        expect(await mapLabelFlags(page)).toEqual([{ streets: null, pois: null }]);
        expect(await engineEvents(page, 'hcm-map-labels-change')).toEqual([]);
    },
);

const ROADS_OFF_BASEMAP = { style: `mapbox://styles/hcm-e2e/${E2E_ROADS_OFF_STYLE_ID}` };

test(
    "A link turning on what the style's own default leaves off keeps its choice",
    { tag: '@S-V31-HAPPY-STYLE-DEFAULT' },
    async ({ page, lang }) => {
        await serveManifest(page, withBasemap(ROADS_OFF_BASEMAP));
        await openViewer(page, { lang, hash: `${VIEW}&labels=streets,pois` });
        await openLayers(page, lang);

        await expect(streets(page, lang)).toHaveAttribute('aria-checked', 'true');
        await expect.poll(() => mapLabelFlags(page)).toEqual([BOTH_DRAWN]);
        await expect.poll(() => hashParam(page, 'labels')).toBe('streets,pois');
        await expectMapCounts(page, 1, 0);
    },
);

test("A link over a style's own default loses nothing on the next reload", { tag: '@S-V31-BAD-STYLE-DEFAULT' }, async ({ page, lang }) => {
    await serveManifest(page, withBasemap(ROADS_OFF_BASEMAP));
    await openViewer(page, { lang, hash: `${VIEW}&labels=pois` });
    await openLayers(page, lang);

    await streets(page, lang).click();
    await expect.poll(() => mapLabelFlags(page)).toEqual([BOTH_DRAWN]);
    await expect.poll(() => hashParam(page, 'labels')).toBe('streets,pois');

    await page.reload();
    await openLayers(page, lang);
    await expect(streets(page, lang)).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => mapLabelFlags(page)).toEqual([BOTH_DRAWN]);
});

test('Swipe compare follows the choice on both sides, with no third map', { tag: '@S-V31-HAPPY-COMPARE' }, async ({ page, lang }) => {
    await page.setViewportSize(WIDE);
    await openViewer(page, { lang, hash: `${VIEW}&layers=${E2E_TILESET_LAYER.id}&cmp=&labels=streets` });
    await expect(compareBar(page, lang)).toBeVisible();
    await expectMapCounts(page, 2, 0);
    await expect
        .poll(() => mapLabelFlags(page))
        .toEqual([
            { streets: true, pois: false },
            { streets: true, pois: false },
        ]);

    await openLayers(page, lang);
    await streets(page, lang).click();
    await pois(page, lang).click();

    await expect
        .poll(() => mapLabelFlags(page))
        .toEqual([
            { streets: false, pois: true },
            { streets: false, pois: true },
        ]);
    await expectMapCounts(page, 2, 0);
});

test('Compare on a custom basemap writes neither side', { tag: '@S-V31-BAD-COMPARE-CUSTOM-BASEMAP' }, async ({ page, lang }) => {
    await page.setViewportSize(WIDE);
    await serveManifest(page, withBasemap(CUSTOM_BASEMAP));
    await openViewer(page, { lang, hash: `${VIEW}&layers=${E2E_TILESET_LAYER.id}&cmp=&labels=` });
    await expectMapCounts(page, 2, 0);

    await callController(page, 'setMapLabels', { streets: false, pois: false });

    await expect
        .poll(() => mapLabelFlags(page))
        .toEqual([
            { streets: null, pois: null },
            { streets: null, pois: null },
        ]);
    await expect.poll(async () => (await currentHash(page)).includes('labels')).toBe(false);
});

test('The controller sets the labels and the event says so', { tag: '@S-V31-HAPPY-API' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: VIEW });

    await callController(page, 'setMapLabels', { pois: false });

    await expect.poll(() => mapLabelFlags(page)).toEqual([{ streets: true, pois: false }]);
    await expect.poll(() => engineEvents(page, 'hcm-map-labels-change')).toEqual([{ streets: true, pois: false }]);
});

test('The controller ignores what is not a label choice', { tag: '@S-V31-BAD-API' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: VIEW });

    await callController(page, 'setMapLabels', { streets: 'no', transit: false });
    await callController(page, 'setMapLabels', null);
    await callController(page, 'setMapLabels');

    expect(await mapLabelFlags(page)).toEqual([BOTH_DRAWN]);
    expect(await engineEvents(page, 'hcm-map-labels-change')).toEqual([]);
});

test(
    'Points of interest off hide the tram and metro stations too, and a reload keeps them hidden',
    { tag: '@S-V31-HAPPY-TRANSIT' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: VIEW });
        await openLayers(page, lang);
        expect(await mapTransitFlags(page)).toEqual([true]);

        await pois(page, lang).click();
        await expect.poll(() => mapTransitFlags(page)).toEqual([false]);
        await expect.poll(() => hashParam(page, 'labels')).toBe('streets');

        await page.reload();
        await mapIdle(page);
        expect(await mapTransitFlags(page)).toEqual([false]);
        expect(await hashParam(page, 'labels')).toBe('streets');
        await openLayers(page, lang);
        await pois(page, lang).click();
        await expect.poll(() => mapTransitFlags(page)).toEqual([true]);
        await expectMapCounts(page, 1, 0);
    },
);

test(
    "A city's own transit choice stands when the points of interest come back",
    { tag: '@S-V31-BAD-TRANSIT-CITY' },
    async ({ page, lang }) => {
        await serveManifest(page, withBasemap({ config: { showTransitLabels: false } }));
        await openViewer(page, { lang, hash: `${VIEW}&labels=streets` });
        await openLayers(page, lang);

        await pois(page, lang).click();

        await expect.poll(() => mapLabelFlags(page)).toEqual([BOTH_DRAWN]);
        expect(await mapTransitFlags(page)).toEqual([false]);
    },
);

test('A custom basemap is sent no transit property', { tag: '@S-V31-BAD-TRANSIT-UNKNOWN' }, async ({ page, lang }) => {
    await serveManifest(page, withBasemap(CUSTOM_BASEMAP));
    await openViewer(page, { lang, hash: VIEW });
    await openLayers(page, lang);

    await callController(page, 'setMapLabels', { pois: false });

    await expect(pois(page, lang)).toHaveCount(0);
    expect(await mapTransitFlags(page)).toEqual([null]);
    expect(await engineEvents(page, 'hcm-map-labels-change')).toEqual([]);
});
