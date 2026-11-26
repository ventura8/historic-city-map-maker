import type { Route } from '@playwright/test';

import { expect, test } from '../../support/content-test.js';
import { shellText } from '../../support/i18n.js';
import { jpegBytes, photoFile } from '../../support/images.js';
import { newAdminBanner, redeployAdmin, serveInstallBundle, setTabVisibility } from '../../support/install.js';
import { photoInput, photosText, seedPhotosCity, servePhotoImages, uploadItem } from '../../support/photos.js';

/**
 * A newer admin served while an upload is still being sent (M18 item 1, behaviour A61; `packages/admin/src/app/mount.ts`
 * holds the self-reload while `content.busy()`): coming back to the tab does not reload it, which would drop the upload,
 * but puts up the Reload banner instead; and the unsaved guard, which asks only about edits, asks nothing about the
 * upload when the admin moves to another page. The upload is held open at the network (the Storage emulator's request
 * never answered until the end), the only way the e2e world keeps a file "being sent" across a deploy.
 */

const AT = new Date('2026-10-17T09:00:00.000Z');
/** The photo uploads to the Storage emulator (a small file goes as one multipart request). */
const UPLOAD = /\/v0\/b\/[^/]+\/o\?.*name=uploads/;
/** The release Hosting serves after the redeploy. */
const NEWER = '1.0.1+e2e0002';

test(
    'An upload still being sent holds the self-reload back: the Reload banner instead, and the unsaved guard asks nothing',
    { tag: ['@S-A61-BAD-UPLOAD-HOLDS-RELOAD'] },
    async ({ page, lang, content, consoleErrors }, testInfo) => {
        await serveInstallBundle(page);
        await page.clock.install();
        await servePhotoImages(page);
        await seedPhotosCity(content, AT);
        await page.goto(content.address(lang, 'photos', { map: false }));
        await page.clock.resume();
        await expect(page.getByText(photosText(lang, 'adminContent.photos.empty'))).toBeVisible();
        const held: Route[] = [];
        await page.route(UPLOAD, (route) => {
            held.push(route);
        });
        await photoInput(page).setInputFiles(await photoFile(testInfo, 'Ateneul.jpg', await jpegBytes('#8b5e3c')));
        await expect.poll(() => held.length).toBe(1);
        const sending = photosText(lang, 'adminContent.photos.upload.uploading', { percent: '\u0000' }).split('\u0000')[0] ?? '';
        await expect(uploadItem(page, 'Ateneul.jpg')).toContainText(sending);
        await page.evaluate(() => {
            Object.assign(window, { hcmBeforeDeploy: true });
        });
        const dialogs: string[] = [];
        page.on('dialog', (dialog) => {
            dialogs.push(dialog.type());
            void dialog.dismiss();
        });

        await redeployAdmin(page, NEWER);
        await setTabVisibility(page, 'hidden');
        await page.clock.fastForward(2 * 60_000);
        await setTabVisibility(page, 'visible');

        await expect(newAdminBanner(page)).toContainText(shellText(lang, 'adminShell.update.ready'));
        expect(await page.evaluate(() => 'hcmBeforeDeploy' in window), 'the page did not reload').toBe(true);
        await expect(uploadItem(page, 'Ateneul.jpg')).toContainText(sending);

        // The unsaved guard is about edits only: moving to Places while the file is still being sent asks nothing.
        await page.evaluate(() => {
            window.location.hash = '#/pois';
        });
        await expect(page.getByRole('heading', { level: 1, name: shellText(lang, 'adminShell.nav.pois') })).toBeVisible();
        await expect(page.locator('hcm-dialog[open]')).toHaveCount(0);
        expect(dialogs).toEqual([]);
        expect(await page.evaluate(() => 'hcmBeforeDeploy' in window)).toBe(true);

        await held[0]?.abort('internetdisconnected');
        await expect.poll(() => consoleErrors.takeMatching(/ERR_INTERNET_DISCONNECTED/).length).toBeGreaterThan(0);
    },
);
