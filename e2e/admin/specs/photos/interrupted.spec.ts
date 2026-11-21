import type { Page, Route } from '@playwright/test';

import { expect, test } from '../../support/content-test.js';
import { jpegBytes, photoFile } from '../../support/images.js';
import { awaitProcessed, photoInput, photosText, seedPhotosCity, servePhotoImages, uploadItem } from '../../support/photos.js';

/**
 * An upload the network drops (docs/research/M2c-interfaces.md §6.2; behaviour A08), in a city of the admin's own. Firebase
 * Storage's upload retries a dropped request by itself: a short drop resumes once the network is back, with nothing to do;
 * a drop longer than the SDK's retry time (ten minutes, run on the page's clock) leaves the item "interrupted" with Retry,
 * which sends the file again into the same photo document. Either way the city ends with one photo document and one
 * original per file.
 */

const AT = new Date('2026-10-17T09:00:00.000Z');

/** The photo uploads to the Storage emulator (a small file goes as one multipart request). */
const UPLOAD = /\/v0\/b\/[^/]+\/o\?.*name=uploads/;

/** The network drops every upload request while `down` says so; returns how many it dropped. */
async function dropUploads(page: Page, down: () => boolean): Promise<() => number> {
    let dropped = 0;
    await page.route(UPLOAD, async (route: Route) => {
        if (down()) {
            dropped += 1;
            await route.abort('internetdisconnected');
            return;
        }
        await route.fallback();
    });
    return () => dropped;
}

test(
    'A dropped upload resumes by itself once the network is back; one dropped too long says so and Retry sends it once',
    { tag: ['@S-A08-BAD-UPLOAD-INTERRUPTED'] },
    async ({ page, lang, content, consoleErrors }, testInfo) => {
        test.setTimeout(180_000);
        await page.clock.install();
        await servePhotoImages(page);
        await seedPhotosCity(content, AT);
        await page.goto(content.address(lang, 'photos', { map: false }));
        await page.clock.resume();
        await expect(page.getByText(photosText(lang, 'adminContent.photos.empty'))).toBeVisible();

        // A short drop: the first request fails, the SDK's next attempt goes through.
        let down = true;
        const dropped = await dropUploads(page, () => down);
        await photoInput(page).setInputFiles(await photoFile(testInfo, 'Ateneul.jpg', await jpegBytes('#8b5e3c')));
        await expect.poll(dropped).toBe(1);
        down = false;
        await page.clock.fastForward('00:10');
        await awaitProcessed(content, 1);
        await expect(uploadItem(page, 'Ateneul.jpg').getByRole('button', { name: /Ateneul/ })).not.toContainText(
            photosText(lang, 'adminContent.photos.upload.retry', { name: 'Ateneul.jpg' }),
        );

        // A drop longer than the SDK's retry time: the item says the upload was interrupted and offers Retry.
        down = true;
        await photoInput(page).setInputFiles(await photoFile(testInfo, 'Gara_de_Nord.jpg', await jpegBytes('#3c8b5e')));
        await expect.poll(dropped).toBe(2);
        await page.clock.fastForward('11:00');
        const item = uploadItem(page, 'Gara_de_Nord.jpg');
        await expect(item).toContainText(photosText(lang, 'adminContent.photos.upload.interrupted'));

        // The network is back: Retry sends it into the photo document it already has.
        down = false;
        await item
            .getByRole('button', { name: photosText(lang, 'adminContent.photos.upload.retry', { name: 'Gara_de_Nord.jpg' }) })
            .click();
        await awaitProcessed(content, 2);
        expect(Object.keys(await content.collection('photos'))).toHaveLength(2);
        const originals = await content.emulators.objectNames(`originals/photos/${content.city}/`);
        expect(originals.map((name) => name.split('/')[3] ?? '').sort((a, b) => a.localeCompare(b))).toEqual(
            Object.keys(await content.collection('photos')).sort((a, b) => a.localeCompare(b)),
        );
        expect(consoleErrors.takeMatching(/ERR_INTERNET_DISCONNECTED/).length).toBeGreaterThan(0);
    },
);
