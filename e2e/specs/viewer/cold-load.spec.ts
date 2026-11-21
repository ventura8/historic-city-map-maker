import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import type { Page, Route } from '@playwright/test';

import { sitePath } from '../../support/site.js';
import { expect, test } from '../../support/test.js';

/**
 * A cold first load on a slow phone network (behaviour V01; the Pixel Tablet, 2026-11-12: the first paint came 5,376 ms
 * after a cold start against 764 ms warm). The page is loaded with the browser's cache off, Chrome DevTools' "Fast 4G"
 * (165 ms of latency, 9 Mbit/s down, 1.5 up, each at 90 %) and a CPU four times slower (CDP), on a phone and a tablet.
 *
 * The firewall answers api.mapbox.com from the mock APIs (`route.fulfill`), which the network throttling does not reach,
 * so a cold fetch from Mapbox's CDN is modelled where the route answers: a new connection (DNS, TCP and TLS, three round
 * trips) and the file's gzip bytes at the same throughput. Mapbox GL JS is 1.9 MB (526 KB gzip): before the fix the
 * engine, a module script, waited for it as for any deferred script, and nothing was painted until both had run.
 * Now Mapbox GL loads `async` and the engine renders the viewer at once, creating the map when `mapboxgl` is there
 * (packages/engine/src/mount.ts `mapboxOf`, scripts/site/src/page.ts). With the CDN two seconds slower, the page's own
 * `mapbox-gl.css` in the head held the first paint at 2.9 s; the page links none now (the viewer's shadow root does).
 */

/** Chrome DevTools' "Fast 4G" (front_end/core/sdk/NetworkManager.ts), in bytes per second. */
const FAST_4G = { offline: false, latency: 165, downloadThroughput: (9_000_000 / 8) * 0.9, uploadThroughput: (1_500_000 / 8) * 0.9 };
const CPU_SLOWDOWN = 4;
/** DNS, TCP and TLS to a new origin. */
const CONNECT_ROUND_TRIPS = 3;

/** The first contentful paint's budget in this profile (docs/research/DECISIONS-for-review.md §178). */
const FCP_BUDGET_MS = 1_800;

const SIZES = [
    { name: 'phone', width: 412, height: 915 },
    { name: 'tablet', width: 800, height: 1280 },
] as const;

/** The gzip size of a file of the pinned Mapbox GL JS release, as its CDN sends it. */
function mapboxGzipBytes(file: string): number {
    return gzipSync(readFileSync(fileURLToPath(import.meta.resolve(`mapbox-gl/dist/${file}`)))).length;
}

const MAPBOX_FILES: Readonly<Record<string, number>> = {
    'mapbox-gl.js': mapboxGzipBytes('mapbox-gl.js'),
    'mapbox-gl.css': mapboxGzipBytes('mapbox-gl.css'),
};

/** The modelled network time (not a wait for the page: the page is polled). */
function networkTime(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

/** How long a cold fetch of `url` from Mapbox's CDN takes at Fast 4G, plus `extraMs`. */
function cdnTimeMs(url: string, extraMs: number): number {
    const file = new URL(url).pathname.split('/').pop() ?? '';
    const bytes = MAPBOX_FILES[file] ?? 0;
    return CONNECT_ROUND_TRIPS * FAST_4G.latency + (bytes / FAST_4G.downloadThroughput) * 1000 + extraMs;
}

/** Mapbox GL's files take their CDN time, then the firewall answers them as usual. */
async function throttleMapbox(page: Page, extraMs: number): Promise<void> {
    await page.route(/^https:\/\/api\.mapbox\.com\/mapbox-gl-js\//, async (route: Route) => {
        await networkTime(cdnTimeMs(route.request().url(), extraMs));
        await route.fallback();
    });
}

async function throttle(page: Page): Promise<void> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', FAST_4G);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
}

interface ColdLoad {
    /** The first contentful paint, ms after navigation (0 before it). */
    readonly fcp: number;
    /** When mapbox-gl.js had arrived (0 before it). */
    readonly mapboxGlEnd: number;
}

/** In the page: the first contentful paint and when Mapbox GL JS had arrived. */
function coldLoadInPage(): ColdLoad {
    const paint = performance.getEntriesByName('first-contentful-paint')[0];
    const script = performance.getEntriesByType('resource').find((entry) => entry.name.endsWith('/mapbox-gl.js')) as
        PerformanceResourceTiming | undefined;
    return { fcp: paint?.startTime ?? 0, mapboxGlEnd: script?.responseEnd ?? 0 };
}

async function coldLoad(page: Page, size: { readonly width: number; readonly height: number }): Promise<ColdLoad> {
    await page.setViewportSize(size);
    await page.goto(sitePath('bucharest'));
    await expect
        .poll(async () => {
            const load = await page.evaluate(coldLoadInPage);
            return Math.min(load.fcp, load.mapboxGlEnd);
        })
        .toBeGreaterThan(0);
    return page.evaluate(coldLoadInPage);
}

test(
    'A cold load on Fast 4G with a slow CPU paints the viewer within its budget, on a phone and a tablet',
    { tag: '@S-V01-HAPPY-COLD-FIRST-PAINT' },
    async ({ page }) => {
        await throttleMapbox(page, 0);
        await throttle(page);
        for (const size of SIZES) {
            const load = await coldLoad(page, size);
            test.info().annotations.push({ type: 'cold-load', description: `${size.name}: FCP ${String(Math.round(load.fcp))} ms` });

            expect(load.fcp, `${size.name}: the first contentful paint`).toBeLessThan(FCP_BUDGET_MS);
        }
    },
);

test(
    'A slow Mapbox CDN does not hold back the first paint: the viewer paints before Mapbox GL JS has arrived',
    { tag: '@S-V01-BAD-SLOW-MAPBOX-FIRST-PAINT' },
    async ({ page }) => {
        // Two more seconds on Mapbox's files: the engine must not wait for them to draw the viewer.
        await throttleMapbox(page, 2_000);
        await throttle(page);
        for (const size of SIZES) {
            const load = await coldLoad(page, size);
            test.info().annotations.push({
                type: 'cold-load',
                description: `${size.name}: FCP ${String(Math.round(load.fcp))} ms, mapbox-gl.js ${String(Math.round(load.mapboxGlEnd))} ms`,
            });

            // Relative, not the budget: the happy row holds the budget; this one asks only that Mapbox GL is not waited for.
            expect(load.fcp, `${size.name}: painted before mapbox-gl.js arrived`).toBeLessThan(load.mapboxGlEnd);
        }
    },
);
