/**
 * Home's Visitors card (the owner, 2026-11-16): the Statistics page's last numbers of this session, never asked by Home;
 * none before the first read.
 */
import { describe, expect, it } from 'vitest';

import { NO_STATISTICS_SOURCE, type StatisticsSource } from '../../src/crashes/statistics.js';
import { HOME_MODULE } from '../../src/home/home.js';
import { contentWorld } from '../content/world.js';

async function settled(): Promise<void> {
    for (let round = 0; round < 10; round += 1) {
        await Promise.resolve();
    }
}

const NUMBERS = {
    visitors: 5,
    sessions: 7,
    pages: [],
    screens: [],
    events: [],
    devices: [],
    countries: [],
    surfaces: [],
    steps: [],
    pending: null,
};

describe("Home's Visitors card", () => {
    it('happyPath_showsTheStatisticsPagesLastNumbersAndFollowsThemOnRefresh', async () => {
        let latest: ReturnType<NonNullable<StatisticsSource['latest']>> = null;
        const statistics: StatisticsSource = { ...NO_STATISTICS_SOURCE, latest: () => latest };
        const home = HOME_MODULE.create(contentWorld({ statistics }).services);

        home.open([]);
        await settled();
        expect(home.state.visitors).toBeNull();

        latest = { days: 28, numbers: NUMBERS };
        await home.intents.refresh();
        expect(home.state.visitors).toEqual({ days: 28, numbers: NUMBERS });
        home.destroy();
    });

    it('badPath_noStatisticsSourceLeavesTheCardEmpty', async () => {
        const home = HOME_MODULE.create(contentWorld({ statistics: null }).services);
        home.open([]);
        await settled();
        expect(home.state.visitors).toBeNull();
        home.destroy();
    });
});
