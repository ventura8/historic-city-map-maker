import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DatesOpenDetail } from '../../src/viewer/timeline-dates.js';
import { DWELL_MS, DatesPeek, HOVER_INTENT_MS, datesPeekEvent, peekAnchor, type DatesPeekDetail } from '../../src/viewer/timeline-peek.js';

/** V13's peek: a pointer resting on a year of several dates shows them after the intent delay; moving on closes them. */
const ANCHOR = { x: 10, y: 20, width: 4, height: 4 };
/** Stops 0 and 2 have several dates; 1 has one. */
function datesAt(index: number): DatesOpenDetail | null {
    return index === 1 ? null : { year: 1960 + index, anchor: ANCHOR };
}

function peek(): { readonly peek: DatesPeek; readonly sent: DatesPeekDetail[] } {
    const sent: DatesPeekDetail[] = [];
    return { peek: new DatesPeek({ datesAt, send: (detail) => sent.push(detail) }), sent };
}

describe('timeline-peek: the dates of a year a pointer rests on (V13)', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('happyPath_aMouseRestingOnAYearOfSeveralDatesShowsThemAfterTheIntentDelay', () => {
        const { peek: subject, sent } = peek();
        subject.rest(0, 'mouse');
        subject.rest(0, 'mouse');
        vi.advanceTimersByTime(HOVER_INTENT_MS - 1);
        expect(sent).toEqual([]);

        vi.advanceTimersByTime(1);

        expect(sent).toEqual([{ dates: { year: 1960, anchor: ANCHOR }, gently: false }]);
        expect(subject.shown()).toBe(true);
    });

    it('badPath_aSweepAcrossTheYearsShowsNothing', () => {
        const { peek: subject, sent } = peek();
        for (const index of [0, 1, 2, 1, 0, 1]) {
            subject.rest(index, 'mouse');
            vi.advanceTimersByTime(HOVER_INTENT_MS / 3);
        }
        vi.advanceTimersByTime(HOVER_INTENT_MS);

        expect(sent).toEqual([]);
    });

    it('happyPath_aMouseMovingOffClosesGentlyAndAFingerMovingOnAtOnceWithATick', () => {
        const vibrate = vi.fn(() => true);
        Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
        const mouse = peek();
        mouse.peek.rest(2, 'mouse');
        vi.advanceTimersByTime(HOVER_INTENT_MS);
        mouse.peek.away();
        expect(mouse.sent.at(-1)).toEqual({ dates: null, gently: true });

        const finger = peek();
        finger.peek.rest(0, 'touch');
        vi.advanceTimersByTime(HOVER_INTENT_MS);
        expect(finger.sent).toEqual([]);
        vi.advanceTimersByTime(DWELL_MS - HOVER_INTENT_MS);
        expect(finger.sent).toHaveLength(1);
        expect(vibrate).toHaveBeenCalledTimes(1);
        finger.peek.rest(1, 'touch');
        expect(finger.sent.at(-1)).toEqual({ dates: null, gently: false });
        Reflect.deleteProperty(navigator, 'vibrate');
    });

    it('badPath_aPressStopsWhatWaitsAndClosesOnlyWhenAsked', () => {
        const { peek: subject, sent } = peek();
        subject.rest(0, 'mouse');
        subject.stop(true);
        vi.advanceTimersByTime(HOVER_INTENT_MS);
        expect(sent).toEqual([]);

        subject.rest(2, 'touch');
        vi.advanceTimersByTime(DWELL_MS);
        subject.stop(false);
        expect(sent).toHaveLength(1);
        expect(subject.shown()).toBe(false);
        subject.away();
        subject.stop(true);
        expect(sent).toHaveLength(1);
    });

    it('badPath_aYearThatLostItsDatesWhileWaitingShowsNothing', () => {
        let several = true;
        const sent: DatesPeekDetail[] = [];
        const subject = new DatesPeek({
            datesAt: () => (several ? { year: 1966, anchor: ANCHOR } : null),
            send: (detail) => sent.push(detail),
        });
        subject.rest(0, 'mouse');
        several = false;
        vi.advanceTimersByTime(HOVER_INTENT_MS);

        expect(sent).toEqual([]);
    });

    it('happyPath_theAnchorIsTheYearsPointAlongTheTrackAndTheCardAcrossIt', () => {
        const mark = { x: 100, y: 200, width: 6, height: 6 };
        const card = { x: 50, y: 180, width: 400, height: 60 };

        expect(peekAnchor(mark, card, false)).toEqual({ x: 100, width: 6, y: 180, height: 60 });
        expect(peekAnchor(mark, card, true)).toEqual({ x: 50, width: 400, y: 200, height: 6 });
        expect(datesPeekEvent({ dates: null, gently: true }).composed).toBe(true);
    });
});
