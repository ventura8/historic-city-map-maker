import type { Locale } from '@hcm/shared';
import { expect, type Page } from '@playwright/test';

import { twoDatesOf1980 } from '../fixtures/manifest.js';
import { mapIdle } from '../support/map.js';
import { callController, openTimelineCard, openViewer, serveManifest, t, viewer } from '../support/viewer.js';
import { hasBottomSheets } from './sheets.js';

/**
 * The opacity card of a year with several layers (the owner, 2026-11-15/16; `timeline-opacity-card.ts`): an "all" slider
 * and a row per layer, opened by a mouse on the pill; on a narrow screen
 * the same card as a bottom sheet. Visited by the journey `timeline-opacity` of e2e/tour/states.ts at every viewport.
 */

export interface TimelineOpacityTour {
    readonly page: Page;
    readonly lang: Locale;
}

/**
 * Opens the card with a mouse resting on the selected pill at every viewport (a finger's long press is
 * S-V12-HAPPY-IPHONE-YEAR-OPACITY-HOLD's): the card stays while the mouse rests there, through the checkers' Tab round.
 */
async function openCard(page: Page, lang: Locale): Promise<void> {
    if (await viewer(page).locator('.opacity-sheet').isVisible()) {
        // The phone's modal sheet is still open from the state before: the frame under it is inert.
        return;
    }
    await openTimelineCard(page);
    // Opening the phone's card on a year of two dates offers its date menu (V13): closed first, it is not this state's.
    const dates = page.getByRole('menu', { name: t(lang, 'timeline.dates', { year: '1980' }), exact: true });
    if (await dates.isVisible()) {
        await page.keyboard.press('Escape');
        await expect(dates).toBeHidden();
    }
    const opener = viewer(page).locator('hcm-timeline .opacity-open');
    if (await opener.isVisible()) {
        // A phone: the open card's Opacity button opens the modal sheet.
        await opener.click();
    } else {
        // From off the pill: a mouse already resting on it (the tap that opened the card) sends no new pointerover.
        await page.mouse.move(0, 0);
        await viewer(page).locator('hcm-timeline .thumb').hover();
    }
    const sliders = viewer(page).locator(
        'hcm-timeline:not([dates-open]) .opacity:not([hidden]) [role="slider"], .opacity-sheet [role="slider"], hcm-date-menu .opacity-sliders [role="slider"]',
    );
    await expect(sliders).toHaveCount(3);
    await expect(sliders.first()).toHaveAttribute(
        'aria-label',
        t(lang, 'layers.opacity', { name: t(lang, 'timeline.opacityAll', { year: '1980' }) }),
    );
    await expect(sliders.last()).toBeVisible();
    await mapIdle(page);
}

type Box = { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null;

/** Whether two boxes share any area (touching edges do not). */
function intersects(first: Box, second: Box): boolean {
    if (first === null || second === null) {
        return false;
    }
    const apart = first.x + first.width <= second.x || second.x + second.width <= first.x;
    return !apart && !(first.y + first.height <= second.y || second.y + second.height <= first.y);
}

/**
 * The date menu, the sliders beside it and the timeline's bar never overlap (the owner's screenshot, 2026-11-16: the
 * sliders covered 1985 to 1989), whichever of them shows.
 */
async function expectApart(page: Page): Promise<void> {
    const box = async (selector: string): Promise<Box> => {
        const shown = viewer(page).locator(selector).first();
        return (await shown.count()) === 0 ? null : shown.boundingBox();
    };
    const [menu, side, bar] = await Promise.all([box('hcm-date-menu .menu'), box('hcm-date-menu .side'), box('hcm-timeline')]);
    expect(intersects(menu, side), 'the dates and the sliders').toBe(false);
    expect(intersects(menu, bar), 'the dates and the timeline').toBe(false);
    expect(intersects(side, bar), 'the sliders and the timeline').toBe(false);
}

export const TIMELINE_OPACITY_STATES = {
    'timeline-opacity-several': {
        title: 'The opacity card of a year with two layers: "all" first, then a slider per layer by date (beside its dates on a desktop)',
        enter: async ({ page, lang }: TimelineOpacityTour) => {
            await openCard(page, lang);
            await expectApart(page);
        },
    },
    'timeline-opacity-sheet': {
        title: "On a phone the year's opacity card is a modal sheet at the viewer's foot, opened by the card's Opacity button",
        enter: async ({ page, lang }: TimelineOpacityTour) => {
            await openCard(page, lang);
            const box = await viewer(page).locator('.opacity-sheet, hcm-timeline .opacity:not([hidden])').first().boundingBox();
            expect((page.viewportSize()?.height ?? 0) - ((box?.y ?? 0) + (box?.height ?? 0))).toBeLessThan(80);
        },
        exists: hasBottomSheets,
    },
} as const;

export const TIMELINE_OPACITY_JOURNEY = {
    title: 'The opacity card of a year with several layers, and its bottom sheet on a narrow screen',
    id: 'timeline-opacity',
    boot: async ({ page, lang }: TimelineOpacityTour) => {
        await serveManifest(page, twoDatesOf1980());
        await openViewer(page, { lang, hash: '15/44.37000/25.97000' });
        await callController(page, 'setYear', 1980);
    },
    states: ['timeline-opacity-several', 'timeline-opacity-sheet'],
} as const;
