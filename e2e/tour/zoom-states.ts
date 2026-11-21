import type { Locale } from '@hcm/shared';
import { expect, type Page } from '@playwright/test';

import { mapIdle } from '../support/map.js';
import { currentHash, openViewer, t } from '../support/viewer.js';

/**
 * The zoom buttons' states in the tour's inventory (behaviour V52), visited by the journey `zoom` of e2e/tour/states.ts at
 * every viewer viewport: the pair at the city's maximum, Zoom in soft-disabled with the keyboard's focus ring on it, then
 * Zoom out focused after a step out. The buttons show in every other state of the map too, so each of those checks
 * them against the menu, the timeline, the chip, the sheets and the legal line as well.
 */

export interface ZoomTour {
    readonly page: Page;
    readonly lang: Locale;
}

const CENTRE = '44.42704/26.0853';

function zoomButton(page: Page, lang: Locale, key: 'viewer.zoomIn' | 'viewer.zoomOut'): ReturnType<Page['getByRole']> {
    return page.getByRole('button', { name: t(lang, key), exact: true });
}

/** Waits until the address says `zoom` and the map is idle again. */
async function settledAt(page: Page, zoom: string): Promise<void> {
    await expect.poll(async () => (await currentHash(page)).split('/')[0]).toBe(zoom);
    await mapIdle(page);
}

export const ZOOM_STATES = {
    'zoom-at-limit': {
        title: "At the city's maximum zoom: Zoom in soft-disabled, focused from the keyboard",
        enter: async ({ page, lang }: ZoomTour) => {
            await zoomButton(page, lang, 'viewer.zoomIn').focus();
            await expect(zoomButton(page, lang, 'viewer.zoomIn')).toHaveAttribute('aria-disabled', 'true');
        },
    },
    'zoom-out': {
        title: 'Zoom out from the keyboard: one level out, both buttons enabled, the focus kept',
        enter: async ({ page, lang }: ZoomTour) => {
            await zoomButton(page, lang, 'viewer.zoomOut').focus();
            await page.keyboard.press('Enter');
            await settledAt(page, '19');
            await expect(zoomButton(page, lang, 'viewer.zoomIn')).not.toHaveAttribute('aria-disabled', 'true');
            await expect(zoomButton(page, lang, 'viewer.zoomOut')).toBeFocused();
        },
    },
} as const;

/** The journey of these states in e2e/tour/states.ts. */
export const ZOOM_JOURNEY = {
    title: "The zoom buttons at the city's maximum and one level out",
    id: 'zoom',
    boot: ({ page, lang }: ZoomTour) => openViewer(page, { lang, hash: `20/${CENTRE}` }),
    states: ['zoom-at-limit', 'zoom-out'],
} as const;
