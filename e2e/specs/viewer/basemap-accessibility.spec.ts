import type { Page } from '@playwright/test';

import { siteManifestData, type Json } from '../../fixtures/manifest.js';
import { E2E_PLAIN_STYLE_ID } from '../../fixtures/world.js';
import { expectMapCounts } from '../../support/compare.js';
import { expect, test } from '../../support/test.js';
import { chooseMenuItem, menuButton, openViewer, serveManifest, t, viewer } from '../../support/viewer.js';

const VIEW = '15/44.42700/26.08530';

async function lightOf(page: Page): Promise<readonly unknown[]> {
    return page.evaluate(() => {
        interface ConfigMap {
            getConfigProperty(importId: string, name: string): unknown;
        }
        const maps = (window as unknown as { __hcmE2e?: { maps: ConfigMap[] } }).__hcmE2e?.maps ?? [];
        return maps.map((map) => map.getConfigProperty('basemap', 'lightPreset'));
    });
}

/** How much of the map's light the view cones ignore: 1 keeps them bright on Standard's night, whatever the fake style draws. */
async function coneEmissive(page: Page): Promise<readonly unknown[]> {
    return page.evaluate(() => {
        interface PaintMap {
            getPaintProperty(layer: string, name: string): unknown;
        }
        const map = (window as unknown as { __hcmE2e?: { maps: PaintMap[] } }).__hcmE2e?.maps.at(-1);
        return map === undefined
            ? []
            : [
                  map.getPaintProperty('hcm-photos-cone-fill', 'fill-emissive-strength'),
                  map.getPaintProperty('hcm-photos-cone-line', 'line-emissive-strength'),
              ];
    });
}

function withBasemap(change: Json): Json {
    const manifest = siteManifestData();
    Object.assign((manifest['city'] as Json)['basemap'] as Json, change);
    return manifest;
}

test.describe("The basemap's light (V38)", () => {
    test('It follows the theme live, with one map load', { tag: '@S-V38-HAPPY' }, async ({ page, lang }) => {
        await page.emulateMedia({ colorScheme: 'dark' });
        await openViewer(page, { lang, hash: VIEW });
        await expect.poll(() => lightOf(page)).toEqual(['night']);
        await expect.poll(() => coneEmissive(page)).toEqual([1, 1]);

        await page.emulateMedia({ colorScheme: 'light' });
        await expect.poll(() => lightOf(page)).toEqual(['day']);
        await expectMapCounts(page, 1, 0);
    });

    test("A city's basemap.config keeps its own light", { tag: '@S-V38-BAD-CITY-CONFIG' }, async ({ page, lang }) => {
        await page.emulateMedia({ colorScheme: 'dark' });
        await serveManifest(page, withBasemap({ config: { lightPreset: 'dusk' } }));
        await openViewer(page, { lang, hash: VIEW });

        await expect.poll(() => lightOf(page)).toEqual(['dusk']);
        await page.emulateMedia({ colorScheme: 'light' });
        await expect.poll(() => lightOf(page)).toEqual(['dusk']);
    });

    test('A style without the property is left alone', { tag: '@S-V38-BAD-NO-PROPERTY' }, async ({ page, lang }) => {
        await page.emulateMedia({ colorScheme: 'dark' });
        await serveManifest(page, withBasemap({ style: `mapbox://styles/hcm-e2e/${E2E_PLAIN_STYLE_ID}` }));
        await openViewer(page, { lang, hash: VIEW });

        await page.emulateMedia({ colorScheme: 'light' });
        await expect(menuButton(page, lang)).toBeVisible();
        await expect.poll(() => lightOf(page)).toEqual([null]);
        await expectMapCounts(page, 1, 0);
    });
});

test.describe('The accessibility statement (V39)', () => {
    test('About says what works, what is missing and how to report a problem', { tag: '@S-V39-HAPPY' }, async ({ page, lang }) => {
        await openViewer(page, { lang, hash: VIEW });
        await chooseMenuItem(page, lang, t(lang, 'about.title'));
        const about = viewer(page).locator('hcm-about-dialog');

        await expect(about.getByRole('heading', { name: t(lang, 'about.accessibility') })).toBeVisible();
        await expect(about).toContainText(t(lang, 'about.a11yWorks'));
        await expect(about).toContainText(t(lang, 'about.a11yMissing'));
        await expect(about.getByRole('link', { name: t(lang, 'about.a11yReport') })).toHaveAttribute('href', /\/issues$/);
    });

    test('A city with no credits and no analytics still has it', { tag: '@S-V39-BAD-BARE-CITY' }, async ({ page, lang }) => {
        const manifest = siteManifestData();
        Object.assign(manifest['city'] as Json, { credits: [], analytics: {} });
        await serveManifest(page, manifest);
        await openViewer(page, { lang, hash: VIEW });
        await chooseMenuItem(page, lang, t(lang, 'about.title'));

        await expect(viewer(page).locator('hcm-about-dialog')).toContainText(t(lang, 'about.a11yMissing'));
        await expect(
            viewer(page)
                .locator('hcm-about-dialog')
                .getByRole('link', { name: t(lang, 'about.a11yReport') }),
        ).toHaveAttribute('href', /\/issues$/);
    });
});
