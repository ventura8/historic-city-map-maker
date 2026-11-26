import { gunzipSync } from 'node:zlib';

import { STORAGE_PATHS, translateAdminContent, validateManifest, type AdminContentKey } from '@hcm/shared';
import { expect, type Page } from '@playwright/test';

import { siteManifestData, type Json } from '../../fixtures/manifest.js';
import { E2E_CITY_ID, E2E_TOKEN, SITE_ORIGIN } from '../../fixtures/world.js';
import { mapIdle } from '../../support/map.js';
import { sitePath } from '../../support/site.js';
import { serveManifest, waitForEngineEvent } from '../../support/viewer.js';
import { E2E_PROJECT_ID } from '../world.js';
import type { CityWorld } from './content.js';
import { FUNCTIONS_TIMEOUT_MS } from './emulators.js';

/**
 * From the admin to the public viewer (behaviour A41, docs/research/M2c-interfaces.md §12.3 "Admin to viewer"): the
 * admin saves in the editors against the emulators; the publish trigger, the manifest build (the Cloud Tasks emulator
 * dispatches it at once) and the history triggers run in the Functions emulator; the spec then reads the manifest the
 * build wrote into the Storage emulator's public bucket, serves exactly that manifest to the built viewer of the site
 * server, and asserts what a visitor sees. Every value is a generated test value.
 */

/** The public bucket the manifest build writes (`functions/src/deps.ts`: `<project>-public`). */
const PUBLIC_BUCKET = `${E2E_PROJECT_ID}-public`;

/** How long a manifest build may take: the trigger, the task and the build in the Functions emulator. */
const BUILD_TIMEOUT_MS = FUNCTIONS_TIMEOUT_MS;

/** An editor text (`adminContent.*`) in the project's language. */
export function flowText(lang: 'ro' | 'en', key: AdminContentKey, params: Readonly<Record<string, string>> = {}): string {
    return translateAdminContent(lang, key, params);
}

/**
 * The city as Setup leaves it once Mapbox is connected: bounds around Bucharest, its start view, About, the privacy text
 * and the theme of the built site (a manifest needs all three), the viewer's public token (the e2e token the mock Mapbox
 * accepts: without one the build refuses to publish), the photos overlay, published.
 */
export async function seedPublicCity(world: CityWorld, at: Date): Promise<void> {
    const site = siteManifestData()['city'] as Json;
    await world.emulators.setDocument(`cities/${world.city}`, {
        about: site['about'],
        privacy: site['privacy'],
        theme: site['theme'],
        name: { ro: 'București', en: 'Bucharest' },
        bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6 },
        center: { lat: 44.43, lng: 26.1 },
        zoom: 13,
        mapbox: { user: 'e2e-user', publicToken: E2E_TOKEN },
        photosOverlay: { defaultOpacity: 1 },
        published: true,
        updatedBy: 'system:setup',
        updatedAt: at,
    });
}

/** The manifest the last build published (gzip JSON in the public bucket), or undefined before the first build. */
async function publicManifest(world: CityWorld): Promise<Json | undefined> {
    const stored = await world.emulators.storageObject(PUBLIC_BUCKET, STORAGE_PATHS.manifest(world.city));
    if (stored === undefined) {
        return undefined;
    }
    const gzip = stored[0] === 0x1f && stored[1] === 0x8b;
    return JSON.parse((gzip ? gunzipSync(stored) : stored).toString('utf8')) as Json;
}

/**
 * Waits until a build published a manifest of the world's city for which `check` holds, and returns it. When none comes,
 * the failure says how the last build ended (`manifests/<city>`: its status, error and skipped documents).
 */
export async function awaitManifest(world: CityWorld, what: string, check: (manifest: Json) => boolean): Promise<Json> {
    let found: Json | undefined;
    // On a timeout the poll's last value says how far the build got (its `manifests` record).
    const built = async (): Promise<string> => {
        found = await publicManifest(world);
        const done = found !== undefined && check(found);
        const record = done ? undefined : await world.emulators.document(`manifests/${world.city}`);
        return done ? 'built' : `the last build: ${JSON.stringify(record)}`;
    };
    await expect.poll(built, { message: `the public manifest ${what}`, timeout: BUILD_TIMEOUT_MS }).toBe('built');
    return found ?? {};
}

/** The entries of a manifest list (`photos`, `pois`, `layers`) as plain objects. */
export function entries(manifest: Json, list: 'photos' | 'pois' | 'layers'): Json[] {
    const value = manifest[list];
    return Array.isArray(value) ? (value as Json[]) : [];
}

/** The entry `id` of a manifest list, if the manifest has it. */
export function entry(manifest: Json, list: 'photos' | 'pois' | 'layers', id: string): Json | undefined {
    return entries(manifest, list).find((item) => item['id'] === id);
}

/**
 * The built manifest as the built Bucharest site can show it: every photo's derivatives pointed at a picture the site
 * already serves (the public bucket is the Storage emulator's, which the built viewer's Content Security Policy does not
 * list: it lists the real bucket's host), and a content world's city named as the site's (`bucharest`: the site's
 * `config.js` names it, `DECISIONS-for-review.md` §35b, and the viewer refuses a manifest of another city). Nothing else
 * changes.
 */
function withSiteImages(manifest: Json): Json {
    const [first] = entries(siteManifestData(), 'photos');
    const image = (first?.['image'] ?? {}) as Json;
    const photos = entries(manifest, 'photos').map((photo) => ({
        ...photo,
        image: { ...(photo['image'] as Json), web: image['web'], thumb: image['thumb'] },
    }));
    return { ...manifest, city: { ...(manifest['city'] as Json), id: E2E_CITY_ID }, photos };
}

/**
 * Opens the built Bucharest viewer as a visitor, served `manifest` (the one the admin's save published), in `lang` at
 * `hash`, and waits for `hcm-ready` and an idle map. The manifest must pass the viewer's own validation first.
 */
export async function openPublicViewer(
    page: Page,
    manifest: Json,
    options: { readonly lang: 'ro' | 'en'; readonly hash: string },
): Promise<void> {
    const served = withSiteImages(manifest);
    const validation = validateManifest(served);
    expect(validation.ok ? [] : validation.issues, 'the published manifest passes the viewer validation').toEqual([]);
    await serveManifest(page, served);
    await page.goto(`${SITE_ORIGIN}${sitePath('bucharest', options)}`);
    await waitForEngineEvent(page, 'hcm-ready');
    await mapIdle(page);
}
