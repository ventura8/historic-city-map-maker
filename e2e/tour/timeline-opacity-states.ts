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
    if (await viewer(page).locator('.opacity-sheet, hcm-date-menu .side').first().isVisible()) {
        // The phone's sliders are still open from the state before: the frame under them is inert.
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
        // A phone: the open card's Opacity button opens the year's dates with its sliders (a year of one date: the sheet).
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

export const TIMELINE_OPACITY_STATES = {
    'timeline-opacity-several': {
        title: 'The opacity card of a year with two layers: "all" first, then a slider per layer by date (beside its dates on a desktop)',
        enter: async ({ page, lang }: TimelineOpacityTour) => {
            await openCard(page, lang);
        },
    },
    'timeline-opacity-sheet': {
        title: 'On a phone a year of several dates shows its dates with the opacity sliders, never the sliders alone (owner, 2026-11-22)',
        enter: async ({ page, lang }: TimelineOpacityTour) => {
            await openCard(page, lang);
            await expect(page.getByRole('menu', { name: t(lang, 'timeline.dates', { year: '1980' }), exact: true })).toBeVisible();
            await expect(viewer(page).locator('.opacity-sheet')).toHaveCount(0);
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
