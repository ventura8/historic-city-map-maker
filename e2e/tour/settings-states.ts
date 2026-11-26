import type { Locale } from '@hcm/shared';
import { expect, type Page } from '@playwright/test';

import { chooseMenuItem, dismissToast, menuButton, openViewer, t, viewer } from '../support/viewer.js';

/**
 * The states of the owner's request of 2026-11-08 in the tour's inventory: Settings (Setări), the menu's dialog that holds
 * the language and the theme since they left About, visited by the journey `home` of e2e/tour/states.ts, then the other
 * language chosen in it; and the Layers pane minimized to one floating button, which exists only where the pane is always docked
 * (extra-large, 1600 px and wider), visited by the journey `year-layers` after the opacity state.
 */

export interface SettingsTour {
    readonly page: Page;
    readonly lang: Locale;
}

/** Extra-large windows (1600 px and wider, not a phone held landscape) dock the Layers pane for good (layout.ts). */
function hasDockedLayers(page: Page): boolean {
    const size = page.viewportSize();
    return size !== null && size.width >= 1600 && size.height >= 480;
}

/** Picks in Settings the theme the system is not in (light under a dark system), then closes Settings. */
async function chooseOtherTheme(page: Page, lang: Locale): Promise<void> {
    const dark = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
    await chooseMenuItem(page, lang, t(lang, 'settings.title'));
    await viewer(page)
        .locator('hcm-about-dialog')
        .getByRole('radio', { name: t(lang, dark ? 'theme.light' : 'theme.dark') })
        .click();
    await page.keyboard.press('Escape');
}

/** Fires Chrome's install prompt as Chrome does once the page is installable (headless Chromium never does), then opens Settings. */
async function openSettingsOfferingInstall(page: Page, lang: Locale): Promise<void> {
    await page.evaluate(() => {
        const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
            prompt: () => Promise.resolve(),
            userChoice: Promise.resolve({ outcome: 'dismissed' }),
        });
        window.dispatchEvent(event);
    });
    await chooseMenuItem(page, lang, t(lang, 'settings.title'));
    const dialog = viewer(page).locator('hcm-about-dialog');
    await expect(dialog.getByRole('button', { name: t(lang, 'app.install') }).first()).toBeVisible();
}

/** Resizes the window, waits for the viewer's compact-height layout and opens the FAB menu. */
async function openMenuAt(page: Page, lang: Locale, size: { readonly width: number; readonly height: number }): Promise<void> {
    await page.setViewportSize(size);
    await expect(viewer(page).locator('.frame[data-compact-height]')).toHaveCount(1);
    await menuButton(page, lang).click();
    await expect(page.getByRole('menu', { name: t(lang, 'action.menu') })).toBeVisible();
}

export const SETTINGS_STATES = {
    'menu-short-landscape': {
        title: 'The FAB menu open at 884 × 322 (the Pixel 9 Pro held landscape): every item on screen, in rows above the FAB',
        enter: ({ page, lang }: SettingsTour) => openMenuAt(page, lang, { width: 884, height: 322 }),
        escape: ({ lang }: SettingsTour) => ({ opener: t(lang, 'action.menu') }),
    },
    'menu-shortest-landscape': {
        title: 'The FAB menu open at 568 × 270 (the smallest landscape phone with its bars): the menu scrolls inside the window',
        enter: ({ page, lang }: SettingsTour) => openMenuAt(page, lang, { width: 568, height: 270 }),
        escape: ({ lang }: SettingsTour) => ({ opener: t(lang, 'action.menu') }),
    },
    settings: {
        title: 'Settings from the menu: the language and the theme (full screen on a phone)',
        enter: async ({ page, lang }: SettingsTour) => {
            // The previous state's toast is closed first: its timer went mid-check on a slow machine.
            await dismissToast(page, lang);
            await chooseMenuItem(page, lang, t(lang, 'settings.title'));
            const dialog = viewer(page).locator('hcm-about-dialog');
            await expect(page.getByRole('dialog', { name: t(lang, 'settings.title') })).toBeVisible();
            await expect(dialog.getByRole('radiogroup', { name: t(lang, 'theme.label') })).toBeVisible();
        },
        escape: ({ lang }: SettingsTour) => ({ opener: t(lang, 'action.menu') }),
    },
    'settings-install': {
        title: "Settings once the browser offers the install: App with Install app, and Device accent's note offering it on a computer",
        enter: ({ page, lang }: SettingsTour) => openSettingsOfferingInstall(page, lang),
        escape: ({ lang }: SettingsTour) => ({ opener: t(lang, 'action.menu') }),
    },
    'other-theme-menu': {
        title: "The other theme chosen in Settings, then the menu open: light under a dark system, where Chrome's dark theme for sites repainted it",
        enter: async ({ page, lang }: SettingsTour) => {
            await chooseOtherTheme(page, lang);
            await menuButton(page, lang).click();
            await expect(page.getByRole('menu', { name: t(lang, 'action.menu') })).toBeVisible();
        },
        escape: ({ lang }: SettingsTour) => ({ opener: t(lang, 'action.menu') }),
    },
    language: {
        title: 'The other language chosen in Settings: the whole viewer in it, Settings closed',
        enter: async ({ page, lang }: SettingsTour) => {
            const other = lang === 'ro' ? 'en' : 'ro';
            // The Settings state's Esc closed the dialog: it is opened again from the menu.
            await chooseMenuItem(page, lang, t(lang, 'settings.title'));
            await viewer(page).locator('hcm-about-dialog hcm-language-select select').selectOption(other);
            await expect(page.getByRole('dialog', { name: t(other, 'settings.title') })).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(menuButton(page, other)).toBeVisible();
        },
        shows: (lang: Locale): Locale => (lang === 'ro' ? 'en' : 'ro'),
    },
    'layers-minimized': {
        title: 'The always-docked Layers pane minimized to one floating button: the map takes the whole width',
        enter: async ({ page, lang }: SettingsTour) => {
            const pane = viewer(page).locator('.pane.leading');
            const collapse = pane.getByRole('button', { name: t(lang, 'layers.minimize'), exact: true });
            await expect(collapse).toHaveAttribute('aria-expanded', 'true');
            await collapse.click();
            const rail = pane.getByRole('button', { name: t(lang, 'layers.title'), exact: true });
            await expect(rail).toBeFocused();
            await expect(rail).toHaveAttribute('aria-expanded', 'false');
        },
        exists: hasDockedLayers,
    },
};

/**
 * The other theme chosen in Settings with the menu open (the light theme under a dark system: the dark tours run with
 * Chrome's dark theme for sites, which repainted it, P2 of the Pixel 9 Pro review), and the FAB menu of a short landscape
 * phone (P1: at 884 × 322 with Chrome's bars its seven items lay in one row and ran off the screen), the window resized
 * to the Pixel 9 Pro held landscape, then to the smallest landscape phone with its bars, in every tour project.
 */
export const THEME_MENU_JOURNEY = {
    title: 'The other theme chosen in Settings, the menu open',
    id: 'theme-menu',
    boot: ({ page, lang }: SettingsTour) => openViewer(page, { lang }),
    states: ['other-theme-menu'],
} as const;

export const SHORT_LANDSCAPE_JOURNEY = {
    title: 'The FAB menu of a short landscape phone',
    id: 'short-landscape',
    boot: ({ page, lang }: SettingsTour) => openViewer(page, { lang, hash: '15/44.42700/26.08530&layers=e2e-1966' }),
    states: ['menu-short-landscape', 'menu-shortest-landscape'],
} as const;
