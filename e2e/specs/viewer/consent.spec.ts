import type { BrowserContext, Page } from '@playwright/test';

import { E2E_MEASUREMENT_ID, E2E_TILESET_LAYER, SITE_ORIGIN } from '../../fixtures/world.js';
import { analyticsCalls, analyticsManifest, gaEvents } from '../../support/ga4.js';
import { mapFacts } from '../../support/map.js';
import { expect, test } from '../../support/test.js';
import { chooseMenuItem, openLayers, openViewer, serveManifest, t, viewer, visibilitySwitch } from '../../support/viewer.js';

/**
 * Analytics consent (behaviour V19, PLAN Addendum 2): with a GA4 measurement id and the Firebase app ids in the
 * manifest the viewer asks first; before an answer, and after "Decline", no Google or Firebase host is contacted (the
 * firewall fixture would also fail the test on any other host). "Accept" loads the real Firebase Analytics SDK, whose
 * events reach the GA4 mock (mock-apis/gtag.ts) without personal data: the page location is the origin and path, never
 * the hash with the visitor's view or position, and nothing goes to Performance Monitoring (not in the public viewer,
 * docs/research/DECISIONS-for-review.md §18a). Withdrawing in About stops the events and expires GA4's cookies (§18c).
 */

const LAYER_LABEL = 'Corona 1966 (e2e)';

/** Performance Monitoring's hosts: the public viewer never contacts them. */
const PERFORMANCE_HOSTS = ['firebaselogging.googleapis.com', 'firebaselogging-pa.googleapis.com'];

/** The cookies of the city site, by name (Playwright reads them all, whatever their path). */
async function siteCookies(context: BrowserContext): Promise<Record<string, string>> {
    return Object.fromEntries((await context.cookies(SITE_ORIGIN)).map((cookie) => [cookie.name, cookie.value]));
}

/** GA4's own cookies among them: `_ga` and `_ga_<container>`. */
async function ga4Cookies(context: BrowserContext): Promise<string[]> {
    return Object.keys(await siteCookies(context))
        .filter((name) => /^_ga(_|$)/.test(name))
        .sort((a, b) => a.localeCompare(b));
}

const GA4_COOKIES = ['_ga', `_ga_${E2E_MEASUREMENT_ID.replace(/^G-/, '')}`];

function banner(page: Page) {
    return viewer(page).locator('hcm-consent-banner');
}

async function openWithAnalytics(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await serveManifest(page, analyticsManifest());
    await openViewer(page, { lang, hash: '15/44.37000/25.97000' });
}

async function toggleLayer(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await openLayers(page, lang);
    await visibilitySwitch(page, lang, LAYER_LABEL).click();
    const close = page.getByRole('button', { name: t(lang, 'action.close'), exact: true }).filter({ visible: true });
    if ((await close.count()) > 0) {
        await close.first().click();
    }
}

test(
    'Before an answer and after Decline nothing reaches Google or Firebase',
    { tag: '@S-V19-BAD-NO-REQUEST-BEFORE-CONSENT' },
    async ({ page, lang, mockApis }) => {
        await openWithAnalytics(page, lang);
        await expect(banner(page).getByRole('heading', { name: t(lang, 'consent.title') })).toBeVisible();
        await expect(banner(page)).toContainText(t(lang, 'consent.body'));
        await toggleLayer(page, lang);
        await expect.poll(() => page.evaluate(() => location.hash)).toContain(`layers=${E2E_TILESET_LAYER.id}`);
        expect(await analyticsCalls(mockApis), 'no analytics request before consent').toEqual([]);

        await page.getByRole('button', { name: t(lang, 'consent.decline'), exact: true }).click();
        await expect(banner(page)).toHaveCount(0);
        await toggleLayer(page, lang);
        await page.reload();
        await expect(page.getByRole('button', { name: t(lang, 'action.menu'), exact: true })).toBeVisible();
        await expect(banner(page)).toHaveCount(0);
        expect(await analyticsCalls(mockApis), 'no analytics request after Decline').toEqual([]);
        expect(await page.evaluate(() => Object.keys(window).filter((key) => key === 'dataLayer' || key === 'gtag'))).toEqual([]);
    },
);

test(
    'Accept loads GA4, which receives the page view and a layer toggle without personal data',
    { tag: '@S-V19-HAPPY' },
    async ({ page, lang, mockApis }) => {
        await openWithAnalytics(page, lang);
        await page.getByRole('button', { name: t(lang, 'consent.accept'), exact: true }).click();
        await expect(banner(page)).toHaveCount(0);

        await expect.poll(async () => (await gaEvents(mockApis)).map((event) => event.name)).toContain('page_view');
        const loads = (await analyticsCalls(mockApis)).map((call) => `${call.host}${call.path}`);
        expect(loads).toContain('www.googletagmanager.com/gtag/js');
        await toggleLayer(page, lang);
        await expect.poll(async () => (await gaEvents(mockApis)).map((event) => event.name)).toContain('layer_toggle');

        const events = await gaEvents(mockApis);
        const toggle = events.find((event) => event.name === 'layer_toggle');
        expect(toggle?.params.get('ep.layer_id')).toBe(E2E_TILESET_LAYER.id);
        expect(toggle?.params.get('ep.visible')).toBe('true');
        for (const event of events) {
            expect(event.params.get('tid')).toBe(E2E_MEASUREMENT_ID);
            expect(event.params.get('dl'), 'the page location without its hash or query').toBe(`${SITE_ORIGIN}/bucharest/`);
        }
        const sent = (await analyticsCalls(mockApis)).map((call) => `${call.path}${call.query} ${call.body}`).join('\n');
        // The hash holds the visitor's view (15/44.37000/25.97000) and the visible layers: none of it is sent.
        expect(sent).not.toContain('44.37');
        expect(sent).not.toContain('layers=');
        expect((await analyticsCalls(mockApis)).filter((call) => PERFORMANCE_HOSTS.includes(call.host))).toEqual([]);
    },
);

test(
    'After My location the position in the hash never reaches Google, and nothing goes to Performance Monitoring',
    { tag: '@S-V19-BAD-HASH-NEVER-SENT' },
    async ({ page, context, lang, mockApis }) => {
        await context.grantPermissions(['geolocation'], { origin: SITE_ORIGIN });
        await context.setGeolocation({ latitude: 44.4301, longitude: 26.1003 });
        await openWithAnalytics(page, lang);
        await page.getByRole('button', { name: t(lang, 'consent.accept'), exact: true }).click();
        await expect.poll(async () => (await gaEvents(mockApis)).map((event) => event.name)).toContain('page_view');

        await chooseMenuItem(page, lang, t(lang, 'action.locate'));
        // The map flies to the visitor; the address keeps the view it had (S-V10-BAD-POSITION-NOT-IN-LINK).
        await expect.poll(async () => (await mapFacts(page)).center[1]).toBeCloseTo(44.4301, 4);
        await toggleLayer(page, lang);
        await expect.poll(async () => (await gaEvents(mockApis)).map((event) => event.name)).toContain('layer_toggle');
        await expect.poll(() => page.evaluate(() => location.hash)).toContain('layers=');
        expect(await page.evaluate(() => location.hash)).not.toMatch(/44\.430|26\.100/);

        const calls = await analyticsCalls(mockApis);
        expect(calls.filter((call) => PERFORMANCE_HOSTS.includes(call.host))).toEqual([]);
        for (const event of await gaEvents(mockApis)) {
            expect(event.params.get('dl'), `${event.name}: the page location without its hash`).toBe(`${SITE_ORIGIN}/bucharest/`);
        }
        const sent = calls.map((call) => `${call.path}${call.query} ${call.body}`).join('\n');
        expect(sent).not.toMatch(/44\.430|26\.100/);
    },
);

test(
    'Withdrawing consent in About stops every later analytics request',
    { tag: '@S-V19-BAD-WITHDRAWN' },
    async ({ page, lang, mockApis }) => {
        await openWithAnalytics(page, lang);
        await page.getByRole('button', { name: t(lang, 'consent.accept'), exact: true }).click();
        await expect.poll(async () => (await gaEvents(mockApis)).map((event) => event.name)).toContain('page_view');

        await chooseMenuItem(page, lang, t(lang, 'about.title'));
        const about = viewer(page).locator('hcm-about-dialog');
        await expect(about).toContainText(t(lang, 'consent.granted'));
        await about.getByRole('button', { name: t(lang, 'consent.withdraw') }).click();
        await expect(about).toContainText(t(lang, 'consent.denied'));
        await page.keyboard.press('Escape');
        const before = (await gaEvents(mockApis)).length;

        await toggleLayer(page, lang);
        await expect.poll(() => page.evaluate(() => location.hash)).toContain(`layers=${E2E_TILESET_LAYER.id}`);
        await page.reload();
        await expect(page.getByRole('button', { name: t(lang, 'action.menu'), exact: true })).toBeVisible();
        await expect(banner(page)).toHaveCount(0);
        expect(await gaEvents(mockApis)).toHaveLength(before);
    },
);

test(
    "Withdrawing consent expires GA4's cookies and leaves the site's own",
    { tag: '@S-V19-HAPPY-COOKIES-EXPIRED' },
    async ({ page, context, lang, mockApis }) => {
        await context.addCookies([{ name: 'site_choice', value: 'kept', url: SITE_ORIGIN }]);
        await openWithAnalytics(page, lang);
        await page.getByRole('button', { name: t(lang, 'consent.accept'), exact: true }).click();
        await expect.poll(async () => (await gaEvents(mockApis)).map((event) => event.name)).toContain('page_view');
        await expect.poll(() => ga4Cookies(context), { message: 'gtag.js wrote its cookies after Accept' }).toEqual(GA4_COOKIES);

        await chooseMenuItem(page, lang, t(lang, 'about.title'));
        const about = viewer(page).locator('hcm-about-dialog');
        await about.getByRole('button', { name: t(lang, 'consent.withdraw') }).click();
        await expect(about).toContainText(t(lang, 'consent.denied'));

        await expect.poll(() => ga4Cookies(context), { message: 'no GA4 cookie after the withdrawal' }).toEqual([]);
        expect((await siteCookies(context))['site_choice']).toBe('kept');
        await page.keyboard.press('Escape');
        await page.reload();
        await expect(page.getByRole('button', { name: t(lang, 'action.menu'), exact: true })).toBeVisible();
        expect(await ga4Cookies(context), 'and none comes back on the next visit').toEqual([]);
    },
);

test(
    'Declining at the banner never touches a cookie the viewer did not write',
    { tag: '@S-V19-BAD-DECLINE-KEEPS-PAGE-COOKIES' },
    async ({ page, context, lang, mockApis }) => {
        // A page that embeds the map may run its own GA4: its cookie is not the viewer's to expire.
        await context.addCookies([{ name: '_ga', value: 'GA1.1.page.own', url: SITE_ORIGIN }]);
        await openWithAnalytics(page, lang);

        await page.getByRole('button', { name: t(lang, 'consent.decline'), exact: true }).click();
        await expect(banner(page)).toHaveCount(0);
        await toggleLayer(page, lang);

        expect((await siteCookies(context))['_ga']).toBe('GA1.1.page.own');
        expect(await analyticsCalls(mockApis)).toEqual([]);
    },
);

test(
    'A completed share is one GA4 share event; a cancelled share is none',
    { tag: '@S-V19-HAPPY-SHARE-EVENT' },
    async ({ page, lang, mockApis }) => {
        await page.addInitScript(() => {
            Navigator.prototype.share = function share(): Promise<void> {
                const outcome = (window as unknown as Record<string, unknown>)['hcmE2eShare'];
                return outcome === 'cancel' ? Promise.reject(new DOMException('Share canceled', 'AbortError')) : Promise.resolve();
            };
        });
        await openWithAnalytics(page, lang);
        await page.getByRole('button', { name: t(lang, 'consent.accept'), exact: true }).click();
        await expect.poll(async () => (await gaEvents(mockApis)).map((event) => event.name)).toContain('page_view');

        await page.evaluate(() => {
            (window as unknown as Record<string, unknown>)['hcmE2eShare'] = 'cancel';
        });
        await chooseMenuItem(page, lang, t(lang, 'action.share'));
        await page.evaluate(() => {
            (window as unknown as Record<string, unknown>)['hcmE2eShare'] = 'ok';
        });
        await chooseMenuItem(page, lang, t(lang, 'action.share'));

        await expect.poll(async () => (await gaEvents(mockApis)).filter((event) => event.name === 'share').length).toBe(1);
        await toggleLayer(page, lang);
        await expect.poll(async () => (await gaEvents(mockApis)).map((event) => event.name)).toContain('layer_toggle');
        expect((await gaEvents(mockApis)).filter((event) => event.name === 'share')).toHaveLength(1);
    },
);
