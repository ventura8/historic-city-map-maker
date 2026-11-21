import type { Locale } from '@hcm/shared';
import { expect, type Locator, type Page } from '@playwright/test';

import { mapIdle } from '../support/map.js';
import { currentHash, openViewer, t } from '../support/viewer.js';

/**
 * The compass's states in the tour's inventory (behaviour V64), visited by the journey `compass` of e2e/tour/states.ts
 * at every viewer viewport: the map turned 45°, the compass coloured and focused from the keyboard, then north up again
 * after Enter, the compass quiet with the focus kept. The compass sits by the zoom group, so every other map state checks
 * it against the menu, the timeline, the chip, the sheets and the legal line as well.
 */

export interface CompassTour {
    readonly page: Page;
    readonly lang: Locale;
}

const TURNED = '16/44.42704/26.0853/45';

function compass(page: Page, lang: Locale): Locator {
    return page.getByRole('button', { name: t(lang, 'viewer.compass'), exact: true });
}

/** Waits until the address drops its bearing and the map is idle: the compass quiet, the focus still on it. */
async function settledNorth(page: Page, lang: Locale): Promise<void> {
    await expect.poll(async () => (await currentHash(page)).split('&')[0]).toBe('16/44.42704/26.0853');
    await mapIdle(page);
    await expect(page.locator('hcm-compass')).toHaveAttribute('north');
    await expect(compass(page, lang)).toBeFocused();
}

export const COMPASS_STATES = {
    'compass-turned': {
        title: 'The map turned 45°: the compass coloured, focused from the keyboard',
        enter: async ({ page, lang }: CompassTour) => {
            await compass(page, lang).focus();
            await expect(page.locator('hcm-compass')).not.toHaveAttribute('north');
        },
    },
    'compass-north': {
        title: 'Enter on the compass: north up again, the compass quiet, the focus kept',
        enter: async ({ page, lang }: CompassTour) => {
            await page.keyboard.press('Enter');
            await settledNorth(page, lang);
        },
    },
} as const;

/** The journey of these states in e2e/tour/states.ts. */
export const COMPASS_JOURNEY = {
    title: 'The compass on a turned map and north up again',
    id: 'compass',
    boot: ({ page, lang }: CompassTour) => openViewer(page, { lang, hash: TURNED }),
    states: ['compass-turned', 'compass-north'],
} as const;
