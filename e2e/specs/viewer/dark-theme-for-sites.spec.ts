import type { Page } from '@playwright/test';

import { chipColours, isDark } from '../../support/chip-colours.js';
import { FORCE_DARK, GL_ARGS } from '../../support/chromium-args.js';
import { renderedContrastViolations } from '../../support/rendered-contrast.js';
import { expect, test } from '../../support/test.js';
import { manyYearsManifest, stopCentre, yearChip } from '../../support/timeline.js';
import {
    callController,
    chooseMenuItem,
    menuButton,
    openTimelineCard,
    openViewer,
    serveManifest,
    t,
    viewer,
} from '../../support/viewer.js';

/**
 * The theme under Chrome's dark theme for sites (behaviour V12; the Pixel 9 Pro review, P2): on Android, while the system
 * is dark, Chrome repaints every element whose used colour scheme is light, which no computed style shows. The light
 * theme chosen in Settings then had its FAB's icon and the menu's labels painted pale on the primary container. A
 * chosen scheme is `only light` or `only dark`, and the painted contrast is read from the screen's pixels.
 */

test.use({ colorScheme: 'dark', launchOptions: { args: [...GL_ARGS, FORCE_DARK] } });

async function chooseTheme(page: Page, lang: 'ro' | 'en', key: 'theme.light' | 'theme.dark'): Promise<void> {
    await chooseMenuItem(page, lang, t(lang, 'settings.title'));
    await viewer(page)
        .locator('hcm-about-dialog')
        .getByRole('radio', { name: t(lang, key), exact: true })
        .click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: t(lang, 'settings.title') })).toHaveCount(0);
}

async function colourScheme(page: Page): Promise<string> {
    return viewer(page).evaluate((host) => getComputedStyle(host).colorScheme);
}

test(
    "The light theme under a dark system keeps its own colours: the FAB and the menu's labels are painted with their contrast",
    { tag: '@S-V12-HAPPY-ONLY-LIGHT' },
    async ({ page, lang }) => {
        await openViewer(page, { lang });
        await chooseTheme(page, lang, 'theme.light');

        await expect.poll(() => colourScheme(page)).toMatch(/^(only light|light only)$/);
        expect(await renderedContrastViolations(page, 'light under a dark system')).toEqual([]);
        await menuButton(page, lang).click();
        await expect(page.getByRole('menu', { name: t(lang, 'action.menu') })).toBeVisible();
        expect(await renderedContrastViolations(page, 'light under a dark system')).toEqual([]);
    },
);

test(
    "The dark theme chosen, or the system's, is the viewer's own dark, which Chrome's dark theme for sites leaves alone",
    { tag: '@S-V12-BAD-FORCED-DARK-SYSTEM' },
    async ({ page, lang }) => {
        await openViewer(page, { lang });
        await expect.poll(() => colourScheme(page)).toBe('light dark');
        await menuButton(page, lang).click();
        expect(await renderedContrastViolations(page, 'the system dark')).toEqual([]);
        await page.keyboard.press('Escape');

        await chooseTheme(page, lang, 'theme.dark');

        await expect.poll(() => colourScheme(page)).toMatch(/^(only dark|dark only)$/);
        await menuButton(page, lang).click();
        expect(await renderedContrastViolations(page, 'dark under a dark system')).toEqual([]);
    },
);

test(
    "Under Chrome's dark theme for sites the timeline's chips stay the viewer's own dark, never light",
    { tag: '@S-V12-BAD-DARK-CHIPS-NOT-LIGHT' },
    async ({ page, lang }) => {
        await page.setViewportSize({ width: 360, height: 800 });
        await serveManifest(
            page,
            manyYearsManifest(
                Array.from({ length: 20 }, (_, at) => 1965 + at),
                [1964],
            ),
        );
        await openViewer(page, { lang, hash: '16/44.44763/26.13822' });
        await callController(page, 'setYear', 1964);
        const timeline = viewer(page).locator('hcm-timeline');
        await expect(timeline).toHaveAttribute('collapsed');

        for (const [selector, fill, text] of [
            ['.thumb', 'primary-container', 'on-primary-container'],
            ['.thumb .badge', 'error-container', 'on-error-container'],
        ] as const) {
            expect(isDark((await chipColours(timeline.locator(selector), { fill, text })).fill), `${selector}: a dark fill`).toBe(true);
        }
        expect(await renderedContrastViolations(page, 'the pill under a dark system', 'hcm-timeline .thumb')).toEqual([]);

        await openTimelineCard(page);
        const unlabelled = await stopCentre(page, 1);
        await page.mouse.move(unlabelled.x, unlabelled.y);
        await page.mouse.move(unlabelled.x + 1, unlabelled.y);
        await expect.poll(async () => (await yearChip(page))?.text).toBe('1965');
        const chip = await chipColours(timeline.locator('.tip'), { fill: 'surface-container-highest', text: 'on-surface' });
        expect(isDark(chip.fill), 'the year chip: a dark fill').toBe(true);
        expect(await renderedContrastViolations(page, 'the year chip under a dark system', 'hcm-timeline .tip')).toEqual([]);
    },
);
