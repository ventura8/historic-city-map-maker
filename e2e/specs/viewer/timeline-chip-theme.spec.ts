import type { Locale } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { chipColours, chipContrast, isDark, type ChipRoles } from '../../support/chip-colours.js';
import { expect, test } from '../../support/test.js';
import { fingers, lift, manyYearsManifest, stopCentre, touch, yearChip } from '../../support/timeline.js';
import { callController, openTimelineCard, openViewer, serveManifest, t, viewer } from '../../support/viewer.js';

/**
 * The timeline's chips follow the theme (behaviour V12; the owner's Android in dark, 2026-11-13: the year chips were light)
 * at the project's own window, a phone's or a desktop's: the pill of the year, its dates' badge, the year chip and the date
 * menu are light in the light theme and dark in the dark one, each painted with its theme roles at 4.5:1 or more.
 */

const OBOR_VIEW = '16/44.44763/26.13822';
/** Twenty-one layer years, 1964 (two dates) to 1984, and today. */
const YEARS = Array.from({ length: 21 }, (_, at) => 1964 + at);

const PILL: ChipRoles = { fill: 'primary-container', text: 'on-primary-container' };
const BADGE: ChipRoles = { fill: 'error-container', text: 'on-error-container' };
const YEAR_CHIP: ChipRoles = { fill: 'surface-container-highest', text: 'on-surface' };
const MENU: ChipRoles = { fill: 'surface-container', text: 'on-surface' };

function slider(page: Page, lang: Locale): Locator {
    return page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
}

async function openOn1964(page: Page, lang: Locale, scheme: 'light' | 'dark'): Promise<void> {
    await page.emulateMedia({ colorScheme: scheme });
    await serveManifest(page, manyYearsManifest(YEARS.slice(1), [1964]));
    await openViewer(page, { lang, hash: OBOR_VIEW });
    await callController(page, 'setYear', 1964);
    await expect(viewer(page).locator('hcm-timeline .thumb .badge')).toHaveText('2');
}

/** The chip takes its roles' colours, dark in the dark theme and light in the light one, its text at 4.5:1 or more. */
async function expectThemed(chip: Locator, roles: ChipRoles, name: string, scheme: 'light' | 'dark'): Promise<void> {
    await expect(chip, name).toBeVisible();
    const colours = await chipColours(chip, roles);
    expect(colours.fill, `${name}: --md-sys-color-${roles.fill} in ${scheme}`).toEqual(colours.fillRole);
    expect(colours.text, `${name}: --md-sys-color-${roles.text} in ${scheme}`).toEqual(colours.textRole);
    expect(isDark(colours.fill), `${name}: a ${scheme} fill`).toBe(scheme === 'dark');
    expect(chipContrast(colours), `${name}: its text at 4.5:1`).toBeGreaterThanOrEqual(4.5);
}

/** The pill, its badge, the date menu and the year chip, in `scheme`. */
async function expectEveryChip(page: Page, lang: Locale, scheme: 'light' | 'dark'): Promise<void> {
    await openOn1964(page, lang, scheme);
    const timeline = viewer(page).locator('hcm-timeline');
    await expectThemed(timeline.locator('.thumb'), PILL, 'the pill of the year', scheme);
    await expectThemed(timeline.locator('.thumb .badge'), BADGE, 'the badge of its dates', scheme);

    await slider(page, lang).focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: t(lang, 'timeline.dates', { year: '1964' }), exact: true });
    await expect(menu).toBeVisible();
    await expectThemed(viewer(page).locator('hcm-date-menu .menu'), MENU, 'the date menu', scheme);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    // Every year has its label (the owner, 2026-11-14), so a mouse shows no chip: a finger scrubbing from the pill does.
    await openTimelineCard(page);
    const pill = await timeline.locator('.thumb').boundingBox();
    const cdp = await fingers(page);
    const from = { x: (pill?.x ?? 0) + (pill?.width ?? 0) / 2, y: (pill?.y ?? 0) + (pill?.height ?? 0) / 2 };
    await touch(cdp, from, [await stopCentre(page, 1)], false);
    await expect.poll(async () => (await yearChip(page))?.text).toBe('1965');
    await expectThemed(timeline.locator('.tip'), YEAR_CHIP, 'the year chip', scheme);
    await lift(cdp);
}

test(
    "The timeline's chips follow the theme: light in the light theme and dark in the dark one, painted with its roles",
    { tag: '@S-V12-HAPPY-CHIPS-FOLLOW-THEME' },
    async ({ page, lang }) => {
        await expectEveryChip(page, lang, 'light');
        await expectEveryChip(page, lang, 'dark');
    },
);
