/**
 * `imagery.import` (`functions/src/imagery/import.ts`, `docs/research/M3-interfaces.md` §1, §4.1): the one click of the
 * happy path creates the `usgs-import` job, its version and the reserved layer id, and marks the scene imported, in one
 * transaction, after every check: the scene exists, is not imported yet and is already scanned (USGS confirms it), the
 * download role is approved, the budget guard is green and today's raster jobs are under the cap.
 */
import { DEFAULT_NEW_CITY_LIMITS, FIRESTORE_PATHS, JOBS_PER_DAY, cityDocSchema, jobDocSchema, timestampFromDate } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { dispatchJob } from '../../src/imagery/dispatch.js';
import { importFunction } from '../../src/imagery/import.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import {
    CITY,
    NOW,
    at,
    readJob,
    readScene,
    readVersion,
    readyWorld,
    renderedVersion,
    seedGuard,
    seedJob,
    seedLayer,
    seedScene,
    seedSetup,
    seedVersion,
    type ImageryWorld,
} from './world.js';

const ENTITY = 'DS1035-1057DA023';
const SECOND = 'DS1035-1057DA024';
const JOB_ID = `im-${Date.parse(NOW).toString(36)}-${ENTITY}`;

function importScene(world: ImageryWorld, entityId = ENTITY) {
    return importFunction(() => world.deps).run(adminCall({ cityId: CITY, entityId }));
}

async function scannedWorld(): Promise<ImageryWorld> {
    const world = await readyWorld();
    await seedScene(world, ENTITY);
    world.scenes.options.set(ENTITY, { entityId: ENTITY, available: true, bytes: 734_003_200 });
    return world;
}

describe('imagery.import', () => {
    it('happyPath_oneClickQueuesTheJobItsVersionAndTheReservedLayer', async () => {
        const world = await scannedWorld();

        const response = await importScene(world);

        expect(response).toEqual({ jobId: JOB_ID, versionId: JOB_ID, layerId: 'kh-4a-corona-12-iulie-1966' });
        expect(await readJob(world, JOB_ID)).toEqual({
            type: 'usgs-import',
            status: 'queued',
            params: { entityId: ENTITY, dataset: 'corona2', sensor: 'KH-4A' },
            createdBy: 'u-admin',
            createdAt: at(NOW),
            layerId: 'kh-4a-corona-12-iulie-1966',
            versionId: JOB_ID,
            updatedBy: 'u-admin',
            updatedAt: at(NOW),
        });
        expect(await readVersion(world, JOB_ID)).toMatchObject({
            layerId: 'kh-4a-corona-12-iulie-1966',
            jobId: JOB_ID,
            origin: 'usgs',
            state: 'processing',
            source: { kind: 'usgs', entityId: ENTITY, dataset: 'corona2', sensor: 'KH-4A', acquisitionDate: '1966-07-12' },
            label: { ro: 'KH-4A Corona, 12 iulie 1966', en: 'KH-4A Corona, 12 July 1966' },
            year: 1966,
            date: '1966-07-12',
        });
        expect(await readScene(world, ENTITY)).toMatchObject({ status: 'imported', layerId: 'kh-4a-corona-12-iulie-1966' });
        expect(world.usgs.sessions.size).toBe(0);
    });

    it('happyPath_theReservedIdStaysClearOfLayersAndUnfinishedVersions', async () => {
        const world = await scannedWorld();
        await seedLayer(world, 'kh-4a-corona-12-iulie-1966');
        await seedScene(world, 'DS-OTHER', { acquisitionDate: '1966-07-12' });
        world.scenes.options.set('DS-OTHER', { entityId: 'DS-OTHER', available: true, bytes: 1 });
        await importScene(world);

        const second = await importScene(world, 'DS-OTHER');

        expect(second.layerId).toBe('kh-4a-corona-12-iulie-1966-3');
    });

    it.each([
        ['failed', 'kh-4a-corona-12-iulie-1966-2'],
        ['rejected', 'kh-4a-corona-12-iulie-1966'],
        ['cancelled', 'kh-4a-corona-12-iulie-1966'],
    ] as const)('badPath_aFailedVersionHoldsItsIdUntilItIsDismissed_%s @S-A12-BAD-FAILED-HOLDS-ID', async (state, layerId) => {
        const world = await scannedWorld();
        const error = { code: 'apiError.imagery.cityNotFound' } as const;
        await seedVersion(
            world,
            'im-earlier',
            renderedVersion({ jobId: 'im-earlier', layerId: 'kh-4a-corona-12-iulie-1966', state, error }),
        );

        expect((await importScene(world)).layerId).toBe(layerId);
    });

    it('badPath_aDeletedLayersIdStaysTakenUntilItsDeletionRuns @S-A33-BAD-ID-REUSED', async () => {
        const world = await scannedWorld();
        await seedJob(world, 'ld-1', {
            type: 'layer-delete',
            status: 'queued',
            params: { layerId: 'kh-4a-corona-12-iulie-1966', tilesetId: 'e2e-mapbox.hcm-bucharest-kh-4a-corona-12-iulie-1966' },
            createdBy: 'u-admin',
            createdAt: at(NOW),
            dispatchAt: at('2026-10-30T08:00:00.000Z'),
            updatedBy: 'u-admin',
            updatedAt: at(NOW),
        });

        const { layerId } = await importScene(world);

        expect(layerId).toBe('kh-4a-corona-12-iulie-1966-2');
    });

    it('badPath_aSceneThatIsNotScannedCannotBeImported @S-A12-BAD-NOT-SCANNED', async () => {
        const world = await readyWorld();
        await seedScene(world, ENTITY, { downloadAvailable: false });

        const failure = await failureOf(importScene(world));

        expect(failure).toMatchObject({ code: 'failed-precondition', details: { code: 'apiError.imagery.notScanned' } });
        expect(world.deps.documents.paths(FIRESTORE_PATHS.jobs(CITY))).toEqual([]);
        expect(world.deps.documents.paths(FIRESTORE_PATHS.layerVersions(CITY))).toEqual([]);
        expect((await readScene(world, ENTITY))?.layerId).toBeUndefined();
    });

    it('badPath_usgsSayingTheDownloadIsNotAvailableIsNotScannedEither @S-A12-BAD-NOT-SCANNED', async () => {
        const world = await readyWorld();
        await seedScene(world, ENTITY);

        const failure = await failureOf(importScene(world));

        expect(failure).toMatchObject({ details: { code: 'apiError.imagery.notScanned' } });
        expect(world.scenes.recorder.argsOf('downloadOptions')).toEqual([[expect.any(String), 'corona2', [ENTITY]]]);
        expect(world.deps.documents.paths(FIRESTORE_PATHS.jobs(CITY))).toEqual([]);
        // The card stops offering a free Import: the scene is not free after all, and its rank says so.
        const scene = await readScene(world, ENTITY);
        expect(scene).toMatchObject({ downloadAvailable: false, updatedBy: 'system:imagery' });
        expect(scene?.rank.reasons[0]).toEqual({ code: 'needsOrder' });
        expect(await failureOf(importScene(world))).toMatchObject({ details: { code: 'apiError.imagery.notScanned' } });
        expect(world.scenes.recorder.argsOf('downloadOptions')).toHaveLength(1);
    });

    it('badPath_aSceneIsImportedOnce @S-A12-BAD-ALREADY-IMPORTED', async () => {
        const world = await scannedWorld();
        const { layerId } = await importScene(world);

        const pending = await failureOf(importScene(world));
        await seedLayer(world, layerId, { label: { ro: 'Corona 1966' } });
        const published = await failureOf(importScene(world));

        expect(pending).toMatchObject({
            code: 'already-exists',
            details: { code: 'apiError.imagery.alreadyImported', params: { layer: layerId } },
        });
        expect(published).toMatchObject({ details: { code: 'apiError.imagery.alreadyImported', params: { layer: 'Corona 1966' } } });
        expect(world.deps.documents.paths(FIRESTORE_PATHS.jobs(CITY))).toHaveLength(1);
    });

    it('badPath_aRaceIsSettledInTheTransaction @S-A12-BAD-ALREADY-IMPORTED', async () => {
        const world = await scannedWorld();
        const original = world.deps.scenes.downloadOptions.bind(world.deps.scenes);
        world.deps.scenes.downloadOptions = async (...args) => {
            const options = await original(...args);
            await seedScene(world, ENTITY, { status: 'imported', layerId: 'raced' });
            return options;
        };

        const failure = await failureOf(importScene(world));

        expect(failure).toMatchObject({ details: { code: 'apiError.imagery.alreadyImported', params: { layer: 'raced' } } });
        expect(world.deps.documents.paths(FIRESTORE_PATHS.jobs(CITY))).toEqual([]);
    });
});

describe('imagery.import: again', () => {
    function importAgain(world: ImageryWorld) {
        return importFunction(() => world.deps).run(adminCall({ cityId: CITY, entityId: ENTITY, again: true }));
    }

    it('happyPath_anImportedSceneImportedAgainIsANewVersionOfItsOwnLayer @S-A12-HAPPY-IMPORT-AGAIN', async () => {
        const world = await scannedWorld();
        const first = await importScene(world);
        world.deps.clock.set(new Date(Date.parse(NOW) + 3_600_000).toISOString());

        const second = await importAgain(world);

        expect(second.layerId).toBe(first.layerId);
        expect(second.jobId).not.toBe(first.jobId);
        expect(world.deps.documents.paths(FIRESTORE_PATHS.jobs(CITY))).toHaveLength(2);
        expect(await readScene(world, ENTITY)).toMatchObject({ status: 'imported', layerId: first.layerId });
    });

    it('badPath_importAgainOfASceneMovedToAnotherLayerMeanwhileIsAConflict @S-A12-BAD-IMPORT-AGAIN-MOVED', async () => {
        const world = await scannedWorld();
        await importScene(world);
        world.deps.clock.set(new Date(Date.parse(NOW) + 3_600_000).toISOString());
        const original = world.deps.scenes.downloadOptions.bind(world.deps.scenes);
        world.deps.scenes.downloadOptions = async (...args) => {
            const options = await original(...args);
            await seedScene(world, ENTITY, { status: 'imported', layerId: 'raced' });
            return options;
        };

        expect(await failureOf(importAgain(world))).toMatchObject({ details: { code: 'apiError.conflict' } });
        expect(world.deps.documents.paths(FIRESTORE_PATHS.jobs(CITY))).toHaveLength(1);
    });
});

describe('imagery.import: the limits', () => {
    it('badPath_theBudgetGuardPausesImportsAndQueuedJobsNeverTheSite @S-A12-BAD-GUARD-PAUSED', async () => {
        const world = await scannedWorld();
        await seedGuard(world, 'red');
        await seedJob(world, 'queued-1', {
            type: 'usgs-import',
            status: 'queued',
            params: { entityId: 'DS-Q', dataset: 'corona2', sensor: 'KH-4A' },
            createdBy: 'u-admin',
            createdAt: at(NOW),
            updatedBy: 'u-admin',
            updatedAt: at(NOW),
        });

        const failure = await failureOf(importScene(world));
        const dispatched = await dispatchJob(world.deps, CITY, 'queued-1');

        expect(failure).toMatchObject({ code: 'failed-precondition', details: { code: 'apiError.guardPaused' } });
        expect(dispatched).toBe('waiting');
        expect(await readJob(world, 'queued-1')).toMatchObject({ status: 'queued', waitReason: 'guard' });
        expect(world.jobs.runs).toEqual([]);
        expect(world.deps.tasks.queued).toEqual([]);
        expect(world.deps.documents.paths('manifests/')).toEqual([]);
        expect(world.scenes.recorder.calls).toEqual([]);
    });

    it('badPath_atMostTenRasterJobsADay @S-A12-BAD-DAILY-LIMIT', async () => {
        const world = await scannedWorld();
        for (let index = 0; index < JOBS_PER_DAY; index += 1) {
            await world.deps.documents.set(FIRESTORE_PATHS.job(CITY, `today-${String(index)}`), jobDocSchema, {
                type: 'usgs-import',
                status: 'succeeded',
                params: { entityId: `scene-${String(index)}` },
                createdBy: 'u-admin',
                createdAt: timestampFromDate(new Date('2026-10-23T01:00:00.000Z')),
                updatedBy: 'u-admin',
                updatedAt: at(NOW),
            });
        }

        const failure = await failureOf(importScene(world));

        expect(failure).toMatchObject({
            code: 'resource-exhausted',
            details: { code: 'apiError.imagery.dailyLimit', params: { limit: '10' } },
        });
    });

    // M18 item 3 (docs/research/M18-improvements.md): new points, a crop or Locate again re-run what is here: never counted.
    it('happyPath_reRunsOfTodayDoNotCountAgainstTheDailyImportLimit @S-A12-HAPPY-RERUNS-FREE', async () => {
        const world = await scannedWorld();
        for (let index = 0; index < JOBS_PER_DAY; index += 1) {
            await world.deps.documents.set(FIRESTORE_PATHS.job(CITY, `rerun-${String(index)}`), jobDocSchema, {
                type: index % 2 === 0 ? 'regeoref' : 'layer-tiles',
                status: 'succeeded',
                params: { basedOn: 'v0' },
                createdBy: 'u-admin',
                createdAt: timestampFromDate(new Date(NOW)),
                updatedBy: 'u-admin',
                updatedAt: at(NOW),
            });
        }

        await expect(importScene(world)).resolves.toMatchObject({ jobId: JOB_ID });
    });

    it('happyPath_yesterdaysJobsAndLayerDeletionsDoNotCount @S-A12-BAD-DAILY-LIMIT', async () => {
        const world = await scannedWorld();
        for (let index = 0; index < JOBS_PER_DAY; index += 1) {
            await world.deps.documents.set(FIRESTORE_PATHS.job(CITY, `old-${String(index)}`), jobDocSchema, {
                type: index % 2 === 0 ? 'layer-delete' : 'regeoref',
                status: 'succeeded',
                params: index % 2 === 0 ? { layerId: 'x' } : { basedOn: 'v0' },
                createdBy: 'u-admin',
                createdAt: timestampFromDate(index % 2 === 0 ? new Date(NOW) : new Date('2026-10-22T23:00:00.000Z')),
                updatedBy: 'u-admin',
                updatedAt: at(NOW),
            });
        }

        await expect(importScene(world)).resolves.toMatchObject({ jobId: JOB_ID });
    });

    it('badPath_downloadsNotApprovedYetArePending', async () => {
        const world = await scannedWorld();
        await seedSetup(world, { usgs: { state: 'pending', role: 'search' } });

        const failure = await failureOf(importScene(world));

        expect(failure).toMatchObject({ code: 'failed-precondition', details: { code: 'apiError.usgs.accessPending' } });
    });

    it('happyPath_aDailyCheckThatFoundUsgsInMaintenanceLeavesImportOn @S-A11-BAD-USGS-UNAVAILABLE', async () => {
        const world = await scannedWorld();
        await seedSetup(world, { usgs: { state: 'unavailable', role: 'download', detail: 'apiError.usgs.maintenance' } });

        await expect(importScene(world)).resolves.toMatchObject({ jobId: JOB_ID });
    });

    it('badPath_usgsUnavailableBeforeItWasEverApprovedIsNotConfigured', async () => {
        const world = await scannedWorld();
        await seedSetup(world, { usgs: { state: 'unavailable' } });

        expect(await failureOf(importScene(world))).toMatchObject({ details: { code: 'apiError.usgs.notConfigured' } });
    });

    it('badPath_usgsInMaintenanceIsExplained', async () => {
        const world = await scannedWorld();
        world.scenes.recorder.failNext('downloadOptions', new UpstreamError('usgs', 'maintenance', { status: 503 }));

        const failure = await failureOf(importScene(world));

        expect(failure).toMatchObject({ code: 'unavailable', details: { code: 'apiError.usgs.maintenance' } });
        expect(world.usgs.sessions.size).toBe(0);
    });

    it('badPath_anUnknownSceneIsNotFound', async () => {
        const world = await scannedWorld();

        expect(await failureOf(importScene(world, 'DS-NONE'))).toMatchObject({ code: 'not-found', details: { code: 'apiError.notFound' } });
    });

    it('badPath_anUnknownCityIsNotFound', async () => {
        const world = await scannedWorld();
        await world.deps.documents.delete(FIRESTORE_PATHS.city(CITY));

        expect(await failureOf(importScene(world))).toMatchObject({ code: 'not-found', details: { code: 'apiError.notFound' } });
    });
});

/** M5 (`docs/research/M5-interfaces.md` §1.8): a city's own share of the project's daily jobs. */
describe('imagery.import: the city’s share', () => {
    it('badPath_aCitysOwnDailyShareCapsItsImportsAndOtherCitiesJobsDoNotCount @S-A52-BAD-DAILY-JOBS', async () => {
        const world = await scannedWorld();
        const city = await world.deps.documents.get(FIRESTORE_PATHS.city(CITY), cityDocSchema);
        if (city === undefined) {
            throw new Error('the scanned world has its city');
        }
        await world.deps.documents.set(FIRESTORE_PATHS.city(CITY), cityDocSchema, {
            ...city,
            limits: { ...DEFAULT_NEW_CITY_LIMITS, rasterJobsPerDay: 3 },
        });
        await world.deps.documents.set(FIRESTORE_PATHS.city('other-city'), cityDocSchema, { ...city, id: 'other-city' });
        const job = {
            type: 'usgs-import' as const,
            status: 'succeeded' as const,
            params: { entityId: 'scene-x' },
            createdBy: 'u-admin',
            createdAt: timestampFromDate(new Date('2026-10-23T01:00:00.000Z')),
            updatedBy: 'u-admin',
            updatedAt: at(NOW),
        };
        for (let index = 0; index < 3; index += 1) {
            await world.deps.documents.set(FIRESTORE_PATHS.job('other-city', `elsewhere-${String(index)}`), jobDocSchema, job);
        }
        for (let index = 0; index < 2; index += 1) {
            await world.deps.documents.set(FIRESTORE_PATHS.job(CITY, `today-${String(index)}`), jobDocSchema, job);
        }
        await expect(importScene(world)).resolves.toMatchObject({ jobId: JOB_ID });
        await seedScene(world, SECOND);
        world.scenes.options.set(SECOND, { entityId: SECOND, available: true, bytes: 734_003_200 });

        const failure = await failureOf(importScene(world, SECOND));

        expect(failure).toMatchObject({
            code: 'resource-exhausted',
            details: { code: 'apiError.imagery.dailyLimit', params: { limit: '3' } },
        });
    });
});

describe('imagery.import of a scene harvested before the id rules', () => {
    it('happyPath_anArgonFrameHarvestedAsKh4aIsImportedAsKh5 @S-A12-HAPPY-STALE-CAMERA', async () => {
        const world = await readyWorld();
        const argon = 'DS09065A073MC043';
        await seedScene(world, argon, { sensor: 'KH-4A', acquisitionDate: '1964-06-18' });
        world.scenes.options.set(argon, { entityId: argon, available: true, bytes: 1 });

        const { jobId, layerId } = await importScene(world, argon);

        expect(layerId).toBe('kh-5-argon-18-iunie-1964');
        expect((await readJob(world, jobId))?.params).toEqual({ entityId: argon, dataset: 'corona2', sensor: 'KH-5' });
        expect(await readVersion(world, jobId)).toMatchObject({ sensor: 'KH-5', label: { en: 'KH-5 Argon, 18 June 1964' } });
        expect(await readScene(world, argon)).toMatchObject({ sensor: 'KH-5', status: 'imported' });
    });
});
