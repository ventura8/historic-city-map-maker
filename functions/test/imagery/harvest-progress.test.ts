/**
 * Lesson 728 (2026-11-14, Bucharest's "Search USGS again" read "Searching…" on all six sources for five minutes): a dataset waiting
 * its turn is `queued`, not `searching` (two are searched at a time), and a tail step still running at the run's end no longer keeps
 * the run from writing its outcome before the server stops it.
 */
import { FIRESTORE_PATHS, harvestStateDocSchema, type HarvestStateDoc } from '@hcm/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { searchFunction } from '../../src/imagery/search.js';
import { adminCall } from '../publish/fakes.js';
import { sceneRecord } from '../support/imagery-fakes.js';
import { CITY, NOW, readyWorld, type ImageryWorld } from './world.js';

/** The run's own end (`RUN_BUDGET_MS` of `harvest.ts`). */
const RUN_BUDGET_MS = 420_000;

function harvestState(world: ImageryWorld): Promise<HarvestStateDoc | undefined> {
    return world.deps.documents.get(FIRESTORE_PATHS.harvestState(CITY), harvestStateDocSchema);
}

/** The record once `ready` holds of it (its writes are chained, not awaited by the search), else as it is after a few reads. */
async function once(world: ImageryWorld, ready: (state: HarvestStateDoc | undefined) => boolean): Promise<HarvestStateDoc | undefined> {
    let state = await harvestState(world);
    for (let read = 0; read < 20 && !ready(state); read += 1) {
        state = await harvestState(world);
    }
    return state;
}

afterEach(() => {
    vi.useRealTimers();
});

describe('imagery.search: what the record says while it runs', () => {
    it('happyPath_aDatasetWaitingItsTurnIsQueuedWhileTheFirstTwoSearch @S-A11-HAPPY-HARVEST-QUEUED', async () => {
        const world = await readyWorld(NOW, { corona2: [sceneRecord('DS1105-0001')] });
        const scenes = world.deps.scenes;
        const seen: (HarvestStateDoc | undefined)[] = [];
        const watching: typeof scenes = {
            ...scenes,
            search: async (apiKey, request) => {
                if (request.dataset === 'corona2') {
                    seen.push(await once(world, (state) => state?.datasets?.corona2?.state === 'searching'));
                }
                return scenes.search(apiKey, request);
            },
        };

        await searchFunction(() => ({ ...world.deps, scenes: watching })).run(adminCall({ cityId: CITY }));

        expect(seen[0]?.datasets).toMatchObject({
            corona2: { state: 'searching', found: 0 },
            landsat_tm_c2_l1: { state: 'queued', found: 0 },
            landsat_ot_c2_l1: { state: 'queued', found: 0 },
        });
        expect((await harvestState(world))?.outcome).toBe('ok');
    });

    it('badPath_aBrowseCopyStillRunningAtTheRunsEndDoesNotKeepTheOutcomeUnwritten @S-A11-BAD-HARVEST-TAIL-CUT', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const world = await readyWorld(NOW, { corona2: [sceneRecord('DS1105-0001')] });
        const hanging: ImageryWorld['deps']['remote'] = { ...world.deps.remote, get: () => new Promise(() => undefined) };

        const running = searchFunction(() => ({ ...world.deps, remote: hanging })).run(adminCall({ cityId: CITY }));
        await vi.advanceTimersByTimeAsync(RUN_BUDGET_MS);
        const response = await running;

        expect(response.datasets?.corona2).toEqual({ state: 'done', found: 1 });
        expect((await harvestState(world))?.outcome).toBe('ok');
        const cut = world.deps.recording.records.find((record) => record.message === 'harvest step cut short, out of time');
        expect(cut).toMatchObject({ level: 'warn', data: { step: 'browse', reasonCode: 'harvest.tailCut' } });
    });
});
