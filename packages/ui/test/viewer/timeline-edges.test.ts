import { describe, expect, it } from 'vitest';

import { crowdedLabels, edgesBeyond, pageTowards, sameSet } from '../../src/viewer/timeline-edges.js';

/** A scroller of `visible` px showing `along` of `extent` px, recording its scrolls. */
function scrollerOf(visible: number, along = 0, extent = 1000): HTMLElement & { readonly calls: ScrollToOptions[] } {
    const calls: ScrollToOptions[] = [];
    return {
        calls,
        clientWidth: visible,
        clientHeight: visible,
        scrollWidth: extent,
        scrollHeight: extent,
        scrollLeft: along,
        scrollTop: along,
        scrollBy: (options: ScrollToOptions) => {
            calls.push(options);
        },
    } as unknown as HTMLElement & { readonly calls: ScrollToOptions[] };
}

describe('crowdedLabels', () => {
    it('happyPath_fourDigitYearsFortyPxApartAllShow', () => {
        // Label large: a four-digit year is about 32 px; 40 px apart they keep 8 px between them.
        expect([...crowdedLabels([32, 32, 32, 32], 40)]).toEqual([]);
    });

    it('badPath_aLongTodayLeavesOutTheYearsItWouldTouch', () => {
        // French "Aujourd’hui" is about 76 px: the year before it would touch it, the one before that not.
        expect([...crowdedLabels([32, 32, 32, 76], 40)]).toEqual([2]);
        expect([...crowdedLabels([], 40)]).toEqual([]);
    });
});

describe('sameSet', () => {
    it('happyPath_theSameIndices', () => {
        expect(sameSet(new Set([1, 2]), new Set([2, 1]))).toBe(true);
    });

    it('badPath_otherIndicesOrAnotherSize', () => {
        expect(sameSet(new Set([1, 2]), new Set([1, 3]))).toBe(false);
        expect(sameSet(new Set([1]), new Set([1, 3]))).toBe(false);
    });
});

describe('edgesBeyond', () => {
    it('happyPath_theMiddleHasYearsBeyondBothEdges', () => {
        expect(edgesBeyond(scrollerOf(300, 300), false)).toEqual({ start: true, end: true });
        expect(edgesBeyond(scrollerOf(300, -300), false)).toEqual({ start: true, end: true });
    });

    it('badPath_eitherEndHasNothingBeyondIt', () => {
        expect(edgesBeyond(scrollerOf(300, 0), true)).toEqual({ start: false, end: true });
        expect(edgesBeyond(scrollerOf(300, 700), true)).toEqual({ start: true, end: false });
    });
});

describe('pageTowards', () => {
    it('happyPath_onePageLessTheButtonsSmoothly', () => {
        const scroller = scrollerOf(400);
        pageTowards(scroller, 'end', { vertical: false, rtl: false, reduced: false });
        pageTowards(scroller, 'start', { vertical: true, rtl: false, reduced: false });
        expect(scroller.calls).toEqual([
            { left: 288, behavior: 'smooth' },
            { top: -288, behavior: 'smooth' },
        ]);
    });

    it('badPath_rightToLeftTurnsATinyCardStillMovesAYearReducedMotionJumps', () => {
        const scroller = scrollerOf(100);
        pageTowards(scroller, 'end', { vertical: false, rtl: true, reduced: true });
        pageTowards(scroller, 'start', { vertical: false, rtl: true, reduced: true });
        pageTowards(scroller, 'end', { vertical: true, rtl: true, reduced: true });
        expect(scroller.calls).toEqual([
            { left: -40, behavior: 'instant' },
            { left: 40, behavior: 'instant' },
            { top: 40, behavior: 'instant' },
        ]);
    });
});
