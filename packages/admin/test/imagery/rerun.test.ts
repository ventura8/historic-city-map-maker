/**
 * Lesson 728 (2026-11-14): Find showed Bucharest's Landsat 5 TM only for 1984 and 1985. The scenes are read best score first, a
 * page of 100 at a time, and the source and year filters kept only what that page held; the 1991 and 2008 scenes (score 68) lay
 * past it. A narrowing filter now reads the next pages by itself while it keeps fewer than `FILTERED_MIN`. Also the running
 * search's elapsed time, said again every 15 seconds.
 */
import { FIRESTORE_PATHS } from '@hcm/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IMAGERY_MODULE } from '../../src/imagery/imagery.js';
import { DEFAULT_FILTERS, FILTERED_MIN, wantsMore } from '../../src/imagery/model.js';
import { HarvestSearch, type SearchState } from '../../src/imagery/search.js';
import { settle } from '../app/fakes.js';
import { answer, CITY, cityDoc, imageryWorld, SCENES, sceneDoc, setupStatus } from './world.js';

const LANDSAT = { dataset: 'landsat_tm_c2_l1', sensor: 'L5-TM', resolutionM: 30 } as const;

function rank(score: number) {
    return { score, reasons: [{ code: 'free' }], version: 5 };
}

/** 120 declassified frames ranked 90, then three Landsat 5 scenes ranked 68 (1984, 1991, 2008): past the first page. */
function crowded() {
    const world = imageryWorld();
    world.clock.current = Date.parse('2026-11-14T20:00:00Z');
    world.store.docs.set(FIRESTORE_PATHS.setupStatus, setupStatus('ok'));
    world.store.docs.set(FIRESTORE_PATHS.city(CITY), cityDoc());
    for (let index = 0; index < 120; index += 1) {
        const id = `DS1105-${String(index).padStart(4, '0')}`;
        world.store.docs.set(SCENES(id), sceneDoc(id, { rank: rank(90) }));
    }
    for (const [id, date] of [
        ['LT51820291984242XXX01', '1984-08-29'],
        ['LT51820291991181XXX03', '1991-06-30'],
        ['LT51820292008228MTI00', '2008-08-15'],
    ] as const) {
        world.store.docs.set(
            SCENES(id),
            sceneDoc(id, { ...LANDSAT, acquisitionDate: date, status: 'imported', layerId: id, rank: rank(68) }),
        );
    }
    return world;
}

afterEach(() => {
    vi.useRealTimers();
});

describe('Find: a narrowing filter reads past the first page', () => {
    it('happyPath_theLandsatFilterFindsThe1991And2008ScenesPastTheFirstPage @S-A130-HAPPY-FIND-IMPORTED', async () => {
        const world = crowded();
        const imagery = IMAGERY_MODULE.create(world.services);
        imagery.open([]);
        await settle();
        const firstPage = imagery.state.scenes.items.length;

        imagery.intents.setFilters({ datasets: ['landsat_tm_c2_l1'] });
        await settle();

        expect(firstPage).toBe(100);
        expect(imagery.state.visible.map((scene) => [scene.year, scene.status])).toEqual([
            [1984, 'imported'],
            [1991, 'imported'],
            [2008, 'imported'],
        ]);
    });

    it('badPath_noFilterOrEnoughKeptOrNothingMoreReadsNoFurtherPage @S-A130-BAD-FIND-IMPORTED', () => {
        const page = { status: 'ready', hasMore: true, items: Array.from({ length: 100 }) };
        const landsat = { ...DEFAULT_FILTERS, datasets: ['landsat_tm_c2_l1' as const] };

        expect(wantsMore(page, DEFAULT_FILTERS, 0, -1)).toBe(false);
        expect(wantsMore(page, landsat, FILTERED_MIN, -1)).toBe(false);
        expect(wantsMore({ ...page, hasMore: false }, landsat, 0, -1)).toBe(false);
        expect(wantsMore(page, landsat, 0, 100)).toBe(false);
        expect(wantsMore({ ...page, status: 'loading' }, { ...DEFAULT_FILTERS, fromYear: 1990 }, 0, -1)).toBe(false);
        expect(wantsMore(page, { ...DEFAULT_FILTERS, toYear: 2000 }, 0, -1)).toBe(true);
    });
});

describe('the running search says how long it has taken', () => {
    it('happyPath_theElapsedTimeIsSaidAgainWhileTheSearchRuns @S-A11-HAPPY-SEARCH-ELAPSED', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        const world = imageryWorld();
        world.clock.current = Date.parse('2026-11-14T20:12:00Z');
        const states: SearchState[] = [];
        const harvest = new HarvestSearch(world.services, (state) => states.push(state));
        let finish: () => void = () => undefined;
        answer(
            world.callables,
            'imagery.search',
            () =>
                new Promise((resolve) => {
                    finish = () => {
                        resolve({ found: 1, added: 0, updated: 1, failedDatasets: [], searchedAt: '2026-11-14T20:17:00.000Z' });
                    };
                }),
        );

        const running = harvest.search();
        world.clock.current += 125_000;
        await vi.advanceTimersByTimeAsync(15_000);
        const during = harvest.state;
        finish();
        await running;
        world.clock.current += 60_000;
        await vi.advanceTimersByTimeAsync(15_000);

        expect(during).toMatchObject({ phase: 'searching', elapsedS: 125 });
        expect(harvest.state).toMatchObject({ phase: 'done' });
        expect(harvest.state.elapsedS).toBeUndefined();
        expect(states.at(-1)?.phase).toBe('done');
    });
});
