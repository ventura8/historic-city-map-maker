import { STORAGE_PATHS, translateAdminContent, type AdminContentKey } from '@hcm/shared';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { ADMIN_WEB_CONFIG, E2E_PROJECT_ID, emulatorOrigin } from '../../world.js';
import type { ContentWorld } from '../../support/content.js';
import { seedPublicCity } from '../../support/flows.js';
import { seedPhoto } from '../../support/photos.js';

/**
 * The static export's world for the admin tier (M5, docs/research/M5-interfaces.md §5, behaviour A53): a published city
 * of the test's own with one photo licensed for this map only, whose files the photo pipeline would have left in the
 * public bucket (written into the Storage emulator past its rules), export records as `export.start` and
 * `export.build` leave them, and the mocked public-storage host's answer to the stand-in signer's address: the object the
 * task wrote, read from the Storage emulator, saved under its name. Every value is a generated test value.
 */

export const AT = new Date('2026-10-17T09:00:00.000Z');
export const PHOTO = 'opera-1940';
const PUBLIC_BUCKET = `${E2E_PROJECT_ID}-public`;
const EMULATOR_ADMIN = { authorization: 'Bearer owner' } as const;
/** A tiny WebP (RIFF header and a VP8L frame of one pixel): what the photo pipeline would have written. */
const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');

export function exportText(lang: 'ro' | 'en', key: AdminContentKey, params: Readonly<Record<string, string>> = {}): string {
    return translateAdminContent(lang, key, params);
}

/** The settings page's Export the city section. */
export function exportSection(page: Page): Locator {
    return page.locator('hcm-settings-page section[data-section="export"]');
}

async function upload(api: APIRequestContext, path: string): Promise<void> {
    const query = new URLSearchParams({ uploadType: 'media', name: path });
    const response = await api.post(`${emulatorOrigin('storage')}/upload/storage/v1/b/${PUBLIC_BUCKET}/o?${query.toString()}`, {
        headers: { ...EMULATOR_ADMIN, 'content-type': 'image/webp' },
        data: WEBP,
    });
    if (!response.ok()) {
        throw new Error(`upload of gs://${PUBLIC_BUCKET}/${path}: ${String(response.status())} ${await response.text()}`);
    }
}

/** The city, published, with one photo licensed for this map only and its two files in the public bucket. */
export async function seedExportableCity(world: ContentWorld, api: APIRequestContext): Promise<void> {
    await seedPublicCity(world, AT);
    for (const variant of ['web', 'thumb']) {
        await upload(api, `photos/${world.city}/${PHOTO}/${variant}.webp`);
    }
    await seedPhoto(
        world,
        {
            id: PHOTO,
            title: 'Opera, 1940',
            extra: { published: true, license: 'permission', rightsHolder: 'Arhiva familiei', permissionNote: 'Acordul familiei, 2015' },
        },
        AT,
    );
}

/** A city that was never published: its document only, nothing in the public bucket. */
export async function seedUnpublishedCity(world: ContentWorld): Promise<void> {
    await world.setDocument(undefined, {
        name: { ro: 'Orașul nepublicat', en: 'The unpublished city' },
        bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6 },
        published: false,
        updatedBy: 'system:setup',
        updatedAt: AT,
    });
}

/** An export record as the server leaves it (`cities/<city>/exports/<id>`). */
export async function seedExport(world: ContentWorld, exportId: string, fields: Readonly<Record<string, unknown>>): Promise<void> {
    await world.setDocument(`exports/${exportId}`, {
        state: 'queued',
        requestedBy: world.uid,
        rasters: false,
        engineVersion: '1.0.0',
        createdAt: AT,
        updatedBy: 'system:export',
        updatedAt: AT,
        ...fields,
    });
}

/** The world's admin as an editor of its city (the owner role taken away), as `admins.setRole` would leave it. */
export async function makeEditor(world: ContentWorld): Promise<void> {
    await world.emulators.updateFields(`admins/${world.uid}`, { cities: { [world.city]: 'editor' } }, ['cities']);
}

/**
 * The mocked public-storage host's answer to the stand-in signer's address (`functions/src/adapters/url-signer.ts`): the
 * object of the private bucket the address names, read from the Storage emulator, with the disposition the address asks
 * for, so the browser saves exactly what the task wrote. Any other address of the host is not this route's.
 */
export async function serveSignedExports(page: Page, world: ContentWorld): Promise<void> {
    const prefix = `https://storage.googleapis.com/${ADMIN_WEB_CONFIG.storageBucket}/exports/`;
    await page.route(`${prefix}**`, async (route) => {
        const url = new URL(route.request().url());
        const path = decodeURIComponent(url.pathname.slice(`/${ADMIN_WEB_CONFIG.storageBucket}/`.length));
        const body = await world.emulators.storageObject(ADMIN_WEB_CONFIG.storageBucket, path);
        if (body === undefined || url.searchParams.get('X-Goog-Algorithm') !== 'hcm-emulator-stand-in') {
            await route.fulfill({ status: 404, contentType: 'text/plain', body: 'No such object.' });
            return;
        }
        const disposition = url.searchParams.get('response-content-disposition') ?? 'attachment';
        await route.fulfill({ status: 200, contentType: 'application/zip', headers: { 'content-disposition': disposition }, body });
    });
}

/** The zip the task wrote for `exportId`, read from the Storage emulator's private bucket (empty when there is none). */
export async function writtenZip(world: ContentWorld, exportId: string): Promise<Buffer> {
    return (
        (await world.emulators.storageObject(ADMIN_WEB_CONFIG.storageBucket, STORAGE_PATHS.cityExport(world.city, exportId))) ??
        Buffer.alloc(0)
    );
}
