import type { Locale } from '@hcm/shared';
import { expect, type Page } from '@playwright/test';

import { siteManifestData, type Json } from '../fixtures/manifest.js';
import { openViewer, serveManifest, t, viewer } from '../support/viewer.js';

/** The tour's state of a photo dated to the day, with its source (docs/research/photo-date-source.md), from e2e/tour/states.ts. */

/** A lone photo of the fixture and a view near it. */
const PHOTO = 'strandul-opereta-1976';
const SOURCE = { url: 'https://arhiva.example/foto/1976', label: 'Arhiva Operetei' };

export const PHOTO_SOURCE_STATES = {
    'photo-source': {
        title: 'A photo dated to the day, with the link to where it comes from',
        enter: async ({ page, lang }: { readonly page: Page; readonly lang: Locale }): Promise<void> => {
            await expect(viewer(page).locator('hcm-photo-sheet .source')).toContainText(t(lang, 'photo.source'));
            await expect(viewer(page).getByRole('link', { name: SOURCE.label })).toBeVisible();
        },
    },
};

export const PHOTO_SOURCE_JOURNEY = {
    title: 'A photo dated to the day, with its source',
    id: 'photo-source',
    boot: async ({ page, lang }: { readonly page: Page; readonly lang: Locale }): Promise<void> => {
        const manifest = siteManifestData();
        const photos = manifest['photos'] as Json[];
        const target = photos.find((candidate) => candidate['id'] === PHOTO) ?? {};
        Object.assign(target, { year: 1976, month: 7, day: 12, source: SOURCE });
        Reflect.deleteProperty(target, 'yearEnd');
        Reflect.deleteProperty(target, 'dateText');
        await serveManifest(page, manifest);
        await openViewer(page, { lang, hash: `18/44.42955/26.09560&photo=${PHOTO}` });
    },
    states: ['photo-source'] as const,
};
