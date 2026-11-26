import { describe, expect, it } from 'vitest';

import {
    COMPACT_HEIGHT_MAX_PX,
    DOCKED_PANE_MIN_PX,
    TOUCH_TARGET_MIN_PX,
    isCompactHeight,
    isDockable,
    windowClassFor,
} from '../src/theme/tokens.js';

describe('windowClassFor', () => {
    it.each([
        [0, 'compact'],
        [320, 'compact'],
        [599, 'compact'],
        [600, 'medium'],
        [839, 'medium'],
        [840, 'expanded'],
        [1199, 'expanded'],
        [1200, 'large'],
        [1599, 'large'],
        [1600, 'extra-large'],
        [3840, 'extra-large'],
    ] as const)('happyPath_%dpx_is_%s', (width, expected) => {
        expect(windowClassFor(width)).toBe(expected);
    });

    it.each([[-1], [Number.NaN]])('badPath_invalidWidth_%d_isCompact', (width) => {
        expect(windowClassFor(width)).toBe('compact');
    });
});

describe('isCompactHeight', () => {
    it('happyPath_landscapePhoneIsCompactHeight', () => {
        expect(isCompactHeight(412)).toBe(true);
    });

    it('badPath_tallContainerIsNotCompactHeight', () => {
        expect(isCompactHeight(COMPACT_HEIGHT_MAX_PX)).toBe(false);
    });

    it('happyPath_touchTargetIs48dp', () => {
        expect(TOUCH_TARGET_MIN_PX).toBe(48);
    });
});

describe('isDockable', () => {
    it('happyPath_aTabletHeldUprightDocksItsSheets', () => {
        // The Pixel Tablet upright is 800 px wide: its modal side sheets covered the timeline, Menu and zoom.
        expect(isDockable(800)).toBe(true);
        expect(isDockable(DOCKED_PANE_MIN_PX)).toBe(true);
    });

    it('badPath_aNarrowMediumWindowKeepsModalSheets', () => {
        expect(isDockable(DOCKED_PANE_MIN_PX - 1)).toBe(false);
        expect(isDockable(Number.NaN)).toBe(false);
    });
});
