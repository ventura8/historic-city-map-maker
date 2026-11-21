import { translateAdminShell } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { SITE_ORIGIN } from '../../../fixtures/world.js';
import { recordLiveRegions } from '../../../support/live-regions.js';
import { sitePath } from '../../../support/site.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { expect, test } from '../../support/content-test.js';
import type { ContentWorld } from '../../support/content.js';
import { seedPublicCity } from '../../support/flows.js';
import { adminMapReady, photoMarker } from '../../support/map.js';
import { photosText, seedPhoto, seedPhotosCity, servePhotoImages } from '../../support/photos.js';
import { poisText, seedCategories, seedPlace } from '../pois/places.js';

/**
 * The admin's shell around the editors (docs/research/M2c-interfaces.md §1.2, §2.4, §10.1; behaviours A21, A29), in a city of
 * the admin's own: the navigation follows the window class and marks the open page across a reload, a phone held sideways
 * gets the rail, a place opened from its address on a phone goes Back to the places list instead of the site the visitor
 * came from, and switching the language in an open editor keeps its draft, its map and the selection.
 */

const AT = new Date('2026-10-17T09:00:00.000Z');

function nav(page: Page): Locator {
    return page
        .getByRole('navigation', { name: translateAdminShell('ro', 'adminShell.nav.label') })
        .or(page.getByRole('navigation', { name: translateAdminShell('en', 'adminShell.nav.label') }));
}

/** The width the navigation takes at the window's left (a rail), or 0 (a bar at the bottom, or none). */
async function railWidth(page: Page): Promise<number> {
    const box = await page.locator('hcm-admin-nav').first().boundingBox();
    const viewport = page.viewportSize();
    return box === null || viewport === null || box.height < viewport.height / 2 ? 0 : Math.round(box.width);
}

test(
    'The navigation is a bar on a phone, a rail from a tablet, an expanded rail on a large screen, and marks the open page across a reload',
    { tag: ['@S-A29-HAPPY'] },
    async ({ page, lang, content }) => {
        await seedPhotosCity(content, AT);
        const link = (key: Parameters<typeof translateAdminShell>[1]): Locator =>
            nav(page).getByRole('link', { name: translateAdminShell(lang, key), exact: true });

        // A phone: the bar with Setup, Photos, Places, Layers and More.
        await page.setViewportSize({ width: 360, height: 800 });
        await page.goto(content.address(lang, 'photos', { map: false }));
        for (const key of ['adminShell.nav.setup', 'adminShell.nav.photos', 'adminShell.nav.pois', 'adminShell.nav.layers'] as const) {
            await expect(link(key)).toBeVisible();
        }
        await expect(nav(page).getByRole('button', { name: translateAdminShell(lang, 'adminShell.nav.more') })).toBeVisible();
        expect(await railWidth(page)).toBe(0);

        // A tablet and an expanded window: the collapsed rail; a large one: the rail with its labels, wider.
        await page.setViewportSize({ width: 768, height: 1024 });
        await expect.poll(() => railWidth(page)).toBeGreaterThan(0);
        const collapsed = await railWidth(page);
        await page.setViewportSize({ width: 1024, height: 768 });
        await expect.poll(() => railWidth(page)).toBe(collapsed);
        await page.setViewportSize({ width: 1440, height: 900 });
        await expect.poll(() => railWidth(page)).toBeGreaterThan(collapsed);

        // The open page is marked, and stays marked after a reload.
        await expect(link('adminShell.nav.photos')).toHaveAttribute('aria-current', 'page');
        await page.reload();
        await expect(link('adminShell.nav.photos')).toHaveAttribute('aria-current', 'page');
        await expect(link('adminShell.nav.pois')).not.toHaveAttribute('aria-current', 'page');
    },
);

test(
    'A phone held sideways gets the rail instead of the bar, and nothing overlaps or leaves the screen',
    { tag: ['@S-A29-BAD-LANDSCAPE-PHONE'] },
    async ({ page, lang, content }) => {
        await page.context().addInitScript(recordLiveRegions);
        await seedPhotosCity(content, AT);
        await page.setViewportSize({ width: 915, height: 412 });
        await page.goto(content.address(lang, 'photos', { map: false }));
        await expect(page.getByText(photosText(lang, 'adminContent.photos.empty'))).toBeVisible();

        await expect.poll(() => railWidth(page)).toBeGreaterThan(0);
        await expect(nav(page).getByRole('link', { name: translateAdminShell(lang, 'adminShell.nav.photos'), exact: true })).toBeVisible();
        await expectStateSound(page, adminVisit('photos.empty', lang));
    },
);

test(
    "A place's address opened on a phone shows its full-screen editor, and Back, its own or the browser's, goes to the places list",
    { tag: ['@S-A29-BAD-DEEP-LINK-COMPACT'] },
    async ({ page, lang, content }) => {
        await seedPublicCity(content, AT);
        await seedCategories(content, AT);
        await seedPlace(content, { id: 'gara', title: 'Gara de Nord', at: [26.0726, 44.4467] }, AT);
        await page.setViewportSize({ width: 360, height: 800 });

        // The visitor came from the public site, then opened the place's address.
        await page.goto(`${SITE_ORIGIN}${sitePath('bucharest', { lang })}`);
        await page.goto(content.address(lang, 'pois/gara', { map: false }));
        const heading = page.getByRole('heading', { level: 2, name: 'Gara de Nord' });
        await expect(heading).toBeVisible();
        const list = page.getByRole('link', { name: /Gara de Nord/ });
        await expect(list).toBeHidden();

        // The browser's Back: the places list, still the admin.
        await page.goBack();
        await expect(list).toBeVisible();
        expect(new URL(page.url()).origin).toBe(new URL(content.address(lang)).origin);

        // Its own Close does the same.
        await list.click();
        await expect(heading).toBeVisible();
        await page.getByRole('button', { name: poisText(lang, 'adminContent.common.close'), exact: true }).click();
        await expect(list).toBeVisible();
    },
);

test(
    'Switching the language in an open editor keeps its draft, its map and the selection',
    { tag: ['@S-A21-HAPPY'] },
    async ({ page, lang, content }) => {
        test.setTimeout(150_000);
        await page.setViewportSize({ width: 1440, height: 900 });
        await servePhotoImages(page);
        await seedPhotosCity(content, AT);
        await seedPhoto(content, { id: 'cv', title: 'Calea Victoriei' }, AT);
        await seedPhoto(content, { id: 'gn', title: 'Gara de Nord' }, AT);
        await page.goto(content.address(lang, 'photos/cv'));
        await adminMapReady(page);

        // A selection, a draft title and a draft place.
        await page.getByRole('checkbox', { name: photosText(lang, 'adminContent.photos.select', { title: 'Gara de Nord' }) }).check();
        const editor = page.locator('hcm-admin-photo-editor');
        await editor.getByLabel(photosText(lang, 'adminContent.photos.field.titleRo'), { exact: true }).fill('Calea Victoriei, 1930');
        await editor.getByLabel(photosText(lang, 'adminContent.photos.field.lat'), { exact: true }).fill('44.4392');
        await expect.poll(async () => (await photoMarker(page, 'cv'))?.[1]).toBeCloseTo(44.4392, 6);

        // The other language, from the account menu.
        const other = ({ ro: 'en', en: 'ro' } as const)[lang];
        await page
            .getByRole('button', { name: translateAdminShell(lang, 'adminShell.account.label') })
            .filter({ visible: true })
            .click();
        await page.locator('hcm-language-select select').selectOption(other);
        await page.keyboard.press('Escape');

        await expect(page.getByRole('heading', { level: 1, name: translateAdminShell(other, 'adminShell.nav.photos') })).toBeVisible();
        await expect(editor.getByLabel(photosText(other, 'adminContent.photos.field.titleRo'), { exact: true })).toHaveValue(
            'Calea Victoriei, 1930',
        );
        await expect(page.getByText(photosText(other, 'adminContent.photos.bulk.selected', { count: '1' }))).toBeVisible();
        expect((await photoMarker(page, 'cv'))?.[1]).toBeCloseTo(44.4392, 6);
        expect(await page.evaluate(() => (window as unknown as { __hcmE2e: { created: number } }).__hcmE2e.created)).toBe(1);
        expect((await content.document('photos/cv'))?.['title']).toEqual({ ro: 'Calea Victoriei' });
    },
);

/** The city with a place, its editor open (`map` false: no map, a page that keeps no map timer running). */
async function openPlace(page: Page, content: ContentWorld, lang: 'ro' | 'en'): Promise<void> {
    await seedPublicCity(content, AT);
    await seedCategories(content, AT);
    await seedPlace(content, { id: 'gara', title: 'Gara Veche', at: [26.0726, 44.4467] }, AT);
    await page.goto(content.address(lang, 'pois/gara', { map: false }));
    await expect(page.getByRole('textbox', { name: poisText(lang, 'adminContent.pois.field.titleRo') })).toHaveValue('Gara Veche');
}

test(
    'A session left open an hour refreshes its token silently, and the editor open all that time still saves',
    {
        tag: ['@S-A20-HAPPY'],
    },
    async ({ page, lang, content }) => {
        test.setTimeout(150_000);
        await page.clock.install();
        await openPlace(page, content, lang);
        await page.clock.resume();
        const title = page.getByRole('textbox', { name: poisText(lang, 'adminContent.pois.field.titleRo') });
        await title.fill('Gara de Nord');

        // An hour later Firebase Auth asks the Auth emulator for a new ID token, without a word to the admin.
        const refreshed = page.waitForRequest(/securetoken\.googleapis\.com\/v1\/token/);
        await page.clock.fastForward('01:00:00');
        await refreshed;
        await expect(page.getByRole('button', { name: translateAdminShell(lang, 'adminShell.auth.signIn') })).toHaveCount(0);

        // The editor open all that time saves, and a page read from Firestore still loads.
        await page.getByRole('button', { name: poisText(lang, 'adminContent.common.save'), exact: true }).click();
        await expect.poll(async () => (await content.document('pois/gara'))?.['title']).toEqual({ ro: 'Gara de Nord' });
        // The page's own "Saved" before leaving: Firestore can hold the write before the page has its answer, and a
        // draft still saving holds the address back (docs/LESSONS.md 122, 131).
        await expect(page.getByText(poisText(lang, 'adminContent.pois.state.saved'), { exact: true })).toBeVisible();
        await page.goto(content.address(lang, 'pois', { map: false }));
        await expect(page.getByRole('link', { name: /Gara de Nord/ })).toBeVisible();
    },
);

test.describe('signed out', () => {
    test.use({ signedIn: false });

    test(
        'An address of an editor opened signed out leads to the sign-in, and keeps the address',
        { tag: ['@S-A20-BAD-SIGNED-OUT-DEEP-LINK'] },
        async ({ page, lang, content }) => {
            await seedPublicCity(content, AT);
            await page.goto(content.address(lang, 'pois/gara', { map: false }));

            await expect(page.getByRole('button', { name: translateAdminShell(lang, 'adminShell.auth.signIn') })).toBeVisible();
            await expect(page.getByRole('textbox', { name: poisText(lang, 'adminContent.pois.field.titleRo') })).toHaveCount(0);
            expect(new URL(page.url()).hash).toBe('#/pois/gara');
        },
    );
});
