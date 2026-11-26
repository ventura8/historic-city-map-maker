import { describe, expect, it } from 'vitest';

import {
    DOUBLE_TAP_SCALE,
    MAX_SCALE,
    MIN_SCALE,
    ZOOM_RESET,
    clampOffset,
    clampScale,
    distance,
    doubleTapZoom,
    isDoubleTap,
    isTap,
    panBy,
    pinchScale,
    wheelScale,
    zoomAt,
    zoomTo,
} from '../../src/viewer/zoom.js';

const BOX = { x: 400, y: 300 };

describe('clampScale', () => {
    it('happyPath_keepsScalesInRange', () => {
        expect(clampScale(2)).toBe(2);
        expect(clampScale(10)).toBe(MAX_SCALE);
        expect(clampScale(0.2)).toBe(MIN_SCALE);
    });

    it('badPath_nonFiniteScaleResets', () => {
        expect(clampScale(Number.NaN)).toBe(MIN_SCALE);
        expect(clampScale(Number.POSITIVE_INFINITY)).toBe(MIN_SCALE);
    });
});

describe('clampOffset', () => {
    it('happyPath_atScaleOneTheImageCannotMove', () => {
        expect(clampOffset({ x: 50, y: -50 }, 1, BOX)).toEqual({ x: 0, y: 0 });
    });

    it('badPath_offsetBeyondTheEdgeIsClamped', () => {
        expect(clampOffset({ x: 500, y: -500 }, 2, BOX)).toEqual({ x: 100, y: -75 });
    });
});

describe('zoomTo and panBy', () => {
    it('happyPath_zoomThenPanWithinTheImage', () => {
        const zoomed = zoomTo(ZOOM_RESET, 2, BOX);
        expect(zoomed.scale).toBe(2);

        const panned = panBy(zoomed, { x: 40, y: 20 }, BOX);
        expect(panned.offset).toEqual({ x: 20, y: 10 });
    });

    it('badPath_zoomingOutPullsTheOffsetBack', () => {
        const panned = panBy(zoomTo(ZOOM_RESET, 4, BOX), { x: 4000, y: 0 }, BOX);
        expect(zoomTo(panned, 1, BOX)).toEqual({ scale: 1, offset: { x: 0, y: 0 } });
    });
});

describe('gestures', () => {
    it('happyPath_wheelUpZoomsInAndDownZoomsOut', () => {
        expect(wheelScale(1, -100)).toBeGreaterThan(1);
        expect(wheelScale(2, 100)).toBeLessThan(2);
    });

    it('happyPath_pinchFollowsTheFingerSpread', () => {
        expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
        expect(pinchScale(1, 100, 250)).toBe(2.5);
    });

    it('badPath_pinchFromAZeroDistanceKeepsTheScale', () => {
        expect(pinchScale(1.5, 0, 200)).toBe(1.5);
    });
});

describe('zoomAt and the double tap', () => {
    /** Where the image's point under `at` shows after `state`: centre + scale × (point + offset). */
    const shown = (scale: number, offset: number, point: number): number => scale * (point + offset);

    it('happyPath_theTappedPointStaysUnderTheFingerAndASecondDoubleTapZoomsOut', () => {
        const at = { x: 60, y: -30 };
        const zoomed = doubleTapZoom(ZOOM_RESET, at, BOX);

        expect(zoomed.scale).toBe(DOUBLE_TAP_SCALE);
        expect(shown(zoomed.scale, zoomed.offset.x, at.x)).toBeCloseTo(at.x);
        expect(shown(zoomed.scale, zoomed.offset.y, at.y)).toBeCloseTo(at.y);
        expect(doubleTapZoom(zoomed, at, BOX)).toEqual(ZOOM_RESET);
    });

    it('badPath_aPointNearTheEdgeKeepsTheImageCoveringItsBox', () => {
        const zoomed = zoomAt(ZOOM_RESET, 10, { x: 4000, y: 0 }, BOX);

        expect(zoomed.scale).toBe(MAX_SCALE);
        expect(zoomed.offset).toEqual(clampOffset(zoomed.offset, MAX_SCALE, BOX));
        expect(Math.abs(zoomed.offset.x)).toBeCloseTo(((MAX_SCALE - 1) * BOX.x) / 2 / MAX_SCALE);
    });

    it('happyPath_twoQuickTapsCloseTogetherAreADoubleTap', () => {
        expect(isTap({ x: 0, y: 0 }, { x: 6, y: 6 })).toBe(true);
        expect(isDoubleTap({ x: 10, y: 10, time: 1000 }, { x: 20, y: 20, time: 1250 })).toBe(true);
    });

    it('badPath_aDragASlowOrAFarTapOrNoFirstTapIsNot', () => {
        expect(isTap({ x: 0, y: 0 }, { x: 30, y: 0 })).toBe(false);
        expect(isDoubleTap({ x: 10, y: 10, time: 1000 }, { x: 10, y: 10, time: 1400 })).toBe(false);
        expect(isDoubleTap({ x: 10, y: 10, time: 1000 }, { x: 80, y: 10, time: 1100 })).toBe(false);
        expect(isDoubleTap(null, { x: 10, y: 10, time: 1000 })).toBe(false);
    });
});
