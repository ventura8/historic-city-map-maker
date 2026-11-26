import type { Locale } from '@hcm/shared';
import { expect, type Page } from '@playwright/test';

import { siteManifestData } from '../fixtures/manifest.js';
import { E2E_CITY_ID, E2E_TILESET_LAYER } from '../fixtures/world.js';
import { chooseMenuItem, openViewer, serveManifest, t, viewer } from '../support/viewer.js';

/**
 * The public map's states of V91 and V92 (e2e/tour/states.ts spreads them): the Favourites sheet with saved items, and the
 * Licence and citation panel in About's dialog, on every window class.
 */

/** The served manifest: its USGS layer read from a PMTiles archive, so the panel offers that download. */
export function licenceManifest(): Record<string, unknown> {
    const manifest = siteManifestData();
    const layers = (manifest['layers'] as readonly Record<string, unknown>[]).map((layer) =>
        layer['id'] === E2E_TILESET_LAYER.id ? { ...layer, source: { type: 'pmtiles', url: 'tiles/e2e-1966.pmtiles' } } : layer,
    );
    return { ...manifest, layers };
}

/** Saves `items` as the visitor's favourites before the page loads (what an earlier visit left in this browser). */
export async function seedFavorites(page: Page, items: readonly { readonly kind: string; readonly id: string }[]): Promise<void> {
    await page.addInitScript(
        ({ key, value }) => {
            localStorage.setItem(key, value);
        },
        { key: `hcm:${E2E_CITY_ID}:favorites`, value: JSON.stringify(items) },
    );
}

export async function openFavorites(page: Page, lang: Locale): Promise<void> {
    await chooseMenuItem(page, lang, t(lang, 'favorites.title'));
    await expect(viewer(page).locator('hcm-favorites')).toBeVisible();
}

export async function openLicence(page: Page, lang: Locale): Promise<void> {
    await chooseMenuItem(page, lang, t(lang, 'about.title'));
    await viewer(page)
        .locator('hcm-about-dialog')
        .getByRole('button', { name: t(lang, 'licence.open') })
        .click();
    await expect(page.getByRole('dialog', { name: t(lang, 'licence.title') })).toBeVisible();
    await expect(viewer(page).locator('hcm-licence-panel textarea')).toBeVisible();
}

export interface VisitContext {
    readonly page: Page;
    readonly lang: Locale;
}

type Escape<Result> = (opener: (lang: Locale) => string | null) => Result;

/** The states, with the inventory's own `sheetEscape`. */
export function favoritesStates<Result>(sheetEscape: Escape<Result>) {
    return {
        favorites: {
            title: 'The Favourites sheet: two saved items, each with its star',
            enter: async ({ page, lang }: VisitContext): Promise<void> => {
                await openFavorites(page, lang);
                await expect(viewer(page).locator('hcm-favorites').getByRole('listitem')).toHaveCount(2);
            },
            escape: sheetEscape((lang) => t(lang, 'action.menu')),
        },
        licence: {
            title: "Licence and citation: the map's own work, the view's citation, each layer's rights and download",
            enter: async ({ page, lang }: VisitContext): Promise<void> => {
                await openLicence(page, lang);
            },
            escape: ({ lang }: VisitContext) => ({ opener: t(lang, 'action.menu') }),
        },
    };
}

export const FAVORITES_JOURNEY = {
    title: 'Favourites and the licence: the saved list and the Licence and citation panel',
    id: 'favorites-licence',
    boot: async ({ page, lang }: VisitContext): Promise<void> => {
        await seedFavorites(page, [
            { kind: 'layer', id: E2E_TILESET_LAYER.id },
            { kind: 'poi', id: 'fixture-cladire' },
        ]);
        await serveManifest(page, licenceManifest());
        await openViewer(page, { lang });
    },
    states: ['favorites', 'licence'],
} as const;
