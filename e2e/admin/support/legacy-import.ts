import { expect, type Locator, type Page, type Request } from '@playwright/test';

import type { EmulatorWorld } from './emulators.js';
import { setupText } from './i18n.js';
import { SetupPage } from './setup-page.js';

/**
 * What the tests of the legacy import (behaviour A28: e2e/admin/steps/legacy.spec.ts, legacy-additions.spec.ts) share:
 * the card and its one button, the city's legacy photos as the emulators hold them, the end of an import, the uploads.
 */

/** The bundle's records: the 45 of `seed/bucharest` (migrated as is), then the 12 of `seed/bucharest-2023`. */
export const LEGACY_PHOTOS = 57;

/** Where the 2023 additions start in the bundle. */
export const FIRST_PHOTOS = 45;

/**
 * The import card and its one button: "Import the photos (n)" on a map without any, "Import the missing photos (n)" on a
 * map that has some (a closed tab's resume, or the additions).
 */
export async function importCard(
    page: Page,
    lang: 'ro' | 'en',
    count = LEGACY_PHOTOS,
): Promise<{ readonly card: Locator; readonly action: Locator }> {
    const setup = new SetupPage(page, lang);
    await setup.visit('mapbox');
    const card = await setup.show('legacyImport');
    const missing = setupText(lang, 'adminSetup.import.actionMissing', { count: '' }).replace(/\(\)$/, '');
    return {
        card,
        action: card
            .getByRole('button', { name: setupText(lang, 'adminSetup.import.action', { count: String(count) }), exact: true })
            .or(card.getByRole('button', { name: missing })),
    };
}

/** The legacy photos of the city: by id, whether `photos.onUpload` gave each an image and whether it is published. */
export async function legacyPhotos(
    emulators: EmulatorWorld,
): Promise<{ readonly id: string; readonly image: boolean; readonly published: boolean }[]> {
    const photos = await emulators.collection('cities/bucharest/photos');
    return Object.entries(photos)
        .filter(([, photo]) => photo['legacyId'] !== undefined)
        .map(([id, photo]) => ({ id, image: photo['image'] !== undefined, published: photo['published'] === true }));
}

/** Waits until the import is done (the card, opened again: Setup closes it when the last step is done) and says so. */
export async function imported(page: Page, lang: 'ro' | 'en', count = LEGACY_PHOTOS): Promise<void> {
    const setup = new SetupPage(page, lang);
    await setup.expectState('legacyImport', 'ok', 300_000);
    await expect(
        (await setup.show('legacyImport')).getByText(setupText(lang, 'adminSetup.import.done', { count: String(count) })),
    ).toBeVisible();
}

/** Counts the page's uploads of originals to the Storage emulator. */
export function countUploads(page: Page): () => number {
    let uploads = 0;
    page.on('request', (request: Request) => {
        if (request.method() === 'POST' && /\/v0\/b\/[^/]+\/o\?.*name=uploads/.test(request.url())) {
            uploads += 1;
        }
    });
    return () => uploads;
}
