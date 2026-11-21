import { describe, expect, it, vi } from 'vitest';

import { systemClock, systemSleep } from '../../src/adapters/system-clock.js';

describe('systemClock', () => {
    it('happyPath_readsTheCurrentTime', () => {
        const before = Date.now();

        const now = systemClock.now().getTime();

        expect(now).toBeGreaterThanOrEqual(before);
        expect(now).toBeLessThanOrEqual(Date.now());
    });

    it('happyPath_sleepsOnNodesTimers', async () => {
        vi.useFakeTimers();
        try {
            let woke = false;
            const sleeping = systemSleep(1_000).then(() => {
                woke = true;
            });

            await vi.advanceTimersByTimeAsync(999);
            expect(woke).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            await sleeping;

            expect(woke).toBe(true);
            expect(systemClock.sleep).toBe(systemSleep);
        } finally {
            vi.useRealTimers();
        }
    });
});
