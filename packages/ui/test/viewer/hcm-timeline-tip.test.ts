import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import { HCM_TIMELINE_TAG, defineHcmTimeline, type HcmTimeline } from '../../src/viewer/hcm-timeline.js';
import { mountElement, recordEvents, shadowQuery, shadowQueryAll } from './doubles.js';

/**
 * The year chip on `<hcm-timeline>` (the owner, 2026-11-13): a mouse over a stop without its own label (none since every
 * year is labelled, the owner, 2026-11-14), a finger anywhere
 * on the track (scrubbing, selecting on lift, locked to the track's axis); never a year of several dates, whose date menu
 * names them; in title medium, 40 px tall.
 */

/** Twelve stops, 1964 to 1974 and today: roomy in a 720 px card, every year labelled (40 px apart). */
const MANY = [...Array.from({ length: 11 }, (_, at) => 1964 + at), null];
/** 1964 has two dates (and 1967 two layers): their stops carry a badge and never a chip. */
const COUNTS = new Map([
    [1964, 2],
    [1967, 2],
]);

function frame(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            resolve();
        });
    });
}

async function timeline(properties: Partial<HcmTimeline> = {}): Promise<HcmTimeline> {
    defineHcmTimeline();
    const element = await mountElement<HcmTimeline>(HCM_TIMELINE_TAG, { stops: MANY, dateCounts: COUNTS, value: 1974, ...properties });
    element.style.inlineSize = '720px';
    element.style.blockSize = properties.orientation === 'vertical' ? '720px' : '';
    element.style.marginBlockStart = '120px';
    element.style.marginInlineStart = '120px';
    await frame();
    await frame();
    await element.updateComplete;
    return element;
}

function at(element: HcmTimeline, index: number): { readonly x: number; readonly y: number } {
    const box = shadowQueryAll(element, '.stop')[index]?.getBoundingClientRect() ?? new DOMRect();
    return { x: box.left + box.width / 2, y: box.top + 4 };
}

function fire(target: EventTarget, type: string, point: { readonly x: number; readonly y: number }, pointerType = 'mouse'): void {
    const pointerId = pointerType === 'touch' ? 2 : 1;
    const init = { clientX: point.x, clientY: point.y, button: 0, pointerId, pointerType, bubbles: true, cancelable: true, composed: true };
    target.dispatchEvent(new PointerEvent(type, init));
}

function tip(element: HcmTimeline): HTMLElement | null {
    return element.shadowRoot?.querySelector<HTMLElement>('.tip') ?? null;
}

describe('<hcm-timeline> year chip', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aFingerShowsTheYearAboveTheCard', async () => {
        const element = await timeline();
        expect(element.getAttribute('density')).toBe('roomy');
        const track = shadowQuery(element, '.track');

        fire(track, 'pointerdown', at(element, 1), 'touch');
        await element.updateComplete;

        expect(tip(element)?.textContent).toBe('1965');
        expect(tip(element)?.getAttribute('aria-hidden')).toBe('true');
        const style = getComputedStyle(tip(element) ?? element);
        expect([style.fontSize, style.minHeight, style.paddingInlineStart], 'M3 title medium, 40 px, 16 px in').toEqual([
            '16px',
            '40px',
            '16px',
        ]);
        expect(element.hasAttribute('tipping')).toBe(true);
        const card = element.getBoundingClientRect();
        const chip = tip(element)?.getBoundingClientRect() ?? new DOMRect();
        expect(chip.bottom).toBeLessThanOrEqual(card.top - 7);
        expect(Math.abs(chip.left + chip.width / 2 - at(element, 1).x)).toBeLessThan(1);
        fire(window, 'pointercancel', at(element, 1), 'touch');
        await element.updateComplete;
        expect(tip(element)).toBeNull();
    });

    it('badPath_aMouseOverALabelledYearShowsNoChip', async () => {
        const element = await timeline();

        fire(shadowQuery(element, '.track'), 'pointermove', at(element, 2));
        await element.updateComplete;

        expect(tip(element)).toBeNull();
        expect(element.hasAttribute('tipping')).toBe(false);
    });

    it('happyPath_theChipNearTheFirstYearStaysOverTheCardsEnd', async () => {
        const element = await timeline({ locale: 'en' });

        fire(shadowQuery(element, '.track'), 'pointerdown', at(element, 1), 'touch');
        await element.updateComplete;

        expect(tip(element)?.textContent).toBe('1965');
        const chip = tip(element)?.getBoundingClientRect() ?? new DOMRect();
        expect(chip.left).toBeGreaterThanOrEqual(element.getBoundingClientRect().left);
        fire(window, 'pointercancel', at(element, 1), 'touch');
    });

    it('badPath_aMultiDateYearShowsNoChipUnderAMouseTheKeyboardOrAFinger', async () => {
        const element = await timeline({ value: 1965 });
        const track = shadowQuery(element, '.track');

        fire(track, 'pointermove', at(element, 0));
        await element.updateComplete;
        expect(tip(element), 'a mouse').toBeNull();
        element.focus();
        await userEvent.keyboard('{ArrowLeft}');
        await element.updateComplete;
        expect(element.value).toBe(1964);
        expect(tip(element), 'the keyboard').toBeNull();
        fire(track, 'pointerdown', at(element, 2), 'touch');
        await element.updateComplete;
        expect(tip(element)?.textContent, 'a finger on 1966').toBe('1966');
        fire(window, 'pointermove', at(element, 3), 'touch');
        await element.updateComplete;
        expect(tip(element), 'a finger scrubbing over 1967 (two layers)').toBeNull();
        fire(window, 'pointermove', at(element, 4), 'touch');
        await element.updateComplete;
        expect(tip(element)?.textContent).toBe('1968');
        fire(window, 'pointercancel', at(element, 4), 'touch');
    });

    it('happyPath_standingTheChipIsBesideTheCard', async () => {
        const element = await timeline({ orientation: 'vertical' });

        fire(shadowQuery(element, '.track'), 'pointerdown', at(element, 5), 'touch');
        await element.updateComplete;

        const card = element.getBoundingClientRect();
        const chip = tip(element)?.getBoundingClientRect() ?? new DOMRect();
        expect(chip.left).toBeGreaterThanOrEqual(card.right + 7);
        fire(window, 'pointercancel', at(element, 5), 'touch');
    });
});

describe('<hcm-timeline> under a finger', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_theCardsTouchActionReachesTheTrackInsideItsScroller', async () => {
        // A real finger on the track panned and cancelled the scrub: the scroller is a scroll container (lesson 642).
        const element = await timeline();

        expect(getComputedStyle(shadowQuery(element, '.scroller')).touchAction).toBe('none');
        expect(getComputedStyle(shadowQuery(element, '.track')).touchAction).toBe('none');
    });

    it('badPath_aScrollingCardStillLetsAFingerScrollItAlongTheTrack', async () => {
        const element = await timeline({ stops: [...Array.from({ length: 61 }, (_, at) => 1924 + at), null], dateCounts: new Map() });

        expect(element.getAttribute('density')).toBe('scroll');
        expect(getComputedStyle(shadowQuery(element, '.track')).touchAction).toBe('pan-x');
    });

    it('happyPath_aFingerDragAcrossYearsSelectsEachLiveAndTheChipFollows', async () => {
        const element = await timeline();
        const events = recordEvents(element, 'hcm-year-change');

        fire(shadowQuery(element, '.track'), 'pointerdown', at(element, 2), 'touch');
        await element.updateComplete;
        expect(tip(element)?.textContent, 'a labelled year under a finger too').toBe('1966');
        expect(events, 'a press alone selects nothing yet').toHaveLength(0);
        fire(window, 'pointermove', at(element, 3), 'touch');
        await element.updateComplete;
        expect(element.value).toBe(1967);
        expect(tip(element), '1967 has two layers: no chip, its date menu names them').toBeNull();
        expect(events.map((event) => event.detail)).toEqual([{ year: 1967 }]);
        await frame();
        fire(window, 'pointermove', at(element, 4), 'touch');
        await element.updateComplete;
        expect(tip(element)?.textContent).toBe('1968');
        expect(events.map((event) => event.detail)).toEqual([{ year: 1967 }, { year: 1968 }]);
        fire(window, 'pointerup', at(element, 4), 'touch');
        await element.updateComplete;

        expect(element.value).toBe(1968);
        expect(events).toHaveLength(2);
        expect(tip(element)).toBeNull();
        expect(shadowQuery(element, '[aria-live="polite"]').textContent).toBe('Anul 1968');
    });

    it('badPath_aFastScrubSendsAtMostOneYearPerFrameAndEndsOnTheLastOne', async () => {
        const element = await timeline();
        const events = recordEvents(element, 'hcm-year-change');

        fire(shadowQuery(element, '.track'), 'pointerdown', at(element, 2), 'touch');
        for (const index of [3, 4, 5, 6, 7, 8, 9]) {
            fire(window, 'pointermove', at(element, index), 'touch');
        }
        expect(events.map((event) => event.detail)).toEqual([{ year: 1967 }]);
        // The viewer renders the store's year (1967) back into the timeline before the frame (lesson 641).
        element.value = 1967;
        fire(window, 'pointerup', at(element, 9), 'touch');
        await frame();
        await frame();

        expect(events.map((event) => event.detail)).toEqual([{ year: 1967 }, { year: 1973 }]);
    });

    it('happyPath_aFrameSendsTheYearAScrubLeftUnsent', async () => {
        const element = await timeline();
        const events = recordEvents(element, 'hcm-year-change');

        fire(shadowQuery(element, '.track'), 'pointerdown', at(element, 2), 'touch');
        fire(window, 'pointermove', at(element, 3), 'touch');
        fire(window, 'pointermove', at(element, 5), 'touch');
        await frame();
        await frame();

        expect(events.map((event) => event.detail)).toEqual([{ year: 1967 }, { year: 1969 }]);
        fire(window, 'pointerup', at(element, 5), 'touch');
        expect(events).toHaveLength(2);
    });

    it('badPath_aSwipeAcrossTheTrackOrACancelSelectsNothing', async () => {
        const element = await timeline();
        const events = recordEvents(element, 'hcm-year-change');
        const start = at(element, 2);

        fire(shadowQuery(element, '.track'), 'pointerdown', start, 'touch');
        fire(window, 'pointermove', { x: start.x + 3, y: start.y - 40 }, 'touch');
        fire(window, 'pointermove', at(element, 6), 'touch');
        fire(window, 'pointerup', at(element, 6), 'touch');
        fire(shadowQuery(element, '.track'), 'pointerdown', start, 'touch');
        fire(window, 'pointerup', at(element, 6), 'mouse');
        fire(window, 'pointercancel', start, 'touch');
        fire(window, 'pointerup', start, 'touch');
        await element.updateComplete;

        expect(events).toHaveLength(0);
        expect(element.value).toBe(1974);
        expect(tip(element)).toBeNull();
    });

    it('happyPath_aTapSelectsTheYearUnderTheFinger', async () => {
        const element = await timeline();

        const point = at(element, 6);
        fire(shadowQuery(element, '.track'), 'pointerdown', point, 'touch');
        fire(window, 'pointermove', { x: point.x + 2, y: point.y }, 'touch');
        fire(window, 'pointercancel', point, 'mouse');
        fire(window, 'pointermove', point, 'mouse');
        expect(element.value, 'nothing before the finger moves along or lifts').toBe(1974);
        fire(window, 'pointerup', point, 'touch');
        await element.updateComplete;

        expect(element.value).toBe(1970);
    });

    it('badPath_aMouseHintNeverReplacesAFingersChipAndADisconnectEndsTheScrub', async () => {
        const element = await timeline();
        const track = shadowQuery(element, '.track');

        fire(track, 'pointerdown', at(element, 2), 'touch');
        fire(track, 'pointermove', at(element, 3), 'mouse');
        fire(track, 'pointerleave', at(element, 3), 'mouse');
        await element.updateComplete;
        expect(tip(element)?.textContent).toBe('1966');
        element.remove();
        fire(window, 'pointerup', at(element, 2), 'touch');
        expect(element.value).toBe(1974);
    });
});
