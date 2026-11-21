import type { Locator, Page } from '@playwright/test';

import { BASEMAP_BACKGROUND, E2E_USER_TILESET_COLOUR } from '../../../fixtures/world.js';
import type { Json } from '../../../fixtures/manifest.js';
import { blend, expectColourAt, mapFraction, mapIdle } from '../../../support/map.js';
import { chooseMenuItem, openLayers, opacitySlider, t, viewer } from '../../../support/viewer.js';
import { expect, test } from '../../support/content-test.js';
import { awaitManifest, entry, openPublicViewer, seedPublicCity } from '../../support/flows.js';
import { adminMapReady, mapPaint, overlayFeatureIds, rasterPaint } from '../../support/map.js';
import { seedCategory, seedLayer, seedPlace, text } from './world.js';

/**
 * The settings page's map (docs/research/M2c-interfaces.md §8.5; behaviours A19 and A36; DECISIONS-for-review.md §42a) in
 * a city of the admin's own: the area drawn on the map as a rectangle and the start view taken from it, the texts and
 * the colour saved section by section, and the overlay defaults previewed live on the same map: each save is read back
 * from the manifest the Functions emulator built, and the visitors' viewer opens with it.
 */

const AT = new Date('2026-10-17T09:00:00.000Z');
const PRIMARY = '--md-sys-color-primary';
const SEED = '#006a6a';

function fieldOf(page: Page, lang: 'ro' | 'en', key: Parameters<typeof text>[1], params: Readonly<Record<string, string>> = {}): Locator {
    return page.getByLabel(text(lang, key, params), { exact: true });
}

function button(page: Page, lang: 'ro' | 'en', key: Parameters<typeof text>[1]): Locator {
    return page.getByRole('button', { name: text(lang, key), exact: true });
}

/** Saves the open section and waits until the page says so. */
async function save(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await button(page, lang, 'adminContent.common.save').click();
    await expect(page.getByText(text(lang, 'adminContent.settings.saved')).first()).toBeVisible();
}

/** A number field of the area section as a number. */
async function numberIn(page: Page, lang: 'ro' | 'en', key: Parameters<typeof text>[1]): Promise<number> {
    return Number(await fieldOf(page, lang, key).inputValue());
}

/** Sets a slider with the keyboard: Home, then PageUp in steps of 10 %. */
async function setPercent(slider: Locator, percent: number): Promise<void> {
    await slider.focus();
    await slider.press('Home');
    for (let step = 0; step < percent / 10; step += 1) {
        await slider.press('PageUp');
    }
    await expect(slider).toHaveAttribute('aria-valuenow', String(percent));
}

/** Draws the area with two clicks on the map, a quarter of its box in from opposite corners. */
async function drawArea(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await button(page, lang, 'adminContent.settings.drawArea').click();
    await expect(page.getByText(text(lang, 'adminContent.settings.drawFirst'))).toBeVisible();
    await page.locator('hcm-admin-map').scrollIntoViewIfNeeded();
    const first = await mapFraction(page, 0.25, 0.25);
    await page.mouse.click(first.x, first.y);
    await expect(page.getByText(text(lang, 'adminContent.settings.drawSecond'))).toBeVisible();
    const second = await mapFraction(page, 0.75, 0.75);
    await page.mouse.click(second.x, second.y);
    await expect(button(page, lang, 'adminContent.settings.drawArea')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText(text(lang, 'adminContent.settings.drawSecond'))).toBeHidden();
}

test(
    'The area drawn on the map, the start view, the name, About, two credits and a new colour reach the viewer',
    { tag: ['@S-A19-HAPPY'] },
    async ({ page, lang, content }) => {
        test.setTimeout(240_000);
        await seedPublicCity(content, AT);
        await page.goto(content.address(lang, 'settings/area'));
        await adminMapReady(page);
        expect(await overlayFeatureIds(page, '_bounds')).toEqual(['_bounds']);

        // Two clicks draw the rectangle: the four edges follow, inside the old bounds around the start view.
        await drawArea(page, lang);
        const bounds = {
            west: await numberIn(page, lang, 'adminContent.settings.west'),
            south: await numberIn(page, lang, 'adminContent.settings.south'),
            east: await numberIn(page, lang, 'adminContent.settings.east'),
            north: await numberIn(page, lang, 'adminContent.settings.north'),
        };
        expect(bounds.west).toBeGreaterThan(25.9);
        expect(bounds.east).toBeLessThan(26.3);
        expect(bounds.west).toBeLessThan(26.1);
        expect(bounds.east).toBeGreaterThan(26.1);
        expect(bounds.south).toBeLessThan(44.43);
        expect(bounds.north).toBeGreaterThan(44.43);

        // One step closer, then Use this view: the zoom is the map's.
        await page
            .locator('hcm-admin-map')
            .getByRole('button', { name: text(lang, 'adminContent.map.zoomIn') })
            .click();
        await mapIdle(page);
        await button(page, lang, 'adminContent.settings.useView').click();
        await expect(fieldOf(page, lang, 'adminContent.settings.zoom')).toHaveValue('14');
        await save(page, lang);
        await expect.poll(async () => (await content.document())?.['bounds']).toEqual(bounds);
        expect((await content.document())?.['zoom']).toBe(14);

        // The texts: the name and About in both languages, two credits.
        await page.goto(content.address(lang, 'settings/texts', { map: false }));
        await fieldOf(page, lang, 'adminContent.settings.nameRo').fill('Bucureștiul de altădată');
        await fieldOf(page, lang, 'adminContent.settings.nameEn').fill('Bucharest of old');
        await fieldOf(page, lang, 'adminContent.settings.aboutRo').fill('Harta orașului **de altădată**.');
        await fieldOf(page, lang, 'adminContent.settings.aboutEn').fill('The city of old, mapped.');
        for (const [n, ro, en] of [
            ['1', 'Arhiva Națională', 'National Archives'],
            ['2', 'Voluntarii hărții', 'The map volunteers'],
        ] as const) {
            await button(page, lang, 'adminContent.settings.addCredit').click();
            await fieldOf(page, lang, 'adminContent.settings.creditRo', { n }).fill(ro);
            await fieldOf(page, lang, 'adminContent.settings.creditEn', { n }).fill(en);
        }
        await save(page, lang);

        // The colour: a preset seed, saved.
        await page.goto(content.address(lang, 'settings/theme', { map: false }));
        await page.getByRole('button', { name: text(lang, 'adminContent.settings.preset', { hex: SEED }) }).click();
        await save(page, lang);

        // The manifest carries all of it; the viewer opens in the new area with the new name, About, credits and colours.
        const manifest = await awaitManifest(content, 'carries the new settings', (built) => {
            const city = built['city'] as Json;
            return (city['theme'] as Json | undefined)?.['seedColor'] === SEED && JSON.stringify(city).includes('Voluntarii');
        });
        const city = manifest['city'] as Json;
        expect(city).toMatchObject({
            // The manifest's bounds are a box, [[west, south], [east, north]].
            bounds: [
                [bounds.west, bounds.south],
                [bounds.east, bounds.north],
            ],
            zoom: 14,
            name: { ro: 'Bucureștiul de altădată', en: 'Bucharest of old' },
            about: { ro: 'Harta orașului **de altădată**.', en: 'The city of old, mapped.' },
            credits: [
                { label: { ro: 'Arhiva Națională', en: 'National Archives' } },
                { label: { ro: 'Voluntarii hărții', en: 'The map volunteers' } },
            ],
        });
        const tokens = Object.values((city['theme'] as { tokens: Record<string, Record<string, string>> }).tokens);
        await openPublicViewer(page, manifest, { lang: 'en', hash: '14/44.43000/26.10000' });
        const primaries = tokens.map((scheme) => scheme[PRIMARY]?.toLowerCase());
        const primary = await viewer(page).evaluate(
            (host, token) => getComputedStyle(host).getPropertyValue(token).trim().toLowerCase(),
            PRIMARY,
        );
        expect(primaries).toContain(primary);
        await chooseMenuItem(page, 'en', t('en', 'about.title'));
        const dialog = viewer(page).locator('hcm-about-dialog');
        await expect(dialog.getByRole('heading', { name: 'Bucharest of old' })).toBeVisible();
        await expect(dialog.getByText('The city of old, mapped.')).toBeVisible();
        await expect(dialog.getByText('National Archives')).toBeVisible();
        await expect(dialog.getByText('The map volunteers')).toBeVisible();
    },
);

/** The city with a historical layer, a category with a place and the photos overlay, every default at 100 %. */
async function overlayCity(content: Parameters<typeof seedPublicCity>[0]): Promise<void> {
    await seedPublicCity(content, AT);
    await seedLayer(content, 'corona-1968', AT, { attribution: 'USGS EarthExplorer (e2e)' });
    await seedCategory(content, 'cladiri', AT);
    await seedPlace(content, 'ateneu', AT, { category: 'cladiri', lat: 44.441, lng: 26.097, title: 'Ateneul Român' });
}

/** The opacities the admin map paints now: the layer, the photos' markers, the category's circles. */
function mapOpacities(page: Page): Promise<number[]> {
    return Promise.all([
        rasterPaint(page, 'corona-1968', 'raster-opacity'),
        mapPaint(page, 'hcm-photos-marker', 'icon-opacity'),
        mapPaint(page, 'hcm-poi-cladiri-circle', 'circle-opacity'),
    ]).then((values) => values.map((value) => Math.round(Number(value ?? 1) * 100)));
}

/** The three sliders of the overlays section. */
function sliders(page: Page, lang: 'ro' | 'en'): { readonly layer: Locator; readonly photos: Locator; readonly category: Locator } {
    const slider = (name: string): Locator =>
        page.getByRole('slider', { name: text(lang, 'adminContent.settings.overlayOpacity', { name }) });
    return {
        layer: slider('Corona 1968'),
        photos: slider(t(lang, 'layers.photos')),
        category: slider(lang === 'en' ? 'Buildings' : 'Clădiri'),
    };
}

test(
    'Default opacities fade live on the admin map, are saved, and the viewer opens with them',
    { tag: ['@S-A36-HAPPY'] },
    async ({ page, lang, content }) => {
        test.setTimeout(240_000);
        await overlayCity(content);
        await page.goto(content.address(lang, 'settings/overlays'));
        await adminMapReady(page);
        await expect.poll(() => mapOpacities(page)).toEqual([100, 100, 100]);

        const { layer, photos, category } = sliders(page, lang);
        await setPercent(layer, 40);
        await setPercent(photos, 60);
        await setPercent(category, 30);
        await expect.poll(() => mapOpacities(page)).toEqual([40, 60, 30]);
        await save(page, lang);
        await expect.poll(async () => (await content.document('layers/corona-1968'))?.['opacity']).toBe(0.4);
        await expect.poll(async () => (await content.document())?.['photosOverlay']).toEqual({ defaultOpacity: 0.6 });
        await expect.poll(async () => (await content.document('poiCategories/cladiri'))?.['defaultOpacity']).toBe(0.3);

        const manifest = await awaitManifest(content, 'carries the new defaults', (built) => {
            const categories = (built['poiCategories'] ?? []) as Json[];
            return Math.abs(Number(categories[0]?.['defaultOpacity']) - 0.3) < 1e-9;
        });
        expect(entry(manifest, 'layers', 'corona-1968')).toMatchObject({ opacity: 0.4 });
        expect(manifest['photosOverlay']).toMatchObject({ defaultOpacity: 0.6 });
        await openPublicViewer(page, manifest, { lang, hash: '15/44.43000/26.10000&layers=corona-1968' });
        await expectColourAt(
            page,
            await mapFraction(page, 0.5, 0.5),
            blend(E2E_USER_TILESET_COLOUR, BASEMAP_BACKGROUND, 0.4),
            'the layer at 40 %',
            { tolerance: 10 },
        );
        await openLayers(page, lang);
        await expect(opacitySlider(page, lang, 'Corona 1968')).toHaveAttribute('aria-valuenow', '40');
        await expect(opacitySlider(page, lang, t(lang, 'layers.photos'))).toHaveAttribute('aria-valuenow', '60');
        await expect(opacitySlider(page, lang, lang === 'en' ? 'Buildings' : 'Clădiri')).toHaveAttribute('aria-valuenow', '30');
    },
);

test(
    'Unsaved default opacities are discarded: the map returns to the stored ones, nothing is written',
    { tag: ['@S-A36-BAD-DISCARD'] },
    async ({ page, lang, content }) => {
        test.setTimeout(150_000);
        await overlayCity(content);
        await page.goto(content.address(lang, 'settings/overlays'));
        await adminMapReady(page);
        const { layer, category } = sliders(page, lang);
        await setPercent(layer, 20);
        await setPercent(category, 50);
        await expect.poll(() => mapOpacities(page)).toEqual([20, 100, 50]);

        await button(page, lang, 'adminContent.common.discard').click();
        await expect.poll(() => mapOpacities(page)).toEqual([100, 100, 100]);
        await expect(layer).toHaveAttribute('aria-valuenow', '100');
        expect((await content.document('layers/corona-1968'))?.['opacity']).toBe(1);
        expect((await content.document('poiCategories/cladiri'))?.['defaultOpacity']).toBe(1);
    },
);
