import type { Page } from '@playwright/test';

import { siteManifestData, type Json } from '../../fixtures/manifest.js';
import { lostStreetsManifest } from '../../tour/lost-streets-states.js';
import { mapIdle, renderedFeatureIds, screenPointOf, type LngLat } from '../../support/map.js';
import { expect, test } from '../../support/test.js';
import { serveManifest, t, viewer, visibilitySwitch, waitForEngineEvent } from '../../support/viewer.js';
import { sitePath } from '../../support/site.js';

/**
 * M27 Disappeared streets (behaviour V71, docs/research/M27-lost-streets.md): a POI category the city pins to the top of
 * Layers, hidden until the visitor turns it on, whose streets name the map they were traced on and the data's credit.
 */

const LABEL = { ro: 'Străzi demolate', en: 'Disappeared streets' } as const;
const RENAMED_LABEL = { ro: 'Străzi redenumite', en: 'Renamed streets' } as const;
const CREDIT = 'OpenHistoricalMap (CC0)';
const ON_LINE: LngLat = [26.088, 44.42485];
const ON_RENAMED_LINE: LngLat = [26.088, 44.42585];
const STREET_ID = 'ls-ohm-1';
const RENAMED_ID = 'ls-ohm-renamed-1';

/** The tour's fixture (a pinned, hidden category and one street traced on the first layer) and that layer's label. */
function lostStreetsFixture(): { readonly manifest: Json; readonly layerLabel: { ro: string; en: string } } {
    const manifest = lostStreetsManifest();
    const [layer] = manifest['layers'] as [Json];
    return { manifest, layerLabel: layer['label'] as { ro: string; en: string } };
}

async function bootWide(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(sitePath('bucharest', { lang, hash: '16/44.42490/26.08720' }));
    await waitForEngineEvent(page, 'hcm-ready');
    await mapIdle(page);
}

test(
    'Disappeared streets lead the Places section, above every layer, hidden until switched on',
    { tag: ['@S-V71-HAPPY-PINNED', '@S-V71-HAPPY-SOURCES'] },
    async ({ page, lang }) => {
        const { manifest, layerLabel } = lostStreetsFixture();
        await serveManifest(page, manifest);
        await bootWide(page, lang);
        const pane = viewer(page).locator('.pane.leading hcm-layer-panel');
        const streets = visibilitySwitch(page, lang, LABEL[lang]);

        // Its place (the owner, 2026-11-22): the first of the places, no longer in the strip at the top.
        await expect(pane.locator('.pinned .section-body hcm-overlay-list')).toHaveCount(0);
        const firstPlace = await pane.locator('[data-section="places"] hcm-overlay-list li').first().textContent();
        expect(firstPlace).toContain(LABEL[lang]);
        const streetsBox = await streets.boundingBox();
        const firstLayer = await pane.locator('hcm-overlay-list').last().boundingBox();
        expect((streetsBox?.y ?? 0) < (firstLayer?.y ?? 0), 'the pinned category sits above the historical layers').toBe(true);

        // Hidden at start: no street is drawn and its credit is not listed until the visitor turns it on.
        await expect(streets).toHaveAttribute('aria-checked', 'false');
        expect(await renderedFeatureIds(page, 'hcm-poi-')).not.toContain(STREET_ID);
        await streets.click();
        await expect.poll(() => renderedFeatureIds(page, 'hcm-poi-')).toContain(STREET_ID);
        await expect(pane.locator('.attribution')).toContainText(CREDIT);
        await page.screenshot({ path: test.info().outputPath(`lost-streets-pinned-${lang}.png`) });

        // A tap on the street: its name, years and sources (the map it was traced on, the data's credit).
        const point = await screenPointOf(page, ON_LINE);
        await page.mouse.click(point.x, point.y);
        const sheet = viewer(page).locator('hcm-poi-detail');
        await expect(sheet).toContainText(t(lang, 'poi.sourceLayer', { layer: layerLabel[lang] }));
        await expect(sheet).toContainText(t(lang, 'layers.attribution', { attribution: CREDIT }));
        await page.screenshot({ path: test.info().outputPath(`lost-streets-sheet-${lang}.png`) });
    },
);

test(
    'A street traced on a map the manifest does not list is refused with the field named, not drawn on a guess',
    { tag: '@S-V71-BAD-UNKNOWN-LAYER' },
    async ({ page, lang }) => {
        const { manifest } = lostStreetsFixture();
        for (const street of (manifest['pois'] as Json[]).filter((poi) => poi['category'] === 'strazi-disparute')) {
            street['sourceLayer'] = 'gone-1911';
        }
        await serveManifest(page, manifest);
        await page.goto(sitePath('bucharest', { lang }));

        await expect(viewer(page).locator('hcm-error-card')).toContainText('sourceLayer');
    },
);

test(
    'Without a pinned category neither the strip nor Places lists Disappeared streets',
    { tag: '@S-V71-BAD-NOTHING-ELSE-PINNED' },
    async ({ page, lang }) => {
        await serveManifest(page, siteManifestData());
        await bootWide(page, lang);

        await expect(viewer(page).locator('hcm-layer-panel .pinned .pinned-overlays')).toHaveCount(0);
        await expect(visibilitySwitch(page, lang, LABEL[lang])).toHaveCount(0);
    },
);

test(
    'Renamed streets have their own pinned switch and show both old and current name in the detail sheet',
    { tag: '@S-V71-HAPPY-RENAMED' },
    async ({ page, lang }) => {
        const { manifest } = lostStreetsFixture();
        (manifest['poiCategories'] as Json[]).push({
            ...{ id: 'strazi-redenumite', label: RENAMED_LABEL, icon: 'route', color: '#1B6B52', defaultOpacity: 1 },
            ...{ defaultVisible: false, pinned: true, attribution: CREDIT },
        });
        (manifest['pois'] as Json[]).push({
            id: RENAMED_ID,
            category: 'strazi-redenumite',
            geometry: {
                type: 'LineString',
                coordinates: [
                    [26.085, 44.4255],
                    [26.088, 44.42585],
                    [26.089, 44.426],
                ],
            },
            title: { ro: 'Podul Mogoșoaiei', en: 'Podul Mogoșoaiei' },
            currentName: { ro: 'Calea Victoriei', en: 'Calea Victoriei' },
            yearEnd: 1878,
            links: [],
        });
        await serveManifest(page, manifest);
        await bootWide(page, lang);

        const renamed = visibilitySwitch(page, lang, RENAMED_LABEL[lang]);
        await expect(renamed).toHaveAttribute('aria-checked', 'false');
        await renamed.click();
        await expect.poll(() => renderedFeatureIds(page, 'hcm-poi-')).toContain(RENAMED_ID);

        const point = await screenPointOf(page, ON_RENAMED_LINE);
        await page.mouse.click(point.x, point.y);
        const sheet = viewer(page).locator('hcm-poi-detail');
        await expect(sheet).toContainText(t(lang, 'poi.currentName', { name: 'Calea Victoriei' }));
    },
);

test(
    'A renamed street with an empty currentName is refused with the field named',
    { tag: '@S-V71-BAD-RENAMED-EMPTY' },
    async ({ page, lang }) => {
        const { manifest } = lostStreetsFixture();
        for (const street of (manifest['pois'] as Json[]).filter((poi) => poi['category'] === 'strazi-disparute')) {
            street['currentName'] = {};
        }
        await serveManifest(page, manifest);
        await page.goto(sitePath('bucharest', { lang }));

        await expect(viewer(page).locator('hcm-error-card')).toContainText('currentName');
    },
);
