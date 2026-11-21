import { sitePath } from '../../support/site.js';
import { expect, test } from '../../support/test.js';

/**
 * Boot without JavaScript (behaviour V01, bad path): the generated page's `<noscript>` note explains in Romanian and
 * English that the map needs JavaScript, and the mount point stays empty. Nothing from Mapbox is executed.
 */

test.use({ javaScriptEnabled: false });

test('Without JavaScript the page explains that the map needs it', { tag: '@S-V01-BAD-NO-JAVASCRIPT' }, async ({ page }) => {
    await page.goto(sitePath('bucharest'));

    await expect(page).toHaveTitle('București dispărut');
    // Playwright's text locators skip <noscript> content by design, so the paragraphs are found by language.
    const romanian = page.locator('noscript p[lang="ro"]');
    const english = page.locator('noscript p[lang="en"]');
    await expect(romanian).toBeVisible();
    await expect(romanian).toContainText('Harta are nevoie de JavaScript.');
    await expect(english).toBeVisible();
    await expect(english).toContainText('The map needs JavaScript.');
    await expect(page.locator('#historic-city-map')).toBeEmpty();
    await expect(page.locator('hcm-map-viewer')).toHaveCount(0);
});
