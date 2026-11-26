import type { Locale } from '@hcm/shared';
import { expect, type BrowserContext, type Page } from '@playwright/test';

import { connectPad, installFakePads, pressButton } from '../support/gamepad.js';
import { focused } from '../support/layout.js';
import { dismissToast, openViewer, t } from '../support/viewer.js';

/**
 * The 10-foot view's states in the tour's inventory (behaviours V65, V66; docs/research/viewer-input.md §6), visited by
 * the journey `tv` of e2e/tour/states.ts: a TV's window (1920 × 1080) with a coarse pointer (Chromium's touch emulation,
 * what a console's browser reports), driven with a fake pad. They exist at the projects of a large window (1200 px wide
 * or more), which the journey turns into the TV's; a phone's or a tablet's project passes them over.
 */

export interface TvTour {
    readonly page: Page;
    readonly context: BrowserContext;
    readonly lang: Locale;
}

const TV_WINDOW = { width: 1920, height: 1080 };
const DPAD_DOWN = 13;
const Y = 3;

/** The TV's window: the journey's boot sets it at a large project only. */
function onTv(page: Page): boolean {
    const size = page.viewportSize();
    return size?.width === TV_WINDOW.width && size.height === TV_WINDOW.height;
}

async function bootTvJourney({ page, context, lang }: TvTour): Promise<void> {
    await installFakePads(page);
    if ((page.viewportSize()?.width ?? 0) >= 1200) {
        await page.setViewportSize(TV_WINDOW);
        const devtools = await context.newCDPSession(page);
        await devtools.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    await openViewer(page, { lang, hash: '15/44.42700/26.08530&layers=e2e-1966' });
    await connectPad(page);
    // The pad's greeting goes before the states: a toast that times out during the Tab round is not a state of these.
    // The snackbar's visible message, not its live region's copy of the same text (strict mode found both).
    await expect(page.locator('hcm-snackbar .message', { hasText: t(lang, 'gamepad.ready') })).toBeVisible();
    await dismissToast(page, lang);
}

async function ringWidth(page: Page): Promise<number> {
    return page.evaluate(() => {
        let active: Element | null = document.activeElement;
        while (active?.shadowRoot?.activeElement) {
            active = active.shadowRoot.activeElement;
        }
        return active === null ? 0 : Number.parseFloat(getComputedStyle(active).outlineWidth);
    });
}

/** D-pad down from the map: a control has the focus, with the TV's 6 px ring. */
async function dpadOffTheMap(page: Page): Promise<void> {
    await pressButton(page, DPAD_DOWN);
    await expect.poll(async () => (await focused(page))?.outlined).toBe(true);
    await expect.poll(() => ringWidth(page)).toBe(6);
}

/** D-pad down until the timeline has the focus (a few controls may lie on the way). */
async function dpadToTimeline(page: Page, lang: Locale): Promise<void> {
    const timeline = page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
    for (let press = 0; press < 8 && !(await timeline.evaluate((slider) => slider.matches(':focus'))); press += 1) {
        await pressButton(page, DPAD_DOWN);
    }
    await expect(timeline).toBeFocused();
}

/** Whether the focus is inside the Layers panel, through every shadow root on the way. */
async function focusInLayers(page: Page): Promise<boolean> {
    return page.evaluate(() => {
        let active: Element | null = document.activeElement;
        let inside = false;
        while (active !== null) {
            inside ||= active.localName === 'hcm-layer-panel';
            active = active.shadowRoot?.activeElement ?? null;
        }
        return inside;
    });
}

/** Y: the Layers panel, the focus in it. */
async function layersFromY(page: Page, lang: Locale): Promise<void> {
    await pressButton(page, Y);
    await expect(page.getByRole('heading', { name: t(lang, 'layers.title'), exact: true }).first()).toBeVisible();
    await expect.poll(() => focusInLayers(page)).toBe(true);
}

export const TV_STATES = {
    'tv-dpad-focus': {
        title: 'A TV (1920 × 1080, coarse pointer): the D-pad moved the focus off the map, a 6 px ring on it',
        exists: onTv,
        enter: ({ page }: TvTour) => dpadOffTheMap(page),
    },
    'tv-timeline': {
        title: 'A TV: the D-pad on the timeline, which keeps left and right for its years',
        exists: onTv,
        enter: ({ page, lang }: TvTour) => dpadToTimeline(page, lang),
    },
    'tv-layers': {
        title: 'A TV: Y took the focus into the Layers panel',
        exists: onTv,
        enter: ({ page, lang }: TvTour) => layersFromY(page, lang),
    },
} as const;

/** The journey of these states in e2e/tour/states.ts. */
export const TV_JOURNEY = {
    title: 'A TV or a games console: the D-pad, the timeline and Layers at 1920 × 1080 with a coarse pointer',
    id: 'tv',
    boot: bootTvJourney,
    states: ['tv-dpad-focus', 'tv-timeline', 'tv-layers'],
} as const;
