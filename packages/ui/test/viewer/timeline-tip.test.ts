import { describe, expect, it, vi } from 'vitest';

import { tick } from '../../src/viewer/timeline-scrub.js';
import { placeTip, tipText, tipWanted } from '../../src/viewer/timeline-tip.js';

/** The timeline's year chip (the owner, 2026-11-13): its text, when a mouse or a key needs it, and its place. */
describe('the timeline year chip', () => {
    it('happyPath_theChipIsTheYearOrToday', () => {
        expect(tipText(1980, 'en')).toBe('1980');
        expect(tipText(null, 'en')).toBe('Today');
    });

    it('happyPath_aStopWithoutItsLabelWantsTheChip', () => {
        expect(tipWanted(false, false)).toBe(true);
    });

    it('badPath_aLabelledStopOrAYearOfSeveralDatesWantsNone', () => {
        expect(tipWanted(true, false)).toBe(false);
        expect(tipWanted(false, true), 'its date menu names the dates').toBe(false);
        expect(tipWanted(true, true)).toBe(false);
    });

    const card = { left: 100, top: 500, width: 400, height: 84 };
    const tip = { width: 80, height: 24 };
    const lying = { width: 1000, height: 800, rtl: false, vertical: false };

    it('happyPath_lyingItIsCentredOverItsStop', () => {
        expect(placeTip({ x: 200, y: 30 }, tip, card, lying)).toEqual({ left: 160, top: -32 });
    });

    it('badPath_atTheCardsEndsAndTheViewportsEdgeItStaysInside', () => {
        expect(placeTip({ x: 5, y: 30 }, tip, card, lying).left).toBe(0);
        expect(placeTip({ x: 398, y: 30 }, tip, card, lying).left).toBe(320);
        expect(placeTip({ x: 5, y: 30 }, tip, { ...card, left: -20 }, lying).left).toBe(28);
        expect(placeTip({ x: 398, y: 30 }, tip, card, { ...lying, width: 450 }).left).toBe(262);
    });

    it('happyPath_standingItIsBesideTheCardOnItsTrailingSide', () => {
        const standing = { ...lying, vertical: true };
        const column = { left: 16, top: 16, width: 68, height: 500 };

        expect(placeTip({ x: 34, y: 200 }, tip, column, standing)).toEqual({ left: 76, top: 188 });
        expect(placeTip({ x: 34, y: 200 }, tip, column, { ...standing, rtl: true })).toEqual({ left: -88, top: 188 });
    });

    it('badPath_standingAtTheEndsItStaysWithinTheCardAndTheViewport', () => {
        const standing = { ...lying, vertical: true, height: 400 };
        const column = { left: 16, top: 16, width: 68, height: 500 };

        expect(placeTip({ x: 34, y: 2 }, tip, column, standing).top).toBe(0);
        expect(placeTip({ x: 34, y: 499 }, tip, column, standing).top).toBe(400 - 8 - 16 - 24);
    });

    function fakeWindow(vibrate: unknown, reduced: boolean): Window {
        return { navigator: { vibrate }, matchMedia: () => ({ matches: reduced }) } as unknown as Window;
    }

    it('happyPath_aNewYearUnderTheFingerTicksWhereTheDeviceVibrates', () => {
        const vibrate = vi.fn();

        tick(fakeWindow(vibrate, false));

        expect(vibrate).toHaveBeenCalledWith(8);
    });

    it('badPath_noTickWithoutAVibratorOrUnderReducedMotion', () => {
        const vibrate = vi.fn();

        tick(fakeWindow(vibrate, true));
        tick(fakeWindow(undefined, false));

        expect(vibrate).not.toHaveBeenCalled();
    });
});
