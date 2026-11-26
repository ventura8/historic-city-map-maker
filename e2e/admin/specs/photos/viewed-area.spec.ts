import { translate } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../../support/content-test.js';
import type { ContentWorld } from '../../support/content.js';
import { seedPublicCity } from '../../support/flows.js';
import { adminMapReady, photoMarker, rasterPaint } from '../../support/map.js';
import { photosText, seedPhoto, servePhotoImages } from '../../support/photos.js';

import { seedLayer } from '../settings/world.js';

/**
 * A195 (the owner, 2026-11-22): an aerial photo's viewed area in the photo editor. Draw puts a four-corner trapezoid in
 * front of the camera and Save writes it; a crossed area says why under the section and is not saved.
 */

const AT = new Date('2026-10-17T09:00:00.000Z');
const START = { lat: 44.43, lng: 26.1 };

async function openAerial(page: Page, content: ContentWorld, lang: 'ro' | 'en', extra: Record<string, unknown>): Promise<void> {
    await servePhotoImages(page);
    await seedPublicCity(content, AT);
    await seedPhoto(content, { id: 'air', title: 'Gara de Nord', extra: { location: START, bearing: 0, kind: 'aerial', ...extra } }, AT);
    await page.goto(content.address(lang, 'photos/air'));
    await expect(
        page.getByRole('heading', { name: photosText(lang, 'adminContent.photos.editor.title', { title: 'Gara de Nord' }) }),
    ).toBeVisible();
    await adminMapReady(page);
}

function areaSection(page: Page): Locator {
    return page.locator('hcm-admin-photo-editor [data-area]');
}

test(
    'The admin draws the area of an aerial photo in front of the camera and saves it',
    { tag: ['@S-A195-HAPPY-DRAW'] },
    async ({ page, lang, content }) => {
        await openAerial(page, content, lang, {});

        await areaSection(page)
            .getByRole('button', { name: photosText(lang, 'adminContent.photos.area.draw') })
            .click();
        await expect(areaSection(page).getByRole('button', { name: photosText(lang, 'adminContent.photos.area.remove') })).toBeVisible();
        await page.getByRole('button', { name: photosText(lang, 'adminContent.photos.editor.save'), exact: true }).click();

        await expect.poll(async () => ((await content.document('photos/air'))?.['viewedArea'] as unknown[] | undefined)?.length).toBe(4);
        const [nearLeft, farLeft] = (await content.document('photos/air'))?.['viewedArea'] as { lat: number }[];
        // In front of the camera (north): the far corners lie further north than the near ones.
        expect(farLeft?.lat ?? 0).toBeGreaterThan(nearLeft?.lat ?? 0);
    },
);

test('A crossed viewed area says why and is not saved', { tag: ['@S-A195-BAD-SHAPE'] }, async ({ page, lang, content }) => {
    const crossed = [
        { lat: 44.431, lng: 26.099 },
        { lat: 44.434, lng: 26.103 },
        { lat: 44.434, lng: 26.097 },
        { lat: 44.431, lng: 26.101 },
    ];
    await openAerial(page, content, lang, { viewedArea: crossed });

    await expect(areaSection(page).getByRole('alert')).toContainText(translate(lang, 'validation.viewedArea'));
    await areaSection(page)
        .getByRole('button', { name: photosText(lang, 'adminContent.photos.area.reset') })
        .click();
    await expect(areaSection(page).getByRole('alert')).toHaveCount(0);
});

test('A satellite layer helps place a photo on the same map', { tag: '@S-A195-HAPPY-BACKGROUND' }, async ({ page, content, lang }) => {
    await seedLayer(content, 'corona', AT);
    await seedLayer(content, 'survey', AT, { year: 1992, label: { ro: 'Atlas 1992' } });
    await seedLayer(content, 'b-scan', AT, { year: 1992, date: '1992-05-01', label: { ro: 'Scan B' } });
    await seedLayer(content, 'a-scan', AT, { year: 1992, date: '1992-05-01', label: { ro: 'Scan A' } });
    await seedLayer(content, 'autumn', AT, { year: 1992, date: '1992-10-23', label: { ro: 'Scan Oct' } });
    await openAerial(page, content, lang, {});
    const picker = page.getByRole('combobox', { name: photosText(lang, 'adminContent.photos.map.background') });
    await expect(picker.locator('option')).toHaveText([
        'Scan Oct',
        'Scan A',
        'Scan B',
        'Atlas 1992',
        'Corona 1968',
        photosText(lang, 'adminContent.photos.map.satellite'),
        photosText(lang, 'adminContent.settings.basemap.standard'),
    ]);
    await expect(picker).toHaveValue('');
    await picker.selectOption('corona');
    await expect.poll(() => rasterPaint(page, 'corona', 'raster-opacity')).toBe(1);
    await expect.poll(() => photoMarker(page, 'air')).toEqual([START.lng, START.lat]);
    await picker.selectOption('');
    await expect.poll(() => rasterPaint(page, 'corona', 'raster-opacity')).toBeUndefined();
    await adminMapReady(page);
});

test(
    'Without saved layers the editor places a photo against current satellite imagery',
    { tag: '@S-A195-BAD-NO-BACKGROUND' },
    async ({ page, content, lang }) => {
        const satellite = 'mapbox.satellite';
        let reads = 0;
        // Only this photo scenario answers the real provider address locally; georeferencing keeps the firewall.
        await page.route('https://api.mapbox.com/v4/mapbox.satellite.json*', (route) => {
            reads += 1;
            return route.fulfill({
                json: {
                    tilejson: '2.2.0',
                    tiles: ['https://api.mapbox.com/v4/e2e-user.satellite/{z}/{x}/{y}.webp'],
                    attribution: 'Photo imagery test provider',
                },
            });
        });
        await openAerial(page, content, lang, {});
        const picker = page.getByRole('combobox', { name: photosText(lang, 'adminContent.photos.map.background') });
        await expect(picker.locator('option')).toHaveText([
            photosText(lang, 'adminContent.photos.map.satellite'),
            photosText(lang, 'adminContent.settings.basemap.standard'),
        ]);
        await expect(picker).toHaveValue('');
        expect(reads).toBe(0);
        await picker.selectOption({ label: photosText(lang, 'adminContent.photos.map.satellite') });
        await expect.poll(() => reads).toBeGreaterThan(0);
        await adminMapReady(page);
        await expect.poll(() => rasterPaint(page, satellite, 'raster-opacity')).toBe(1);
        await expect(page.locator('.mapboxgl-ctrl-attrib-inner')).toContainText('Photo imagery test provider');
        await expect.poll(() => photoMarker(page, 'air')).toEqual([START.lng, START.lat]);
        await picker.selectOption('');
        await expect.poll(() => rasterPaint(page, satellite, 'raster-opacity')).toBeUndefined();
    },
);
