// The installed app updates itself at a safe moment (2026-11-14): whether anybody uses the admin's tab
// (`packages/admin/src/app/activity.ts`), on a hand-driven clock.
import { describe, expect, it } from 'vitest';

import { IDLE_MS, watchActivity } from '../../src/app/activity.js';
import { FakeClock } from './fakes.js';

function tab() {
    const clock = new FakeClock();
    const listeners = new Map<string, () => void>();
    const idle = watchActivity(
        {
            addEventListener: (type, listener, options) => {
                expect(options).toEqual({ capture: true, passive: true });
                listeners.set(type, listener);
            },
        },
        clock,
    );
    const fire = (type: string): void => {
        listeners.get(type)?.();
    };
    return { clock, idle, fire };
}

describe('watchActivity', () => {
    it('happyPath_aTabNobodyTouchesForAMinuteIsIdle', () => {
        const t = tab();
        expect(t.idle()).toBe(false);
        t.clock.advance(IDLE_MS);
        expect(t.idle()).toBe(true);
    });

    it('badPath_aKeyOrAWheelStartsTheMinuteAgain', () => {
        const t = tab();
        t.clock.advance(IDLE_MS - 1);
        t.fire('keydown');
        t.clock.advance(IDLE_MS - 1);
        expect(t.idle()).toBe(false);
        t.fire('wheel');
        t.clock.advance(IDLE_MS);
        expect(t.idle()).toBe(true);
    });

    it('badPath_aPressedPointerIsNeverIdle_untilItIsLetGo', () => {
        const t = tab();
        t.fire('pointerdown');
        t.clock.advance(10 * IDLE_MS);
        expect(t.idle()).toBe(false);
        t.fire('pointercancel');
        t.clock.advance(IDLE_MS);
        expect(t.idle()).toBe(true);
        t.fire('pointerdown');
        t.fire('pointerup');
        t.clock.advance(IDLE_MS);
        expect(t.idle()).toBe(true);
    });
});
