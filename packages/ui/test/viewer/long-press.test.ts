/**
 * LongPress: a finger hold opens the opacity card; mouse/pen never hold; moving past the slop cancels.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LongPress } from '../../src/viewer/long-press.js';

function touch(overrides: Partial<PointerEvent> = {}): PointerEvent {
    return {
        pointerType: 'touch',
        clientX: 10,
        clientY: 20,
        ...overrides,
    } as PointerEvent;
}

describe('LongPress', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('happyPath_aFingerHeldHalfASecondCallsOnHold', () => {
        const onHold = vi.fn();
        const press = new LongPress(onHold);

        press.start(touch());
        vi.advanceTimersByTime(500);

        expect(onHold).toHaveBeenCalledOnce();
    });

    it('badPath_aMouseOrPenNeverHolds', () => {
        const onHold = vi.fn();
        const press = new LongPress(onHold);

        press.start(touch({ pointerType: 'mouse' }));
        vi.advanceTimersByTime(500);
        press.start(touch({ pointerType: 'pen' }));
        vi.advanceTimersByTime(500);

        expect(onHold).not.toHaveBeenCalled();
    });

    it('badPath_movingPastTheSlopCancelsTheHold', () => {
        const onHold = vi.fn();
        const press = new LongPress(onHold);

        press.start(touch({ clientX: 0, clientY: 0 }));
        document.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, clientY: 0, bubbles: true }));
        vi.advanceTimersByTime(500);

        expect(onHold).not.toHaveBeenCalled();
    });

    it('happyPath_aSmallDriftStillHolds', () => {
        const onHold = vi.fn();
        const press = new LongPress(onHold);

        press.start(touch({ clientX: 0, clientY: 0 }));
        document.dispatchEvent(new PointerEvent('pointermove', { clientX: 5, clientY: 5, bubbles: true }));
        vi.advanceTimersByTime(500);

        expect(onHold).toHaveBeenCalledOnce();
    });
});
