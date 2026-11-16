/**
 * Home's Monthly costs (the owner, 2026-11-16): the counters the backend keeps (Mapbox's compute units, Cloud Run's seconds, the
 * AI's dollars, the budget alert) measured; Firebase and USGS estimated; a counter that cannot be read falls back to an estimate.
 */
import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { LOADING_DOC, type DocState } from '../../src/content/doc.js';
import { CostsWatch, LOADING_COSTS, monthElapsed, monthlyCostsOf, type CostInputs, type MonthlyCosts } from '../../src/home/costs.js';
import { at, contentWorld } from '../content/world.js';

const STAMP = { updatedBy: 'system:ops', updatedAt: at('2026-11-10T10:00:00Z') };
const MID_MONTH = Date.UTC(2026, 10, 16);

function ready<T>(data: T | null): DocState<T> {
    return {
        status: 'ready',
        reconnecting: false,
        failure: null,
        doc: data === null ? null : { id: 'x', path: 'x', version: '', pending: false, data },
    };
}

const NONE: CostInputs = { mapbox: ready<never>(null), cloudRun: ready<never>(null), ai: ready<never>(null), guard: ready<never>(null) };

async function settled(): Promise<void> {
    for (let round = 0; round < 10; round += 1) {
        await Promise.resolve();
    }
}

describe('monthly costs', () => {
    it('happyPath_measuresWhatTheBackendCountsAndForecastsTheMonth', () => {
        const costs = monthlyCostsOf(
            {
                mapbox: ready({ month: '2026-11', computeUnits: 30, computeUnitBudget: 20, uploadedMb: 1, publishes: 2, ...STAMP }),
                cloudRun: ready({ month: '2026-11', vcpuSeconds: 190_000, gibSeconds: 100, runs: 3, ...STAMP }),
                ai: ready({ month: '2026-11', requests: 4, inputTokens: 1, outputTokens: 1, usd: 0.5, ...STAMP }),
                guard: ready({ state: 'green', spend: { costAmount: 6, budgetAmount: 5, currency: 'EUR' }, ...STAMP }),
            },
            MID_MONTH,
        );
        const by = new Map(costs.rows.map((row) => [row.service, row]));
        expect(costs.month).toBe('2026-11');
        expect(by.get('mapbox')).toMatchObject({ basis: 'measured', freeUsed: 1.5, usd: { low: 9, high: 9 } });
        expect(by.get('cloudRun')).toMatchObject({ basis: 'measured', usd: { low: 0.18, high: 0.18 } });
        expect(by.get('ai')?.usd).toEqual({ low: 0.5, high: 0.5 });
        expect(by.get('firebase')?.basis).toBe('estimate');
        expect(by.get('usgs')?.forecastUsd).toEqual({ low: 0, high: 0 });
        expect(by.get('mapbox')?.forecastUsd.low).toBeGreaterThan(9);
        expect(costs.budget).toEqual({ amount: 5, currency: 'EUR', spent: 6 });
        expect(costs.overBudget).toBe(true);
        expect(costs.loading).toBe(false);
    });

    it('happyPath_noUseThisMonthStaysUnderTheDefaultBudget', () => {
        const costs = monthlyCostsOf(NONE, MID_MONTH);
        expect(costs.rows.every((row) => row.basis !== 'unread')).toBe(true);
        expect(costs.budget).toEqual({ amount: 5, currency: 'USD', spent: null });
        expect(costs.overBudget).toBe(false);
        expect(costs.rows.find((row) => row.service === 'cloudRun')?.freeUsed).toBe(0);
    });

    it('badPath_aCounterThatCannotBeReadIsAnEstimateSaidAsSuch', () => {
        const failed: DocState<never> = {
            status: 'error',
            doc: null,
            reconnecting: false,
            failure: { kind: 'denied', code: 'permission-denied' },
        };
        const costs = monthlyCostsOf({ mapbox: failed, cloudRun: failed, ai: failed, guard: failed }, MID_MONTH);
        expect(costs.rows.filter((row) => row.basis === 'unread').map((row) => row.service)).toEqual(['mapbox', 'cloudRun', 'ai']);
        expect(costs.budget.spent).toBeNull();
    });

    it('loadsWhileAnyCounterIsReadingAndForecastsAtLeastOneDay', () => {
        expect(LOADING_COSTS.loading).toBe(true);
        expect(monthlyCostsOf({ ...NONE, ai: LOADING_DOC }, MID_MONTH).loading).toBe(true);
        expect(monthElapsed(Date.UTC(2026, 10, 1))).toBeCloseTo(1 / 30);
        expect(monthElapsed(Date.UTC(2026, 10, 30, 23))).toBeLessThanOrEqual(1);
    });

    it('happyPath_watchesTheFourCountersLive', async () => {
        const { services, store, clock } = contentWorld();
        clock.current = MID_MONTH;
        store.docs.set(FIRESTORE_PATHS.aiUsage('2026-11'), {
            month: '2026-11',
            requests: 1,
            inputTokens: 1,
            outputTokens: 1,
            usd: 2,
            ...STAMP,
        });
        const seen: MonthlyCosts[] = [];
        const watch = new CostsWatch(services, (costs) => seen.push(costs));
        watch.show();
        await settled();
        const last = seen.at(-1);
        expect(last?.loading).toBe(false);
        expect(last?.rows.find((row) => row.service === 'ai')?.usd.low).toBe(2);

        store.fail(FIRESTORE_PATHS.cloudRunUsage('2026-11'), { kind: 'denied', code: 'permission-denied' });
        await settled();
        expect(seen.at(-1)?.rows.find((row) => row.service === 'cloudRun')?.basis).toBe('unread');
        watch.retry();
        await settled();
        watch.stop();
    });
});
