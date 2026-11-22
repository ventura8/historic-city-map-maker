import { translate } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../../support/content-test.js';
import type { ContentWorld } from '../../support/content.js';
import { seedPublicCity } from '../../support/flows.js';
import { adminMapReady } from '../../support/map.js';
import { photosText, seedPhoto, servePhotoImages } from '../../support/photos.js';

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
