import type { Page, Request } from '@playwright/test';

import { ADMIN_ORIGIN, ADMIN_URL, PAGES_REDIRECT_FOLDER } from '../../admin/world.js';
import { SECOND_CITY, UNPUBLISHED_CITY } from '../../fixtures/second-city.js';
import { E2E_CITY_ID, SITE_ORIGIN } from '../../fixtures/world.js';
import { bucketFolder, bucketWithout, hostingUrl, policyHeaders, serveBucketCity, useStartUpVariant } from '../../support/hosting.js';
import { mapFacts } from '../../support/map.js';
import { expect, test } from '../../support/test.js';
import { engineEvents, t, waitForEngineEvent } from '../../support/viewer.js';

/**
 * The public map on Firebase Hosting (behaviour V30; docs/research/M6-interfaces.md §2): the e2e Hosting tree the
 * production `build:hosting` makes, served as Hosting serves it (e2e/mock-apis/admin-server.ts). The root boots the
 * project's first city from the public bucket's manifest with one map and its own meta policy, never asking Firestore or
 * Firebase; a city made in the admin (no committed site) boots through the generic city page; `/admin/` is the admin's.
 * Before Publish the map the root is the start-up page; a city never published says its map was not found, and a path
 * that is no city answers the bilingual 404 page. The old GitHub Pages links go through the redirect tree to the same view
 * on Hosting.
 */

/** A city made in the admin: no committed site, so Hosting rewrites its address to the generic city page. */
const ADMIN_MADE_CITY = 'bacau';

/** Every request the page makes to Firestore or the Firebase SDK's hosts. */
function firebaseRequests(page: Page): Request[] {
    const seen: Request[] = [];
    page.on('request', (request) => {
        if (/firestore\.googleapis\.com|firebase(?:io|installations|remoteconfig)?\.googleapis\.com|firebaseio\.com/.test(request.url())) {
            seen.push(request);
        }
    });
    return seen;
}

async function metaPolicy(page: Page): Promise<string> {
    return (await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')) ?? '';
}

test(
    'The public map opens at the Hosting root and every city at its path',
    { tag: '@S-V30-HAPPY' },
    async ({ page, lang, instrumentation }) => {
        const root = await serveBucketCity(page, { city: E2E_CITY_ID, site: 'bucharest' });
        const generic = await serveBucketCity(page, { city: ADMIN_MADE_CITY, site: SECOND_CITY });
        const firebase = firebaseRequests(page);

        const answer = await page.goto(hostingUrl('/', { lang }));
        await waitForEngineEvent(page, 'hcm-ready');

        expect(await engineEvents(page, 'hcm-ready')).toEqual([expect.objectContaining({ cityId: E2E_CITY_ID })]);
        expect((await instrumentation.read(page)).mapsCreated).toBe(1);
        expect(root[0]).toBe(`${bucketFolder(E2E_CITY_ID)}manifest.json`);
        expect(policyHeaders((await answer?.headersArray()) ?? [])).toEqual([]);
        expect(await metaPolicy(page)).toContain('https://storage.googleapis.com');

        await page.goto(hostingUrl(`/${ADMIN_MADE_CITY}/`, { lang }));
        await waitForEngineEvent(page, 'hcm-ready');

        expect(await engineEvents(page, 'hcm-ready')).toEqual([expect.objectContaining({ cityId: ADMIN_MADE_CITY, photos: 3 })]);
        expect((await instrumentation.read(page)).mapsCreated).toBe(1);
        expect(generic[0]).toBe(`${bucketFolder(ADMIN_MADE_CITY)}manifest.json`);
        await expect(page).toHaveTitle('Hartă istorică');
        expect(firebase).toEqual([]);

        const admin = await page.request.get(ADMIN_URL);
        expect(admin.status()).toBe(200);
        expect(policyHeaders(admin.headersArray())).toHaveLength(1);
    },
);

/** The page's tab icon and home-screen icon addresses (null when the page has none). */
async function iconLinks(page: Page): Promise<{ readonly icon: string | null; readonly touch: string | null }> {
    return page.evaluate(() => ({
        icon: document.querySelector('link[rel="icon"]')?.getAttribute('href') ?? null,
        // The last home-screen link wins: the page's own app icon comes first, the city's is appended after it.
        touch: [...document.querySelectorAll('link[rel="apple-touch-icon"]')].at(-1)?.getAttribute('href') ?? null,
    }));
}

test(
    "Every city's tab shows its own uploaded icon from the public bucket once it loads, on the root and the generic page",
    { tag: '@S-V54-HAPPY' },
    async ({ page, lang }) => {
        await serveBucketCity(page, { city: E2E_CITY_ID, site: 'bucharest' });
        await serveBucketCity(page, { city: ADMIN_MADE_CITY, site: SECOND_CITY });

        await page.goto(hostingUrl('/', { lang }));
        await waitForEngineEvent(page, 'hcm-ready');

        await expect
            .poll(() => iconLinks(page))
            .toEqual({
                icon: `${bucketFolder(E2E_CITY_ID)}icon-own-32.png`,
                touch: `${bucketFolder(E2E_CITY_ID)}icon-180.png`,
            });

        await page.goto(hostingUrl(`/${ADMIN_MADE_CITY}/`, { lang }));
        await waitForEngineEvent(page, 'hcm-ready');

        await expect
            .poll(() => iconLinks(page))
            .toEqual({
                icon: `${bucketFolder(ADMIN_MADE_CITY)}icon-own-32.png`,
                touch: `${bucketFolder(ADMIN_MADE_CITY)}icon-180.png`,
            });
    },
);

test(
    'A 2015-2022 link through the Pages redirect page opens the same view on Hosting',
    { tag: '@S-V30-HAPPY-OLD-PAGES-LINK' },
    async ({ page, lang }) => {
        await serveBucketCity(page, { city: E2E_CITY_ID, site: 'bucharest' });

        await page.goto(`${SITE_ORIGIN}/${PAGES_REDIRECT_FOLDER}/?lang=${lang}#15.5/44.4271/26.0853/90/!a3!p2`);
        await page.waitForURL(`${ADMIN_ORIGIN}/**`);
        await waitForEngineEvent(page, 'hcm-ready');

        expect(new URL(page.url()).pathname).toBe('/');
        await expect.poll(async () => (await mapFacts(page)).zoom).toBeCloseTo(15.5, 1);
        const facts = await mapFacts(page);
        expect(facts.center[1]).toBeCloseTo(44.4271, 4);
        expect(facts.center[0]).toBeCloseTo(26.0853, 4);

        // A photo of an old link opens on the map at Hosting's root.
        await page.goto(`${SITE_ORIGIN}/${PAGES_REDIRECT_FOLDER}/?lang=${lang}#17/44.42955/26.09560&photo=strandul-opereta-1976`);
        await page.waitForURL(`${ADMIN_ORIGIN}/**`);
        await expect(page.getByRole('heading', { name: 'Ștrandul Operetă' })).toBeVisible();
    },
);

test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    test(
        'The Pages redirect page says the map moved, in Romanian and English, with the new address',
        { tag: '@S-V30-HAPPY-OLD-PAGES-LINK' },
        async ({ page }) => {
            await page.goto(`${SITE_ORIGIN}/${PAGES_REDIRECT_FOLDER}/${SECOND_CITY}/`);

            await expect(page.getByRole('heading', { level: 1, name: 'Harta s-a mutat' })).toBeVisible();
            await expect(page.getByRole('heading', { level: 2, name: 'The map has moved' })).toBeVisible();
            await expect(page.getByRole('link', { name: `${ADMIN_ORIGIN}/${SECOND_CITY}/` }).first()).toHaveAttribute(
                'href',
                `${ADMIN_ORIGIN}/${SECOND_CITY}/`,
            );
        },
    );
});

test('Before Publish the map the root says the map is being set up', { tag: '@S-V30-BAD-START-UP' }, async ({ page, context }) => {
    await useStartUpVariant(context);
    const engine: string[] = [];
    page.on('request', (request) => {
        if (/\/engine\/|mapbox/.test(request.url())) {
            engine.push(request.url());
        }
    });

    await page.goto(hostingUrl('/'));

    await expect(page.getByRole('heading', { level: 1, name: 'Harta este în pregătire' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'This map is being set up' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Administrarea hărții' })).toHaveAttribute('href', '/admin/');
    expect(await page.evaluate(() => 'HistoricCityMap' in window)).toBe(false);
    expect(engine).toEqual([]);
    expect(await (await page.request.get(hostingUrl('/release.json'))).json()).toMatchObject({ variant: 'start-up' });
});

test(
    'A city that is not published, or a path that is no city, is said plainly',
    { tag: ['@S-V30-BAD-UNKNOWN-CITY', '@S-V54-BAD-MISSING', '@S-V54-BAD-NOREQUEST'] },
    async ({ page, lang, consoleErrors, instrumentation }) => {
        const asked = await bucketWithout(page, UNPUBLISHED_CITY);

        await page.goto(hostingUrl(`/${UNPUBLISHED_CITY}/`, { lang }));

        await expect(page.getByRole('alert')).toContainText(t(lang, 'error.manifest.notFound'));
        expect((await instrumentation.read(page)).mapsCreated).toBe(0);
        // The page also looks for the city's home-screen icon (V54; an image, which the browser may ask after the
        // manifest), but never for its own tab icon: only a manifest saying `ownIcon` has one, and a missing image is
        // blocked by the browser as an opaque error. Each 404 is one console line.
        await expect
            .poll(() => [...new Set(asked)].sort((a, b) => a.localeCompare(b)))
            .toEqual(['icon-180.png', 'manifest.json'].map((name) => `${bucketFolder(UNPUBLISHED_CITY)}${name}`));
        const errors: string[] = [];
        await expect
            .poll(() => {
                errors.push(...consoleErrors.take());
                return errors.length;
            })
            .toBe(asked.length);
        expect(errors.every((line) => line.includes('404'))).toBe(true);
        expect(asked.some((url) => url.endsWith('icon-own-32.png'))).toBe(false);
        // The default, inlined (and drawn in the page's theme), and the page's own app icon: nothing of the bucket's.
        expect(await iconLinks(page)).toEqual({ icon: expect.stringMatching(/^data:image\/png;base64,/), touch: 'app-icon-192.png' });

        const answer = await page.goto(hostingUrl('/Not_A_City/'));

        expect(answer?.status()).toBe(404);
        await expect(page.getByRole('heading', { level: 1, name: 'Pagina nu există' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Deschide harta' })).toHaveAttribute('href', '/');
        await expect(page.getByRole('link', { name: "The map's admin" })).toHaveAttribute('href', '/admin/');
        // The browser may report the page's own 404 status: nothing else goes wrong.
        expect(consoleErrors.take().filter((error) => !error.includes('404'))).toEqual([]);
    },
);
