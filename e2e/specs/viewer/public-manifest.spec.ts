import type { Page, Request, Route } from '@playwright/test';

import { E2E_PUBLIC_BUCKET, SITE_ORIGIN } from '../../fixtures/world.js';
import { serveCityIcons } from '../../support/hosting.js';
import { sitePath } from '../../support/site.js';
import { expect, test } from '../../support/test.js';
import { engineEvents, t, waitForEngineEvent } from '../../support/viewer.js';

/**
 * The city page reads the manifest the admin publishes (behaviour V01; PLAN → Architecture: the public viewer GETs
 * `gs://<project>-public/cities/{city}/manifest.json`; DECISIONS-for-review.md §51e). The e2e site `bucharest-bucket` is
 * the Bucharest site built with the public bucket named (`HCM_PUBLIC_BUCKET`): its config.js names the bucket's manifest
 * and it bundles no snapshot. The bucket is an external boundary: these tests answer it themselves, with the same files
 * the plain e2e site serves (the manifest and its photos), or with a 404.
 */

const BUCKET = `https://storage.googleapis.com/${E2E_PUBLIC_BUCKET}/cities/bucharest/`;

/** The bucket's city folder is the plain e2e site's `data/` folder: the manifest and, relative to it, the photos. */
function siteFileOf(url: string): string {
    return `${SITE_ORIGIN}${sitePath('bucharest')}data/${url.slice(BUCKET.length)}`;
}

/** Answers the public bucket as the admin's publish leaves it: the city's manifest and photos. */
async function serveBucket(page: Page): Promise<string[]> {
    const asked: string[] = [];
    await page.route(`${BUCKET}**`, async (route: Route) => {
        asked.push(route.request().url());
        await route.fulfill({ response: await route.fetch({ url: siteFileOf(route.request().url()) }) });
    });
    await serveCityIcons(page, BUCKET);
    return asked;
}

/** Every request the page makes for a bundled snapshot of the manifest next to it. */
function bundledSnapshots(page: Page): Request[] {
    const seen: Request[] = [];
    page.on('request', (request) => {
        if (request.url().includes('/bucharest-bucket/data/')) {
            seen.push(request);
        }
    });
    return seen;
}

test(
    'The city page reads the manifest the admin published to the public bucket, and no bundled snapshot',
    { tag: '@S-V01-HAPPY-PUBLIC-BUCKET' },
    async ({ page, lang }) => {
        const asked = await serveBucket(page);
        const snapshots = bundledSnapshots(page);

        await page.goto(sitePath('bucharest-bucket', { lang, hash: '18/44.42955/26.09560&photo=strandul-opereta-1976' }));
        await waitForEngineEvent(page, 'hcm-ready');

        await expect(page.getByRole('heading', { name: 'Ștrandul Operetă' })).toBeVisible();
        await expect.poll(() => asked.filter((url) => url.endsWith('.webp')).length).toBeGreaterThan(0);
        expect(asked[0]).toBe(`${BUCKET}manifest.json`);
        expect(snapshots).toEqual([]);
        expect(await engineEvents(page, 'hcm-ready')).toEqual([expect.objectContaining({ cityId: 'bucharest' })]);
    },
);

test(
    'A public bucket without the manifest shows the not-found card, never a stale snapshot',
    { tag: '@S-V01-BAD-PUBLIC-BUCKET-404' },
    async ({ page, lang, consoleErrors }) => {
        await page.route(`${BUCKET}**`, (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' }));
        // The tab icon's probes are answered apart: this row is about the manifest's 404 line.
        await serveCityIcons(page, BUCKET);
        const snapshots = bundledSnapshots(page);

        await page.goto(sitePath('bucharest-bucket', { lang }));

        await expect(page.getByRole('alert')).toContainText(t(lang, 'error.manifest.notFound'));
        expect(await engineEvents(page, 'hcm-error')).toEqual([{ code: 'error.manifest.notFound', retryable: true, detail: '404' }]);
        expect(snapshots).toEqual([]);
        expect(consoleErrors.take()).toEqual([expect.stringContaining('404')]);
    },
);
