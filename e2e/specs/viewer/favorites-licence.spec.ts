import { licenceManifest, openFavorites, openLicence, seedFavorites } from '../../tour/favorites-states.js';
import { siteManifestData } from '../../fixtures/manifest.js';
import { E2E_TILESET_LAYER, E2E_XYZ_LAYER } from '../../fixtures/world.js';
import { expect, test } from '../../support/test.js';
import { callController, openViewer, serveManifest, t, viewer } from '../../support/viewer.js';

/**
 * Favourites (V91) and the Licence and citation panel (V92), the owner's 2026-11-23 requests: a star on a place, a photo, a
 * layer or a story keeps it in this browser, listed in the menu's Favourites; the panel states whose rights each layer and
 * photo carries, offers a citation to copy and downloads only the layers made from public-domain USGS imagery.
 */

const POI = 'fixture-cladire';

test('A star keeps a place in Favourites, across a reload, and its row opens it', { tag: '@S-V91-HAPPY-SAVE' }, async ({ page }) => {
    await openViewer(page, { lang: 'en' });
    await callController(page, 'openPoi', POI);
    const star = viewer(page)
        .locator('hcm-photo-sheet hcm-favorite-star')
        .getByRole('button', { name: t('en', 'favorites.add') });
    await star.click();
    await expect(
        viewer(page)
            .locator('hcm-photo-sheet hcm-favorite-star')
            .getByRole('button', { name: t('en', 'favorites.remove') }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await openFavorites(page, 'en');
    const row = viewer(page).locator('hcm-favorites button.open');
    await expect(row).toHaveCount(1);
    await row.click();
    await expect(viewer(page).locator('hcm-poi-detail')).toBeVisible();
});

test('A layer starred in Layers is listed, and opening it shows it on the map', { tag: '@S-V91-HAPPY-LAYER' }, async ({ page }) => {
    await seedFavorites(page, [{ kind: 'layer', id: E2E_TILESET_LAYER.id }]);
    await openViewer(page, { lang: 'en' });
    await openFavorites(page, 'en');
    await viewer(page).locator('hcm-favorites button.open').click();
    await expect.poll(() => new URL(page.url()).hash).toContain(`layers=${E2E_TILESET_LAYER.id}`);
});

test(
    'Blocked site data: the star still works for the page and the list says how to keep it',
    { tag: '@S-V91-BAD-STORAGE' },
    async ({ page }) => {
        await page.addInitScript(() => {
            Storage.prototype.setItem = () => {
                throw new DOMException('blocked', 'SecurityError');
            };
        });
        await openViewer(page, { lang: 'en' });
        await callController(page, 'openPoi', POI);
        await viewer(page)
            .locator('hcm-photo-sheet hcm-favorite-star')
            .getByRole('button', { name: t('en', 'favorites.add') })
            .click();
        await callController(page, 'openPoi', null);
        await openFavorites(page, 'en');
        await expect(viewer(page).getByText(t('en', 'favorites.notSavedFix'))).toBeVisible();
        await expect(viewer(page).locator('hcm-favorites button.open')).toHaveCount(1);
    },
);

test('A saved item the city removed is left out; none left says how to save one', { tag: '@S-V91-BAD-EMPTY' }, async ({ page }) => {
    await seedFavorites(page, [{ kind: 'photo', id: 'no-such-photo' }]);
    await openViewer(page, { lang: 'ro' });
    await openFavorites(page, 'ro');
    await expect(viewer(page).getByText(t('ro', 'favorites.empty'))).toBeVisible();
});

test(
    "The licence panel states each layer's rights, cites the view and downloads our USGS layer",
    { tag: '@S-V92-HAPPY-PANEL' },
    async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await serveManifest(page, licenceManifest());
        await openViewer(page, { lang: 'en' });
        await openLicence(page, 'en');
        const panel = viewer(page).locator('hcm-licence-panel');
        await expect(panel.locator(`li[data-layer="${E2E_TILESET_LAYER.id}"] a[data-download="pmtiles"]`)).toHaveAttribute(
            'href',
            /tiles\/e2e-1966\.pmtiles$/,
        );
        expect(await panel.locator('textarea').inputValue()).toContain(page.url().split('#')[0] ?? '');
        await panel.locator(`[data-cite="${E2E_TILESET_LAYER.id}"]`).click();
        await expect(panel.getByText(t('en', 'cite.copied'))).toBeVisible();
        const copied = await page.evaluate(() => navigator.clipboard.readText());
        expect(copied).toContain(`layers=${E2E_TILESET_LAYER.id}`);
    },
);

test(
    'A third-party scan offers no download, and a refused clipboard shows the citation to copy by hand',
    { tag: '@S-V92-BAD-NO-DOWNLOAD' },
    async ({ page }) => {
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'clipboard', {
                value: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
            });
        });
        await serveManifest(page, siteManifestData());
        await openViewer(page, { lang: 'en' });
        await openLicence(page, 'en');
        const panel = viewer(page).locator('hcm-licence-panel');
        const scan = panel.locator(`li[data-layer="${E2E_XYZ_LAYER.id}"]`);
        await expect(scan.locator('a[data-download]')).toHaveCount(0);
        await expect(scan.getByText(t('en', 'licence.noDownload'))).toBeVisible();
        await panel.locator('[data-cite="view"]').click();
        await expect(panel.getByText(t('en', 'cite.copyFailed'))).toBeVisible();
        await expect(panel.locator('[data-cite-fallback]')).toContainText('http');
    },
);
