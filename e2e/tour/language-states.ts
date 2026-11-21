import { VIEWER_LOCALES, type Locale, type ViewerLocale } from '@hcm/shared';
import { expect, type Page } from '@playwright/test';

import { mapIdle } from '../support/map.js';
import { chooseMenuItem, languageList, menuButton, openLayers, openViewer, t, viewer } from '../support/viewer.js';

/**
 * The tour's language states (V11; docs/ENGINE_API.md → Language), from e2e/tour/states.ts (the switch itself is
 * Settings' `language`, e2e/tour/settings-states.ts): the viewer in a script of its own, Arabic right to left and
 * Japanese, whose glyphs come from the system's fonts.
 * Those two journeys open the viewer in their language whatever the project's, so every per-push tour project (a phone,
 * a laptop, …) visits them.
 */

interface LanguageState {
    readonly title: string;
    readonly enter: (tour: { readonly page: Page; readonly lang: Locale }) => Promise<void>;
    readonly escape?: (tour: { readonly page: Page; readonly lang: Locale }) => { readonly opener: string | null } | null;
    readonly shows: (lang: Locale) => ViewerLocale;
}

const arabic = (): ViewerLocale => 'ar';
const japanese = (): ViewerLocale => 'ja';

/** The photo the right-to-left journey opens: its title has English, its description only Romanian. */
const PHOTO = 'mihai-voda-1978';

export const LANGUAGE_STATES = {
    'rtl-photo': {
        title: "Arabic: a photo's sheet right to left, its city texts in English or Romanian, named as such",
        enter: async ({ page }) => {
            await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
            await expect(viewer(page).locator('hcm-photo-sheet .fallback-note')).toBeVisible();
        },
        shows: arabic,
    },
    'rtl-home': {
        title: 'Arabic: the map left to right under a viewer that reads right to left',
        enter: async ({ page }) => {
            await page.goto('about:blank');
            await openViewer(page, { lang: 'ar' });
            await expect(menuButton(page, 'ar')).toBeVisible();
            await mapIdle(page);
        },
        shows: arabic,
    },
    'rtl-languages': {
        title: "Arabic: Settings' list of the 25 languages, each by its own name",
        enter: async ({ page }) => {
            await chooseMenuItem(page, 'ar', t('ar', 'settings.title'));
            await expect(page.getByRole('dialog', { name: t('ar', 'settings.title') })).toBeVisible();
            await expect(languageList(page).getByRole('option')).toHaveCount(VIEWER_LOCALES.length);
        },
        escape: () => ({ opener: t('ar', 'action.menu') }),
        shows: arabic,
    },
    'cjk-home': {
        title: "Japanese: the viewer in the system's Japanese font",
        enter: async ({ page }) => {
            await expect(menuButton(page, 'ja')).toBeVisible();
            await mapIdle(page);
        },
        shows: japanese,
    },
    'cjk-layers': {
        title: 'Japanese: the Layers panel',
        enter: async ({ page }) => {
            await openLayers(page, 'ja');
        },
        shows: japanese,
    },
} as const satisfies Record<string, LanguageState>;

/** Arabic from a photo's link: the photo, then home, then the language list. */
export const RTL_JOURNEY = {
    title: 'Arabic, right to left: a photo, home and the language list',
    id: 'rtl',
    boot: async ({ page }: { readonly page: Page }): Promise<void> => {
        await openViewer(page, { lang: 'ar', hash: `18/44.42955/26.09560&photo=${PHOTO}` });
    },
    states: ['rtl-photo', 'rtl-home', 'rtl-languages'] as const,
};

/** Japanese from the address: home and the Layers panel. */
export const CJK_JOURNEY = {
    title: 'Japanese: home and the Layers panel',
    id: 'cjk',
    boot: async ({ page }: { readonly page: Page }): Promise<void> => {
        await openViewer(page, { lang: 'ja', hash: '15/44.42700/26.08530' });
    },
    states: ['cjk-home', 'cjk-layers'] as const,
};
