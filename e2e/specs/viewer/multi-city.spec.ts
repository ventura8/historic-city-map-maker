import type { Page } from '@playwright/test';

import { PAGES_FOLDER, SECOND_CITY, SECOND_CITY_PHOTOS, UNPUBLISHED_CITY } from '../../fixtures/second-city.js';
import { E2E_CITY_ID, E2E_PUBLIC_BUCKET } from '../../fixtures/world.js';
import { serveCityIcons } from '../../support/hosting.js';
import { mapFacts } from '../../support/map.js';
import { expect, test } from '../../support/test.js';
import { engineEvents, t, waitForEngineEvent } from '../../support/viewer.js';

/**
 * Many cities on one GitHub Pages site (behaviour V26; `docs/research/M5-interfaces.md` §1.10): the e2e build assembles
 * the Pages tree the production build's `--pages` makes (`scripts/site/src/pages.ts`) under `/pages/`: Bucharest at its
 * root, the second city in `/pages/e2e-second/` with its own manifest, and a city whose page reads the public bucket only,
 * before the admin published it. Each page boots its own city with one map, and names only its own manifest.
 */

const ROOT = `/${PAGES_FOLDER}/`;

function pagePath(city: string | null, lang: string, hash = ''): string {
    const folder = city === null ? ROOT : `${ROOT}${city}/`;
    const fragment = hash === '' ? '' : `#${hash}`;
    return `${folder}?lang=${lang}${fragment}`;
}

/** The page's own policy (its first element, as GitHub Pages cannot send headers). */
async function policyOf(page: Page): Promise<string> {
    return (await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')) ?? '';
}

/** What a page's `config.js` and its bundled manifest name. */
async function expectOwnManifest(page: Page, folder: string, cityId: string): Promise<void> {
    const config = await (await page.request.get(`${folder}config.js`)).text();
    expect(config).toContain(`cityId: '${cityId}'`);
    expect(config).toContain("manifestUrl: './data/manifest.json'");
    const manifest = (await (await page.request.get(`${folder}data/manifest.json`)).json()) as { city: { id: string } };
    expect(manifest.city.id).toBe(cityId);
}

test(
    'Bucharest at the root and a second city under its own path, each with its own manifest',
    { tag: '@S-V26-HAPPY' },
    async ({ page, lang, instrumentation }) => {
        await page.goto(pagePath(null, lang));
        await waitForEngineEvent(page, 'hcm-ready');
        expect(await engineEvents(page, 'hcm-ready')).toEqual([expect.objectContaining({ cityId: E2E_CITY_ID, photos: 45 })]);
        expect((await instrumentation.read(page)).mapsCreated).toBe(1);
        expect(await policyOf(page)).not.toContain('storage.googleapis.com');
        await expectOwnManifest(page, ROOT, E2E_CITY_ID);

        await page.goto(pagePath(SECOND_CITY, lang));
        await waitForEngineEvent(page, 'hcm-ready');

        expect(await engineEvents(page, 'hcm-ready')).toEqual([
            expect.objectContaining({ cityId: SECOND_CITY, photos: SECOND_CITY_PHOTOS }),
        ]);
        expect((await instrumentation.read(page)).mapsCreated).toBe(1);
        await expect(page).toHaveTitle('Al doilea oraș (e2e)');
        await expectOwnManifest(page, `${ROOT}${SECOND_CITY}/`, SECOND_CITY);
    },
);

test("Bucharest's old links keep opening at the root", { tag: '@S-V26-HAPPY-ROOT-LINKS' }, async ({ page, lang }) => {
    await page.goto(pagePath(null, lang, '15.5/44.4271/26.0853/90/!a3!p2'));
    await waitForEngineEvent(page, 'hcm-ready');

    await expect.poll(async () => (await mapFacts(page)).zoom).toBeCloseTo(15.5, 1);
    const facts = await mapFacts(page);
    expect(facts.center[1]).toBeCloseTo(44.4271, 4);
    expect(facts.center[0]).toBeCloseTo(26.0853, 4);

    await page.goto(pagePath(null, lang, '17/44.42955/26.09560&photo=strandul-opereta-1976'));
    await waitForEngineEvent(page, 'hcm-ready');

    await expect(page.getByRole('heading', { name: 'Ștrandul Operetă' })).toBeVisible();
});

test(
    'A city whose manifest is not in the public bucket yet says so',
    { tag: '@S-V26-BAD-NOT-PUBLISHED' },
    async ({ page, lang, consoleErrors, instrumentation }) => {
        const bucket = `https://storage.googleapis.com/${E2E_PUBLIC_BUCKET}/cities/${UNPUBLISHED_CITY}/`;
        const asked: string[] = [];
        await page.route(`${bucket}**`, async (route) => {
            asked.push(route.request().url());
            await route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' });
        });
        // The tab icon's probes are answered apart: this row is about the manifest's 404 line.
        await serveCityIcons(page, bucket);

        await page.goto(pagePath(UNPUBLISHED_CITY, lang));

        await expect(page.getByRole('alert')).toContainText(t(lang, 'error.manifest.notFound'));
        await expect(page.getByRole('button', { name: t(lang, 'action.retry'), exact: true })).toBeVisible();
        expect(await engineEvents(page, 'hcm-error')).toEqual([{ code: 'error.manifest.notFound', retryable: true, detail: '404' }]);
        expect((await instrumentation.read(page)).mapsCreated).toBe(0);
        expect(asked).toEqual([`${bucket}manifest.json`]);
        expect(await policyOf(page)).toContain('https://storage.googleapis.com');
        expect(consoleErrors.take()).toEqual([expect.stringContaining('404')]);

        await page.goto(pagePath(null, lang));
        await waitForEngineEvent(page, 'hcm-ready');
        expect(await engineEvents(page, 'hcm-error')).toEqual([]);
    },
);
