import type { Locale } from '@hcm/shared';
import { expect, type Page } from '@playwright/test';

import { siteManifestData } from '../fixtures/manifest.js';
import { chooseMenuItem, openViewer, serveManifest, t, viewer } from '../support/viewer.js';

/**
 * The public map's states of M17 (docs/research/M17-stories.md §5; e2e/tour/states.ts spreads them): the list of stories from the
 * menu and one story read in its sheet, with a figure of the city's photo, its places and photos, on every window class.
 */

export const STORY_ID = 'teatrul-national';

/** The served manifest with two stories: one about its first photo and first place, one with no year. */
export function storyManifest(): Record<string, unknown> {
    const manifest = siteManifestData();
    const [photo] = manifest['photos'] as readonly { readonly id: string }[];
    const [poi] = (manifest['pois'] ?? []) as readonly { readonly id: string }[];
    const photoId = String(photo?.id);
    return {
        ...manifest,
        stories: [
            {
                id: STORY_ID,
                title: { ro: 'Teatrul Național', en: 'The National Theatre' },
                body: {
                    ro: `Clădirea a ars în **1944**.\n\n![Fațada](photo:${photoId})\n\nO [sursă](https://example.org/teatrul).`,
                    en: `The building burned in **1944**. <b>not bold</b>\n\n![The front](photo:${photoId})\n\n![Gone](photo:no-such-photo)`,
                },
                yearStart: 1966,
                photoIds: [photoId],
                ...(poi === undefined ? {} : { poiIds: [poi.id] }),
                credit: 'Maria',
            },
            { id: 'fara-an', title: { ro: 'O poveste fără an', en: 'A story with no year' }, body: { ro: 'Text.' } },
        ],
    };
}

export interface VisitContext {
    readonly page: Page;
    readonly lang: Locale;
}

type Escape<Result> = (opener: (lang: Locale) => string | null) => Result;

/** The stories list, from the menu. */
export async function openStories(page: Page, lang: Locale): Promise<void> {
    await chooseMenuItem(page, lang, t(lang, 'stories.title'));
    await expect(
        viewer(page)
            .locator('hcm-stories')
            .getByRole('list', { name: t(lang, 'stories.title') }),
    ).toBeVisible();
}

/** The states, with the inventory's own `sheetEscape`. */
export function storyStates<Result>(sheetEscape: Escape<Result>) {
    return {
        stories: {
            title: 'The list of stories',
            enter: async ({ page, lang }: VisitContext): Promise<void> => {
                await openStories(page, lang);
            },
            escape: sheetEscape((lang) => t(lang, 'action.menu')),
        },
        story: {
            title: 'One story, read in its sheet',
            enter: async ({ page, lang }: VisitContext): Promise<void> => {
                await openStories(page, lang);
                const title = lang === 'en' ? 'The National Theatre' : 'Teatrul Național';
                await viewer(page).locator('hcm-stories').getByRole('button', { name: title }).click();
                await expect(viewer(page).locator('hcm-stories').locator('figure')).toBeVisible();
            },
            escape: sheetEscape((lang) => t(lang, 'action.menu')),
        },
    };
}

export const STORY_JOURNEY = {
    title: 'Stories: the list and one story',
    id: 'stories',
    boot: async ({ page, lang }: VisitContext): Promise<void> => {
        await serveManifest(page, storyManifest());
        await openViewer(page, { lang });
    },
    states: ['stories', 'story'],
} as const;
