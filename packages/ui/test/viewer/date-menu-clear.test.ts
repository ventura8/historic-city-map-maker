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
        expect(clearOf({ ...MENU, x: 92, y: 300 }, [CARD, COMPASS, ZOOM, FAB], ROOM, 42)).toEqual({ ...MENU, x: 92, y: 300 });
    });

    it('happyPath_overTheZoomItMovesPastItAndTheCompassAboveThem', () => {
        const placed = clearOf(MENU, [CARD, COMPASS, ZOOM, FAB], ROOM, 42);

        expect(placed).toEqual({ ...MENU, y: COMPASS.y - 8 - MENU.height });
    });

    it('happyPath_itTakesTheShortestWayRoundAChip', () => {
        const chip = { x: 192, y: 594, width: 40, height: 40 };
        const card = { x: 192, y: 642, width: 640, height: 84 };

        expect(clearOf({ x: 126, y: 522, width: 220, height: 112 }, [card, chip], { width: 1024, height: 768 }, 42)).toEqual({
            x: 126,
            y: 474,
            width: 220,
            height: 112,
        });
    });

    it('badPath_withNoClearPlaceItStaysWhereItWasAsked', () => {
        const wall = { x: 0, y: 0, width: 360, height: 800 };

        expect(clearOf(MENU, [wall], ROOM, 42)).toEqual(MENU);
    });
});
