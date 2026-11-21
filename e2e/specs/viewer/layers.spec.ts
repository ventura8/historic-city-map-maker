import { USGS_ATTRIBUTION, type Locale } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { siteManifestData, type Json } from '../../fixtures/manifest.js';
import {
    BASEMAP_BACKGROUND,
    E2E_BROKEN_TILESET,
    E2E_PLAIN_STYLE_ID,
    E2E_TILESET_LAYER,
    E2E_XYZ_LAYER,
    type Rgb,
} from '../../fixtures/world.js';
import { colourDistance, expectColourAt, mapFacts, mapFraction, probeArea } from '../../support/map.js';
import { sitePath } from '../../support/site.js';
import { expect, test } from '../../support/test.js';
import {
    currentHash,
    hashParam,
    openLayers,
    openViewer,
    opacitySlider,
    serveManifest,
    t,
    viewer,
    visibilitySwitch,
    waitForEngineEvent,
} from '../../support/viewer.js';

/**
 * Historical layers (behaviours V03 layer toggle, V05 opacity, V25 image adjustments, and V16's tile outage): pixel
 * probes read the synthetic tile colours of the e2e world in an empty corner of the city, where nothing but the basemap
 * and the rasters draw.
 */

const LAYER_LABEL = 'Corona 1966 (e2e)';
const EMPTY_VIEW = '15/44.37000/25.97000';
const BROKEN = { id: 'e2e-broken', label: 'Strat stricat (e2e)' } as const;

/** The fixture with one more layer whose tiles all answer 503 (a tile outage of one tileset). */
function withBrokenLayer(): Json {
    const manifest = siteManifestData();
    const layers = manifest['layers'] as Json[];
    layers.push({
        ...layers[0],
        id: BROKEN.id,
        year: 1970,
        label: { ro: BROKEN.label, en: BROKEN.label },
        source: { type: 'mapbox', tilesetId: E2E_BROKEN_TILESET },
        order: 3,
    });
    return manifest;
}

/** The fixture with image adjustments on the 1966 layer. */
function withAdjustments(adjustments: Json): Json {
    const manifest = siteManifestData();
    const [layer] = manifest['layers'] as [Json, ...Json[]];
    layer['adjustments'] = adjustments;
    return manifest;
}

/** Closes the Layers panel; the probes that follow poll until the map shows the change. */
async function closePanel(page: Page, lang: Locale): Promise<void> {
    const close = page.getByRole('button', { name: t(lang, 'action.close'), exact: true }).filter({ visible: true });
    if ((await close.count()) > 0) {
        await close.first().click();
    }
}

function brightness(colour: Rgb): number {
    return colour.reduce((sum, channel) => sum + channel, 0);
}

function chroma(colour: Rgb): number {
    return Math.max(...colour) - Math.min(...colour);
}

test(
    'A historical layer switched on and off shows and hides its tiles and its attribution',
    { tag: '@S-V03-HAPPY' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: EMPTY_VIEW });
        const probe = await mapFraction(page, 0.5, 0.3);
        const attribution = viewer(page).locator('.mapboxgl-ctrl-attrib-inner');
        await expectColourAt(page, probe, BASEMAP_BACKGROUND, 'no layer before the switch');
        await expect(attribution).not.toContainText('USGS (e2e)');

        await openLayers(page, lang);
        const toggle = visibilitySwitch(page, lang, LAYER_LABEL);
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-checked', 'true');
        await expect(page.getByText(t(lang, 'layers.attribution', { attribution: 'USGS (e2e)' }))).toBeVisible();
        await closePanel(page, lang);
        await expectColourAt(page, probe, E2E_TILESET_LAYER.colour, 'the 1966 tiles');
        await expect(attribution).toContainText('USGS (e2e)');
        await expect.poll(() => hashParam(page, 'layers')).toBe(E2E_TILESET_LAYER.id);

        await openLayers(page, lang);
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-checked', 'false');
        await expect(page.getByText(t(lang, 'layers.attribution', { attribution: 'USGS (e2e)' }))).toBeHidden();
        await closePanel(page, lang);
        await expectColourAt(page, probe, BASEMAP_BACKGROUND, 'the layer is hidden again');
        await expect(attribution).not.toContainText('USGS (e2e)');
    },
);

test(
    'A tileset whose tiles fail names the layer in a toast and the map keeps working',
    { tag: '@S-V03-BAD-TILE404' },
    async ({ page, lang, consoleErrors }) => {
        await serveManifest(page, withBrokenLayer());
        // Not openViewer: a map whose visible layer keeps failing is never idle.
        await page.goto(sitePath('bucharest', { lang, hash: `${EMPTY_VIEW}&layers=${BROKEN.id}` }));
        await waitForEngineEvent(page, 'hcm-ready');

        await expect(page.getByRole('status').filter({ hasText: t(lang, 'error.layer', { name: BROKEN.label }) })).toBeVisible();
        const probe = await mapFraction(page, 0.5, 0.3);
        await expectColourAt(page, probe, BASEMAP_BACKGROUND, 'the broken layer draws nothing');
        await openLayers(page, lang);
        await visibilitySwitch(page, lang, BROKEN.label).click();
        await visibilitySwitch(page, lang, LAYER_LABEL).click();
        await closePanel(page, lang);
        await expectColourAt(page, probe, E2E_TILESET_LAYER.colour, 'another layer still draws');
        await expect(viewer(page).locator('canvas.mapboxgl-canvas')).toBeVisible();
        const errors = consoleErrors.take();
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.filter((error) => !error.includes('503'))).toEqual([]);
    },
);

test(
    "A visible historical layer turns the basemap's 3D objects off, and hiding it turns them on",
    { tag: '@S-V03-HAPPY-3D-OFF' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: EMPTY_VIEW });
        expect((await mapFacts(page)).show3dObjects).toBe(true);

        await openLayers(page, lang);
        const toggle = visibilitySwitch(page, lang, LAYER_LABEL);
        await toggle.click();
        await expect.poll(async () => (await mapFacts(page)).show3dObjects).toBe(false);
        await toggle.click();
        await expect.poll(async () => (await mapFacts(page)).show3dObjects).toBe(true);
    },
);

test(
    'A style without the Standard configuration is left alone when a layer shows',
    { tag: '@S-V03-BAD-STYLE-WITHOUT-CONFIG' },
    async ({ page, lang }) => {
        const manifest = siteManifestData();
        ((manifest['city'] as Json)['basemap'] as Json)['style'] = `mapbox://styles/hcm-e2e/${E2E_PLAIN_STYLE_ID}`;
        await serveManifest(page, manifest);
        await openViewer(page, { lang, hash: EMPTY_VIEW });
        expect((await mapFacts(page)).show3dObjects).toBeNull();

        await openLayers(page, lang);
        await visibilitySwitch(page, lang, LAYER_LABEL).click();
        await closePanel(page, lang);
        await expectColourAt(page, await mapFraction(page, 0.5, 0.3), E2E_TILESET_LAYER.colour, 'the layer draws on the plain style');
        expect((await mapFacts(page)).show3dObjects).toBeNull();
    },
);

test(
    "Markup in a layer's attribution is shown as text in the map's attribution, never as a link or an element",
    { tag: '@S-V03-BAD-ATTRIBUTION-MARKUP-IS-TEXT' },
    async ({ page, lang }) => {
        // Mapbox GL parses a source attribution as HTML and keeps its links; the manifest's attribution is plain text.
        const markup = '<a href="https://example.org/e2e">USGS (e2e)</a> & <b>bold</b>';
        const manifest = siteManifestData();
        const [layer] = manifest['layers'] as [Json, ...Json[]];
        layer['attribution'] = markup;
        await serveManifest(page, manifest);
        await openViewer(page, { lang, hash: `${EMPTY_VIEW}&layers=${E2E_TILESET_LAYER.id}` });

        const attribution = viewer(page).locator('.mapboxgl-ctrl-attrib-inner');
        await expect(attribution).toContainText(markup);
        await expect(attribution.locator('a[href="https://example.org/e2e"], b')).toHaveCount(0);
        await openLayers(page, lang);
        await expect(page.getByText(t(lang, 'layers.attribution', { attribution: markup }))).toBeVisible();
    },
);

test(
    "Two layers with the same USGS credit name their source once, in the visitor's language, in the panel and on the map",
    { tag: '@S-V03-BAD-ATTRIBUTION-REPEATED' },
    async ({ page, lang }) => {
        // The Pixel Tablet, 2026-11-12: "Sursa: USGS EROS, declassified imagery (public domain)" once per layer, in English.
        const manifest = siteManifestData();
        for (const layer of manifest['layers'] as Json[]) {
            layer['attribution'] = USGS_ATTRIBUTION;
        }
        await serveManifest(page, manifest);
        await openViewer(page, { lang, hash: `${EMPTY_VIEW}&layers=${E2E_TILESET_LAYER.id},${E2E_XYZ_LAYER.id}` });
        const credit = t(lang, 'layers.attribution.usgs');

        await expect(viewer(page).locator('.mapboxgl-ctrl-attrib-inner')).toContainText(credit);
        await openLayers(page, lang);
        await expect(page.getByText(t(lang, 'layers.attribution', { attribution: credit }), { exact: true })).toHaveCount(1);
        // The English words nowhere on the Romanian map; in English once in the panel and once in Mapbox's line.
        await expect(page.getByText(t('en', 'layers.attribution.usgs'))).toHaveCount({ ro: 0, en: 2 }[lang]);
    },
);

test('The layer slider draws the layer at 100 % and not at all at 0 %', { tag: '@S-V05-HAPPY' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: `${EMPTY_VIEW}&layers=${E2E_TILESET_LAYER.id}` });
    const probe = await mapFraction(page, 0.5, 0.3);
    await expectColourAt(page, probe, E2E_TILESET_LAYER.colour, 'the layer at 100 %');

    await openLayers(page, lang);
    const slider = opacitySlider(page, lang, LAYER_LABEL);
    await expect(slider).toHaveAttribute('aria-valuenow', '100');
    await expect(slider).toHaveAttribute('aria-valuetext', t(lang, 'layers.opacityValue', { percent: '100' }));
    await slider.focus();
    await slider.press('Home');
    await expect(slider).toHaveAttribute('aria-valuenow', '0');
    await expect(slider).toHaveAttribute('aria-valuetext', t(lang, 'layers.opacityValue', { percent: '0' }));
    await closePanel(page, lang);
    await expectColourAt(page, probe, BASEMAP_BACKGROUND, 'the layer at 0 %');
    await expect.poll(() => hashParam(page, 'op')).toBe(`${E2E_TILESET_LAYER.id}:0`);
});

test('An opacity out of range in the hash is clamped', { tag: '@S-V05-BAD-HASH-OUT-OF-RANGE' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: `${EMPTY_VIEW}&layers=${E2E_TILESET_LAYER.id}&opacity=7` });
    const probe = await mapFraction(page, 0.5, 0.3);
    await expectColourAt(page, probe, E2E_TILESET_LAYER.colour, 'opacity=7 draws the layer at 100 %');

    await page.evaluate((layer) => {
        location.hash = `15/44.37000/25.97000&layers=${layer}&opacity=-2.5`;
    }, E2E_TILESET_LAYER.id);
    await expectColourAt(page, probe, BASEMAP_BACKGROUND, 'opacity=-2.5 draws it at 0 %');
    await openLayers(page, lang);
    await expect(opacitySlider(page, lang, LAYER_LABEL)).toHaveAttribute('aria-valuenow', '0');
    await expect.poll(() => currentHash(page)).not.toContain('opacity=');
    await expect.poll(() => hashParam(page, 'op')).toBe(`${E2E_TILESET_LAYER.id}:0`);
});

test("A layer's stored adjustments are drawn: brighter and greyer than its raw tiles", { tag: '@S-V25-HAPPY' }, async ({ page, lang }) => {
    await serveManifest(page, withAdjustments({ brightnessMin: 0.3, saturation: -0.6 }));
    await openViewer(page, { lang, hash: `${EMPTY_VIEW}&layers=${E2E_TILESET_LAYER.id}` });

    const seen = await probeArea(page, await mapFraction(page, 0.5, 0.3));
    expect(colourDistance(seen, E2E_TILESET_LAYER.colour), 'the adjusted layer differs from the raw tile').toBeGreaterThan(20);
    expect(brightness(seen), 'brighter than the raw tile').toBeGreaterThan(brightness(E2E_TILESET_LAYER.colour) + 30);
    expect(chroma(seen), 'greyer than the raw tile').toBeLessThan(chroma(E2E_TILESET_LAYER.colour) - 30);
});

test(
    'Crossed brightness bounds are refused, so the image is never drawn inverted',
    { tag: '@S-V25-BAD-OUT-OF-RANGE' },
    async ({ page, lang }) => {
        await serveManifest(page, withAdjustments({ brightnessMin: 0.9, brightnessMax: 0.1 }));
        await page.goto(`/bucharest/?lang=${lang}#${EMPTY_VIEW}&layers=${E2E_TILESET_LAYER.id}`);

        const card = page.getByRole('alert');
        await expect(card).toContainText(t(lang, 'error.manifest.invalid', { count: '1' }));
        await expect(card).toContainText(`layers[0].adjustments.brightnessMax: ${t(lang, 'validation.value')}`);
        await expect(viewer(page).locator('canvas.mapboxgl-canvas')).toHaveCount(0);
    },
);

test(
    'A tile host that is down shows a non-blocking toast; the map stays usable',
    { tag: '@S-V16-BAD-TILE-HOST-DOWN' },
    async ({ page, lang, consoleErrors }) => {
        await page.route('**/xyz/e2e-1980/**', (route) => route.abort('connectionrefused'));
        await openViewer(page, { lang, hash: `${EMPTY_VIEW}&layers=e2e-1980` });

        const toast = page.getByRole('status').filter({
            hasText: t(lang, 'error.layer', { name: lang === 'ro' ? 'Fotografie aeriană 1980 (e2e)' : 'Aerial photo 1980 (e2e)' }),
        });
        await expect(toast).toBeVisible();
        await expect(page.getByRole('alert')).toHaveCount(0);
        await openLayers(page, lang);
        await visibilitySwitch(page, lang, LAYER_LABEL).click();
        await closePanel(page, lang);
        await expectColourAt(page, await mapFraction(page, 0.5, 0.3), E2E_TILESET_LAYER.colour, 'the other layer still draws');
        const errors = consoleErrors.take();
        expect(errors.filter((error) => !error.includes('ERR_CONNECTION_REFUSED'))).toEqual([]);
    },
);
