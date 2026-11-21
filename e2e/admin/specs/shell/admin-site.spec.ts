import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { BrowserContext, Page } from '@playwright/test';

import { splitAdminSite } from '../../../../scripts/site/src/hosting/admin-site.js';
import { E2E_CITY_ID } from '../../../fixtures/world.js';
import { hostingUrl, serveBucketCity } from '../../../support/hosting.js';
import { waitForEngineEvent } from '../../../support/viewer.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { FIREBASE_USER_KEY } from '../../support/session.js';
import { ADMIN_ORIGIN, ADMIN_PATH } from '../../world.js';

// One admin test at a time: the owner's sign-in and the project are shared.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The admin on its own web address (behaviour A160; the owner's decision of 2026-11-13, DECISIONS-for-review.md §210):
 * the admin's own Hosting site shares its origin with no page of the public map, so the owner signs in once and every
 * tab is signed in (the origin's IndexedDB), while a public map page, on its own origin, reads nothing of it. The e2e
 * world plays the two sites with two loopback origins of the same server: `localhost` is the admin's own site (its
 * `runtime.json` names that origin, as the site build writes it there), `127.0.0.1` the public map's. Without the admin's
 * site (any other origin in `runtime.json`, or none) the admin keeps the sign-in in its tab, as since M6. The old
 * `/admin/…` addresses answer 301 with the rule the site build writes (`scripts/site/src/hosting/admin-site.ts`), played
 * by a route, and the browser keeps the hash route across it.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

/** The admin's own site in the e2e world: the same server on its other loopback name. */
const OWN_ORIGIN = ADMIN_ORIGIN.replace('127.0.0.1', 'localhost');

/** Runs in the page: where the origin keeps a Firebase sign-in. */
async function signInStorage(): Promise<string[]> {
    const holds = (storage: Storage): boolean => Object.keys(storage).some((key) => key.startsWith('firebase:authUser:'));
    const databases = (await indexedDB.databases()).map((database) => database.name ?? '');
    return [
        ...(holds(localStorage) ? ['localStorage'] : []),
        ...(holds(sessionStorage) ? ['sessionStorage'] : []),
        ...(databases.includes('firebaseLocalStorageDb') ? ['indexedDB'] : []),
    ];
}

/** `runtime.json` as the site build writes it on the admin's site: naming `adminOrigin`. */
async function runtimeNaming(context: BrowserContext, origin: string, adminOrigin: string): Promise<void> {
    await context.route(`${origin}${ADMIN_PATH}runtime.json`, async (route) => {
        const response = await route.fetch();
        const runtime = (await response.json()) as Record<string, unknown>;
        await route.fulfill({ response, json: { ...runtime, adminOrigin } });
    });
}

/**
 * The owner's one sign-in on the admin's own site. The test's own sign-in (`../../support/session.ts`) seeds every tab's
 * `sessionStorage`, which the admin's own site does not read: on that origin it is dropped, and the account is put once,
 * for the first document only, where Firebase moves a sign-in into the origin's IndexedDB from (`localStorage`). A later
 * tab finds it only where the origin keeps it.
 */
async function signInOnce(context: BrowserContext): Promise<void> {
    await context.addInitScript(
        ({ key, own }: { readonly key: string; readonly own: string }) => {
            if (location.origin !== own) {
                return;
            }
            const value = sessionStorage.getItem(key);
            sessionStorage.removeItem(key);
            if (value !== null && localStorage.getItem('hcm:e2e:ownSiteSeeded') === null) {
                localStorage.setItem('hcm:e2e:ownSiteSeeded', '1');
                localStorage.setItem(key, value);
            }
        },
        { key: FIREBASE_USER_KEY, own: OWN_ORIGIN },
    );
}

async function home(page: Page, origin: string, lang: 'ro' | 'en', route = 'home'): Promise<void> {
    await page.goto(`${origin}${adminPath(lang, route)}`);
    await expect(page.locator('hcm-home-page')).toBeVisible();
}

test("Signed in once on the admin's own site, a new tab is signed in too", { tag: '@S-A160-HAPPY-ONE-SIGN-IN' }, async ({ page, lang }) => {
    await runtimeNaming(page.context(), OWN_ORIGIN, OWN_ORIGIN);
    await signInOnce(page.context());
    await home(page, OWN_ORIGIN, lang);
    // The sign-in is the origin's IndexedDB's, where every tab of the admin's site finds it.
    await expect.poll(() => page.evaluate(signInStorage)).toEqual(['indexedDB']);

    const second = await page.context().newPage();
    await home(second, OWN_ORIGIN, lang);

    expect(await second.evaluate(signInStorage)).toEqual(['indexedDB']);
    await second.close();
});

test(
    "A public map page, on its own origin, reads nothing of the admin's sign-in",
    { tag: '@S-A160-BAD-VIEWER-READS-NOTHING' },
    async ({ page, lang }) => {
        await runtimeNaming(page.context(), OWN_ORIGIN, OWN_ORIGIN);
        await signInOnce(page.context());
        await home(page, OWN_ORIGIN, lang);
        await expect.poll(() => page.evaluate(signInStorage)).toEqual(['indexedDB']);
        const viewer = await page.context().newPage();
        await serveBucketCity(viewer, { city: E2E_CITY_ID, site: 'bucharest' });

        await viewer.goto(hostingUrl('/', { lang }));
        await waitForEngineEvent(viewer, 'hcm-ready');

        expect(await viewer.evaluate(signInStorage)).toEqual([]);
        await viewer.close();
    },
);

test("Without the admin's own site the sign-in stays in the admin's tab", { tag: '@S-A160-BAD-NO-ADMIN-SITE' }, async ({ page, lang }) => {
    // A runtime naming another origin (the admin's site exists, but this copy is served from the public map's) is not it.
    await runtimeNaming(page.context(), ADMIN_ORIGIN, OWN_ORIGIN);
    await home(page, ADMIN_ORIGIN, lang);

    await page.reload();

    await expect(page.locator('hcm-home-page')).toBeVisible();
    expect(await page.evaluate(signInStorage)).toEqual(['sessionStorage']);
});

/** The public map's forward of `/admin/…` as the site build writes it into `firebase.json`, made from a tree in a folder. */
function forwardRule(): { readonly pattern: RegExp; readonly destination: string } {
    const dir = mkdtempSync(join(tmpdir(), 'hcm-e2e-admin-site-'));
    try {
        mkdirSync(join(dir, 'public/admin'), { recursive: true });
        writeFileSync(join(dir, 'public/admin/index.html'), 'the admin');
        const hosting = (
            JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../firebase.json'), 'utf8')) as {
                hosting: Record<string, unknown>;
            }
        ).hosting;
        writeFileSync(join(dir, 'firebase.json'), JSON.stringify({ hosting: { ...hosting, site: 'demo-hcm', public: 'public' } }));
        splitAdminSite({ config: join(dir, 'firebase.json'), siteId: 'demo-hcm-admin' });
        const split = JSON.parse(readFileSync(join(dir, 'firebase.json'), 'utf8')) as {
            hosting: { redirects: Record<string, string>[] }[];
        };
        const rule = split.hosting[0]?.redirects[1];
        return { pattern: new RegExp(String(rule?.['regex']).replace('(?P<', '(?<')), destination: String(rule?.['destination']) };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

test(
    "An old admin address forwards to the admin's own site with its route",
    { tag: '@S-A160-HAPPY-OLD-LINK-FORWARDS' },
    async ({ page, lang }) => {
        const rule = forwardRule();
        // Hosting's 301 of the public map's `/admin/…`, to the e2e world's admin site instead of `demo-hcm-admin.web.app`.
        await page.context().route(`${ADMIN_ORIGIN}${ADMIN_PATH}**`, async (route) => {
            const path = new URL(route.request().url()).pathname;
            const rest = rule.pattern.exec(path)?.groups?.['rest'];
            const location = `${rule.destination.replace(':rest', rest ?? '')}${new URL(route.request().url()).search}`;
            await route.fulfill({ status: 301, headers: { location: location.replace('https://demo-hcm-admin.web.app', OWN_ORIGIN) } });
        });
        await runtimeNaming(page.context(), OWN_ORIGIN, OWN_ORIGIN);
        await signInOnce(page.context());

        await page.goto(`${ADMIN_ORIGIN}${adminPath(lang, 'settings')}`);

        await expect(page).toHaveURL(`${OWN_ORIGIN}${adminPath(lang, 'settings')}`);
        await expect(page.locator('hcm-settings-page')).toBeVisible();
    },
);

test(
    "The starter list and the public map's own pages are never forwarded to the admin's site",
    { tag: '@S-A160-BAD-NOT-FORWARDED' },
    async ({ page, lang }) => {
        const rule = forwardRule();
        await serveBucketCity(page, { city: E2E_CITY_ID, site: 'bucharest' });

        await page.goto(hostingUrl('/', { lang }));
        await waitForEngineEvent(page, 'hcm-ready');

        expect(new URL(page.url()).origin).toBe(ADMIN_ORIGIN);
        // A Linux starter from before §210 reads its list with curl and no -L: a redirect would stop its self-update.
        expect(['/admin/starter.json', '/', `/${E2E_CITY_ID}/`].filter((path) => rule.pattern.test(path))).toEqual([]);
    },
);
