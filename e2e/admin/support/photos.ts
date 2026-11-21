import { translateAdminContent, translateApiError, type AdminContentKey, type ApiErrorCode } from '@hcm/shared';
import { expect, type Locator, type Page } from '@playwright/test';

import type { CityWorld } from './content.js';
import { FUNCTIONS_TIMEOUT_MS } from './emulators.js';

/**
 * The photos area's world for the admin tier (docs/research/M2c-interfaces.md §6, §12.3): a city and its photos, written
 * into the Firestore emulator past the rules (as the processing trigger or an earlier session would have left them), the
 * derivatives' addresses answered with one small image, and the photos page's texts.
 */

/** A 1×1 PNG: every derivative of the seeded photos. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==', 'base64');

/** Where the seeded derivatives live (the public bucket's address, answered by `servePhotoImages`). */
const IMAGE_BASE = 'https://storage.googleapis.com/demo-hcm-public/photos';

/** An editor text (`adminContent.*`) in the project's language. */
export function photosText(lang: 'ro' | 'en', key: AdminContentKey, params: Readonly<Record<string, string>> = {}): string {
    return translateAdminContent(lang, key, params);
}

/** Answers every seeded derivative with the one-pixel image (the browser never reaches the real bucket). */
export async function servePhotoImages(page: Page): Promise<void> {
    await page.route(`${IMAGE_BASE}/**`, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));
}

/** The city document: bounds around Bucharest, published. */
export async function seedPhotosCity(world: CityWorld, at: Date): Promise<void> {
    await world.emulators.setDocument(`cities/${world.city}`, {
        name: { ro: 'București', en: 'Bucharest' },
        bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6 },
        published: true,
        updatedBy: 'system:setup',
        updatedAt: at,
    });
}

export interface SeededPhoto {
    readonly id: string;
    readonly title: string;
    readonly extra?: Readonly<Record<string, unknown>>;
}

function image(city: string, id: string): Record<string, unknown> {
    return {
        web: `${IMAGE_BASE}/${city}/${id}/web.webp`,
        thumb: `${IMAGE_BASE}/${city}/${id}/thumb.webp`,
        sha256: id
            .padEnd(64, '0')
            .slice(0, 64)
            .replace(/[^a-f0-9]/g, 'a'),
        w: 1,
        h: 1,
    };
}

/** A processed, unpublished photo of the city (its `extra` overrides any field). */
export async function seedPhoto(world: CityWorld, photo: SeededPhoto, at: Date): Promise<void> {
    const fields: Record<string, unknown> = {
        title: { ro: photo.title },
        license: 'CC-BY-4.0',
        location: { lat: 44.43, lng: 26.1 },
        published: false,
        processing: 'done',
        image: image(world.city, photo.id),
        createdAt: at,
        createdBy: world.uid,
        updatedBy: world.uid,
        updatedAt: at,
        ...photo.extra,
    };
    // An `undefined` in `extra` leaves the field out (a photo still processing has no image).
    await world.emulators.setDocument(
        `cities/${world.city}/photos/${photo.id}`,
        Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
    );
}

/** A server error's message (`apiError.photo.*`), as an upload or the editor shows it. */
export function photoError(lang: 'ro' | 'en', code: ApiErrorCode): string {
    return translateApiError(lang, code);
}

/** What an admin chose earlier, as the photos area remembers it per admin (`hcm:admin:photoSticky`, `hcm:admin:lastPin`). */
export interface RememberedChoices {
    readonly sticky?: Readonly<Record<string, string>>;
    /** `[longitude, latitude]` of the last pin. */
    readonly lastPin?: readonly [number, number];
}

/** Runs in the page before its scripts: stores what an earlier session left, unless the admin has changed it since. */
function rememberInPage(entries: readonly (readonly [string, string])[]): void {
    for (const [key, value] of entries) {
        if (localStorage.getItem(key) === null) {
            localStorage.setItem(key, value);
        }
    }
}

/** The page opens with these choices remembered, as an earlier session of the same admin left them. */
export async function rememberPhotoChoices(page: Page, choices: RememberedChoices): Promise<void> {
    const entries: (readonly [string, string])[] = [];
    if (choices.sticky !== undefined) {
        entries.push(['hcm:admin:photoSticky', JSON.stringify(choices.sticky)]);
    }
    if (choices.lastPin !== undefined) {
        entries.push(['hcm:admin:lastPin', JSON.stringify(choices.lastPin)]);
    }
    await page.addInitScript(rememberInPage, entries);
}

/** The photo list's file input (Add photos opens it; a drop hands the same files over). */
export function photoInput(page: Page): Locator {
    return page.locator('hcm-admin-photo-list input[type="file"]');
}

/** One item of the uploads panel, by its file's name. */
export function uploadItem(page: Page, name: string): Locator {
    return page.locator('hcm-admin-photo-list li.upload').filter({ hasText: name });
}

/** A row of the photo list, by its title. */
export function photoRow(page: Page, title: string): Locator {
    return page.locator('hcm-admin-photo-list li.photo-row').filter({ hasText: title });
}

/** The city's photos as `[Romanian title, field]` pairs, sorted by title. */
export async function photosBy(world: CityWorld, field: string): Promise<[string, unknown][]> {
    const photos = Object.values(await world.emulators.collection(`cities/${world.city}/photos`));
    return photos
        .map((photo): [string, unknown] => [String((photo['title'] as { ro?: string } | undefined)?.ro), photo[field]])
        .sort(([a], [b]) => a.localeCompare(b));
}

/** Waits until the city has `count` photos, every one processed by `photos.onUpload` in the Functions emulator. */
export async function awaitProcessed(world: CityWorld, count: number): Promise<void> {
    await expect
        .poll(async () => (await photosBy(world, 'processing')).map(([, state]) => state), {
            message: 'photos.onUpload processed every upload',
            timeout: FUNCTIONS_TIMEOUT_MS,
        })
        .toEqual(Array.from({ length: count }, () => 'done'));
}
