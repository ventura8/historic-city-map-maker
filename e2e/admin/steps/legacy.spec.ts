import type { Locator, Page, Request, Route } from '@playwright/test';

import { STUCK_PHOTO_MS } from '../../../packages/admin/src/import/legacy-import.js';
import { apiText, setupText } from '../support/i18n.js';
import { LEGACY_PHOTOS, countUploads, importCard, imported, legacyPhotos } from '../support/legacy-import.js';
import { SetupPage } from '../support/setup-page.js';
import { seedClaimedCity, seedSetupStatus } from '../support/steps.js';
import { ADMIN_LOCK, expect, test } from '../support/test.js';
import { emulatorOrigin } from '../world.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The legacy Bucharest import (docs/research/M2b-interfaces.md §3.3 h; behaviour A28) on a claimed map: one click
 * creates a photo document per bundled record and uploads its original through the normal path, `photos.onUpload`
 * processes it in the Functions emulator, and the photo is published. It is idempotent by document id and `legacyId`:
 * a second run writes nothing, a closed tab resumes with the photos that have no image, and a photo that fails
 * processing is listed with its reason while the others are imported. The old site's 2023 additions and the owner's
 * edits: legacy-additions.spec.ts.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

test.beforeEach(async ({ adminWorld }) => {
    await seedClaimedCity(adminWorld.emulators, adminWorld.accounts.owner.uid);
    await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid);
});

test(
    'Importing again, from a tab opened before the first import ended, creates no document and uploads nothing',
    { tag: ['@S-A28-BAD-RERUN-IDEMPOTENT', '@S-A28-HAPPY-DONE-SNACKBAR'] },
    async ({ page, lang, adminWorld }) => {
        test.setTimeout(420_000);
        const second = await page.context().newPage();
        const first = await importCard(page, lang);
        const stale = await importCard(second, lang);
        await first.action.click();
        // M6 (finding 19): the end is said in the snackbar, announced, while Setup moves on to the next step.
        const done = setupText(lang, 'adminSetup.import.allOnMap', { count: String(LEGACY_PHOTOS) });
        await expect(snackbarMessage(page)).toHaveText(done, { timeout: 300_000 });
        await expect(new SetupPage(page, lang).open('legacyImport')).toHaveCount(0);
        await expect(page.locator('hcm-snackbar [aria-live]')).toHaveText(done);
        await imported(page, lang);
        const before = await legacyPhotos(adminWorld.emulators);

        // The other tab still offers the import: it finds every photo done.
        const uploads = countUploads(second);
        await stale.action.click();
        await imported(second, lang);
        expect(uploads()).toBe(0);
        expect(await legacyPhotos(adminWorld.emulators)).toEqual(before);
        expect(before).toHaveLength(LEGACY_PHOTOS);
    },
);

test(
    'An import whose tab closed resumes with the photos that have no image and finishes',
    { tag: ['@S-A28-BAD-RESUME'] },
    async ({ page, lang, adminWorld }) => {
        test.setTimeout(420_000);
        const first = await importCard(page, lang);
        await first.action.click();
        await expect
            .poll(async () => (await legacyPhotos(adminWorld.emulators)).filter((photo) => photo.image).length, { timeout: 120_000 })
            .toBeGreaterThan(5);
        await page.close();
        const withImage = (await legacyPhotos(adminWorld.emulators)).filter((photo) => photo.image).length;

        const again = await page.context().newPage();
        const uploads = countUploads(again);
        const resumed = await importCard(again, lang);
        await resumed.action.click();
        await imported(again, lang);
        const photos = await legacyPhotos(adminWorld.emulators);
        expect(photos).toHaveLength(LEGACY_PHOTOS);
        expect(photos.every((photo) => photo.image && photo.published)).toBe(true);
        // Only the photos without an image when the tab closed were sent again.
        expect(uploads()).toBeLessThanOrEqual(LEGACY_PHOTOS - withImage);
    },
);

test(
    'A photo that fails processing is listed with its reason, and the other photos are imported and published',
    { tag: ['@S-A28-BAD-PROCESSING-FAILED', '@S-A28-BAD-PARTIAL-SNACKBAR'] },
    async ({ page, lang, adminWorld }) => {
        test.setTimeout(420_000);
        // One original is damaged on its way: its bytes are no image.
        let damaged: string | null = null;
        await page.route('**/legacy/bucharest/originals/**', async (route: Route) => {
            if (damaged === null) {
                damaged = new URL(route.request().url()).pathname;
                await route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from('not an image at all') });
                return;
            }
            await route.fallback();
        });
        const { card, action } = await importCard(page, lang);
        await action.click();

        const failed = card.locator('[data-photo]');
        await expect(failed).toHaveCount(1, { timeout: 300_000 });
        await expect(card.getByText(setupText(lang, 'adminSetup.import.failed', { count: '1' }))).toBeVisible({ timeout: 300_000 });
        // The server sniffs the bytes: they are no image of a type it takes.
        await expect(failed).toContainText(apiText(lang, 'apiError.photo.unsupportedType'));
        // M6 (finding 19): the end says how many are on the map; Open shows the card's list of the photo that failed.
        const message = snackbarMessage(page);
        await expect(message).toHaveText(
            setupText(lang, 'adminSetup.import.someOnMap', { done: String(LEGACY_PHOTOS - 1), total: String(LEGACY_PHOTOS) }),
            { timeout: 300_000 },
        );
        await page
            .locator('hcm-snackbar')
            .getByRole('button', { name: setupText(lang, 'adminSetup.import.open') })
            .click();
        await expect(new SetupPage(page, lang).open('legacyImport').locator('[data-photo]')).toHaveCount(1);
        await expect
            .poll(async () => (await legacyPhotos(adminWorld.emulators)).filter((photo) => photo.image && photo.published).length, {
                timeout: 120_000,
            })
            .toBe(LEGACY_PHOTOS - 1);
    },
);

/** The snackbar's message (not its live region, which repeats the text a moment after it shows). */
function snackbarMessage(page: Page): Locator {
    return page.locator('hcm-snackbar').locator('.snackbar .message');
}

/**
 * M6 (finding 17 of docs/research/manual-test-2026-10-25.md): on the real project Eventarc could not deliver the upload
 * events (the event functions' account lacked roles/run.invoker), so the photos stayed `pending`. The emulators always
 * deliver, so the first photo's upload is sent, with the Storage emulator's admin token, to a name in the same folder that
 * `photos.onUpload` ignores (a stem under 8 characters): its event is lost for the photo, and `photos.reprocess` still finds
 * the upload. The waits are the page's clock (STUCK_PHOTO_MS each).
 */
async function loseFirstUploadEvent(page: Page, file: string): Promise<() => string | null> {
    let photo: string | null = null;
    await page.route(/\/v0\/b\/[^/]+\/o\?.*name=uploads/, async (route: Route) => {
        const url = new URL(route.request().url());
        const parts = (url.searchParams.get('name') ?? '').split('/');
        if (photo !== null || route.request().method() !== 'POST' || parts.length !== 6) {
            await route.fallback();
            return;
        }
        photo = parts[4] ?? '';
        url.searchParams.set('name', [...parts.slice(0, 5), file].join('/'));
        await route.continue({ url: url.toString(), headers: { ...route.request().headers(), authorization: 'Bearer owner' } });
    });
    return () => photo;
}

/**
 * Moves the page's clock past the stuck wait once, unless it already passed by itself, and waits for the reprocess the
 * import then asks: a jump too many would also end the wait for the reprocessed upload.
 */
async function passStuckWaitOnce(page: Page, requested: () => number): Promise<void> {
    if (requested() === 0) {
        await page.clock.fastForward(STUCK_PHOTO_MS);
    }
    await expect.poll(requested, { timeout: 60_000 }).toBe(1);
}

/** Fast-forwards the page's clock by the stuck wait until `until` holds (the import's timers are the page's). */
async function waitPastStuck(page: Page, until: () => Promise<void>): Promise<void> {
    await expect(async () => {
        await page.clock.fastForward(STUCK_PHOTO_MS);
        await until();
    }).toPass({ timeout: 300_000, intervals: [5_000] });
}

test(
    'A photo whose upload event was lost is processed again after two minutes and published; no photo waits ten minutes',
    { tag: ['@S-A28-HAPPY-STUCK-REPROCESSED'] },
    async ({ page, lang, adminWorld }) => {
        test.setTimeout(480_000);
        await page.clock.install();
        await page.clock.resume();
        const lost = await loseFirstUploadEvent(page, 'lost.jpg');
        const reprocessed: string[] = [];
        page.on('request', (request: Request) => {
            if (request.url().startsWith(emulatorOrigin('functions')) && request.url().endsWith('/photos-reprocess')) {
                reprocessed.push(request.url());
            }
        });
        const { action } = await importCard(page, lang);
        await action.click();
        await expect
            .poll(async () => (await legacyPhotos(adminWorld.emulators)).filter((photo) => photo.image).length, { timeout: 300_000 })
            .toBe(LEGACY_PHOTOS - 1);
        const stuck = lost();
        expect(stuck).not.toBeNull();

        // Two minutes of the page's clock later the import asks photos.reprocess once; the photo is processed and published.
        await passStuckWaitOnce(page, () => reprocessed.length);
        await expect
            .poll(async () => (await legacyPhotos(adminWorld.emulators)).find((candidate) => candidate.id === stuck), { timeout: 120_000 })
            .toEqual({ id: stuck, image: true, published: true });
        await imported(page, lang);
        expect(reprocessed).toHaveLength(1);
        const photos = await legacyPhotos(adminWorld.emulators);
        expect(photos.filter((photo) => photo.image && photo.published)).toHaveLength(LEGACY_PHOTOS);
    },
);

test(
    'A photo still stuck after its second upload is listed as not received with the step that fixes it; the others are imported',
    { tag: ['@S-A28-BAD-STUCK-AGAIN'] },
    async ({ page, lang, adminWorld }) => {
        test.setTimeout(480_000);
        await page.clock.install();
        await page.clock.resume();
        const lost = await loseFirstUploadEvent(page, 'lost.jpg');
        // The second event is lost too (Eventarc refused again). The emulators always deliver the event of the copy the
        // server makes, so the page's call is answered as photos.reprocess answers and no copy is made: the photo stays
        // `pending` (photos.reprocess itself runs for real in S-A28-HAPPY-STUCK-REPROCESSED).
        let asked = 0;
        await page.route(`${emulatorOrigin('functions')}/**/photos-reprocess`, async (route: Route) => {
            asked += 1;
            await route.fulfill({ json: { result: { processing: 'pending' } } });
        });
        const { card, action } = await importCard(page, lang);
        await action.click();
        await expect
            .poll(async () => (await legacyPhotos(adminWorld.emulators)).filter((photo) => photo.image && photo.published).length, {
                timeout: 300_000,
            })
            .toBe(LEGACY_PHOTOS - 1);

        const failed = card.locator('[data-photo]');
        await waitPastStuck(page, async () => {
            await expect(failed).toHaveCount(1, { timeout: 1_000 });
        });
        const stuck = lost() ?? '';
        await expect(failed).toHaveAttribute('data-photo', stuck);
        await expect(failed).toContainText(apiText(lang, 'apiError.photo.notReceived'));
        await expect(card.getByText(setupText(lang, 'adminSetup.import.failed', { count: '1' }))).toBeVisible();
        expect(asked).toBe(1);
        const fix = failed.getByRole('link', {
            name: setupText(lang, 'adminSetup.selfTest.fix', { step: setupText(lang, 'adminSetup.step.provision') }),
        });
        await expect(fix).toHaveAttribute('href', '#/setup/provision');
        expect((await legacyPhotos(adminWorld.emulators)).find((photo) => photo.id === stuck)).toEqual({
            id: stuck,
            image: false,
            published: false,
        });
    },
);
