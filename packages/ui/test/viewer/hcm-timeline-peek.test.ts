import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HCM_DATE_MENU_TAG, defineHcmDateMenu, type HcmDateMenu } from '../../src/viewer/hcm-date-menu.js';
import { HCM_TIMELINE_TAG, defineHcmTimeline, type HcmTimeline } from '../../src/viewer/hcm-timeline.js';
import { DWELL_MS, HOVER_INTENT_MS, type DatesPeekDetail } from '../../src/viewer/timeline-peek.js';
import { mountElement, recordEvents, shadowQuery } from './doubles.js';

/**
 * V13's peek on `<hcm-timeline>` (the owner, 2026-11-13): a mouse resting on a year of several dates, or a scrubbing finger
 * resting on it, asks for its dates (`hcm-dates-peek`) without selecting the year; a sweep, a held button or a finger
 * moving on does not; a finger slides onto the menu to pick a date.
 */
const STOPS = [1966, 1977, 1980, null];
const COUNTS = new Map([
    [1966, 3],
    [1980, 2],
]);

async function timeline(properties: Partial<HcmTimeline> = {}): Promise<HcmTimeline> {
    defineHcmTimeline();
    const element = await mountElement<HcmTimeline>(HCM_TIMELINE_TAG, { stops: STOPS, value: 1977, dateCounts: COUNTS, ...properties });
    element.style.inlineSize = properties.orientation === 'vertical' ? '68px' : '400px';
    element.style.blockSize = properties.orientation === 'vertical' ? '300px' : '';
    element.style.marginBlockStart = '400px';
    element.style.display = 'block';
    await element.updateComplete;
    return element;
}

/** A pointer event at stop `index` of the track (`dy`: px off the track's middle, across it). */
function pointerAt(element: HcmTimeline, type: string, index: number, pointerType: string, target?: EventTarget, dy = 0): void {
    const track = shadowQuery(element, '.track');
    const rect = track.getBoundingClientRect();
    const init = { clientX: rect.left + (rect.width * index) / (STOPS.length - 1), clientY: rect.top + rect.height / 2 + dy, button: 0 };
    const event = new PointerEvent(type, { ...init, pointerType, pointerId: 7, bubbles: true, cancelable: true, composed: true });
    (target ?? track).dispatchEvent(event);
}

function peeks(element: HcmTimeline): { readonly detail: unknown }[] {
    return recordEvents(element, 'hcm-dates-peek');
}

function years(seen: readonly { readonly detail: unknown }[]): readonly (number | null)[] {
    return seen.map((event) => (event.detail as DatesPeekDetail).dates?.year ?? null);
}

describe('<hcm-timeline>: a mouse resting on a year of several dates (V13 peek)', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    afterEach(() => {
        vi.useRealTimers();
        document.body.replaceChildren();
    });

    it('happyPath_hoveringAYearOfSeveralDatesAsksForThemWithoutSelectingIt', async () => {
        const element = await timeline();
        const seen = peeks(element);
        const changes = recordEvents(element, 'hcm-year-change', 'hcm-dates-open');

        pointerAt(element, 'pointermove', 2, 'mouse');
        vi.advanceTimersByTime(HOVER_INTENT_MS);

        expect(years(seen)).toEqual([1980]);
        const anchor = (seen[0]?.detail as DatesPeekDetail).dates?.anchor;
        expect(anchor?.y, 'the card across the track').toBeCloseTo(element.getBoundingClientRect().top, 0);
        expect(changes).toEqual([]);
        expect(element.value).toBe(1977);

        shadowQuery(element, '.track').dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
        expect((seen.at(-1)?.detail as DatesPeekDetail).gently).toBe(true);
    });

    it('badPath_sweepingAcrossTheYearsAsksForNothing', async () => {
        const element = await timeline();
        const seen = peeks(element);

        for (const index of [0, 1, 2, 3, 2, 1]) {
            pointerAt(element, 'pointermove', index, 'mouse');
            vi.advanceTimersByTime(HOVER_INTENT_MS / 3);
        }
        vi.advanceTimersByTime(HOVER_INTENT_MS);

        expect(seen).toEqual([]);
    });

    it('badPath_aDragWithTheButtonHeldAsksForNothingMidDrag', async () => {
        const element = await timeline();
        const seen = peeks(element);

        pointerAt(element, 'pointermove', 0, 'mouse');
        pointerAt(element, 'pointerdown', 1, 'mouse');
        pointerAt(element, 'pointermove', 2, 'mouse');
        vi.advanceTimersByTime(HOVER_INTENT_MS * 2);

        expect(seen).toEqual([]);
        pointerAt(element, 'pointerup', 2, 'mouse', window);
    });

    it('badPath_aFingerOverTheTrackIsNoHover', async () => {
        const element = await timeline();
        const seen = peeks(element);

        pointerAt(element, 'pointermove', 0, 'touch');
        vi.advanceTimersByTime(DWELL_MS);

        expect(seen).toEqual([]);
    });
});

describe('<hcm-timeline>: a scrubbing finger resting on a year of several dates (V13 peek)', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    afterEach(() => {
        vi.useRealTimers();
        document.body.replaceChildren();
    });

    /** The menu the viewer would show for the peek, in the timeline's root. */
    async function menuFor(seen: readonly { readonly detail: unknown }[]): Promise<HcmDateMenu> {
        defineHcmDateMenu();
        const menu = document.createElement(HCM_DATE_MENU_TAG);
        menu.style.cssText = 'position: fixed; inset: 0';
        const items = [
            { id: 'one', date: '1980', label: 'One' },
            { id: 'two', date: '1980', label: 'Two' },
        ];
        Object.assign(menu, { items, label: '1980', peek: true, anchor: (seen.at(-1)?.detail as DatesPeekDetail).dates?.anchor });
        document.body.append(menu);
        await menu.updateComplete;
        return menu;
    }

    it('happyPath_aDwellAsksForTheDatesAndSlidingOntoOnePicksIt', async () => {
        const element = await timeline();
        const seen = peeks(element);
        pointerAt(element, 'pointerdown', 1, 'touch');
        pointerAt(element, 'pointermove', 2, 'touch', window);
        vi.advanceTimersByTime(DWELL_MS);
        expect(years(seen)).toEqual([1980]);
        const menu = await menuFor(seen);
        const picks = recordEvents(menu, 'hcm-date-pick');
        const opens = recordEvents(element, 'hcm-dates-open');
        const item = shadowQuery(menu, '[data-item="two"]').getBoundingClientRect();
        const track = shadowQuery(element, '.track').getBoundingClientRect();
        const off = item.top + item.height / 2 - (track.top + track.height / 2);

        pointerAt(element, 'pointermove', 2, 'touch', window, -20);
        pointerAt(element, 'pointermove', 2, 'touch', window, off);
        pointerAt(element, 'pointerup', 2, 'touch', window, off);
        await element.updateComplete;

        expect(picks).toEqual([{ type: 'hcm-date-pick', detail: { layerId: 'two' } }]);
        expect(element.value).toBe(1980);
        expect(opens).toEqual([]);
    });

    it('happyPath_liftingOnTheYearSelectsItAndItsMenuStays', async () => {
        const element = await timeline();
        const seen = peeks(element);
        const opens = recordEvents(element, 'hcm-dates-open');
        pointerAt(element, 'pointerdown', 2, 'touch');
        vi.advanceTimersByTime(DWELL_MS);
        await menuFor(seen);

        pointerAt(element, 'pointerup', 2, 'touch', window);
        await element.updateComplete;
        await element.updateComplete;

        expect(years(seen)).toEqual([1980]);
        expect(opens).toHaveLength(1);
    });

    it('badPath_aQuickSweepAsksForNothingAndMovingOnClosesIt', async () => {
        const element = await timeline();
        const seen = peeks(element);
        pointerAt(element, 'pointerdown', 3, 'touch');
        for (const index of [2, 1, 0, 1]) {
            pointerAt(element, 'pointermove', index, 'touch', window);
            vi.advanceTimersByTime(DWELL_MS / 4);
        }
        expect(seen).toEqual([]);

        pointerAt(element, 'pointermove', 2, 'touch', window);
        vi.advanceTimersByTime(DWELL_MS);
        await menuFor(seen);
        pointerAt(element, 'pointermove', 3, 'touch', window);

        expect(years(seen)).toEqual([1980, null]);
        expect((seen.at(-1)?.detail as DatesPeekDetail).gently).toBe(false);
        expect(element.value, 'the scrub goes on').toBe(null);
        pointerAt(element, 'pointercancel', 3, 'touch', window);
    });
});
