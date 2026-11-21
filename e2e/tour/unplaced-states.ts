import type { Locale } from '@hcm/shared';
import { expect, type Page } from '@playwright/test';

import { siteManifestData } from '../fixtures/manifest.js';
import { chooseMenuItem, openViewer, serveManifest, t, viewer } from '../support/viewer.js';

/**
 * The public map's states of M13 (docs/research/M13-roles.md §5; e2e/tour/states.ts spreads them): the gallery of the photos with no
 * place, from the menu, over a manifest with one photo moved there and the Contribute link.
 */

/** The manifest's Contribute page; a manifest takes https addresses only, so its spec answers it at the network's edge. */
export const UNPLACED_CONTRIBUTE_URL = 'https://contribute.e2e.test/admin/#/contribute/bucharest';

/** The served manifest with one photo moved to the gallery and the Contribute link (e2e/specs/viewer/unplaced.spec.ts too). */
export function unplacedManifest(): Record<string, unknown> {
    const manifest = siteManifestData();
    const [first, ...rest] = manifest['photos'] as readonly Record<string, unknown>[];
    const entries = Object.entries(first ?? {}).filter(([key]) => !['location', 'bearing', 'fov'].includes(key));
    return {
        ...manifest,
        photos: rest,
        unplaced: [Object.fromEntries(entries)],
        contributeUrl: UNPLACED_CONTRIBUTE_URL,
    };
}

export interface VisitContext {
    readonly page: Page;
    readonly lang: Locale;
}

type Escape<Result> = (opener: (lang: Locale) => string | null) => Result;

/** The states, with the inventory's own `sheetEscape`. */
export function unplacedStates<Result>(sheetEscape: Escape<Result>) {
    return {
        unplaced: {
            title: 'The "Where was this taken?" gallery',
            enter: async ({ page, lang }: VisitContext): Promise<void> => {
                await chooseMenuItem(page, lang, t(lang, 'unplaced.title'));
                await expect(viewer(page).locator('hcm-unplaced-gallery').getByRole('list')).toBeVisible();
            },
            escape: sheetEscape((lang) => t(lang, 'action.menu')),
        },
    };
}

export const UNPLACED_JOURNEY = {
    title: 'Photos with no place yet, and the Contribute link',
    id: 'unplaced',
    boot: async ({ page, lang }: VisitContext): Promise<void> => {
        await serveManifest(page, unplacedManifest());
        await openViewer(page, { lang });
    },
    states: ['unplaced'],
} as const;
