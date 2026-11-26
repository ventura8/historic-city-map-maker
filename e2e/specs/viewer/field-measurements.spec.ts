import type { Page } from '@playwright/test';

import { siteManifestData, type Json } from '../../fixtures/manifest.js';
import { E2E_BROKEN_TILESET, SITE_ORIGIN } from '../../fixtures/world.js';
import {
    analyticsCalls,
    analyticsManifest,
    eventParams,
    fetchedScripts,
    gaEvents,
    hidePage,
    viewerEventProblem,
    type GaEvent,
} from '../../support/ga4.js';
import { sitePath, type MockApis } from '../../support/site.js';
import { expect, test } from '../../support/test.js';
import {
    chooseMenuItem,
    openLayers,
    openViewer,
    serveManifest,
    t,
    viewer,
    visibilitySwitch,
    waitForEngineEvent,
} from '../../support/viewer.js';

/**
 * Field measurements (V19 and docs/ARCHITECTURE.md → *Field measurements*, DECISIONS-for-review.md §76): after the
 * visitor's consent the viewer fetches its field chunk (Google's `web-vitals` and the event guard) with the Firebase SDK
 * and GA4 receives the Core Web Vitals (`web_vitals`) and the boot's timings (`viewer_timing`), each one a valid event of
 * the viewer's schema, with the page's origin and path only. Before an answer, after Decline and after a withdrawal,
 * nothing is fetched or sent. An event that would carry a position never leaves the page, and a storm of tile errors
 * reaches GA4 as a count, not one event per tile.
 */

const LAYER_LABEL = 'Corona 1966 (e2e)';
const BROKEN = { id: 'e2e-broken', label: 'Strat stricat (e2e)' } as const;
const FIELD_CHUNK = /\/field-sdk-[\w-]+\.js$/;

async function openWithAnalytics(page: Page, lang: 'ro' | 'en', manifest: Json = analyticsManifest()): Promise<void> {
    await serveManifest(page, manifest);
    await openViewer(page, { lang, hash: '15/44.37000/25.97000' });
}

async function accept(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await page.getByRole('button', { name: t(lang, 'consent.accept'), exact: true }).click();
    await expect(viewer(page).locator('hcm-consent-banner')).toHaveCount(0);
}

async function toggleLayer(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await openLayers(page, lang);
    await visibilitySwitch(page, lang, LAYER_LABEL).click();
    const close = page.getByRole('button', { name: t(lang, 'action.close'), exact: true }).filter({ visible: true });
    if ((await close.count()) > 0) {
        await close.first().click();
    }
}

async function named(mockApis: MockApis, name: string): Promise<GaEvent[]> {
    return (await gaEvents(mockApis)).filter((event) => event.name === name);
}

/** The boot phases GA4 received, sorted (the beacons may arrive in any order). */
async function phases(mockApis: MockApis): Promise<string[]> {
    return (await named(mockApis, 'viewer_timing')).map((event) => event.params.get('ep.phase') ?? '').sort((a, b) => a.localeCompare(b));
}

async function metrics(mockApis: MockApis): Promise<string[]> {
    return (await named(mockApis, 'web_vitals')).map((event) => event.params.get('ep.metric_name') ?? '');
}

/** The fixture with analytics and one more layer whose tiles all answer 503 (a tile outage of one tileset). */
function brokenLayerManifest(): Json {
    const manifest = siteManifestData({ analytics: true });
    const layers = manifest['layers'] as Json[];
    layers.push({
        ...layers[0],
        id: BROKEN.id,
        year: 1970,
        label: { ro: BROKEN.label, en: BROKEN.label },
        source: { type: 'mapbox', tilesetId: E2E_BROKEN_TILESET },
        order: 3,
    });
    return analyticsManifest(manifest);
}

test(
    'After Accept GA4 receives the Core Web Vitals and the boot timings as valid events without the hash',
    { tag: '@S-V19-HAPPY-FIELD-MEASUREMENTS' },
    async ({ page, lang, mockApis }) => {
        await openWithAnalytics(page, lang);
        expect(
            (await fetchedScripts(page)).filter((url) => FIELD_CHUNK.test(url)),
            'no field chunk before consent',
        ).toEqual([]);

        await accept(page, lang);
        await expect.poll(() => fetchedScripts(page)).toContainEqual(expect.stringMatching(FIELD_CHUNK));
        await expect.poll(() => phases(mockApis)).toEqual(['manifest', 'map_idle', 'map_render']);
        await expect.poll(() => metrics(mockApis)).toEqual(expect.arrayContaining(['TTFB', 'FCP']));
        // A click ends the LCP's observation; hiding the page reports CLS (and INP, after an interaction).
        await toggleLayer(page, lang);
        await hidePage(page);
        await expect.poll(() => metrics(mockApis)).toEqual(expect.arrayContaining(['TTFB', 'FCP', 'LCP', 'CLS']));

        const events = await gaEvents(mockApis);
        for (const event of events) {
            expect(viewerEventProblem(event), `${event.name}: a valid event of the viewer`).toBeNull();
            expect(event.params.get('dl'), `${event.name}: the page location without its hash`).toBe(`${SITE_ORIGIN}/bucharest/`);
        }
        expect((await named(mockApis, 'viewer_timing')).map((event) => eventParams(event)['app'])).toEqual(['viewer', 'viewer', 'viewer']);
        const sent = (await analyticsCalls(mockApis)).map((call) => `${call.path}${call.query} ${call.body}`).join('\n');
        expect(sent).not.toContain('44.37');
        expect(sent).not.toContain('layers=');
    },
);

test(
    'Before an answer and after Decline nothing is measured out loud: no field chunk, no event',
    { tag: '@S-V19-BAD-NO-MEASUREMENT-BEFORE-CONSENT' },
    async ({ page, lang, mockApis }) => {
        await openWithAnalytics(page, lang);
        await toggleLayer(page, lang);
        await hidePage(page);
        expect(await analyticsCalls(mockApis), 'nothing before an answer').toEqual([]);
        expect((await fetchedScripts(page)).filter((url) => FIELD_CHUNK.test(url))).toEqual([]);

        await page.reload();
        await expect(page.getByRole('button', { name: t(lang, 'consent.decline'), exact: true })).toBeVisible();
        await page.getByRole('button', { name: t(lang, 'consent.decline'), exact: true }).click();
        await toggleLayer(page, lang);
        await hidePage(page);
        await page.reload();
        await expect(page.getByRole('button', { name: t(lang, 'action.menu'), exact: true })).toBeVisible();

        expect((await fetchedScripts(page)).filter((url) => FIELD_CHUNK.test(url))).toEqual([]);
        expect(await analyticsCalls(mockApis), 'nothing after Decline').toEqual([]);
    },
);

test(
    'After a withdrawal in About no measurement is sent, the hidden page included',
    { tag: '@S-V19-BAD-NO-MEASUREMENT-AFTER-WITHDRAWAL' },
    async ({ page, lang, mockApis }) => {
        await openWithAnalytics(page, lang);
        await accept(page, lang);
        await expect.poll(() => phases(mockApis)).toEqual(['manifest', 'map_idle', 'map_render']);

        await chooseMenuItem(page, lang, t(lang, 'about.title'));
        const about = viewer(page).locator('hcm-about-dialog');
        await about.getByRole('button', { name: t(lang, 'consent.withdraw') }).click();
        await expect(about).toContainText(t(lang, 'consent.denied'));
        await page.keyboard.press('Escape');
        const before = (await gaEvents(mockApis)).length;

        await toggleLayer(page, lang);
        await hidePage(page);
        await page.reload();
        await expect(page.getByRole('button', { name: t(lang, 'action.menu'), exact: true })).toBeVisible();

        expect(await gaEvents(mockApis)).toHaveLength(before);
    },
);

test(
    'An exception whose message holds a position never reaches GA4; a plain one does',
    { tag: '@S-V19-BAD-POSITION-NEVER-MEASURED' },
    async ({ page, lang, mockApis, consoleErrors }) => {
        await openWithAnalytics(page, lang);
        await accept(page, lang);
        await expect.poll(async () => (await named(mockApis, 'page_view')).length).toBe(1);

        for (const message of ['e2e lost at 44.43012, 26.10031', 'e2e plain failure']) {
            await page.evaluate((text) => {
                setTimeout(() => {
                    throw new Error(text);
                }, 0);
            }, message);
        }

        await expect
            .poll(async () => (await named(mockApis, 'exception')).map((event) => event.params.get('ep.description')))
            .toEqual(['Error: e2e plain failure']);
        const sent = (await analyticsCalls(mockApis)).map((call) => `${call.path}${call.query} ${call.body}`).join('\n');
        expect(sent).not.toMatch(/44\.430|26\.100/);
        expect(consoleErrors.take()).toEqual(['uncaught Error: e2e lost at 44.43012, 26.10031', 'uncaught Error: e2e plain failure']);
    },
);

test(
    'A layer whose tiles all fail reaches GA4 as a count of tile errors, not one event per tile',
    { tag: '@S-V19-BAD-ERROR-FLOOD-CAPPED' },
    async ({ page, lang, mockApis, consoleErrors }) => {
        await serveManifest(page, brokenLayerManifest());
        // Not openViewer: a map whose visible layer keeps failing is never idle.
        await page.goto(sitePath('bucharest', { lang, hash: `15/44.37000/25.97000&layers=${BROKEN.id}` }));
        await waitForEngineEvent(page, 'hcm-ready');
        await expect(page.getByRole('status').filter({ hasText: t(lang, 'error.layer', { name: BROKEN.label }) })).toBeVisible();
        await accept(page, lang);
        await expect.poll(async () => (await named(mockApis, 'map_errors')).length).toBe(1);

        await hidePage(page);

        await expect.poll(async () => (await named(mockApis, 'map_errors')).length).toBe(2);
        const counts = (await named(mockApis, 'map_errors')).map((event) => eventParams(event));
        expect(counts.map((params) => params['error_kind'])).toEqual(['tile', 'tile']);
        expect(counts[0]?.['error_count']).toBe(1);
        expect(Number(counts[1]?.['error_count']), 'the tiles that failed since the first, in one event').toBeGreaterThan(1);
        // The failing tiles keep coming while the layer shows: the page goes before the console is read.
        await page.goto('about:blank');
        expect(consoleErrors.take().filter((error) => !error.includes('503'))).toEqual([]);
    },
);
