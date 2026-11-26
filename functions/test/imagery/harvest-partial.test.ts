/**
 * Lesson 676 (no Landsat over Bucharest): the harvest is no longer all or nothing. Each dataset is stored as soon as its own search
 * ends; each USGS request has its own timeout inside the run's time; a dataset not searched to its end is recorded `partial` with where
 * it resumes, and the next run resumes it there; a run the server stopped is found `running` and counted. Landsat 8 and 9 OLI
 * (`landsat_ot_c2_l1`) is searched beside TM and ETM+, and while the city's computers run the worker the tick imports several Landsat
 * scenes a run, on the computer.
 */
import {
    FIRESTORE_PATHS,
    harvestStateDocSchema,
    jobDocSchema,
    timestampFromDate,
    workerDocSchema,
    type HarvestStateDoc,
    type UsgsSceneDoc,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { TIMED_OUT_REASON } from '../../src/adapters/upstream-http.js';
import { PAGE_TIMEOUT_MS } from '../../src/imagery/harvest-pages.js';
import { HARVEST_KILLED_AFTER_MS } from '../../src/imagery/harvest-state.js';
import { SEARCH_BUDGET_MS } from '../../src/imagery/harvest-target.js';
import { importLandsat } from '../../src/imagery/landsat-auto.js';
import { searchFunction } from '../../src/imagery/search.js';
import { sceneFields } from '../../src/imagery/scene-record.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import { sceneRecord, type SceneRecord } from '../support/imagery-fakes.js';
import { BOUNDS, CITY, NOW, at, readScene, readyWorld, seedScene, type ImageryWorld } from './world.js';

const OLI_2016 = 'LC81830292016198LGN01';
const OLI_2023 = 'LC91830292023199LGN00';
const MAPPING = 'D3C1213-200346A003';

function many(prefix: string, count: number): SceneRecord[] {
    return Array.from({ length: count }, (_, index) => sceneRecord(`${prefix}${String(index).padStart(4, '0')}`));
}

function records(): Readonly<Record<string, readonly SceneRecord[]>> {
    return {
        corona2: many('DS1105-', 250),
        declassii: [sceneRecord(MAPPING, { acquisitionDate: '1978-03-30' })],
        landsat_ot_c2_l1: [
            sceneRecord(OLI_2016, { acquisitionDate: '2016-07-16', cloudCover: 2 }),
            sceneRecord(OLI_2023, { acquisitionDate: '2023-07-18', cloudCover: 1 }),
        ],
    };
}

function search(world: ImageryWorld, scenes = world.deps.scenes) {
    return searchFunction(() => ({ ...world.deps, scenes })).run(adminCall({ cityId: CITY }));
}

function harvestState(world: ImageryWorld): Promise<HarvestStateDoc | undefined> {
    return world.deps.documents.get(FIRESTORE_PATHS.harvestState(CITY), harvestStateDocSchema);
}

/** The fake's search, whose page from `startingNumber` on of `dataset` takes too long: it fails as the adapter's aborted request. */
function slowPage(world: ImageryWorld, dataset: string, startingNumber: number): ImageryWorld['deps']['scenes'] {
    const scenes = world.deps.scenes;
    return {
        ...scenes,
        search: async (apiKey, request) => {
            if (request.dataset === dataset && (request.startingNumber ?? 1) >= startingNumber) {
                throw new UpstreamError('usgs', 'unavailable', { reason: TIMED_OUT_REASON });
            }
            return scenes.search(apiKey, request);
        },
    };
}

describe('imagery.search: Landsat 8 and 9 OLI', () => {
    it('happyPath_oliScenesAreHarvestedAsLandsat8And9 @S-A130-HAPPY-OLI', async () => {
        const world = await readyWorld(NOW, records());

        const response = await search(world);

        expect(response.datasets?.landsat_ot_c2_l1).toEqual({ state: 'done', found: 2 });
        expect((await readScene(world, OLI_2016))?.sensor).toBe('L8-OLI');
        expect(await readScene(world, OLI_2023)).toMatchObject({ dataset: 'landsat_ot_c2_l1', sensor: 'L9-OLI', resolutionM: 15 });
        const oli = world.scenes.recorder
            .argsOf('search')
            .find(([, request]) => (request as { dataset: string }).dataset === 'landsat_ot_c2_l1');
        expect(oli?.[1]).toMatchObject({ months: [5, 6, 7, 8, 9], maxCloud: 40, timeoutMs: PAGE_TIMEOUT_MS });
    });

    it('badPath_anOliRecordOfAnUnknownSatelliteIsLandsat8 @S-A130-BAD-OLI-UNKNOWN', () => {
        expect(sceneFields(sceneRecord('LX81830292016198LGN01'), 'landsat_ot_c2_l1', BOUNDS)?.sensor).toBe('L8-OLI');
        expect(sceneFields(sceneRecord('LO91830292023199LGN00'), 'landsat_ot_c2_l1', BOUNDS)?.sensor).toBe('L9-OLI');
    });
});

describe('imagery.search: a partial harvest', () => {
    it('badPath_aTimedOutRequestIsRecordedAndWhatTheDatasetFoundIsStored @S-A11-BAD-REQUEST-TIMED-OUT', async () => {
        const world = await readyWorld(NOW, records());

        const response = await search(world, slowPage(world, 'corona2', 101));

        expect(response.datasets?.corona2).toEqual({
            state: 'partial',
            found: 100,
            next: 101,
            reason: 'requestTimedOut',
            error: 'apiError.usgs.unavailable',
        });
        expect(response.failedDatasets).toEqual([]);
        expect(await readScene(world, 'DS1105-0099')).toBeDefined();
        expect(await readScene(world, 'DS1105-0100')).toBeUndefined();
        expect(await harvestState(world)).toMatchObject({ outcome: 'partial', failures: 1, nextAt: at('2026-10-23T08:15:00.000Z') });
    });

    it('happyPath_theNextRunResumesOnlyTheUnfinishedDatasetWhereItStopped @S-A11-HAPPY-HARVEST-RESUME', async () => {
        const world = await readyWorld(NOW, records());
        await search(world, slowPage(world, 'corona2', 101));
        const before = world.scenes.recorder.argsOf('search').length;

        const response = await search(world);

        const resumed = world.scenes.recorder.argsOf('search').slice(before);
        expect(
            resumed.map(([, request]) => [
                (request as { dataset: string }).dataset,
                (request as { startingNumber: number }).startingNumber,
            ]),
        ).toEqual([
            ['corona2', 101],
            ['corona2', 201],
        ]);
        expect(response.datasets).toMatchObject({ corona2: { state: 'done', found: 150 }, declassii: { state: 'done', found: 1 } });
        expect(await readScene(world, 'DS1105-0249')).toBeDefined();
        expect(await harvestState(world)).toMatchObject({ outcome: 'ok', failures: 0 });
    });

    it('badPath_aPageUsgsRefusesForTooManyRequestsIsAskedAgainAfterAWait @S-A11-BAD-HARVEST-PARTIAL-STORED', async () => {
        const world = await readyWorld(NOW, records());
        const scenes = world.deps.scenes;
        const waits: number[] = [];
        let refused = 0;
        const busy: typeof scenes = {
            ...scenes,
            search: async (apiKey, request) => {
                if (request.dataset === 'declassii' && refused < 2) {
                    refused += 1;
                    throw new UpstreamError('usgs', 'rateLimited', { status: 500 });
                }
                return scenes.search(apiKey, request);
            },
        };
        const clock = {
            now: () => world.deps.clock.now(),
            sleep: (ms: number) => {
                waits.push(ms);
                return Promise.resolve();
            },
        };

        const response = await searchFunction(() => ({ ...world.deps, scenes: busy, clock })).run(adminCall({ cityId: CITY }));

        expect(waits).toEqual([5000, 10_000]);
        expect(response.datasets?.declassii).toEqual({ state: 'done', found: 1 });
        expect(await readScene(world, MAPPING)).toBeDefined();
    });

    it('badPath_aRunOutOfTimeStoresEveryDatasetItFinishedAndRecordsTheRestPartial @S-A11-BAD-HARVEST-PARTIAL-STORED', async () => {
        const world = await readyWorld(NOW, records());
        const scenes = world.deps.scenes;
        // corona2's first page uses up the search's time: its second page is never asked for; the others answered at once.
        const slow: typeof scenes = {
            ...scenes,
            search: async (apiKey, request) => {
                const page = await scenes.search(apiKey, request);
                if (request.dataset === 'corona2') {
                    world.deps.clock.set(new Date(world.deps.clock.now().getTime() + SEARCH_BUDGET_MS).toISOString());
                }
                return page;
            },
        };

        const response = await search(world, slow);

        expect(response.datasets?.corona2).toMatchObject({ state: 'partial', found: 100, next: 101, reason: 'outOfTime' });
        expect(response.datasets?.declassii).toEqual({ state: 'done', found: 1 });
        expect(await readScene(world, MAPPING)).toBeDefined();
        expect((await harvestState(world))?.outcome).toBe('partial');
    });

    it('badPath_aRunTheServerStoppedIsCountedAndItsUnfinishedDatasetsResume @S-A11-BAD-HARVEST-KILLED', async () => {
        const world = await readyWorld(NOW, records());
        const stopped = new Date(new Date(NOW).getTime() - HARVEST_KILLED_AFTER_MS);
        await world.deps.documents.set(FIRESTORE_PATHS.harvestState(CITY), harvestStateDocSchema, {
            attemptedAt: timestampFromDate(stopped),
            outcome: 'running',
            failures: 0,
            nextAt: timestampFromDate(new Date(NOW)),
            datasets: { corona2: { state: 'done', found: 250 }, declassii: { state: 'searching', found: 0 } },
            updatedBy: 'system:imagery',
            updatedAt: timestampFromDate(stopped),
        });

        const response = await search(world);

        expect(world.scenes.recorder.argsOf('search').map(([, request]) => (request as { dataset: string }).dataset)).toEqual([
            'declassii',
        ]);
        expect(response.datasets).toMatchObject({ corona2: { state: 'done', found: 250 }, declassii: { state: 'done', found: 1 } });
        expect(await harvestState(world)).toMatchObject({ outcome: 'ok', failures: 0, attemptedAt: at(NOW) });
        const stoppedLog = world.deps.recording.records.find((record) => record.message === 'usgs harvest was stopped before it finished');
        expect(stoppedLog).toMatchObject({ level: 'error', data: { reasonCode: 'harvest.killed' } });
    });

    it('badPath_everyDatasetRefusedIsStillUsgsNotAnsweringAndRecordedFailed @S-A11-BAD-USGS-UNAVAILABLE', async () => {
        const world = await readyWorld(NOW, records());
        for (const dataset of ['corona2', 'declassii', 'declassiii', 'landsat_tm_c2_l1', 'landsat_etm_c2_l1', 'landsat_ot_c2_l1']) {
            world.scenes.failing.set(dataset, new UpstreamError('usgs', 'maintenance', { status: 503 }));
        }

        expect(await failureOf(search(world))).toMatchObject({ details: { code: 'apiError.usgs.maintenance' } });
        expect(await harvestState(world)).toMatchObject({ outcome: 'failed', error: 'apiError.usgs.maintenance' });
    });
});

const TM = { dataset: 'landsat_tm_c2_l1', sensor: 'L5-TM', resolutionM: 30, coverage: 1, cloudCover: 2 } as const;

async function seedYears(world: ImageryWorld, years: readonly number[]): Promise<void> {
    for (const year of years) {
        const scene: Partial<UsgsSceneDoc> = {
            ...TM,
            acquisitionDate: `${String(year)}-07-12`,
            rank: { score: 70, reasons: [], version: 4 },
        };
        await seedScene(world, `LT5183029${String(year)}193MTI00`, scene);
    }
}

async function seedOnlineWorkers(world: ImageryWorld, count: number, seenAgoMs = 10_000): Promise<void> {
    const seen = timestampFromDate(new Date(new Date(NOW).getTime() - seenAgoMs));
    for (let index = 0; index < count; index += 1) {
        await world.deps.documents.set(FIRESTORE_PATHS.worker(CITY, `w-${String(index).padStart(16, '0')}`), workerDocSchema, {
            uid: 'u-admin',
            version: '1.0.0',
            startedAt: seen,
            lastSeenAt: seen,
            state: 'idle',
            updatedBy: 'u-admin',
            updatedAt: seen,
        });
    }
}

async function landsatJobs(world: ImageryWorld) {
    const jobs = await world.deps.documents.query(FIRESTORE_PATHS.jobs(CITY), jobDocSchema);
    return jobs.documents.map((job) => job.data);
}

describe('the tick’s Landsat pace', () => {
    it('happyPath_twoOnlineWorkersTakeTwoImportsATickOnTheComputer @S-A130-HAPPY-WORKERS-PACE', async () => {
        const world = await readyWorld();
        await seedYears(world, [1989, 1990, 1991]);
        await seedOnlineWorkers(world, 2);

        await importLandsat(world.deps, CITY, new Date(NOW));

        const jobs = await landsatJobs(world);
        expect(jobs.map((job) => [job.params['entityId'], job.runOn])).toEqual([
            ['LT51830291989193MTI00', 'local'],
            ['LT51830291990193MTI00', 'local'],
        ]);
    });

    it('badPath_noWorkerOnlineKeepsOneCloudImportATick @S-A130-BAD-NO-WORKER-PACE', async () => {
        const world = await readyWorld();
        await seedYears(world, [1989, 1990, 1991]);
        await seedOnlineWorkers(world, 2, 3_600_000);

        await importLandsat(world.deps, CITY, new Date(NOW));

        const jobs = await landsatJobs(world);
        expect(jobs).toHaveLength(1);
        expect(jobs[0]?.runOn).toBeUndefined();
    });
});
