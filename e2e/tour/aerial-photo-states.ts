import type { Locale } from '@hcm/shared';
import { expect, type Page } from '@playwright/test';

import { siteManifestData, type Json } from '../fixtures/manifest.js';
import { chooseMenuItem, openViewer, serveManifest, t, viewer } from '../support/viewer.js';

/** The tour's states of aerial photos (V76; the owner, 2026-11-16: aerial photos are photos of their own kind), from e2e/tour/states.ts. */

interface AerialPhotoState {
    readonly title: string;
    readonly enter: (tour: { readonly page: Page; readonly lang: Locale }) => Promise<void>;
}

export const AERIAL_PHOTO_STATES = {
    'photo-list-aerial': {
        title: 'The list of every photo with the Street / Aerial choice, Aerial chosen',
        enter: async ({ page, lang }) => {
            await chooseMenuItem(page, lang, t(lang, 'photos.list'));
            const list = viewer(page).locator('.photos-sheet hcm-photo-list');
            await list.getByRole('radio', { name: t(lang, 'photos.filter.aerial'), exact: true }).check();
            await expect(list.getByRole('button')).toHaveCount(1);
        },
    },
} as const satisfies Record<string, AerialPhotoState>;

/** The fixture with its first photo taken from above, in 1944. */
export function aerialPhotoManifest(): Json {
    const manifest = siteManifestData();
    const [first] = manifest['photos'] as [Json];
    Object.assign(first, { kind: 'aerial' });
    return manifest;
}

export const AERIAL_PHOTO_JOURNEY = {
    title: 'Aerial photos: the Photos list filtered to the aerial ones',
    id: 'aerial-photos',
    boot: async ({ page, lang }: { readonly page: Page; readonly lang: Locale }): Promise<void> => {
        await serveManifest(page, aerialPhotoManifest());
        await openViewer(page, { lang });
    },
    states: ['photo-list-aerial'] as const,
};
