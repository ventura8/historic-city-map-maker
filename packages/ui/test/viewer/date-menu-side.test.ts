import { describe, expect, it } from 'vitest';

import { placeSide, sideOrigin } from '../../src/viewer/date-menu-side.js';

/** The year's opacity sliders beside its date menu (the owner, 2026-11-16). */
const ROOM = { width: 1000, height: 700 };
const SIDE = { width: 240, height: 120 };

describe('the opacity sliders beside the date menu', () => {
    it('happyPath_pastTheMenusEndCentredOnItOrUnderItOnAPhone', () => {
        const menu = { x: 100, y: 300, width: 200, height: 160 };
        expect(sideOrigin(menu, SIDE, ROOM, false)).toEqual({ x: 312, y: 340 });
        expect(sideOrigin(menu, SIDE, ROOM, true)).toEqual({ x: 100, y: 472 });
    });

    it('badPath_noRoomPastTheEndGoesBeforeItAndTheViewerAndLegalLineClampIt', () => {
        expect(sideOrigin({ x: 700, y: 10, width: 200, height: 40 }, SIDE, ROOM, false)).toEqual({ x: 448, y: 12 });
        expect(sideOrigin({ x: 100, y: 560, width: 200, height: 100 }, SIDE, ROOM, true), 'no room under it: beside').toEqual({
            x: 312,
            y: 538,
        });
        expect(sideOrigin({ x: 0, y: 0, width: 990, height: 40 }, SIDE, ROOM, false).x).toBe(12);
    });

    it('happyPath_placeSideSetsItsCornerAndOnAPhoneTheMenusWidth', () => {
        const side = document.createElement('div');
        side.style.position = 'absolute';
        side.style.width = '240px';
        side.style.height = '120px';
        document.body.append(side);
        placeSide(side, { x: 100, y: 300, width: 200, height: 160 }, ROOM, true);
        expect(side.style.inlineSize).toBe('200px');
        expect(side.style.top).toBe('472px');
        placeSide(side, { x: 100, y: 300, width: 200, height: 160 }, ROOM, false);
        expect(side.style.inlineSize).toBe('');
        expect(side.style.left).toBe('312px');
        side.remove();
    });
});
