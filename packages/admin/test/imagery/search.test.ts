import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { IMAGERY_SEARCH_TIMEOUT_MS } from '../../src/imagery/search-timeout.js';
import { HarvestSearch, SEARCH_CUT_OFF_MS, partsOf, searchRefusalOf, usgsCanSearch, type SearchState } from '../../src/imagery/search.js';
import { failure, settle } from '../app/fakes.js';
import { answer, callsOf, imageryWorld } from './world.js';

const SEARCHED = { found: 7, added: 5, updated: 2, failedDatasets: ['declassiii' as const], searchedAt: '2026-10-20T09:00:00.000Z' };

function search() {
    const world = imageryWorld();
    world.clock.current = Date.parse('2026-10-20T09:00:00Z');
    const states: SearchState[] = [];
    const harvest = new HarvestSearch(world.services, (state) => states.push(state));
    return { ...world, harvest, states };
}

describe('the automatic search', () => {
    it('happyPath_aStaleHarvestSearchesOnceWhenUsgsCanSearch', async () => {
        const { harvest, callables, states } = search();
        answer(callables, 'imagery.search', () => SEARCHED);

        harvest.known(null, '2026-08-01T00:00:00Z');
        harvest.known('pending', undefined);
        harvest.known('pending', '2026-08-01T00:00:00Z');
        harvest.known('ok', null);
        await settle();

        expect(callsOf(callables, 'imagery.search')).toEqual([{ cityId: 'bucharest' }]);
        // A first harvest may take minutes: the call waits past the SDK's 70 s (CR-M3-22).
        expect(callables.calls.find((call) => call.name === 'imagery.search')?.timeoutMs).toBe(IMAGERY_SEARCH_TIMEOUT_MS);
        expect(states.map((state) => state.phase)).toEqual(['searching', 'done']);
        expect(harvest.state).toEqual({ phase: 'done', found: 7, added: 5, failedDatasets: ['declassiii'], error: null });
    });

    it('happyPath_aFreshHarvestOrUsgsNotSetUpSearchesNothing', async () => {
        const fresh = search();
        fresh.harvest.known('ok', '2026-10-19T00:00:00Z');
        const missing = search();
        missing.harvest.known('missing', null);
        await settle();

        expect([callsOf(fresh.callables, 'imagery.search'), callsOf(missing.callables, 'imagery.search')]).toEqual([[], []]);
        expect([usgsCanSearch(null), usgsCanSearch('invalid'), usgsCanSearch('ok')]).toEqual([false, false, true]);
    });
});

describe('the search', () => {
    it('badPath_aRefusedSearchSaysWhyAndASecondClickWaitsForTheFirst', async () => {
        const { harvest, callables } = search();
        let release: () => void = () => undefined;
        answer(
            callables,
            'imagery.search',
            () =>
                new Promise((_resolve, reject) => {
                    release = () => {
                        reject(failure('unavailable', 'apiError.usgs.maintenance'));
                    };
                }),
        );

        const first = harvest.search();
        await harvest.search();
        release();
        await first;

        expect(callsOf(callables, 'imagery.search')).toHaveLength(1);
        expect(harvest.state).toMatchObject({ phase: 'failed', error: { key: 'apiError.usgs.maintenance' } });
    });
});

describe('a search the server could not answer', () => {
    it('badPath_aSearchTheServerCutOffSaysHowLongItRanAndWhatToDoNext @S-A11-BAD-SEARCH-CUT-OFF', async () => {
        const { harvest, callables, clock } = search();
        answer(callables, 'imagery.search', () => {
            clock.current += 540_000;
            return Promise.reject(failure('internal', 'apiError.internal'));
        });

        await harvest.search();

        expect(harvest.state).toMatchObject({
            phase: 'failed',
            error: { key: 'adminContent.imagery.searchTimedOut', params: { minutes: '9' } },
        });
    });

    it('badPath_aSearchThatFailedAtOnceSaysTheServerFailedAndWhatToDoNext @S-A11-BAD-SEARCH-CUT-OFF', async () => {
        const { harvest, callables } = search();
        answer(callables, 'imagery.search', () => Promise.reject(failure('internal', 'apiError.internal')));

        await harvest.search();

        expect(harvest.state).toMatchObject({ phase: 'failed', error: { key: 'adminContent.imagery.searchFailed' } });
    });

    it('happyPath_aNetworkFailureIsNoCallablesAndStillSaysWhatToDoNext', () => {
        expect(searchRefusalOf(new Error('offline'), 1_000)).toEqual({ key: 'adminContent.imagery.searchFailed' });
        expect(searchRefusalOf(failure('unavailable', 'apiError.usgs.unavailable'), SEARCH_CUT_OFF_MS)).toEqual({
            key: 'apiError.usgs.unavailable',
        });
    });
});

const T0 = { seconds: 1_792_486_800, nanoseconds: 0 };

describe('each dataset’s part of the search (lesson 676)', () => {
    it('happyPath_eachDatasetsPartShowsLiveThenTheAnswersPartsWithWhatAPartialOneKept @S-A11-BAD-HARVEST-PARTIAL-STORED', async () => {
        const { harvest, callables, store, states } = search();
        let release: () => void = () => undefined;
        const datasets = {
            corona2: { state: 'partial', found: 100, next: 101, reason: 'requestTimedOut', error: 'apiError.usgs.unavailable' },
            landsat_ot_c2_l1: { state: 'done', found: 2 },
        } as const;
        answer(
            callables,
            'imagery.search',
            () =>
                new Promise((resolve) => {
                    release = () => {
                        resolve({ ...SEARCHED, failedDatasets: [], datasets });
                    };
                }),
        );

        const running = harvest.search();
        store.put(FIRESTORE_PATHS.harvestState('bucharest'), {
            attemptedAt: T0,
            outcome: 'running',
            failures: 0,
            nextAt: T0,
            datasets: { corona2: { state: 'searching', found: 0 }, landsat_ot_c2_l1: { state: 'done', found: 2 } },
            updatedBy: 'system:imagery',
            updatedAt: T0,
        });
        await settle();
        const live = states.at(-1);
        release();
        await running;

        expect(live).toMatchObject({
            phase: 'searching',
            datasets: [
                { dataset: 'corona2', state: 'searching' },
                { dataset: 'landsat_ot_c2_l1', state: 'done', found: 2 },
            ],
        });
        expect(harvest.state.datasets).toEqual([
            { dataset: 'corona2', state: 'partial', found: 100, reason: 'requestTimedOut' },
            { dataset: 'landsat_ot_c2_l1', state: 'done', found: 2 },
        ]);
        expect(store.listeners(FIRESTORE_PATHS.harvestState('bucharest'))).toBe(0);
    });

    it('badPath_aFinishedRecordOrNoneAddsNoParts', () => {
        expect(partsOf(undefined)).toBeUndefined();
        expect(partsOf({})).toBeUndefined();
    });
});
