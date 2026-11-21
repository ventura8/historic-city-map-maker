import type { Page } from '@playwright/test';

import { sitePath } from '../../support/site.js';
import { expect, test } from '../../support/test.js';
import { engineEvents, t, viewer, waitForEngineEvent } from '../../support/viewer.js';

/**
 * The starter kit (behaviour V17): a city without any backend, just the page, its `config.js` and a static manifest
 * next to it. A missing, invalid or mismatched `config.js` shows the city owner an instructive error card, in the
 * language the page was opened in (docs/ENGINE_API.md → config.js, Language).
 */

const CONFIG = '**/starter-kit/config.js';

/** Serves `body` as the starter kit's config.js (one assignment of literal data, as the site build requires). */
async function serveConfig(page: Page, body: string): Promise<void> {
    await page.route(CONFIG, (route) => route.fulfill({ contentType: 'text/javascript; charset=utf-8', body }));
}

test('The starter kit renders its static manifest without any backend', { tag: '@S-V17-HAPPY' }, async ({ page, lang, mockApis }) => {
    await page.goto(sitePath('starter-kit', { lang }));
    await waitForEngineEvent(page, 'hcm-ready');

    expect(await engineEvents(page, 'hcm-ready')).toEqual([expect.objectContaining({ cityId: 'exemplu', layers: 0, photos: 2 })]);
    await expect(viewer(page).locator('canvas.mapboxgl-canvas')).toBeVisible();
    await expect(
        page.getByRole('region', { name: t(lang, 'viewer.mapLabel', { city: lang === 'ro' ? 'Orașul meu' : 'My city' }) }),
    ).toBeVisible();
    await expect(page.getByText(t(lang, 'timeline.empty'), { exact: true })).toBeVisible();
    const hosts = new Set((await mockApis.calls()).map((call) => call.host));
    expect([...hosts].filter((host) => !['api.mapbox.com', 'events.mapbox.com'].includes(host))).toEqual([]);
});

test(
    'A missing config.js tells the city owner what to add',
    { tag: '@S-V17-BAD-MISSING-CONFIG' },
    async ({ page, lang, consoleErrors }) => {
        await page.route(CONFIG, (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' }));
        await page.goto(sitePath('starter-kit', { lang }));

        await expect(page.getByRole('alert')).toContainText(t(lang, 'error.config.missing'));
        await expect(page.getByRole('button', { name: t(lang, 'action.retry') })).toHaveCount(0);
        await expect(viewer(page).locator('canvas.mapboxgl-canvas')).toHaveCount(0);
        expect(consoleErrors.take()).toEqual([expect.stringContaining('404')]);
    },
);

test('An invalid config.js names the field to fix', { tag: '@S-V17-BAD-INVALID-CONFIG' }, async ({ page, lang }) => {
    await serveConfig(
        page,
        "globalThis.HistoricCityMapConfig = { cityId: 'exemplu', manifestUrl: './data/manifest.json', colour: 'red' };",
    );
    await page.goto(sitePath('starter-kit', { lang }));

    const card = page.getByRole('alert');
    await expect(card).toContainText(t(lang, 'error.config.invalid', { detail: `colour: ${t(lang, 'validation.unknownKey')}` }));
    await expect(viewer(page).locator('canvas.mapboxgl-canvas')).toHaveCount(0);
});

test('A config.js for another city names both ids', { tag: '@S-V17-BAD-CITY-MISMATCH' }, async ({ page, lang }) => {
    await serveConfig(page, "globalThis.HistoricCityMapConfig = { cityId: 'alt-oras', manifestUrl: './data/manifest.json' };");
    await page.goto(sitePath('starter-kit', { lang }));

    await expect(page.getByRole('alert')).toContainText(
        t(lang, 'error.config.cityMismatch', { cityId: 'alt-oras', manifestCityId: 'exemplu' }),
    );
    expect(await engineEvents(page, 'hcm-error')).toEqual([
        expect.objectContaining({ code: 'error.config.cityMismatch', retryable: false }),
    ]);
    await expect(viewer(page).locator('canvas.mapboxgl-canvas')).toHaveCount(0);
});
