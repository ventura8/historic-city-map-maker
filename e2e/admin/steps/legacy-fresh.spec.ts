import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { Browser, Page, Response } from '@playwright/test';

import { LEGACY_FOLDER } from '../../../scripts/site/src/admin/legacy.js';
import { E2E_CACHE_COOKIE, OLD_LEGACY_CACHE } from '../../mock-apis/admin-server.js';
import { isLoopback } from '../../mock-apis/hosts.js';
import type { EmulatorWorld } from '../support/emulators.js';
import { importCard } from '../support/legacy-import.js';
import { signInContext } from '../support/session.js';
import { seedClaimedCity, seedSetupStatus } from '../support/steps.js';
import { ADMIN_LOCK, expect, test } from '../support/test.js';
import { ADMIN_ORIGIN, ADMIN_PATH, E2E_HOSTING_DIR } from '../world.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK. This spec also rewrites the e2e
// Hosting tree's bundle, which no other admin test reads meanwhile, and puts it back after each test.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * A new release's legacy bundle is always the one read (behaviour A28; the live finding of 2026-11-08): Hosting
 * answered `legacy/<city>/photos.json` with a day's `max-age`, so after the release grew the bundle from 45 to 57
 * records the owner's browser kept the 45 for a day; step h said every photo was on the map and its first run imported
 * against the stale list. The bundle is now asked of Hosting again on every read (`cache: 'no-cache'`), and Hosting
 * answers its JSON `no-cache`. Here the e2e Hosting tree's own file is rewritten between two reads by one browser (its
 * HTTP cache shared by its tabs; no route, which would turn the cache off): the release before, then the new one. The bad
 * row first has the e2e Hosting serve the release before's bundle with the old day-long header (its test-only cookie,
 * `E2E_CACHE_COOKIE`), as the owner's browser received it: only the admin's own `no-cache` read gets past that copy.
 * It runs in a browser of its own with Chromium's HTTP cache on: any route turns that cache off, the firewall's
 * (`e2e/support/network.ts`) included, so the review of 6858f8a found the first version of this pair passing without the
 * admin's `no-cache` read. Only loopback resolves in that browser too (the projects' host rules), and every address it
 * asked is checked to be one.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

// From the repository's root, where the e2e Hosting server runs (Playwright's workers run in e2e/).
const BUNDLE = resolve(import.meta.dirname, '../../..', join(E2E_HOSTING_DIR, ADMIN_PATH, LEGACY_FOLDER, 'photos.json'));
let original = '';

test.beforeEach(async ({ adminWorld }) => {
    original = await readFile(BUNDLE, 'utf8');
    await seedClaimedCity(adminWorld.emulators, adminWorld.accounts.owner.uid);
    await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid);
});

test.afterEach(async () => {
    await writeFile(BUNDLE, original);
});

/** Hosting's bundle as a release ships it: its first `count` records. */
async function release(count: number): Promise<void> {
    await writeFile(BUNDLE, JSON.stringify((JSON.parse(original) as unknown[]).slice(0, count)));
}

/** The owner's browser with its HTTP cache on (no route), and every address its page asks. */
async function cachingBrowser(browser: Browser, emulators: EmulatorWorld): Promise<{ readonly page: Page; readonly asked: string[] }> {
    const context = await browser.newContext({ baseURL: ADMIN_ORIGIN, viewport: { width: 1440, height: 900 } });
    await signInContext(context, await emulators.signIn('owner'), Date.now());
    const page = await context.newPage();
    const asked: string[] = [];
    page.on('request', (request) => asked.push(request.url()));
    return { page, asked };
}

/** The addresses of `asked` beyond the loopback (none may be asked: nothing beyond it resolves in the test's browser). */
function beyondLoopback(asked: readonly string[]): string[] {
    return asked.filter((url) => /^(?:https?|wss?):/.test(url) && !isLoopback(new URL(url).hostname));
}

/** The next answer to the page's read of the bundle's records. */
function bundleRead(page: Page): Promise<Response> {
    return page.waitForResponse((response) => response.url().endsWith(`${LEGACY_FOLDER}/photos.json`));
}

test(
    "A tab opened after a release counts the new bundle's photos, not the copy the browser read before",
    { tag: ['@S-A28-HAPPY-BUNDLE-FRESH'] },
    async ({ page, lang }) => {
        await release(3);
        const before = bundleRead(page);
        await expect((await importCard(page, lang, 3)).action).toBeVisible();
        expect((await before).headers()['cache-control']).toBe('no-cache');

        await release(5);
        const later = await page.context().newPage();
        const read = bundleRead(later);
        await expect((await importCard(later, lang, 5)).action).toBeVisible();
        expect((await (await read).json()) as unknown[]).toHaveLength(5);
    },
);

test(
    'The bundle the browser cached under the old day-long header is never counted when Setup opens again',
    { tag: ['@S-A28-BAD-STALE-BUNDLE-REFUSED'] },
    async ({ browser, adminWorld, lang }) => {
        const { page, asked } = await cachingBrowser(browser, adminWorld.emulators);
        // The release before, read under Hosting's header before 2026-11-08: the browser may keep it for a day.
        await page.context().addCookies([{ name: E2E_CACHE_COOKIE, value: 'day', url: ADMIN_ORIGIN }]);
        await release(3);
        const before = bundleRead(page);
        await expect((await importCard(page, lang, 3)).action).toBeVisible();
        expect((await before).headers()['cache-control']).toBe(OLD_LEGACY_CACHE);

        // The release: a bigger bundle, and Hosting's new no-cache header; the browser's copy is still fresh by the old one.
        await page.context().clearCookies({ name: E2E_CACHE_COOKIE });
        await release(5);
        await page.goto('about:blank');
        const { action } = await importCard(page, lang, 5);
        await expect(action).toBeVisible();
        await expect(action).toHaveAccessibleName(/\(5\)$/);
        expect(beyondLoopback(asked)).toEqual([]);
        await page.context().close();
    },
);
