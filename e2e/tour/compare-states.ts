import type { Locale } from '@hcm/shared';
import { expect, type Page } from '@playwright/test';

import { E2E_XYZ_LAYER } from '../fixtures/world.js';
import { compareBar, compareChooser, divider } from '../support/compare.js';
import { mapIdle } from '../support/map.js';
import { sitePath } from '../support/site.js';
import { t, waitForEngineEvent } from '../support/viewer.js';

/**
 * Swipe compare's states in the tour's inventory (M4, behaviour V06; docs/research/M4-interfaces.md §3.9, §7.3), visited by
 * the journey `compare` of e2e/tour/states.ts at every viewer viewport: on a window 600 px wide or more the second map
 * behind the divider (at 50 %, at either edge, with the keyboard on it), below a toggle on the one map; at every size the
 * chooser of the compared side. Each runs the generic layout and accessibility checkers like every other state.
 */

/** A state of the tour's inventory as e2e/tour/states.ts takes it (without its id). */
export interface CompareState {
    readonly title: string;
    /** Drives the page into the state (a part of the tour's `TourContext`, e2e/tour/states.ts). */
    readonly enter: (tour: { readonly page: Page; readonly lang: Locale }) => Promise<void>;
    readonly exists?: (page: Page) => boolean;
}

/** Two maps of a 4K window under SwiftShader take longer than one to settle on a loaded machine. */
const TWO_MAPS_IDLE_MS = 60_000;

/** A window with the second map (600 px wide or more); below, compare is a toggle. */
function swipes(page: Page): boolean {
    return (page.viewportSize()?.width ?? 0) >= 600;
}

function toggles(page: Page): boolean {
    return !swipes(page);
}

/** Moves the divider with `key` from the keyboard and waits for its value and the second map's tiles. */
async function pressOnDivider(page: Page, lang: Locale, key: string, value: string): Promise<void> {
    const handle = divider(page, lang);
    await handle.press(key);
    await expect(handle).toHaveAttribute('aria-valuenow', value);
    await mapIdle(page, TWO_MAPS_IDLE_MS);
}

/** The journey's boot: compare open on today beside the 1966 layer, its surface drawn and its maps settled. */
export async function openComparing({ page, lang }: { readonly page: Page; readonly lang: Locale }): Promise<void> {
    await page.goto(sitePath('bucharest', { lang, hash: '15/44.42700/26.08530&layers=e2e-1966&cmp=' }));
    await waitForEngineEvent(page, 'hcm-ready');
    await expect(compareBar(page, lang)).toBeVisible();
    await mapIdle(page, TWO_MAPS_IDLE_MS);
}

export const COMPARE_STATES = {
    'compare-swipe': {
        title: 'Swipe compare: the second map right of the divider at 50 %, the compare bar at the top',
        enter: async ({ page, lang }) => {
            await expect(divider(page, lang)).toHaveAttribute('aria-valuenow', '50');
            await mapIdle(page, TWO_MAPS_IDLE_MS);
        },
        exists: swipes,
    },
    'compare-keyboard': {
        title: 'Swipe compare: the divider moved from the keyboard, with its focus ring',
        enter: async ({ page, lang }) => {
            await divider(page, lang).focus();
            await pressOnDivider(page, lang, 'ArrowLeft', '49');
        },
        exists: swipes,
    },
    'compare-swipe-edge': {
        title: 'Swipe compare: the divider at the leading edge, the compared side fills the map',
        enter: ({ page, lang }) => pressOnDivider(page, lang, 'Home', '0'),
        exists: swipes,
    },
    'compare-swipe-edge-end': {
        title: 'Swipe compare: the divider at the trailing edge, the main side fills the map',
        enter: ({ page, lang }) => pressOnDivider(page, lang, 'End', '100'),
        exists: swipes,
    },
    'compare-toggle': {
        title: 'Compare on a compact window: the two-way toggle on the one map, no second map',
        enter: async ({ page, lang }) => {
            await expect(compareBar(page, lang).getByRole('radiogroup', { name: t(lang, 'compare.toggle'), exact: true })).toBeVisible();
        },
        exists: toggles,
    },
    'compare-menu': {
        title: 'Compare: another historical layer chosen for the compared side, its source credited in the bar',
        enter: async ({ page, lang }) => {
            await compareChooser(page, lang).selectOption(E2E_XYZ_LAYER.id);
            await expect(compareBar(page, lang).getByText(t(lang, 'layers.attribution', { attribution: 'Arhivă (e2e)' }))).toBeVisible();
            await mapIdle(page, TWO_MAPS_IDLE_MS);
        },
    },
} as const satisfies Record<string, CompareState>;
