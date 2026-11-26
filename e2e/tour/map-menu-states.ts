import type { Locale } from '@hcm/shared';
import { expect, type Page } from '@playwright/test';

import { openViewer, t, viewer } from '../support/viewer.js';

/**
 * The map's menu in the tour's inventory (behaviour V62; the owner on 2026-11-09), visited by the journey `map-menu` of
 * e2e/tour/states.ts at every viewer viewport: open from a right click a third of the way into the map, its first item
 * focused, its three items (Street View, Copy coordinates, Share a link to this view) inside the map.
 */

export interface MapMenuTour {
    readonly page: Page;
    readonly lang: Locale;
}

export const MAP_MENU_STATES = {
    'map-menu-open': {
        title: "The map's menu, open at a point of the map, its first item focused",
        enter: async ({ page, lang }: MapMenuTour) => {
            const box = await viewer(page).locator('.map').boundingBox();
            // On a short map the menu opens higher: a third of the way down it would cut the zoom group's touch targets.
            const size = { width: box?.width ?? 0, height: box?.height ?? 0 };
            const down = size.height < 600 ? 80 : size.height / 3;
            await page.mouse.click((box?.x ?? 0) + size.width / 3, (box?.y ?? 0) + down, { button: 'right' });
            const menu = page.getByRole('menu', { name: t(lang, 'mapMenu.label') });
            await expect(menu.getByRole('menuitem', { name: t(lang, 'mapMenu.streetView') })).toBeFocused();
        },
    },
} as const;

/** The journey of these states in e2e/tour/states.ts. */
export const MAP_MENU_JOURNEY = {
    title: "The map's menu, open",
    id: 'map-menu',
    boot: ({ page, lang }: MapMenuTour) => openViewer(page, { lang, hash: '16/44.42704/26.0853' }),
    states: ['map-menu-open'],
} as const;
