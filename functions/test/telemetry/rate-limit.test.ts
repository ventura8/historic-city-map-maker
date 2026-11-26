/** The in-memory limiter of `telemetry.reportError` (`functions/src/telemetry/rate-limit.ts`). */
import { ERROR_REPORT_LIMITS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { createRateLimiter } from '../../src/telemetry/rate-limit.js';

const MINUTE = new Date('2026-10-12T08:30:00.000Z');
const SAME_MINUTE = new Date('2026-10-12T08:30:59.999Z');
const NEXT_MINUTE = new Date('2026-10-12T08:31:00.000Z');

function allowed(limiter: ReturnType<typeof createRateLimiter>, client: string, times: number, now = MINUTE): boolean[] {
    return Array.from({ length: times }, () => limiter.allow(client, now));
}

describe('createRateLimiter', () => {
    it('happyPath_aClientGetsItsLimitPerMinuteThenAFreshWindow', () => {
        const limiter = createRateLimiter('e2e-salt');

        const first = allowed(limiter, '203.0.113.7', ERROR_REPORT_LIMITS.perClientPerMinute + 1);
        const later = limiter.allow('203.0.113.7', SAME_MINUTE);
        const fresh = limiter.allow('203.0.113.7', NEXT_MINUTE);

        expect(first.filter(Boolean)).toHaveLength(ERROR_REPORT_LIMITS.perClientPerMinute);
        expect(first.at(-1)).toBe(false);
        expect([later, fresh]).toEqual([false, true]);
    });

    it('badPath_theInstanceLimitCapsEveryClientTogether', () => {
        const limiter = createRateLimiter('e2e-salt', { perClientPerMinute: 2, perInstancePerMinute: 3 });

        expect([...allowed(limiter, 'a', 2), ...allowed(limiter, 'b', 2), ...allowed(limiter, 'c', 1)]).toEqual([
            true,
            true,
            true,
            false,
            false,
        ]);
        expect(limiter.allow('c', NEXT_MINUTE)).toBe(true);
    });
});
