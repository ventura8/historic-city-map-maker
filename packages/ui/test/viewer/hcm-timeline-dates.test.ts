import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { HCM_TIMELINE_TAG, defineHcmTimeline, type HcmTimeline } from '../../src/viewer/hcm-timeline.js';
import { mountElement, recordEvents, shadowQuery, shadowQueryAll } from './doubles.js';

/**
 * V13 (a badge on a year with several dates, a hint only; selecting that year asks for the picker, the years a drag passes
 * never do) and V12 (the collapsed pill).
 */
const STOPS = [1966, 1977, 1980, null];
const COUNTS = new Map([
    [1966, 3],
    [1980, 2],
]);

async function timeline(properties: Partial<HcmTimeline> = {}): Promise<HcmTimeline> {
    defineHcmTimeline();
    const element = await mountElement<HcmTimeline>(HCM_TIMELINE_TAG, { stops: STOPS, value: 1977, dateCounts: COUNTS, ...properties });
    if (properties.collapsed !== true) {
        element.style.inlineSize = properties.orientation === 'vertical' ? '68px' : '400px';
        element.style.blockSize = properties.orientation === 'vertical' ? '300px' : '';
    }
    await element.updateComplete;
    return element;
}

/** The point of stop `index` on the track, as a pointer of `pointerType` would press it. */
function pointerAt(element: HcmTimeline, type: string, index: number, pointerType = 'mouse', target?: EventTarget): void {
    const track = shadowQuery(element, '.track');
    const rect = track.getBoundingClientRect();
    const init = { clientX: rect.left + (rect.width * index) / (STOPS.length - 1), clientY: rect.top + rect.height / 2, button: 0 };
    const event = new PointerEvent(type, { ...init, pointerType, pointerId: 7, bubbles: true, cancelable: true, composed: true });
    (target ?? (type === 'pointerdown' ? track : window)).dispatchEvent(event);
}

/** The years the picker was asked for, once the asks waiting for a render went out. */
async function asked(element: HcmTimeline, seen: readonly { detail: unknown }[]): Promise<readonly number[]> {
    await element.updateComplete;
    await element.updateComplete;
    return seen.map((event) => (event.detail as { year: number }).year);
}

function press(element: HcmTimeline, key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true });
    shadowQuery(element, '[role="slider"]').dispatchEvent(event);
    return event;
}

describe('<hcm-timeline> dates (V13)', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aYearWithSeveralDatesHasABadgeWithTheCount', async () => {
        const element = await timeline();

        expect(shadowQueryAll(element, '.stop .badge').map((badge) => badge.textContent.trim())).toEqual(['3', '2']);
        expect(element.shadowRoot?.querySelector('.thumb .badge')).toBeNull();
        await expect.element(page.getByRole('slider', { name: 'Cronologie' })).toHaveAttribute('aria-valuetext', 'Anul 1977');
    });

    it('happyPath_theSelectedYearsBadgeIsOnThePillAndTheSliderSaysIt', async () => {
        const element = await timeline({ value: 1966, locale: 'en' });

        expect(shadowQuery(element, '.thumb .badge').textContent.trim()).toBe('3');
        expect(shadowQueryAll(element, '.stop .badge')).toHaveLength(1);
        await expect
            .element(page.getByRole('slider', { name: 'Timeline' }))
            .toHaveAttribute('aria-valuetext', 'Year 1966, several dates (3), Enter lists them');
    });

    it('badPath_withoutCountsNoBadge', async () => {
        const element = await timeline({ dateCounts: new Map() });

        expect(element.shadowRoot?.querySelectorAll('.badge')).toHaveLength(0);
    });
});

describe('<hcm-timeline> selecting a year of several dates (V13, the owner 2026-11-13)', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('badPath_theBadgeIsAHintOnlyNoTargetOfItsOwn', async () => {
        const element = await timeline();
        const events = recordEvents(element, 'hcm-dates-open');

        for (const badge of shadowQueryAll(element, '.badge')) {
            expect(getComputedStyle(badge).pointerEvents).toBe('none');
            expect(badge.closest('[aria-hidden="true"]')).not.toBeNull();
            expect(badge.hasAttribute('tabindex')).toBe(false);
            badge.click();
        }

        expect(await asked(element, events)).toEqual([]);
    });

    it('happyPath_aClickOnAYearWithSeveralDatesAsksForThemBesideTheThumb', async () => {
        const element = await timeline();
        const events = recordEvents(element, 'hcm-dates-open');

        pointerAt(element, 'pointerdown', 2);
        expect(await asked(element, events), 'not while the button is down').toEqual([]);
        pointerAt(element, 'pointerup', 2);

        expect(await asked(element, events)).toEqual([1980]);
        const anchor = (events[0]?.detail as { anchor: { x: number; width: number } }).anchor;
        const thumb = shadowQuery(element, '.thumb').getBoundingClientRect();
        expect([anchor.x, anchor.width]).toEqual([thumb.x, thumb.width]);
    });

    it('happyPath_aDeliberateSecondClickOnTheSameYearAsksAgainOncePerClick', async () => {
        const element = await timeline({ value: 1966 });
        const events = recordEvents(element, 'hcm-dates-open');

        pointerAt(element, 'pointerdown', 0);
        pointerAt(element, 'pointerup', 0);
        expect(await asked(element, events)).toEqual([1966]);
        pointerAt(element, 'pointerdown', 0);
        pointerAt(element, 'pointerup', 0);

        expect(await asked(element, events)).toEqual([1966, 1966]);
    });

    it('badPath_aDragAcrossAYearWithSeveralDatesAsksOnlyWhereItEnds', async () => {
        const element = await timeline();
        const events = recordEvents(element, 'hcm-dates-open', 'hcm-year-change');

        pointerAt(element, 'pointerdown', 1);
        pointerAt(element, 'pointermove', 0);
        pointerAt(element, 'pointermove', 1);
        pointerAt(element, 'pointermove', 2);
        await vi.waitFor(() => {
            expect(events.some((event) => event.type === 'hcm-year-change')).toBe(true);
        });
        expect(
            events.filter((event) => event.type === 'hcm-dates-open'),
            'mid-drag: never',
        ).toEqual([]);
        pointerAt(element, 'pointerup', 2);

        await asked(element, events);
        expect(events.filter((event) => event.type === 'hcm-dates-open').map((event) => (event.detail as { year: number }).year)).toEqual([
            1980,
        ]);
    });

    it('badPath_aDragEndingOnASingleDateOrACancelledPressAsksForNothing', async () => {
        const element = await timeline();
        const events = recordEvents(element, 'hcm-dates-open');

        pointerAt(element, 'pointerdown', 1);
        pointerAt(element, 'pointermove', 0);
        pointerAt(element, 'pointermove', 1);
        pointerAt(element, 'pointerup', 1);
        pointerAt(element, 'pointerdown', 2);
        pointerAt(element, 'pointercancel', 2);

        expect(await asked(element, events)).toEqual([]);
    });

    it('happyPath_aFingerScrubEndingOnAYearWithSeveralDatesAsksOnLift', async () => {
        const element = await timeline();
        const events = recordEvents(element, 'hcm-dates-open');

        pointerAt(element, 'pointerdown', 1, 'touch');
        pointerAt(element, 'pointermove', 2, 'touch');
        expect(await asked(element, events), 'mid-scrub: never').toEqual([]);
        expect(element.value).toBe(1980);
        pointerAt(element, 'pointerup', 2, 'touch');

        expect(await asked(element, events)).toEqual([1980]);
    });

    it('happyPath_enterOnAYearWithSeveralDatesAsksForThemEveryTime', async () => {
        const element = await timeline({ value: 1966 });
        const events = recordEvents(element, 'hcm-dates-open');

        const event = press(element, 'Enter');
        expect(event.defaultPrevented).toBe(true);
        expect(await asked(element, events)).toEqual([1966]);
        press(element, 'Enter');

        expect(await asked(element, events)).toEqual([1966, 1966]);
    });

    it('happyPath_theGamepadsAOnTheSliderAsksAsEnterDoesAMouseClickDoesNot', async () => {
        const element = await timeline({ value: 1966 });
        const events = recordEvents(element, 'hcm-dates-open');
        const slider = shadowQuery(element, '[role="slider"]');

        slider.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true, composed: true }));
        expect(await asked(element, events)).toEqual([]);
        slider.click();

        expect(await asked(element, events)).toEqual([1966]);
    });

    it('badPath_theArrowsPassAYearWithSeveralDatesWithoutAsking', async () => {
        const element = await timeline();
        const events = recordEvents(element, 'hcm-dates-open', 'hcm-year-change');

        press(element, 'ArrowRight');
        press(element, 'ArrowLeft');
        press(element, 'ArrowLeft');

        await asked(element, events);
        expect(events.map((event) => event.type)).toEqual(['hcm-year-change', 'hcm-year-change', 'hcm-year-change']);
    });

    it('badPath_enterOnASingleDateOrTodayAsksForNothing', async () => {
        const element = await timeline();
        const events = recordEvents(element, 'hcm-dates-open', 'hcm-year-change');

        expect(press(element, 'Enter').defaultPrevented).toBe(false);
        element.value = null;
        await element.updateComplete;
        press(element, 'Enter');
        shadowQuery(element, '[role="slider"]').click();

        expect(await asked(element, events)).toEqual([]);
    });
});

describe('<hcm-timeline> collapsed (V12)', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_collapsedStandingItIsOnlyTheLargePillA64PixelCard', async () => {
        const element = await timeline({ orientation: 'vertical', collapsed: true });
        const box = element.getBoundingClientRect();

        expect(Math.round(box.height)).toBe(64);
        expect(box.width).toBeGreaterThanOrEqual(96);
        expect(getComputedStyle(shadowQuery(element, '.thumb')).fontSize, 'M3 title large').toBe('22px');
        expect(getComputedStyle(shadowQuery(element, '.rail')).display).toBe('none');
        expect(getComputedStyle(shadowQuery(element, '.stops')).display).toBe('none');
        expect(element.hasAttribute('collapsed')).toBe(true);
    });

    it('badPath_collapsedTheSliderStillTakesTheKeys', async () => {
        const element = await timeline({ collapsed: true });
        const events = recordEvents(element, 'hcm-year-change');

        press(element, 'ArrowRight');

        expect(events).toEqual([{ type: 'hcm-year-change', detail: { year: 1980 } }]);
        expect(element.getBoundingClientRect().height).toBe(64);
    });
});
