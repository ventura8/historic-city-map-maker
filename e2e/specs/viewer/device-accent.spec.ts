import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { siteManifestData } from '../../fixtures/manifest.js';
import { emulateDeviceAccent } from '../../support/device-accent.js';
import { expect, test } from '../../support/test.js';
import { chooseMenuItem, openViewer, t, viewer, waitForEngineEvent } from '../../support/viewer.js';

/**
 * "Follow my device" (behaviour V12; the owner, 2026-11-13): by default the viewer follows the device's light or dark
 * scheme and its accent colour, the city's own colours where the browser gives no accent. A Playwright Chromium tab is a
 * tab, not an installed app, so Chrome gives it no accent of the device; the page names one with `--hcm-device-accent`
 * (the way an embedding site may), which is the emulated accent here.
 */

const TOKENS = (siteManifestData()['city'] as { theme: { tokens: Record<string, Record<string, string>> } }).theme.tokens;
const PRIMARY = '--md-sys-color-primary';
const ON_PRIMARY = '--md-sys-color-on-primary';
const GREEN = '#1e8e3e';

interface Shown {
    readonly primary: string;
    readonly onPrimary: string;
    /** The OKLab hue angle of the primary (radians) and of `GREEN`. */
    readonly hue: number;
    readonly accentHue: number;
    /** WCAG relative luminance of the shown primary and of the city's own. */
    readonly luminance: number;
    readonly cityLuminance: number;
}

/** What the viewer's host wears, measured in the page against the city's `own` primary. */
async function shown(page: Page, own: string): Promise<Shown> {
    return viewer(page).evaluate(
        (host, [primaryName, onPrimaryName, accent, city]) => {
            const style = getComputedStyle(host);
            const linear = (hex: string): number[] =>
                [1, 3, 5].map((at) => {
                    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
                    return value <= 0.040_45 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
                });
            const luminance = (hex: string): number => {
                const [r = 0, g = 0, b = 0] = linear(hex);
                return 0.2126 * r + 0.7152 * g + 0.0722 * b;
            };
            const hue = (hex: string): number => {
                const [r = 0, g = 0, b = 0] = linear(hex);
                const l = Math.cbrt(0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b);
                const m = Math.cbrt(0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b);
                const s = Math.cbrt(0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b);
                return Math.atan2(
                    0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s,
                    1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s,
                );
            };
            const primary = style.getPropertyValue(primaryName).trim().toLowerCase();
            return {
                primary,
                onPrimary: style.getPropertyValue(onPrimaryName).trim().toLowerCase(),
                hue: hue(primary),
                accentHue: hue(accent),
                luminance: luminance(primary),
                cityLuminance: luminance(city),
            };
        },
        [PRIMARY, ON_PRIMARY, GREEN, own] as const,
    );
}

/** Opens Settings and picks the choice named `choice`. */
async function chooseSetting(page: Page, lang: 'ro' | 'en', choice: string): Promise<void> {
    await chooseMenuItem(page, lang, t(lang, 'settings.title'));
    await expect(page.getByRole('dialog', { name: t(lang, 'settings.title') })).toBeVisible();
    await viewer(page).locator('hcm-about-dialog').getByRole('radio', { name: choice, exact: true }).click();
}

for (const scheme of ['light', 'dark'] as const) {
    test(
        `The ${scheme} theme takes the device's accent by default, with the city's contrast`,
        { tag: '@S-V12-HAPPY-DEVICE-ACCENT' },
        async ({ page, lang }) => {
            await page.emulateMedia({ colorScheme: scheme });
            await emulateDeviceAccent(page, GREEN);
            await openViewer(page, { lang });
            const own = TOKENS[scheme]?.[PRIMARY]?.toLowerCase() ?? '';

            await expect.poll(async () => (await shown(page, own)).primary).not.toBe(own);
            const colours = await shown(page, own);
            // The accent's hue, the city's tone: every contrast ratio of the scheme stays the city's.
            expect(Math.abs(colours.hue - colours.accentHue)).toBeLessThan(0.15);
            expect(Math.abs(colours.luminance - colours.cityLuminance)).toBeLessThan(0.01);
            await chooseMenuItem(page, lang, t(lang, 'settings.title'));
            await expect(page.getByRole('dialog', { name: t(lang, 'settings.title') })).toBeVisible();
            const settings = viewer(page).locator('hcm-about-dialog');
            await expect(settings.getByRole('radio', { name: t(lang, 'theme.system'), exact: true })).toHaveAttribute(
                'aria-checked',
                'true',
            );
            await expect(settings.getByRole('radio', { name: t(lang, 'accent.device'), exact: true })).toHaveAttribute(
                'aria-checked',
                'true',
            );
            // The device's accent shows: no word on why it cannot.
            await expect(settings.getByText(t(lang, 'accent.hidden'))).toHaveCount(0);
            const axe = await new AxeBuilder({ page })
                .withTags(['wcag2aa'])
                .withRules(['color-contrast'])
                .include('hcm-map-viewer')
                .analyze();
            expect(axe.violations.map((violation) => violation.id)).toEqual([]);
        },
    );
}

test("Map colours keeps the city's own, and the choice persists", { tag: '@S-V12-HAPPY-DEVICE-ACCENT' }, async ({ page, lang }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await emulateDeviceAccent(page, GREEN);
    await openViewer(page, { lang });
    const own = TOKENS['dark']?.[PRIMARY]?.toLowerCase() ?? '';

    await chooseSetting(page, lang, t(lang, 'accent.map'));
    await expect.poll(async () => (await shown(page, own)).primary).toBe(own);
    await page.reload();
    await waitForEngineEvent(page, 'hcm-ready');
    await expect.poll(async () => (await shown(page, own)).primary).toBe(own);
});

test(
    "Without the device's accent, or with a grey one, the city's own colours show",
    { tag: '@S-V12-BAD-NO-DEVICE-ACCENT' },
    async ({ page, lang }) => {
        await page.emulateMedia({ colorScheme: 'light' });
        await openViewer(page, { lang });
        const own = TOKENS['light']?.[PRIMARY]?.toLowerCase() ?? '';
        // A Chromium tab: Chrome's AccentColor is its constant there, never the device's.
        await expect.poll(async () => (await shown(page, own)).primary).toBe(own);
        // Device accent says so, and what shows instead (the owner, 2026-11-14: no silent fallback).
        await chooseMenuItem(page, lang, t(lang, 'settings.title'));
        const settings = viewer(page).locator('hcm-about-dialog');
        await expect(settings.getByText(t(lang, 'accent.hidden'))).toBeVisible();
        await expect(settings.getByText(t(lang, 'accent.hiddenFix'))).toBeVisible();

        await emulateDeviceAccent(page, '#808080');
        await page.reload();
        await waitForEngineEvent(page, 'hcm-ready');
        await expect.poll(async () => (await shown(page, own)).primary).toBe(own);
        expect((await shown(page, own)).onPrimary).toBe(TOKENS['light']?.[ON_PRIMARY]?.toLowerCase());
        await chooseMenuItem(page, lang, t(lang, 'settings.title'));
        await expect(settings.getByText(t(lang, 'accent.grey'))).toBeVisible();
    },
);
