import type { Locale } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { siteManifestData, type Json } from '../../fixtures/manifest.js';
import { E2E_TILESET_LAYER } from '../../fixtures/world.js';
import { cameras } from '../../support/compare.js';
import { mapIdle } from '../../support/map.js';
import { expect, test } from '../../support/test.js';
import { currentHash, openViewer, serveManifest, t, viewer } from '../../support/viewer.js';

/**
 * The shot direction button (behaviour V93, the owner on 2026-11-23): a satellite or aerial layer may say which way its
 * camera looked; while it is the layer on top, a round button under Show my location turns the map to that bearing, so
 * the view matches the image. A layer without one shows no button. Where it sits at every window size is the tour's.
 */

const HASH = `14/44.42704/26.0853&layers=${E2E_TILESET_LAYER.id}`;

function shotButton(page: Page, lang: Locale, degrees: string): Locator {
    return page.getByRole('button', { name: t(lang, 'viewer.shotDirection', { degrees }), exact: true });
}

/** The site's manifest with the 1966 layer shot towards `degrees`. */
async function serveShotManifest(page: Page, degrees: number): Promise<void> {
    const manifest = siteManifestData();
    const layers = manifest['layers'] as Json[];
    for (const layer of layers) {
        if (layer['id'] === E2E_TILESET_LAYER.id) {
            layer['kind'] = 'aerial';
            layer['shotDirection'] = degrees;
        }
    }
    await serveManifest(page, manifest);
}

test('A click on the shot direction turns the map to the way the image was shot', { tag: '@S-V93-HAPPY-TURN' }, async ({ page, lang }) => {
    await serveShotManifest(page, 135);
    await openViewer(page, { lang, hash: HASH });
    const button = shotButton(page, lang, '135');
    await expect(button).toBeVisible();
    await expect(viewer(page).locator('.dock.shot hcm-shot-compass')).toHaveAttribute(
        'title',
        t(lang, 'viewer.shotDirection', { degrees: '135' }),
    );

    const icon = viewer(page).locator('.dock.shot hcm-shot-compass svg');
    await expect(icon).toHaveCSS('transform', 'matrix(-0.707107, 0.707107, -0.707107, -0.707107, 0, 0)');
    await button.click();

    await expect.poll(async () => (await currentHash(page)).split('&')[0]).toBe('14/44.42704/26.0853/135');
    await mapIdle(page);
    expect(Math.round((await cameras(page))[0]?.bearing ?? Number.NaN)).toBe(135);
    await expect(icon).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
});

test('A layer without a shot direction shows no button', { tag: '@S-V93-BAD-NO-DIRECTION' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: HASH });

    await expect(viewer(page).locator('.dock.locate')).toBeVisible();
    await expect(viewer(page).locator('.dock.shot')).toHaveCount(0);
});

test('Already facing the shot direction, a click leaves the map where it is', { tag: '@S-V93-BAD-ALREADY' }, async ({ page, lang }) => {
    await serveShotManifest(page, 90);
    await openViewer(page, { lang, hash: `14/44.42704/26.0853/90&layers=${E2E_TILESET_LAYER.id}` });

    await shotButton(page, lang, '90').click();
    await mapIdle(page);

    expect((await currentHash(page)).split('&')[0]).toBe('14/44.42704/26.0853/90');
    expect(Math.round((await cameras(page))[0]?.bearing ?? Number.NaN)).toBe(90);
});
