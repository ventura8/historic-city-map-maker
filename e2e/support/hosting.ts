import { DEFAULT_FAVICON_DATA_URL } from '@hcm/shared/tab-icon';
import type { BrowserContext, Page, Route } from '@playwright/test';

import { ADMIN_ORIGIN } from '../admin/world.js';
import { E2E_PUBLIC_BUCKET, SITE_ORIGIN } from '../fixtures/world.js';
import { E2E_VARIANT_COOKIE, START_UP_VARIANT } from '../mock-apis/admin-server.js';

/**
 * The e2e Firebase Hosting site (M6, docs/research/M6-interfaces.md §2; e2e/mock-apis/admin-server.ts): the public map at
 * its root, every other city at `/<city>/` (a committed site, or the generic city page for a city made in the admin), the
 * admin under `/admin/`. Its pages read the public bucket `e2e-hcm-public`, an external boundary the specs answer
 * themselves with the files the plain e2e sites serve (their `data/` folders), or with a 404.
 */

export interface HostingOpenOptions {
    readonly lang?: 'ro' | 'en';
    /** The address's hash without `#`. */
    readonly hash?: string;
}

/** The e2e Hosting server's address of `path` (`/`, `/bacau/`), with the language and the hash. */
export function hostingUrl(path: string, options: HostingOpenOptions = {}): string {
    const query = options.lang === undefined ? '' : `?lang=${options.lang}`;
    const hash = options.hash === undefined ? '' : `#${options.hash}`;
    return `${ADMIN_ORIGIN}${path}${query}${hash}`;
}

/** The public bucket's folder of `city`. */
export function bucketFolder(city: string): string {
    return `https://storage.googleapis.com/${E2E_PUBLIC_BUCKET}/cities/${city}/`;
}

/** Where the bucket's copy of a city comes from: a plain e2e site's `data/` folder, its manifest's city renamed. */
export interface BucketCity {
    readonly city: string;
    /** The plain e2e site (`dist/e2e-site/<site>`) whose `data/` holds the manifest and photos. */
    readonly site: string;
}

/** The manifest of `site` as the admin would publish it for `city` (`city.id` renamed). */
async function publishedManifest(route: Route, source: BucketCity): Promise<void> {
    const response = await route.fetch({ url: `${SITE_ORIGIN}/${source.site}/data/manifest.json` });
    const manifest = (await response.json()) as { city: Record<string, unknown> };
    await route.fulfill({
        response,
        json: { ...manifest, city: { ...manifest.city, id: source.city, ownIcon: true } },
        headers: { 'access-control-allow-origin': '*' },
    });
}

/** The tab icon the build draws for every published city (the default), as a PNG's bytes. */
const CITY_ICON_PNG = Buffer.from(DEFAULT_FAVICON_DATA_URL.slice(DEFAULT_FAVICON_DATA_URL.indexOf(',') + 1), 'base64');

/**
 * Answers the tab icon's files of a city's folder in the public bucket (`icon-own-32.png`, `icon-180.png`: what a page
 * that reads the bucket probes, behaviours V54 and V55), apart from the folder's other routes and unrecorded: a spec
 * about the manifest registers it after its own route, so the probes add no request to its list and no 404 line.
 */
export async function serveCityIcons(page: Page, folder: string): Promise<void> {
    await page.route(`${folder}icon-*.png`, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: CITY_ICON_PNG }));
}

/**
 * Answers the public bucket's folder of `source.city` as the admin's publish leaves it, for a city whose editor uploaded
 * its tab icon (the manifest's `city.ownIcon`): the manifest and, relative to it,
 * the photos, and the city's tab icon (behaviour V54: the generic city page fetches it to show it). Returns the addresses
 * asked, in order, the icon's left out.
 */
export async function serveBucketCity(page: Page, source: BucketCity): Promise<string[]> {
    const folder = bucketFolder(source.city);
    const asked: string[] = [];
    await page.route(`${folder}**`, async (route) => {
        const url = route.request().url();
        asked.push(url);
        if (url === `${folder}manifest.json`) {
            await publishedManifest(route, source);
            return;
        }
        await route.fulfill({ response: await route.fetch({ url: `${SITE_ORIGIN}/${source.site}/data/${url.slice(folder.length)}` }) });
    });
    await serveCityIcons(page, folder);
    return asked;
}

/** The bucket answers 404 for `city`, as for a city never published. */
export async function bucketWithout(page: Page, city: string): Promise<string[]> {
    const asked: string[] = [];
    await page.route(`${bucketFolder(city)}**`, async (route) => {
        asked.push(route.request().url());
        await route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' });
    });
    return asked;
}

/** The browser sees the start-up variant of the site (the first deploy of a new map, before Publish the map). */
export async function useStartUpVariant(context: BrowserContext): Promise<void> {
    await context.addCookies([{ name: E2E_VARIANT_COOKIE, value: START_UP_VARIANT, url: ADMIN_ORIGIN }]);
}

/** The Content-Security-Policy headers of a response (none on a viewer page, one on the admin's). */
export function policyHeaders(headers: readonly { readonly name: string; readonly value: string }[]): string[] {
    return headers.filter((header) => header.name.toLowerCase() === 'content-security-policy').map((header) => header.value);
}
