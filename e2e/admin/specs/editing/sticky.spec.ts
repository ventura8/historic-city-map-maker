import { expect, test } from '../../support/content-test.js';
import { seedPublicCity } from '../../support/flows.js';
import { jpegBytes, photoFile } from '../../support/images.js';
import { awaitProcessed, photoInput, photosText, seedPhoto, servePhotoImages } from '../../support/photos.js';
import { poisText, seedCategories } from '../pois/places.js';

/**
 * What the editors remember per admin (docs/research/M2c-interfaces.md §5.6; behaviour A30), in a city of the admin's own:
 * the author, source and licence of the last photo saved and its place become the next upload's, and the category of the
 * last place saved the next place's, across a reload, with nothing typed again.
 */

const AT = new Date('2026-10-17T09:00:00.000Z');
const PIN = { lat: 44.4392, lng: 26.0975 };

test(
    'After a reload the next upload carries the last author, source, licence and pin, and a new place the last category',
    {
        tag: ['@S-A30-BAD-STICKY-FIELDS'],
    },
    async ({ page, lang, content, consoleErrors }, testInfo) => {
        test.setTimeout(150_000);
        await servePhotoImages(page);
        await seedPublicCity(content, AT);
        await seedCategories(content, AT);
        await seedPhoto(content, { id: 'cv', title: 'Calea Victoriei' }, AT);

        // A photo's author, source, licence and place, saved.
        await page.goto(content.address(lang, 'photos/cv', { map: false }));
        const editor = page.locator('hcm-admin-photo-editor');
        const field = (key: Parameters<typeof photosText>[1]) => editor.getByLabel(photosText(lang, key), { exact: true });
        await field('adminContent.photos.field.author').fill('Ion Popescu');
        await field('adminContent.photos.field.sourceLabel').fill('Arhiva Națională');
        await field('adminContent.photos.field.sourceUrl').fill('https://arhiva.example/cv');
        await field('adminContent.photos.field.license').selectOption('CC0');
        await field('adminContent.photos.field.lat').fill(String(PIN.lat));
        await field('adminContent.photos.field.lng').fill(String(PIN.lng));
        await page.getByRole('button', { name: photosText(lang, 'adminContent.photos.editor.save'), exact: true }).click();
        // The page says it is saved (the server may have the write a moment before the page has its answer; leaving
        // before that, while the Save is on its way, asks first).
        await expect(page.getByText(photosText(lang, 'adminContent.photos.saved')).first()).toBeVisible();
        expect((await content.document('photos/cv'))?.['author']).toBe('Ion Popescu');

        // A place in the markets, saved.
        await page.goto(content.address(lang, 'pois', { map: false }));
        await page.getByRole('button', { name: poisText(lang, 'adminContent.pois.add') }).click();
        await page.getByRole('button', { name: poisText(lang, 'adminContent.pois.shape.point'), exact: true }).click();
        await page.locator('hcm-poi-editor #category').selectOption('markets');
        await page.getByRole('button', { name: poisText(lang, 'adminContent.map.tool.addCentre') }).click();
        await page.getByRole('textbox', { name: poisText(lang, 'adminContent.pois.field.titleRo') }).fill('Hala Matache');
        await page.locator('hcm-poi-editor #yearStart').fill('1890');
        await page.getByRole('button', { name: poisText(lang, 'adminContent.common.save'), exact: true }).click();
        await expect(page.getByText(poisText(lang, 'adminContent.pois.state.saved'), { exact: true })).toBeVisible();
        expect(Object.keys(await content.collection('pois'))).toHaveLength(1);

        // A reload; then an upload without EXIF: the new photo has all of it, nothing typed.
        await page.reload();
        await page.goto(content.address(lang, 'photos', { map: false }));
        // The uploads panel says what a new photo gets.
        const licence = photosText(lang, 'adminContent.photos.license.CC0');
        const values = `Ion Popescu, Arhiva Națională, ${licence}`;
        await expect(page.getByText(photosText(lang, 'adminContent.photos.uploads.sticky', { values }), { exact: true })).toBeVisible();
        await photoInput(page).setInputFiles(await photoFile(testInfo, 'Hala_Matache.jpg', await jpegBytes('#556677')));
        await awaitProcessed(content, 2);
        const added = Object.entries(await content.collection('photos')).find(([id]) => id !== 'cv')?.[1];
        expect(added).toMatchObject({
            author: 'Ion Popescu',
            sourceLabel: 'Arhiva Națională',
            sourceUrl: 'https://arhiva.example/cv',
            license: 'CC0',
            location: PIN,
        });

        // A new place starts in the markets.
        await page.goto(content.address(lang, 'pois', { map: false }));
        await page.getByRole('button', { name: poisText(lang, 'adminContent.pois.add') }).click();
        await page.getByRole('button', { name: poisText(lang, 'adminContent.pois.shape.point'), exact: true }).click();
        await expect(page.locator('hcm-poi-editor #category')).toHaveValue('markets');
        // WebKit reports Firestore's listen channel, cancelled by the reload, as a fetch refused by access control checks.
        consoleErrors.takeMatching(/Fetch API cannot load .*Firestore\/Listen\/channel.* due to access control checks/);
    },
);
