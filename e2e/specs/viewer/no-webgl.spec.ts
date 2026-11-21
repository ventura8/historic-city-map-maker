import { analyticsManifest } from '../../support/ga4.js';
import { readInstrumentation } from '../../support/instrumentation.js';
import { sitePath } from '../../support/site.js';
import { expect, test } from '../../support/test.js';
import { serveManifest, t, viewer, waitForEngineEvent } from '../../support/viewer.js';

/**
 * Without WebGL (behaviour V02, bad path; project `nogl`, Chromium with `--disable-3d-apis`): no map is created and
 * none is billed; a card says why in plain words, and the photo list is still there to browse every photo.
 */

test(
    'Without WebGL a card explains it and the photo list still opens every photo',
    { tag: ['@S-V02-BAD-NO-WEBGL', '@S-V01-BAD-PLAIN-WORDS', '@S-V52-BAD-NO-WEBGL', '@S-V64-BAD-NO-WEBGL'] },
    async ({ page, lang, mockApis }) => {
        await page.goto(sitePath('bucharest', { lang }));
        await waitForEngineEvent(page, 'hcm-ready');

        expect(await page.evaluate(() => document.createElement('canvas').getContext('webgl2'))).toBeNull();
        await expect(page.getByRole('alert')).toContainText(t(lang, 'error.webgl'));
        // Plain words for a visitor: no "WebGL" (the M1 UX review), the card says what still works.
        await expect(page.getByRole('alert')).not.toContainText(/webgl/i);
        // No map, nothing to zoom (V52): the zoom buttons are not there.
        await expect(page.getByRole('button', { name: t(lang, 'viewer.zoomIn'), exact: true })).toHaveCount(0);
        // Nor a compass (V64).
        await expect(page.getByRole('button', { name: t(lang, 'viewer.compass'), exact: true })).toHaveCount(0);
        const list = viewer(page).locator('.fallback hcm-photo-list');
        await expect(list.getByRole('status')).toHaveText(t(lang, 'photos.count.other', { count: '45' }));
        const photos = list.getByRole('list', { name: t(lang, 'photos.list') }).getByRole('button');
        await expect(photos).toHaveCount(45);
        // UX review: the list scrolls under the menu button; its last row must scroll clear of it.
        const last = photos.last();
        await last.scrollIntoViewIfNeeded();
        await viewer(page)
            .locator('.status')
            .evaluate((element) => {
                element.scrollTop = element.scrollHeight;
            });
        const fab = await page.getByRole('button', { name: t(lang, 'action.menu'), exact: true }).boundingBox();
        const lastBox = await last.boundingBox();
        expect((lastBox?.y ?? 0) + (lastBox?.height ?? 0), 'the last photo scrolls clear of the menu button').toBeLessThanOrEqual(
            fab?.y ?? 0,
        );

        await photos.filter({ hasText: 'Ștrandul Operetă' }).click();
        await expect(page.getByRole('heading', { name: 'Ștrandul Operetă' })).toBeVisible();
        await expect(viewer(page).locator('canvas.mapboxgl-canvas')).toHaveCount(0);
        expect((await readInstrumentation(page)).mapsCreated).toBe(0);
        expect(await mockApis.mapLoadEvents()).toBe(0);
    },
);

// M18 item 8 (docs/research/M18-improvements.md): on the public map's no-WebGL list the thumbnails show, and the consent card
// sits in the list's column under the error card instead of covering it.
test(
    'Without WebGL the thumbnails show and the consent card does not cover the error card',
    { tag: ['@S-V02-HAPPY-NO-WEBGL-THUMBS', '@S-V02-BAD-NO-WEBGL-CONSENT'] },
    async ({ page, lang }) => {
        await serveManifest(page, analyticsManifest());
        await page.goto(sitePath('bucharest', { lang }));
        await waitForEngineEvent(page, 'hcm-ready');

        const fallback = viewer(page).locator('.fallback');
        const card = fallback.locator('hcm-error-card');
        const consent = fallback.locator('hcm-consent-banner');
        await expect(card).toBeVisible();
        await expect(consent.getByRole('heading', { name: t(lang, 'consent.title') })).toBeVisible();
        await expect(viewer(page).locator('.dock.consent')).toHaveCount(0);
        const [cardBox, consentBox] = await Promise.all([card.boundingBox(), consent.boundingBox()]);
        expect((cardBox?.y ?? 0) + (cardBox?.height ?? 0), 'the consent card starts below the error card').toBeLessThanOrEqual(
            consentBox?.y ?? 0,
        );

        const first = fallback.locator('hcm-photo-list').getByRole('button').first().locator('img');
        await expect
            .poll(() => first.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0), {
                message: 'the first thumbnail is drawn',
            })
            .toBe(true);
    },
);

test('Without a map a photo opened from the list has no Show on map', { tag: '@S-V51-BAD-NO-MAP' }, async ({ page, lang }) => {
    await page.goto(sitePath('bucharest', { lang }));
    await waitForEngineEvent(page, 'hcm-ready');

    await viewer(page).locator('.fallback hcm-photo-list').getByRole('button').filter({ hasText: 'Ștrandul Operetă' }).click();

    await expect(page.getByRole('heading', { name: 'Ștrandul Operetă' })).toBeVisible();
    await expect(viewer(page).getByRole('button', { name: t(lang, 'photo.openLightbox') })).toBeVisible();
    await expect(viewer(page).getByRole('button', { name: t(lang, 'photo.locate'), exact: true })).toHaveCount(0);
});

// A games console's browser without WebGL (V66, docs/research/viewer-input.md §6): the card says what the console lacks,
// in plain words, and where the map works instead; the photo list stays.
test.describe('On a games console', () => {
    test.use({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox Series X) AppleWebKit/537.36 Chrome/131.0 Edg/131.0' });

    test(
        "A console's browser without WebGL says what it lacks and where the map works",
        { tag: '@S-V66-BAD-NO-WEBGL-CONSOLE' },
        async ({ page, lang }) => {
            await page.goto(sitePath('bucharest', { lang }));
            await waitForEngineEvent(page, 'hcm-ready');

            await expect(page.getByRole('alert')).toContainText(t(lang, 'error.webglConsole'));
            await expect(page.getByRole('alert')).not.toContainText(/webgl/i);
            const list = viewer(page).locator('.fallback hcm-photo-list');
            await expect(list.getByRole('list', { name: t(lang, 'photos.list') }).getByRole('button')).toHaveCount(45);
        },
    );
});
