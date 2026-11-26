import { writeFile } from 'node:fs/promises';

import { PHOTO_LIMITS } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { contentFlowBudget } from '../../../../packages/admin/src/content/budgets.js';
import { expect, test } from '../../support/content-test.js';
import type { ContentWorld } from '../../support/content.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { heicBytes, jpegBytes, pdfBytes, photoFile, type PhotoExif } from '../../support/images.js';
import {
    awaitProcessed,
    photoError,
    photoInput,
    photosBy,
    photoRow,
    photosText,
    rememberPhotoChoices,
    seedPhoto,
    seedPhotosCity,
    servePhotoImages,
    uploadItem,
} from '../../support/photos.js';

/**
 * Adding photos (docs/research/M2c-interfaces.md §6.2; behaviour A08) in a city of the admin's own (the content world):
 * a batch of JPEGs is uploaded through the list's file input, each gets its photo document with the author, source and
 * licence the admin chose last time and the last pin, `photos.onUpload` processes it in the Functions emulator, and the
 * area applies what the file says (the place, the year, the camera's direction, a title from the file name) to the photos
 * nobody touched; one without a usable place stays at the last pin until its place is confirmed. A duplicate, an HEIC
 * file, a PDF named like a photo and a file over the Storage rules' limit are each refused with their reason. Every image
 * is generated at run time (e2e/admin/support/images.ts).
 */

const AT = new Date('2026-10-17T09:00:00.000Z');

/** What the admin chose for the previous photos, as an earlier session left it in this browser. */
const STICKY = { author: 'Arhiva E2E', sourceLabel: 'Colecția E2E', sourceUrl: 'https://arhiva.example/e2e', license: 'CC-BY-4.0' };
/** Where the admin last put a pin: Piața Universității. */
const LAST_PIN = [26.1025, 44.4355] as const;

interface Upload {
    readonly name: string;
    readonly colour: string;
    readonly exif?: PhotoExif;
}

/** Generates the uploads as files of the test's output folder, in order. */
async function files(uploads: readonly Upload[]): Promise<string[]> {
    const info = test.info();
    return Promise.all(uploads.map(async (upload) => photoFile(info, upload.name, await jpegBytes(upload.colour, upload.exif))));
}

async function openPhotos(page: Page, content: ContentWorld, lang: 'ro' | 'en'): Promise<void> {
    await servePhotoImages(page);
    await seedPhotosCity(content, AT);
    await page.goto(content.address(lang, 'photos', { map: false }));
    await expect(page.getByText(photosText(lang, 'adminContent.photos.empty'))).toBeVisible();
}

test(
    'Three photos with EXIF are placed, dated and turned from their files and published in three inputs',
    { tag: ['@S-A08-HAPPY'] },
    async ({ page, lang, content, inputBudget }) => {
        test.setTimeout(150_000);
        await rememberPhotoChoices(page, { sticky: STICKY, lastPin: LAST_PIN });
        await openPhotos(page, content, lang);
        const batch = await files([
            {
                name: 'Calea_Victoriei_1977.jpg',
                colour: '#8b5e3c',
                exif: { at: [26.0967, 44.4378], taken: '1977:03:04 12:00:00', direction: 90 },
            },
            { name: 'Piata_Romana.jpg', colour: '#5e3c8b', exif: { at: [26.0965, 44.4466], taken: '1968:05:01 09:30:00', direction: 180 } },
            { name: 'Gara_de_Nord.jpg', colour: '#3c8b5e', exif: { at: [26.0726, 44.4467], taken: '1955:11:20 16:00:00', direction: 270 } },
        ]);

        // The files (one input): three photo documents at once, each with the remembered author, source and licence.
        const flow = inputBudget.flow('photoBatch', contentFlowBudget('photoBatch'));
        await flow.setInputFiles(photoInput(page), batch);
        await expect
            .poll(async () => (await photosBy(content, 'author')).map(([, author]) => author))
            .toEqual(['Arhiva E2E', 'Arhiva E2E', 'Arhiva E2E']);
        expect((await photosBy(content, 'license')).map(([, license]) => license)).toEqual(['CC-BY-4.0', 'CC-BY-4.0', 'CC-BY-4.0']);

        // Processed: each takes its place, year, direction and a title from its file, none moved by hand.
        await awaitProcessed(content, 3);
        await expect
            .poll(() => photosBy(content, 'location'))
            .toEqual([
                ['Calea Victoriei 1977', { lat: 44.4378, lng: 26.0967 }],
                ['Gara de Nord', { lat: 44.4467, lng: 26.0726 }],
                ['Piata Romana', { lat: 44.4466, lng: 26.0965 }],
            ]);
        expect(await photosBy(content, 'year')).toEqual([
            ['Calea Victoriei 1977', 1977],
            ['Gara de Nord', 1955],
            ['Piata Romana', 1968],
        ]);
        expect(await photosBy(content, 'bearing')).toEqual([
            ['Calea Victoriei 1977', 90],
            ['Gara de Nord', 270],
            ['Piata Romana', 180],
        ]);
        for (const title of ['Calea Victoriei 1977', 'Gara de Nord', 'Piata Romana']) {
            await expect(photoRow(page, title)).toBeVisible();
        }

        // Select all, Publish: the three are published.
        await flow.click(page.getByRole('button', { name: photosText(lang, 'adminContent.photos.bulk.selectAll') }));
        await flow.click(page.getByRole('button', { name: photosText(lang, 'adminContent.photos.bulk.publishAction'), exact: true }));
        await expect.poll(async () => (await photosBy(content, 'published')).map(([, published]) => published)).toEqual([true, true, true]);
        expect(flow.used).toBe(3);
    },
);

test(
    'A photo without a place stays at the last pin until its place is confirmed, and Publish skips it meanwhile',
    { tag: ['@S-A08-BAD-NO-EXIF'] },
    async ({ page, lang, content, inputBudget }) => {
        test.setTimeout(120_000);
        await rememberPhotoChoices(page, { sticky: STICKY, lastPin: LAST_PIN });
        await openPhotos(page, content, lang);
        const flow = inputBudget.flow('photoWithoutExif', contentFlowBudget('photoWithoutExif'));
        await flow.setInputFiles(photoInput(page), await files([{ name: 'Strada_Lipscani.jpg', colour: '#777777' }]));
        await awaitProcessed(content, 1);

        // No EXIF position: the photo stays at the last pin, marked to check.
        expect(await photosBy(content, 'location')).toEqual([['Strada Lipscani', { lat: LAST_PIN[1], lng: LAST_PIN[0] }]]);
        const row = photoRow(page, 'Strada Lipscani');
        await expect(row.getByText(photosText(lang, 'adminContent.photos.chip.checkPlace'))).toBeVisible();

        // Publish skips it and says why.
        await page.getByRole('button', { name: photosText(lang, 'adminContent.photos.bulk.selectAll') }).click();
        await page.getByRole('button', { name: photosText(lang, 'adminContent.photos.bulk.publishAction'), exact: true }).click();
        await page.getByRole('button', { name: photosText(lang, 'adminContent.photos.bulk.seeWhy') }).click();
        const reason = photosText(lang, 'adminContent.photos.reason.line', {
            title: 'Strada Lipscani',
            reason: photosText(lang, 'adminContent.photos.reason.place'),
        });
        await expect(page.locator('hcm-dialog.report').getByText(reason)).toBeVisible();
        await page.keyboard.press('Escape');
        expect(await photosBy(content, 'published')).toEqual([['Strada Lipscani', false]]);
        await page.getByRole('button', { name: photosText(lang, 'adminContent.photos.bulk.clear') }).click();

        // Confirm place at the last pin: the next Publish publishes it (four inputs in all).
        await flow.click(row.getByRole('button', { name: photosText(lang, 'adminContent.photos.confirmPlace') }));
        await expect(row.getByText(photosText(lang, 'adminContent.photos.chip.checkPlace'))).toHaveCount(0);
        await flow.click(page.getByRole('button', { name: photosText(lang, 'adminContent.photos.bulk.selectAll') }));
        await flow.click(page.getByRole('button', { name: photosText(lang, 'adminContent.photos.bulk.publishAction'), exact: true }));
        await expect.poll(() => photosBy(content, 'published')).toEqual([['Strada Lipscani', true]]);
    },
);

test(
    'A photo uploaded twice is refused as a duplicate with a link to the first, and Delete removes it',
    { tag: ['@S-A08-BAD-DUPLICATE'] },
    async ({ page, lang, content }, testInfo) => {
        test.setTimeout(120_000);
        await openPhotos(page, content, lang);
        const bytes = await jpegBytes('#8b5e3c', { at: [26.0967, 44.4378] });
        await photoInput(page).setInputFiles(await photoFile(testInfo, 'Ateneul_Roman.jpg', bytes));
        await awaitProcessed(content, 1);
        const [first = ''] = Object.keys(await content.collection('photos'));

        // The same bytes under another name: refused by the server's sniffing, with a link to the photo it repeats.
        await photoInput(page).setInputFiles(await photoFile(testInfo, 'Ateneul_Roman_copie.jpg', bytes));
        const item = uploadItem(page, 'Ateneul_Roman_copie.jpg');
        await expect(item.getByText(photoError(lang, 'apiError.photo.duplicate'))).toBeVisible();
        await expect(item.getByRole('link', { name: photosText(lang, 'adminContent.photos.openDuplicate') })).toHaveAttribute(
            'href',
            `#/photos/${first}`,
        );
        const copies = Object.entries(await content.collection('photos')).filter(([id]) => id !== first);
        expect(copies.map(([, photo]) => [photo['processing'], photo['duplicateOf'], photo['image']])).toEqual([
            ['failed', first, undefined],
        ]);

        // Its row offers Delete: asked first, then the refused copy is gone and the first photo stays.
        const [copy = ''] = copies.map(([id]) => id);
        const title = (copies[0]?.[1]['title'] as { ro: string }).ro;
        await photoRow(page, title)
            .getByRole('button', { name: photosText(lang, 'adminContent.photos.deleteOne', { title }) })
            .click();
        await page
            .locator('hcm-confirm-dialog')
            .getByRole('button', { name: photosText(lang, 'adminContent.photos.delete.confirm'), exact: true })
            .click();
        await expect.poll(async () => Object.keys(await content.collection('photos'))).toEqual([first]);
        expect(copy).not.toBe(first);
    },
);

test(
    'An HEIC photo and a PDF named like a photo are refused with what to do, and their drafts can be deleted',
    { tag: ['@S-A08-BAD-UNSUPPORTED-TYPE'] },
    async ({ page, lang, content }, testInfo) => {
        test.setTimeout(180_000);
        await openPhotos(page, content, lang);
        await photoInput(page).setInputFiles([
            await photoFile(testInfo, 'vacanta.heic', heicBytes()),
            await photoFile(testInfo, 'scanare.jpg', pdfBytes()),
        ]);

        // The server decides by the bytes (photos.onUpload): an HEIC file is explained, a PDF is no photo whatever its name.
        const decided = { timeout: FUNCTIONS_TIMEOUT_MS };
        await expect(uploadItem(page, 'vacanta.heic').getByText(photoError(lang, 'apiError.photo.heicUnsupported'))).toBeVisible(decided);
        await expect(uploadItem(page, 'scanare.jpg').getByText(photoError(lang, 'apiError.photo.unsupportedType'))).toBeVisible(decided);
        await expect
            .poll(async () => (await photosBy(content, 'processingError')).map(([, error]) => error), decided)
            .toEqual(['apiError.photo.unsupportedType', 'apiError.photo.heicUnsupported']);

        // Each refused draft's row offers Delete.
        for (const title of ['scanare', 'vacanta']) {
            await photoRow(page, title)
                .getByRole('button', { name: photosText(lang, 'adminContent.photos.deleteOne', { title }) })
                .click();
            await page
                .locator('hcm-confirm-dialog')
                .getByRole('button', { name: photosText(lang, 'adminContent.photos.delete.confirm'), exact: true })
                .click();
            await expect(photoRow(page, title)).toHaveCount(0);
        }
        await expect.poll(() => content.collection('photos')).toEqual({});
    },
);

test(
    'A file over the upload limit is refused in the page before anything is written',
    { tag: ['@S-A08-BAD-OVER-SIZE'] },
    async ({ page, lang, content }, testInfo) => {
        await openPhotos(page, content, lang);
        const big = testInfo.outputPath('scan-mare.jpg');
        await writeFile(big, Buffer.alloc(PHOTO_LIMITS.maxUploadBytes + 1));

        await photoInput(page).setInputFiles(big);

        const item = uploadItem(page, 'scan-mare.jpg');
        await expect(item.getByText(photosText(lang, 'adminContent.photos.tooBig', { size: '60' }))).toBeVisible();
        await expect(item.getByText(photosText(lang, 'adminContent.photos.upload.refused'))).toBeVisible();
        expect(await content.collection('photos')).toEqual({});
    },
);

test(
    'An EXIF place outside the city is not applied: the photo stays at the last pin and the editor says why',
    { tag: ['@S-A08-BAD-EXIF-OUTSIDE-CITY'] },
    async ({ page, lang, content }) => {
        test.setTimeout(120_000);
        await rememberPhotoChoices(page, { sticky: STICKY, lastPin: LAST_PIN });
        await openPhotos(page, content, lang);
        await photoInput(page).setInputFiles(
            await files([
                { name: 'Cazinoul_din_Constanta.jpg', colour: '#334455', exif: { at: [28.6625, 44.1733], taken: '1965:07:10 10:00:00' } },
            ]),
        );
        await awaitProcessed(content, 1);

        // The year is applied; the place is not: the photo stays at the last pin, marked to check.
        await expect.poll(() => photosBy(content, 'year')).toEqual([['Cazinoul din Constanta', 1965]]);
        expect(await photosBy(content, 'location')).toEqual([['Cazinoul din Constanta', { lat: LAST_PIN[1], lng: LAST_PIN[0] }]]);
        const row = photoRow(page, 'Cazinoul din Constanta');
        await expect(row.getByText(photosText(lang, 'adminContent.photos.chip.checkPlace'))).toBeVisible();

        // Its editor shows the file's place with the reason, and no Apply for it.
        await row.getByRole('link').click();
        const place = photosText(lang, 'adminContent.photos.suggestion.location', { value: '44.1733, 28.6625' });
        const suggestion = page.locator('hcm-admin-photo-editor li.upload').filter({ hasText: place });
        await expect(suggestion).toBeVisible();
        await expect(suggestion.getByText(photosText(lang, 'adminContent.photos.suggestion.outside'))).toBeVisible();
        await expect(suggestion.getByRole('button', { name: photosText(lang, 'adminContent.photos.suggestion.apply') })).toHaveCount(0);
    },
);

test(
    'However many photos wait for their place, each keeps its mark until its own place is confirmed',
    { tag: ['@S-A08-BAD-CHECK-PLACE-KEPT', '@S-A08-HAPPY-CHECK-PLACE-CONFIRMED'] },
    async ({ page, lang, content }) => {
        await servePhotoImages(page);
        await seedPhotosCity(content, AT);
        await seedPhoto(content, { id: 'oldest-mark', title: 'Strada Lipscani' }, AT);
        await seedPhoto(content, { id: 'newest-mark', title: 'Piața Romană' }, AT);
        // As a browser that uploaded hundreds of photos without a place left it, the oldest mark first (a set of the page's own).
        const others = Array.from({ length: 600 }, (_unused, index) => `other-mark-${String(index)}`);
        const marks = JSON.stringify(['oldest-mark', ...others, 'newest-mark']);
        await page.addInitScript((stored) => {
            if (localStorage.getItem('hcm:admin:photoCheckPlace') === null) {
                localStorage.setItem('hcm:admin:photoCheckPlace', stored);
            }
        }, marks);
        await page.goto(content.address(lang, 'photos', { map: false }));
        const check = photosText(lang, 'adminContent.photos.chip.checkPlace');

        await expect(photoRow(page, 'Strada Lipscani').getByText(check)).toBeVisible();
        await expect(photoRow(page, 'Piața Romană').getByText(check)).toBeVisible();

        // Confirming one lifts that mark alone, also after a reload.
        await photoRow(page, 'Strada Lipscani')
            .getByRole('button', { name: photosText(lang, 'adminContent.photos.confirmPlace') })
            .click();
        await expect(photoRow(page, 'Strada Lipscani').getByText(check)).toHaveCount(0);
        await page.reload();
        await expect(photoRow(page, 'Piața Romană').getByText(check)).toBeVisible();
        await expect(photoRow(page, 'Strada Lipscani').getByText(check)).toHaveCount(0);
    },
);
