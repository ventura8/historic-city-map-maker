import type { Locale } from '@hcm/shared';
import { expect, type Page } from '@playwright/test';

import { siteManifestData, type Json } from '../fixtures/manifest.js';
import { openViewer, serveManifest, t } from '../support/viewer.js';

/**
 * A photo's versions and the full-size view's zoom buttons in the tour's inventory (behaviours V60, V61; the owner on
 * 2026-11-09), visited by the journey `photo-versions` of e2e/tour/states.ts at every viewer viewport: the photo's sheet
 * with its switch Original / Improved / Colorized and the colorized version's credit, then the full-size view with the
 * same switch and its zoom buttons, zoomed in once.
 */

export interface PhotoVersionTour {
    readonly page: Page;
    readonly lang: Locale;
}

const PHOTO = 'strandul-opereta-1976';

/** The fixture with PHOTO carrying an improved and a credited colorized version (other photos' images). */
function versionedManifest(): Json {
    const manifest = siteManifestData();
    const photos = manifest['photos'] as (Json & { readonly id: string; readonly image: Json })[];
    const [improved, colorized] = photos.filter((photo) => photo.id !== PHOTO).map((photo) => photo.image);
    const versions = { improved, colorized: { ...colorized, credit: 'Ana Pop' } };
    return { ...manifest, photos: photos.map((photo) => (photo.id === PHOTO ? { ...photo, versions } : photo)) };
}

export const PHOTO_VERSION_STATES = {
    'photo-colorized': {
        title: "A photo's sheet with its versions' switch, the colorized one picked and credited",
        enter: async ({ page, lang }: PhotoVersionTour) => {
            const versions = page.getByRole('radiogroup', { name: t(lang, 'photo.versions') });
            await versions.getByRole('radio', { name: t(lang, 'photoVersion.colorized') }).click();
            await expect(page.getByText(t(lang, 'photoVersion.colorizedBy', { credit: 'Ana Pop' })).first()).toBeVisible();
        },
    },
    'lightbox-versions-zoomed': {
        title: 'The full-size view of a photo with versions, zoomed in once from its button',
        enter: async ({ page, lang }: PhotoVersionTour) => {
            await page.getByRole('button', { name: t(lang, 'photo.openLightbox') }).click();
            const view = page.getByRole('dialog', { name: t(lang, 'lightbox.label') });
            await expect(view.getByRole('radiogroup', { name: t(lang, 'photo.versions') })).toBeVisible();
            await view.getByRole('button', { name: t(lang, 'lightbox.zoomIn'), exact: true }).click();
            await expect(view.getByRole('button', { name: t(lang, 'lightbox.zoomOut'), exact: true })).not.toHaveAttribute(
                'aria-disabled',
                'true',
            );
        },
        escape: ({ lang }: PhotoVersionTour) => ({ opener: t(lang, 'photo.openLightbox') }),
    },
} as const;

/** The journey of these states in e2e/tour/states.ts. */
export const PHOTO_VERSION_JOURNEY = {
    title: "A photo's versions in its sheet and in the full-size view, zoomed in",
    id: 'photo-versions',
    boot: async ({ page, lang }: PhotoVersionTour) => {
        await serveManifest(page, versionedManifest());
        await openViewer(page, { lang, hash: `18/44.42955/26.09560&photo=${PHOTO}` });
    },
    states: ['photo-colorized', 'lightbox-versions-zoomed'],
} as const;
