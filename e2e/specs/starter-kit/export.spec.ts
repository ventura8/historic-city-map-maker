import { fileURLToPath, pathToFileURL } from 'node:url';

import type { TestInfo } from '@playwright/test';

import { SITE_ORIGIN } from '../../fixtures/world.js';
import { mockedHostKind } from '../../mock-apis/hosts.js';
import { exportSite, serveExports } from '../../support/export-site.js';
import { expect, test } from '../../support/test.js';
import { engineEvents, t, viewer, waitForEngineEvent } from '../../support/viewer.js';

/**
 * The viewer boots from a static export (behaviour V28, `docs/research/M5-interfaces.md` §5.7): the export of the
 * fixture city, made by the export's own planner and zip writer and unpacked as an owner would (`support/export-site.ts`),
 * served by a plain static server. The engine comes from the export's own `engine/`, the photos from its `photos/`, and
 * nothing goes to Firestore, Firebase, googleapis or a CDN: the firewall fails the test on any host outside the mocked
 * ones, and the record of the mocked ones holds Mapbox only. The export carries no analytics ids, so nothing asks for
 * consent; opened by a double-click (`file://`), the page says the map could not load, in Romanian and English, with Try again.
 */

/** A folder of its own per test, project and retry (the projects run in parallel). */
function nameOf(testInfo: TestInfo): string {
    return `${testInfo.project.name}-${testInfo.testId}-${String(testInfo.retry)}`.replace(/[^\w-]/g, '-');
}

/** The hosts a visit reached through the mock APIs, Mapbox's aside. */
const MAPBOX_HOSTS = ['api.mapbox.com', 'events.mapbox.com'];

test(
    'An unzipped export boots on a plain static server with no Firebase',
    { tag: '@S-V28-HAPPY' },
    async ({ page, lang, mockApis }, testInfo) => {
        const site = await exportSite(nameOf(testInfo));
        await serveExports(page);
        const asked: string[] = [];
        page.on('request', (request) => asked.push(request.url()));

        await page.goto(`${SITE_ORIGIN}${site.path}?lang=${lang}#18/44.42955/26.09560&photo=strandul-opereta-1976`);
        await waitForEngineEvent(page, 'hcm-ready');

        expect(await engineEvents(page, 'hcm-ready')).toEqual([
            expect.objectContaining({
                cityId: site.manifest.city.id,
                photos: site.manifest.photos.length,
                layers: site.manifest.layers.length,
            }),
        ]);
        await expect(page.getByRole('heading', { name: 'Ștrandul Operetă' })).toBeVisible();
        await expect(viewer(page).locator('canvas.mapboxgl-canvas')).toBeVisible();
        const own = `${SITE_ORIGIN}${site.path}`;
        expect(asked).toContain(`${own}engine/engine.iife.js`);
        expect(asked).toContain(`${own}city.json`);
        await expect.poll(() => asked.filter((url) => url.startsWith(`${own}photos/`)).length).toBeGreaterThan(0);
        expect(asked.filter((url) => /jsdelivr|googleapis|firebase|firestore|cloudfunctions/.test(url))).toEqual([]);
        expect([...new Set((await mockApis.calls()).map((call) => call.host))].filter((host) => !MAPBOX_HOSTS.includes(host))).toEqual([]);
        expect(site.files).toEqual(expect.arrayContaining(['index.html', 'city.json', 'README.md', 'RIGHTS.md', 'engine/engine.iife.js']));
    },
);

test(
    'An export of a city with analytics asks for no consent and loads nothing',
    { tag: '@S-V28-HAPPY-CONSENT-SENDS-NOTHING' },
    async ({ page, lang, mockApis }, testInfo) => {
        const site = await exportSite(nameOf(testInfo), { analytics: true });
        await serveExports(page);

        await page.goto(`${SITE_ORIGIN}${site.path}?lang=${lang}`);
        await waitForEngineEvent(page, 'hcm-ready');

        expect(site.manifest.city.analytics.measurementId, 'the published city has a GA4 id').toBeDefined();
        await expect(page.getByRole('button', { name: t(lang, 'action.menu'), exact: true })).toBeVisible();
        await expect(viewer(page).locator('hcm-consent-banner')).toHaveCount(0);
        await expect(page.getByRole('button', { name: t(lang, 'consent.accept'), exact: true })).toHaveCount(0);
        expect((await mockApis.calls()).filter((call) => mockedHostKind(call.host) === 'analytics')).toEqual([]);
        expect((await mockApis.calls()).filter((call) => call.host.startsWith('telemetry.'))).toEqual([]);
    },
);

test.describe('opened from the disk', () => {
    test.use({
        expectedConsoleErrors: [
            {
                text: /city\.json|Failed to fetch|URL scheme "file" is not supported/i,
                url: /^file:/,
                why: 'Chromium refuses to fetch a file:// address from a file:// page: that one refusal is the point of the test',
            },
        ],
    });

    test(
        'An export opened by double-click says the map could not load, with Try again',
        { tag: '@S-V28-BAD-FILE-URL' },
        async ({ page, lang }, testInfo) => {
            const site = await exportSite(nameOf(testInfo));
            // The firewall blocks every address that is not a mocked host; the disk is the export's own, so the page,
            // its script and its stylesheet come from it as the browser would read them (Chromium's own fetch of a
            // file:// address never reaches a route: it is refused before, which is the point of the test).
            await page.route(/^file:\/\//, (route) => route.fulfill({ path: fileURLToPath(route.request().url()) }));

            await page.goto(`${pathToFileURL(site.folder).href}/index.html?lang=${lang}`);

            // Nor can it fetch its language's texts (`engine/i18n/`): the engine's own card says so in both its languages.
            await expect(page.getByRole('alert').locator('p[lang="en"]')).toHaveText('The map could not be loaded.');
            await expect(page.getByRole('alert').locator('p[lang="ro"]')).toHaveText('Harta nu s-a putut încărca.');
            await expect(page.getByRole('button', { name: 'Reîncearcă · Retry' })).toBeVisible();
            expect(await engineEvents(page, 'hcm-error')).toEqual([
                expect.objectContaining({ code: 'error.manifest.network', retryable: true }),
            ]);
        },
    );
});
