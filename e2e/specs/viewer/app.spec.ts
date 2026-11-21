import type { BrowserContext, Page } from '@playwright/test';

import { SITE_ORIGIN } from '../../fixtures/world.js';
import { sitePath } from '../../support/site.js';
import { expect, test } from '../../support/test.js';
import { chooseMenuItem, t, viewer, waitForEngineEvent } from '../../support/viewer.js';

/**
 * The installable app (behaviour V72; docs/ENGINE_API.md → *Installable app*; lesson 711: Chrome and Edge give the device's
 * accent colour only to an installed web app): each city site has a web app manifest and a service worker whose scope is
 * its folder. Every other project blocks service workers (e2e/playwright.config.ts); this spec allows them. The worker
 * goes to the network first and never keeps the data, the release's records or another origin (Mapbox), so a deploy shows
 * at once; offline, the last page and shell seen still open. Settings offers **Install app** only while the browser's
 * install prompt waits (headless Chromium never fires one: the spec fires it as Chrome would).
 */

test.use({ serviceWorkers: 'allow' });

const SCOPE = `${SITE_ORIGIN}/bucharest/`;
const WORKER = `${SCOPE}sw.js`;

/** Opens the city and waits until its worker is active and controls the page (`clients.claim`). */
async function openControlled(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await page.goto(sitePath('bucharest', { lang }));
    await waitForEngineEvent(page, 'hcm-ready');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null)).toBe(WORKER);
}

/** Every address the page's caches hold. */
async function cachedUrls(page: Page): Promise<string[]> {
    return page.evaluate(async () => {
        const names = await caches.keys();
        const lists = await Promise.all(names.map(async (name) => (await (await caches.open(name)).keys()).map((request) => request.url)));
        return lists.flat();
    });
}

/** The browser's install prompt, as Chrome fires it once the page is installable; `window.hcmPrompted` counts its use. */
async function offerInstall(page: Page): Promise<void> {
    await page.evaluate(() => {
        const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
            prompt: () => {
                const counted = window as unknown as { hcmPrompted?: number };
                counted.hcmPrompted = (counted.hcmPrompted ?? 0) + 1;
                return Promise.resolve();
            },
            userChoice: Promise.resolve({ outcome: 'dismissed' }),
        });
        window.dispatchEvent(event);
    });
}

async function manifestOf(context: BrowserContext, page: Page): Promise<{ url: string; errors: unknown[]; data?: string }> {
    const cdp = await context.newCDPSession(page);
    return cdp.send('Page.getAppManifest');
}

test(
    'The city map is an installable app: its manifest, its worker, Install app in Settings, and the last page offline',
    { tag: '@S-V72-HAPPY-INSTALLABLE' },
    async ({ page, context, lang, consoleErrors }) => {
        await openControlled(page, lang);
        // The first load came before the worker: a second one goes through it, which keeps the page and its shell.
        await page.reload();
        await waitForEngineEvent(page, 'hcm-ready');

        expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope)).toBe(SCOPE);
        const manifest = await manifestOf(context, page);
        expect(manifest.url).toBe(`${SCOPE}app.webmanifest`);
        expect(manifest.errors).toEqual([]);
        expect(JSON.parse(manifest.data ?? '{}')).toMatchObject({ display: 'standalone', start_url: './', scope: './', id: './' });
        // Nothing pops up on a visit: Settings holds the install once the browser offers it.
        await expect(page.getByRole('dialog')).toHaveCount(0);

        await offerInstall(page);
        await chooseMenuItem(page, lang, t(lang, 'settings.title'));
        const settings = viewer(page).locator('hcm-about-dialog');
        await expect(settings.getByText(t(lang, 'app.installHint'))).toBeVisible();
        // A Chromium tab on a computer: installing is the way to the device's colour, and the note says so (a phone's never
        // gets it: Android's dynamic colour does not reach a web page).
        const phone = await page.evaluate(
            () => (navigator as unknown as { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile === true,
        );
        await expect(settings.getByText(t(lang, 'accent.installFix'))).toHaveCount(phone ? 0 : 1);
        const install = settings.getByRole('button', { name: t(lang, 'app.install') });
        await expect(install).toHaveCount(phone ? 1 : 2);
        await install.first().click();
        await expect.poll(() => page.evaluate(() => (window as unknown as { hcmPrompted?: number }).hcmPrompted)).toBe(1);
        // The prompt is used once: Install app goes until the browser offers it again.
        await expect(install).toHaveCount(0);

        // Offline, the worker serves the last page and shell it saw instead of the browser's error page.
        await context.setOffline(true);
        await page.reload();
        await expect(page.locator('#historic-city-map')).toBeAttached();
        // The data and the catalogues are never kept (S-V72-BAD-NEVER-STALE): offline, only they fail to load.
        let offline: string[] = [];
        await expect
            .poll(() => {
                offline = [...offline, ...consoleErrors.takeMatching(/ERR_INTERNET_DISCONNECTED/)];
                return offline.join('\n');
            })
            .toMatch(/manifest\.json[\s\S]*i18n|i18n[\s\S]*manifest\.json/);
        await context.setOffline(false);
    },
);

test(
    'Without the browser offering the install, Settings offers none and Device accent keeps its own advice',
    { tag: '@S-V72-BAD-NO-PROMPT' },
    async ({ page, lang }) => {
        await openControlled(page, lang);
        await chooseMenuItem(page, lang, t(lang, 'settings.title'));
        const settings = viewer(page).locator('hcm-about-dialog');

        await expect(settings.getByText(t(lang, 'accent.hidden'))).toBeVisible();
        await expect(settings.getByText(t(lang, 'accent.installFix'))).toHaveCount(0);
        await expect(settings.getByRole('button', { name: t(lang, 'app.install') })).toHaveCount(0);
    },
);

test(
    'The worker never serves an old release nor keeps the data or Mapbox: a deploy shows on the next load',
    { tag: '@S-V72-BAD-NEVER-STALE' },
    async ({ page, context, lang }) => {
        await openControlled(page, lang);
        await page.reload();
        await waitForEngineEvent(page, 'hcm-ready');

        const kept = await cachedUrls(page);
        expect(kept.length).toBeGreaterThan(0);
        // Only the page and its own shell: never the data, the app manifest, another origin (Mapbox's terms) or another folder.
        expect(kept.filter((url) => !url.startsWith(SCOPE) || /manifest\.json|app\.webmanifest|\/data\//.test(url))).toEqual([]);
        expect(kept.filter((url) => /\.(?:m?js|css|woff2)$|\/$/.test(url))).toEqual(kept);

        // A deploy: the site's stylesheet changes on the server. The next load shows it, through the worker.
        await context.route(`${SCOPE}site.css`, (route) =>
            route.fulfill({ contentType: 'text/css', headers: { 'cache-control': 'no-cache' }, body: ':root { --hcm-deployed: 2; }' }),
        );
        await page.reload();
        await expect
            .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--hcm-deployed').trim()))
            .toBe('2');
        expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null)).toBe(WORKER);
    },
);

/** The build the next deploy serves (`app-build.json`), as the page script compares it with its own. */
const NEXT_BUILD = 'e2e-next-build';

/** A deploy of a new build: `app-build.json` names it, and with `script` the page's script (its own build) is the new one too. */
async function deploy(context: BrowserContext, script: boolean): Promise<void> {
    await context.route(`${SCOPE}app-build.json`, (route) =>
        route.fulfill({
            contentType: 'application/json',
            headers: { 'cache-control': 'no-cache' },
            body: JSON.stringify({ build: NEXT_BUILD }),
        }),
    );
    if (script) {
        await context.route(`${SCOPE}tab-icon.js`, async (route) => {
            const response = await route.fetch();
            const body = (await response.text()).replace(/"build":"[^"]+"/, `"build":"${NEXT_BUILD}"`);
            await route.fulfill({ response, body });
        });
    }
}

/** The page's window gets the focus back, as when the visitor returns to the installed app. */
async function focusWindow(page: Page): Promise<void> {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

/** The visitor switches to another app or tab, or back (`document.visibilityState`, as the browser fires it). */
async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
    await page.evaluate((value) => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
        document.dispatchEvent(new Event('visibilitychange'));
    }, state);
}

const hideTab = (page: Page): Promise<void> => setVisibility(page, 'hidden');

function updateSnackbar(page: Page) {
    return viewer(page).locator('hcm-snackbar[data-layout-check="update"]');
}

async function markPage(page: Page): Promise<void> {
    await page.evaluate(() => {
        Object.assign(window, { hcmBeforeDeploy: true });
    });
}

const marked = (page: Page): Promise<boolean> => page.evaluate(() => 'hcmBeforeDeploy' in window);

test(
    'A new deploy reaches the open map by itself: Reload is offered while the visitor uses it, and leaving it reloads it',
    { tag: '@S-V72-HAPPY-SELF-UPDATE' },
    async ({ page, context, lang }) => {
        await openControlled(page, lang);
        await markPage(page);

        await deploy(context, true);
        await focusWindow(page);
        // The visitor is at the map: a reload would come out of nowhere, so the snackbar says a new version is ready.
        await expect(updateSnackbar(page)).toContainText(t(lang, 'app.updateReady'));
        await expect(updateSnackbar(page).getByRole('button', { name: t(lang, 'app.reload') })).toBeVisible();
        expect(await marked(page)).toBe(true);

        // Leaving the map is a safe moment: it reloads into the new build, without the snackbar.
        const reloaded = page.waitForEvent('load');
        await hideTab(page);
        await reloaded;
        await waitForEngineEvent(page, 'hcm-ready');
        expect(await marked(page)).toBe(false);
        await focusWindow(page);
        await expect(updateSnackbar(page)).toHaveCount(0);
    },
);

test(
    'An open dialog holds the reload, Reload reloads now, and a page still older after it never reloads again by itself',
    { tag: '@S-V72-BAD-UPDATE-HELD' },
    async ({ page, context, lang }) => {
        await openControlled(page, lang);
        await chooseMenuItem(page, lang, t(lang, 'settings.title'));
        const settings = page.getByRole('dialog', { name: t(lang, 'settings.title') });
        await expect(settings).toBeVisible();
        await markPage(page);

        // Only app-build.json changes: the page that comes back after a reload is still the older build (a stale cache).
        await deploy(context, false);
        await focusWindow(page);
        await hideTab(page);
        expect(await marked(page), 'Settings open: no reload').toBe(true);
        await setVisibility(page, 'visible');

        await page.keyboard.press('Escape');
        await expect(settings).toHaveCount(0);
        const reloaded = page.waitForEvent('load');
        await updateSnackbar(page)
            .getByRole('button', { name: t(lang, 'app.reload') })
            .click();
        await reloaded;
        await waitForEngineEvent(page, 'hcm-ready');
        await markPage(page);

        // Still older: no loop. Leaving the map reloads nothing; the snackbar keeps offering Reload.
        await expect(updateSnackbar(page)).toContainText(t(lang, 'app.updateReady'));
        await hideTab(page);
        await focusWindow(page);
        expect(await marked(page)).toBe(true);
        expect(await page.evaluate(() => sessionStorage.getItem('hcm-app-reloaded-for'))).toBe(NEXT_BUILD);
    },
);
