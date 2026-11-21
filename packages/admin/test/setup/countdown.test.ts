import { describe, expect, it, vi } from 'vitest';

import { USGS_TOKEN_SECONDS, createCountdown } from '../../src/setup/countdown.js';
import { FakeClock } from './harness.js';

function setup() {
    const clock = new FakeClock();
    const ticks: number[] = [];
    const onEnd = vi.fn();
    const countdown = createCountdown(
        clock,
        USGS_TOKEN_SECONDS,
        (secondsLeft) => {
            ticks.push(secondsLeft);
        },
        onEnd,
    );
    return { clock, ticks, onEnd, countdown };
}

describe('createCountdown', () => {
    it('happyPath_countsSixtySecondsDownThenEnds', async () => {
        const { clock, ticks, onEnd, countdown } = setup();

        countdown.start();
        await clock.advance(59_000);
        expect(ticks).toHaveLength(60);
        expect(ticks.slice(0, 2)).toEqual([60, 59]);
        expect(ticks.at(-1)).toBe(1);
        expect(onEnd).not.toHaveBeenCalled();

        await clock.advance(1_000);
        expect(onEnd).toHaveBeenCalledTimes(1);
        expect(clock.pending()).toBe(0);
    });

    it('happyPath_stopEndsItWithoutTheEnd', async () => {
        const { clock, onEnd, countdown } = setup();

        countdown.start();
        countdown.stop();
        countdown.stop();
        await clock.advance(120_000);

        expect(onEnd).not.toHaveBeenCalled();
    });

    it('badPath_aRestartBeginsAgainAtSixty', async () => {
        const { clock, ticks, countdown } = setup();

        countdown.start();
        await clock.advance(30_000);
        countdown.start();

        expect(ticks.at(-1)).toBe(60);
        expect(clock.pending()).toBe(1);
    });

    it('badPath_aLateTimerStillEndsOnTime', async () => {
        const { clock, onEnd, countdown } = setup();

        countdown.start();
        clock.time += 61_000;
        await clock.advance(1_000);

        expect(onEnd).toHaveBeenCalledTimes(1);
    });
});
