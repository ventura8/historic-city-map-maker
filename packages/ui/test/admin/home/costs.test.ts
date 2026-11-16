/**
 * Home's Monthly costs card (the owner, 2026-11-16): each paid service with this month's spend, the forecast, measured or an
 * estimate and why, its console; the total against the budget; past the budget, what happens and where to act.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { rangeText } from '../../../src/admin/home/costs.js';
import type { HomeIntentsPort, HomeViewState } from '../../../src/admin/home/home-port.js';
import { FakeArea } from '../editing/fake-area.js';
import { COSTS, homeState, page } from '../ops/fixtures.js';
import { cleanup, deep, deepAll, deepText, defineAll } from '../shell/fake-app.js';

const INTENTS = { dismissTrial: Promise.resolve() };

describe('<hcm-home-page> monthly costs', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_eachServiceShowsItsSpendForecastBasisAndConsole', async () => {
        const home = new FakeArea<HomeViewState, HomeIntentsPort>(homeState(), INTENTS);
        const { element } = await page('home', home);

        const rows = deepAll(element, 'li.cost');
        expect(rows.map((row) => row.dataset['cost'])).toEqual(['mapbox', 'firebase', 'cloudRun']);
        const text = deepText(element);
        expect(text).toContain('Monthly costs');
        expect(text).toContain('Measured by the map');
        expect(text).toContain('50% of the free tier used');
        expect(text).toContain('Google does not tell the map this cost');
        expect(text).toContain('this month’s use could not be read');
        expect(text).toContain('Budget: $5.00 a month.');
        expect(text).not.toContain('The forecast passes your budget');
        expect(deepAll(element, 'li.cost a.action').map((link) => link.getAttribute('href'))).toEqual(COSTS.rows.map((row) => row.console));
    });

    it('badPath_overBudgetSaysWhatPausesAndLinksJobsAndBilling', async () => {
        const costs = { ...COSTS, overBudget: true, budget: { amount: 25, currency: 'RON', spent: 30 } };
        const home = new FakeArea<HomeViewState, HomeIntentsPort>(homeState({ costs }), INTENTS);
        const { element } = await page('home', home);

        const text = deepText(element);
        expect(text).toContain('The forecast passes your budget');
        expect(text).toContain('Google’s budget alert:');
        expect(deep(element, '.over a.action').getAttribute('href')).toBe('#/jobs');
    });

    it('badPath_whileReadingSaysSoAndShowsNoNumbers', async () => {
        const home = new FakeArea<HomeViewState, HomeIntentsPort>(homeState({ costs: { ...COSTS, loading: true } }), INTENTS);
        const { element } = await page('home', home);

        expect(deepText(element)).toContain('Reading this month’s use…');
        expect(deepAll(element, 'li.cost')).toHaveLength(0);
    });

    it('formatsARangeOrOneAmount', () => {
        expect(rangeText('en', { low: 1, high: 1 })).toBe('$1.00');
        expect(rangeText('en', { low: 0.5, high: 2 })).toBe('$0.50 – $2.00');
    });
});
