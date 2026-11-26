import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Settle, YEAR_SETTLE_MS } from '../../src/telemetry/settle.js';

describe('Settle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('happyPath_aDragAlongTheTimelineIsOneEventItsLastYear', () => {
        // @S-V70-BAD-YEAR-DRAG-ONE-EVENT: many years a second while dragging, one event where the visitor stops.
        const sent: number[] = [];
        const settle = new Settle<number>((year) => sent.push(year), YEAR_SETTLE_MS);
        for (const year of [1950, 1951, 1952, 1953]) {
            settle.hold(year);
            vi.advanceTimersByTime(100);
        }
        expect(sent).toEqual([]);
        vi.advanceTimersByTime(YEAR_SETTLE_MS);
        expect(sent).toEqual([1953]);
    });

    it('happyPath_hidingThePageSendsTheYearHeldAtOnce', () => {
        const sent: number[] = [];
        const settle = new Settle<number>((year) => sent.push(year), YEAR_SETTLE_MS);
        settle.hold(1966);
        settle.flush();
        settle.flush();
        vi.advanceTimersByTime(YEAR_SETTLE_MS);
        expect(sent).toEqual([1966]);
    });

    it('badPath_aCancelledYearNeverLeaves', () => {
        const sent: number[] = [];
        const settle = new Settle<number>((year) => sent.push(year), YEAR_SETTLE_MS);
        settle.hold(1970);
        settle.cancel();
        settle.cancel();
        vi.advanceTimersByTime(YEAR_SETTLE_MS);
        expect(sent).toEqual([]);
    });
});
