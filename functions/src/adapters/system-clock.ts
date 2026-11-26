import type { Clock } from '../ports/clock.js';

/** Waits `ms` on Node's timers. */
export function systemSleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export const systemClock: Clock = { now: () => new Date(), sleep: systemSleep };
