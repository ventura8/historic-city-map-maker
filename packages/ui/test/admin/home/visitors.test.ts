/**
 * Home's Visitors card (the owner, 2026-11-16): before any read it says where to allow it; after, the period's visitors
 * with the trend, the last day, new against returning, and the top lists, each with All the numbers.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { defineHcmHomeCosts } from '../../../src/admin/home/hcm-home-costs.js';
import { defineHcmHomeVisitors } from '../../../src/admin/home/hcm-home-visitors.js';
import type { HomeIntentsPort, HomeViewState, VisitorsPort } from '../../../src/admin/home/home-port.js';
import { FakeArea } from '../editing/fake-area.js';
import { homeState, page } from '../ops/fixtures.js';
import { cleanup, deep, deepText, defineAll } from '../shell/fake-app.js';

const INTENTS = { dismissTrial: Promise.resolve() };

const READ: VisitorsPort = {
    days: 28,
    numbers: {
        visitors: 120,
        sessions: 180,
        devices: [{ name: 'desktop', count: 80 }],
        countries: [
            { name: 'Romania', count: 90 },
            { name: 'Germany', count: 10 },
        ],
        summary: {
            daily: [
                { date: '20261111', visitors: 40, sessions: 60 },
                { date: '20261112', visitors: 80, sessions: 120 },
            ],
            previous: { visitors: 80, sessions: 100 },
            newVsReturning: [
                { name: 'new', count: 70 },
                { name: 'returning', count: 50 },
            ],
            languages: [{ name: 'Romanian', count: 100 }],
            years: [{ name: '1966', count: 30 }],
            layers: [],
            photos: [{ name: 'gara-de-nord', count: 9 }],
        },
    },
};

describe('<hcm-home-page> visitors', () => {
    beforeAll(() => {
        defineAll();
        defineHcmHomeCosts();
        defineHcmHomeVisitors();
    });
    afterEach(cleanup);

    it('happyPath_theLastNumbersWithTheTrendAndTheTopLists', async () => {
        const home = new FakeArea<HomeViewState, HomeIntentsPort>(homeState({ visitors: READ }), INTENTS);
        const { element } = await page('home', home);

        const text = deepText(element);
        expect(text).toContain('Last 28 days: 120 visitors, 180 visits.');
        expect(text).toContain('+50% against the 28 days before.');
        expect(text).toContain('Last day: 80 visitors.');
        expect(text).toContain('New: 70, returning: 50.');
        expect(text).toContain('Romania (90), Germany (10)');
        expect(text).toContain('1966 (30)');
        expect(text).toContain('none yet');
        expect(deep(element, '[data-visitors] a.action').getAttribute('href')).toBe('#/crashes/statistics');
    });

    it('happyPath_numbersWithoutTheSummaryShowZerosAndNoTrend', async () => {
        const plain = { days: 7 as const, numbers: { visitors: 3, sessions: 4, devices: [], countries: [] } };
        const home = new FakeArea<HomeViewState, HomeIntentsPort>(homeState({ visitors: plain }), INTENTS);
        const { element } = await page('home', home);

        const text = deepText(element);
        expect(text).toContain('Last 7 days: 3 visitors, 4 visits.');
        expect(text).not.toContain('against the');
        expect(text).toContain('New: 0, returning: 0.');
    });

    it('badPath_beforeAnyReadItSaysWhereToAllowIt', async () => {
        const home = new FakeArea<HomeViewState, HomeIntentsPort>(homeState(), INTENTS);
        const { element } = await page('home', home);

        expect(deepText(element)).toContain('Allow reading them once on the Statistics page.');
        expect(deep(element, '[data-visitors="none"] a.action').getAttribute('href')).toBe('#/crashes/statistics');
    });
});
