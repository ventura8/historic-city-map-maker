/**
 * `ops/harvest-{city}` staleness: a `running` attempt older than the callable's 540 s is stale.
 */
import { describe, expect, it } from 'vitest';

import { HARVEST_TIMEOUT_MS, HARVEST_TIMEOUT_REASON, isStaleHarvest, type HarvestStateDoc } from '../../src/schemas/harvest-state.js';

const START = { seconds: 1_700_000_000, nanoseconds: 0 };

function running(attemptedAt = START): HarvestStateDoc {
    return {
        attemptedAt,
        outcome: 'running',
        failures: 0,
        nextAt: START,
        updatedBy: 'system:imagery',
        updatedAt: START,
    };
}

describe('isStaleHarvest', () => {
    it('happyPath_aRunningHarvestOlderThan540sIsStale', () => {
        const nowMs = START.seconds * 1000 + HARVEST_TIMEOUT_MS + 1;
        expect(isStaleHarvest(running(), nowMs)).toBe(true);
        expect(HARVEST_TIMEOUT_REASON).toBe('timeout exceeded 540s limit');
    });

    it('badPath_aHarvestAtOrUnder540sOrNotRunningIsNotStale', () => {
        const exact = START.seconds * 1000 + HARVEST_TIMEOUT_MS;
        expect(isStaleHarvest(running(), exact)).toBe(false);
        expect(isStaleHarvest(running(), exact - 1)).toBe(false);
        expect(isStaleHarvest({ ...running(), outcome: 'failed' }, exact + 1)).toBe(false);
        expect(isStaleHarvest(undefined, exact + 1)).toBe(false);
    });
});
