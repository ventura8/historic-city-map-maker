import { describe, expect, it, vi } from 'vitest';

import { createPoller, type PollOutcome } from '../../src/setup/poll.js';
import { FakeClock, FakeVisibility, flush } from './harness.js';

const OPTIONS = { intervalMs: 10_000, stopAfterMs: 60_000 };

/** A check that settles when the test says so. */
function deferred(): { readonly promise: Promise<PollOutcome>; resolve(outcome: PollOutcome): void } {
    const holder: { settle?: (outcome: PollOutcome) => void } = {};
    const promise = new Promise<PollOutcome>((resolve) => {
        holder.settle = resolve;
    });
    return {
        promise,
        resolve(outcome) {
            holder.settle?.(outcome);
        },
    };
}

function setup(outcomes: readonly (PollOutcome | Error)[] = [], options = OPTIONS) {
    const clock = new FakeClock();
    const visibility = new FakeVisibility();
    const queue = [...outcomes];
    const check = vi.fn(() => {
        const next = queue.shift() ?? 'next';
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    });
    const onExpire = vi.fn();
    const poller = createPoller({ clock, visibility }, options, check, onExpire);
    return { clock, visibility, check, onExpire, poller };
}

describe('createPoller', () => {
    it('happyPath_checksAtOnceThenEveryInterval', async () => {
        const { clock, check, poller } = setup();

        poller.start(true);
        await flush();
        await clock.advance(30_000);

        expect(check).toHaveBeenCalledTimes(4);
        expect(poller.isRunning()).toBe(true);
    });

    it('happyPath_aDelayedStartWaitsOneInterval', async () => {
        const { clock, check, poller } = setup();

        poller.start(false);
        await clock.advance(9_999);

        expect(check).not.toHaveBeenCalled();
        await clock.advance(1);
        expect(check).toHaveBeenCalledTimes(1);
    });

    it('happyPath_stopEndsThePoll', async () => {
        const { clock, check, poller, visibility } = setup(['next', 'stop']);

        poller.start(true);
        await flush();
        await clock.advance(60_000);

        expect(check).toHaveBeenCalledTimes(2);
        expect(poller.isRunning()).toBe(false);
        expect(clock.pending()).toBe(0);
        expect(visibility.listening()).toBe(0);
    });

    it('badPath_failuresDoubleTheWaitUpToFourIntervals', async () => {
        const { clock, check, poller } = setup(['backoff', new Error('down'), 'backoff', 'backoff'], {
            intervalMs: 10_000,
            stopAfterMs: 600_000,
        });

        poller.start(true);
        await flush();
        await clock.advance(20_000);
        expect(check).toHaveBeenCalledTimes(2);
        await clock.advance(40_000 - 1);
        expect(check).toHaveBeenCalledTimes(2);
        await clock.advance(1);
        expect(check).toHaveBeenCalledTimes(3);
        await clock.advance(40_000 - 1);
        expect(check).toHaveBeenCalledTimes(3);
        await clock.advance(1);
        expect(check).toHaveBeenCalledTimes(4);
    });

    it('badPath_aSuccessAfterAFailureResetsTheWait', async () => {
        const clock = new FakeClock();
        const outcomes: PollOutcome[] = ['backoff', 'next', 'next'];
        const check = vi.fn(() => Promise.resolve(outcomes.shift() ?? 'next'));
        const poller = createPoller({ clock, visibility: new FakeVisibility() }, { ...OPTIONS, maxBackoff: 2 }, check, vi.fn());

        poller.start(true);
        await flush();
        await clock.advance(20_000);
        await clock.advance(10_000);

        expect(check).toHaveBeenCalledTimes(3);
    });

    it('badPath_givesUpAtTheDeadline', async () => {
        const { clock, check, onExpire, poller } = setup();

        poller.start(true);
        await flush();
        await clock.advance(120_000);

        expect(onExpire).toHaveBeenCalledTimes(1);
        expect(check).toHaveBeenCalledTimes(6);
        expect(poller.isRunning()).toBe(false);
    });

    it('badPath_pausesWhileHiddenAndChecksAgainWhenShown', async () => {
        const { clock, check, poller, visibility } = setup();
        visibility.shown = false;

        poller.start(true);
        await clock.advance(30_000);
        expect(check).not.toHaveBeenCalled();

        visibility.set(true);
        await flush();
        expect(check).toHaveBeenCalledTimes(1);
        visibility.set(true);
        expect(check).toHaveBeenCalledTimes(1);
    });

    it('badPath_aRestartWhileACheckRunsWaitsForIt', async () => {
        const clock = new FakeClock();
        const pending = deferred();
        const check = vi.fn(() => pending.promise);
        const poller = createPoller({ clock, visibility: new FakeVisibility() }, OPTIONS, check, vi.fn());

        poller.start(true);
        poller.start(true);
        expect(check).toHaveBeenCalledTimes(1);
        pending.resolve('next');
        await flush();

        expect(clock.pending()).toBe(1);
    });

    it('badPath_aCheckThatEndsAfterStopSchedulesNothing', async () => {
        const clock = new FakeClock();
        const pending = deferred();
        const check = vi.fn(() => pending.promise);
        const poller = createPoller({ clock, visibility: new FakeVisibility() }, OPTIONS, check, vi.fn());

        poller.start(true);
        poller.stop();
        pending.resolve('next');
        await flush();

        expect(clock.pending()).toBe(0);
    });
});
