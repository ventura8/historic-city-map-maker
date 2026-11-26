import type { Page } from '@playwright/test';

import { E2E_CITY_ID } from '../../fixtures/world.js';
import { compareBar, expectMapCounts } from '../../support/compare.js';
import { analyticsManifest, gaEvents } from '../../support/ga4.js';
import { connectPad, installFakePads } from '../../support/gamepad.js';
import { expect, test } from '../../support/test.js';
import { serveManifest, t, viewer } from '../../support/viewer.js';

/**
 * The IIFE's extras on demand (behaviour V63, docs/ENGINE_API.md → *Extras on demand*, DECISIONS-for-review.md §186): a
 * page that loads `engine.iife.js` fetches no extra for its first paint; the first Compare adds swipe compare's
 * `extra-compare-<hash>.js` beside the engine as a script with its integrity, once, and compare works. An extra that does
 * not arrive closes compare with a message that says to try again, and the next Compare fetches it afresh. The other
 * extras come the same way: the Firebase SDK and the field chunk after the analytics consent, the gamepad's once a pad
 * connects.
 */

/** A page of its own beside the site, as a third party embeds the engine (the embed API's page, V21). */
const EXTRAS_PAGE = '/bucharest/extras-e2e.html';
const EXTRAS_HTML = `<!DOCTYPE html>
<html lang="ro">
<head>
<meta charset="utf-8"><title>Extras e2e</title><link rel="icon" href="data:,">
<script src="https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.js"></script>
<script src="engine/engine.iife.js"></script>
<style>html, body, #embed { margin: 0; width: 100%; height: 100%; }</style>
</head>
<body><div id="embed"></div></body>
</html>`;

const WIDE = { width: 1280, height: 800 };
const EXTRA_COMPARE = /\/engine\/extra-compare-[\w-]{8}\.js$/;
const EXTRA_FIREBASE_SDK = /\/engine\/extra-firebase-sdk-[\w-]{8}\.js$/;
const EXTRA_FIELD_SDK = /\/engine\/extra-field-sdk-[\w-]{8}\.js$/;
const EXTRA_GAMEPAD = /\/engine\/extra-gamepad-[\w-]{8}\.js$/;
const INTEGRITY = /^sha384-[\w+/]{64}$/;

interface ExtrasWindow {
    HistoricCityMap: {
        mount(element: Element, config: unknown): Record<string, (...args: unknown[]) => unknown> & { ready: Promise<unknown> };
    };
    hcmE2eController?: Record<string, (...args: unknown[]) => unknown>;
}

/** Opens the page and mounts the viewer; returns every extra the page asked for, as it asks. */
async function openPage(page: Page): Promise<string[]> {
    const requested: string[] = [];
    page.on('request', (request) => {
        if (/\/extra-[\w-]+\.js$/.test(request.url())) {
            requested.push(new URL(request.url()).pathname);
        }
    });
    await page.setViewportSize(WIDE);
    await page.route(`**${EXTRAS_PAGE}`, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: EXTRAS_HTML }));
    await page.goto(EXTRAS_PAGE);
    const ready = await page.evaluate(async () => {
        const scope = window as unknown as ExtrasWindow;
        const controller = scope.HistoricCityMap.mount(document.getElementById('embed') as Element, {
            cityId: 'bucharest',
            manifestUrl: './data/manifest.json',
        });
        scope.hcmE2eController = controller;
        return controller.ready;
    });
    expect(ready).toEqual({ ok: true, cityId: E2E_CITY_ID });
    await expect(viewer(page).locator('canvas.mapboxgl-canvas')).toBeVisible();
    return requested;
}

async function openCompare(page: Page): Promise<void> {
    await page.evaluate(() => {
        (window as unknown as ExtrasWindow).hcmE2eController?.['openCompare']?.(null);
    });
}

test(
    'The IIFE fetches swipe compare only at the first Compare, once, as a script with its integrity',
    { tag: '@S-V63-HAPPY-EXTRAS-ON-DEMAND' },
    async ({ page }) => {
        const requested = await openPage(page);
        expect(requested).toEqual([]);
        await expect(page.locator('script[src*="extra-"]')).toHaveCount(0);

        await openCompare(page);

        await expect(compareBar(page, 'ro')).toBeVisible();
        await expectMapCounts(page, 2, 0);
        expect(requested).toHaveLength(1);
        expect(requested[0]).toMatch(EXTRA_COMPARE);
        const script = page.locator('head script[src*="extra-compare-"]');
        await expect(script).toHaveAttribute('integrity', INTEGRITY);
        await expect(script).toHaveAttribute('crossorigin', 'anonymous');

        await page.evaluate(() => {
            (window as unknown as ExtrasWindow).hcmE2eController?.['closeCompare']?.();
        });
        await expect(compareBar(page, 'ro')).toHaveCount(0);
        await openCompare(page);
        await expect(compareBar(page, 'ro')).toBeVisible();
        expect(requested).toHaveLength(1);
        await expect(page.locator('head script[src*="extra-compare-"]')).toHaveCount(1);
    },
);

test(
    'An extra that does not arrive closes compare with a message to try again, and the next Compare fetches it afresh',
    { tag: '@S-V63-BAD-EXTRAS-CHUNK-FAILS' },
    async ({ page, consoleErrors }) => {
        await page.route(EXTRA_COMPARE, (route) => route.abort('connectionrefused'));
        const requested = await openPage(page);

        await openCompare(page);

        const toast = page.getByRole('status').filter({ hasText: t('ro', 'error.extraLoad') });
        await expect(toast).toBeVisible();
        await expect(compareBar(page, 'ro')).toHaveCount(0);
        await expect(page.locator('head script[src*="extra-compare-"]')).toHaveCount(0);
        await expectMapCounts(page, 1, 0);
        await expect(viewer(page).locator('canvas.mapboxgl-canvas')).toBeVisible();
        expect(requested).toHaveLength(1);
        expect(consoleErrors.take()).toEqual([expect.stringContaining('ERR_CONNECTION_REFUSED')]);

        await page.unroute(EXTRA_COMPARE);
        await openCompare(page);

        await expect(compareBar(page, 'ro')).toBeVisible();
        await expectMapCounts(page, 2, 0);
        expect(requested).toHaveLength(2);
    },
);

/** The page's scripts added for `name`'s extra: each one in head, with its integrity and CORS. */
async function expectOneExtraScript(page: Page, name: string): Promise<void> {
    const script = page.locator(`head script[src*="/extra-${name}-"]`);
    await expect(script).toHaveCount(1);
    await expect(script).toHaveAttribute('integrity', INTEGRITY);
    await expect(script).toHaveAttribute('crossorigin', 'anonymous');
}

test(
    'The IIFE fetches the analytics extras only after the consent and the gamepad extra only with a pad, each once',
    { tag: '@S-V63-HAPPY-EXTRAS-CONSENT-AND-PAD' },
    async ({ page, mockApis }) => {
        await serveManifest(page, analyticsManifest());
        await installFakePads(page);
        const requested = await openPage(page);
        await expect(viewer(page).locator('hcm-consent-banner')).toBeVisible();
        expect(requested).toEqual([]);

        await page.getByRole('button', { name: t('ro', 'consent.accept'), exact: true }).click();

        await expect.poll(() => requested.filter((path) => EXTRA_FIELD_SDK.test(path))).toHaveLength(1);
        expect(requested.filter((path) => EXTRA_FIREBASE_SDK.test(path))).toHaveLength(1);
        await expectOneExtraScript(page, 'firebase-sdk');
        await expectOneExtraScript(page, 'field-sdk');
        await expect.poll(async () => (await gaEvents(mockApis)).map((event) => event.name)).toContain('viewer_timing');

        await connectPad(page);
        await expect(
            viewer(page)
                .locator('hcm-snackbar .snackbar')
                .filter({ hasText: t('ro', 'gamepad.ready') }),
        ).toBeVisible();
        expect(requested.filter((path) => EXTRA_GAMEPAD.test(path))).toHaveLength(1);
        await expectOneExtraScript(page, 'gamepad');
        expect(requested).toHaveLength(3);
    },
);
