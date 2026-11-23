import { describe, expect, it } from 'vitest';

import { clearOf } from '../../src/viewer/date-menu-clear.js';

/** The date menu keeps clear of the floating controls, moving as little as it can (V68). */
const ROOM = { width: 360, height: 800 };
const MENU = { x: 92, y: 566, width: 220, height: 112 };
const CARD = { x: 16, y: 16, width: 68, height: 640 };
const COMPASS = { x: 296, y: 498, width: 40, height: 40 };
const ZOOM = { x: 296, y: 554, width: 40, height: 88 };
const FAB = { x: 288, y: 700, width: 56, height: 56 };

describe('date-menu-clear', () => {
    it('happyPath_aMenuClearOfEverythingStaysWhereItIs', () => {
        expect(clearOf({ ...MENU, x: 92, y: 300 }, [CARD, COMPASS, ZOOM, FAB], ROOM, { foot: 42 })).toEqual({ ...MENU, x: 92, y: 300 });
    });

    it('happyPath_overTheZoomItMovesPastItAndTheCompassAboveThem', () => {
        const placed = clearOf(MENU, [CARD, COMPASS, ZOOM, FAB], ROOM, { foot: 42 });

        expect(placed).toEqual({ ...MENU, y: COMPASS.y - 8 - MENU.height });
    });

    it('happyPath_itTakesTheShortestWayRoundAChip', () => {
        const chip = { x: 192, y: 594, width: 40, height: 40 };
        const card = { x: 192, y: 642, width: 640, height: 84 };

        expect(clearOf({ x: 126, y: 522, width: 220, height: 112 }, [card, chip], { width: 1024, height: 768 }, { foot: 42 })).toEqual({
            x: 126,
            y: 474,
            width: 220,
            height: 112,
        });
    });

    it('happyPath_alongAxisShiftsHorizontallyRatherThanJumpingUp', () => {
        const zoom = { x: 1384, y: 600, width: 40, height: 88 };
        const card = { x: 400, y: 770, width: 640, height: 84 };
        const wanted = { x: 1000, y: 650, width: 432, height: 112 };

        expect(clearOf(wanted, [card, zoom], { width: 1440, height: 900 }, { foot: 42, axis: 'x' })).toEqual({
            ...wanted,
            x: zoom.x - 8 - wanted.width,
        });
    });

    it('badPath_besideAStackOfControlsItShiftsAlongTheTimelineNotUpToTheCorner', () => {
        const room = { width: 1440, height: 900 };
        const card = { x: 400, y: 770, width: 960, height: 84 };
        const stack = [
            { x: 1384, y: 642, width: 40, height: 88 },
            { x: 1384, y: 586, width: 40, height: 40 },
            { x: 1384, y: 530, width: 40, height: 40 },
        ];
        const wanted = { x: 1000, y: 650, width: 432, height: 112 };

        expect(clearOf(wanted, [card, ...stack], room, { foot: 42, axis: 'x' })).toEqual({ ...wanted, x: 1384 - 8 - 432 });
    });

    it('happyPath_besideAStandingTimelineItShiftsUpOrDownAlongIt', () => {
        expect(clearOf(MENU, [CARD, COMPASS, ZOOM, FAB], ROOM, { foot: 42, axis: 'y' })).toEqual({
            ...MENU,
            y: COMPASS.y - 8 - MENU.height,
        });
    });

    it('badPath_withNoClearPlaceAlongTheAxisItTriesTheOtherWays', () => {
        const wide = { x: 0, y: 600, width: 360, height: 60 };

        expect(clearOf({ ...MENU, y: 580 }, [wide], ROOM, { foot: 42, axis: 'x' })).toEqual({ ...MENU, y: 600 - 8 - MENU.height });
    });

    it('badPath_withNoClearPlaceItStaysWhereItWasAsked', () => {
        const wall = { x: 0, y: 0, width: 360, height: 800 };

        expect(clearOf(MENU, [wall], ROOM, { foot: 42 })).toEqual(MENU);
    });
});
