/**
 * `imagery.locateAgain` (`functions/src/imagery/locate-again.ts`, `docs/research/M3-interfaces.md` §4.5): a frame waiting for
 * points searches again from `locate`, what it fetched and unpacked kept, with no new import.
 */
import { JOB_MAX_ATTEMPTS, JOBS_PER_DAY, type JobDoc, type LayerVersionDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { omit } from '../../src/api/objects.js';
import { locateAgainFunction } from '../../src/imagery/locate-again.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import {
    CITY,
    NOW,
    at,
    needsGcpsVersion,
    readJob,
    readVersion,
    readyWorld,
    seedGuard,
    seedJob,
    seedVersion,
    type ImageryWorld,
} from './world.js';

const JOB = 'job-1966-0712';
const SEGMENT = `work/${CITY}/${JOB}/segments/a.tif`;
const DELIVERY = 'usgs-raw/corona2/DS1035-1057DA023/a.tgz';
const DONE = 'done' as const;

function parked(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'usgs-import',
        status: 'awaiting_gcps',
        waitReason: 'gcps',
        params: { entityId: 'DS1035-1057DA023', dataset: 'corona2', sensor: 'KH-4A' },
        createdBy: 'u-admin',
        createdAt: at(NOW),
        layerId: 'kh-4a-corona-1966',
        versionId: JOB,
        attempt: 1,
        error: { code: 'apiError.imagery.noMatch', message: 'apiError.imagery.noMatch' },
        steps: {
            fetch: { status: DONE, gcsPath: DELIVERY },
            extract: { status: DONE, gcsPath: SEGMENT },
            stitch: { status: DONE, gcsPath: `work/${CITY}/${JOB}/frame.json` },
            locate: { status: DONE, gcsPath: `rasters/${CITY}/${JOB}/scan.tif` },
            reference: { status: DONE },
            georef: { status: 'pending' },
        },
        updatedBy: 'system:pipeline',
        updatedAt: at(NOW),
        ...overrides,
    };
}

function waitingVersion(overrides: Partial<LayerVersionDoc> = {}): LayerVersionDoc {
    return needsGcpsVersion({
        origin: 'usgs',
        error: { code: 'apiError.imagery.noMatch', params: { pairs: '3' } },
        calibration: { how: 'none', refusal: 'no-votes' },
        ...overrides,
    });
}

function store(world: ImageryWorld, path: string): void {
    world.deps.blobs.put('private', path, new Uint8Array([1]));
}

async function parkedWorld(job: Partial<JobDoc> = {}, version: Partial<LayerVersionDoc> = {}): Promise<ImageryWorld> {
    const world = await readyWorld();
    await seedJob(world, JOB, parked(job));
    await seedVersion(world, JOB, waitingVersion(version));
    return world;
}

function locateAgain(world: ImageryWorld, versionId = JOB) {
    return locateAgainFunction(() => world.deps).run(adminCall({ cityId: CITY, versionId }));
}

describe('imagery.locateAgain', () => {
    it('happyPath_aParkedFrameSearchesAgainKeepingWhatItFetchedAndUnpackedAndJoinsItAgain @S-A69-HAPPY-LOCATE-AGAIN', async () => {
        const world = await parkedWorld();
        store(world, SEGMENT);

        await expect(locateAgain(world)).resolves.toEqual({ status: 'queued', attempt: 1 });

        const job = await readJob(world, JOB);
        expect(job).toMatchObject({
            status: 'queued',
            updatedBy: 'u-admin',
            steps: {
                fetch: { status: DONE, gcsPath: DELIVERY },
                extract: { status: DONE, gcsPath: SEGMENT },
                stitch: { status: 'pending' },
                locate: { status: 'pending' },
                reference: { status: 'pending' },
                georef: { status: 'pending' },
            },
        });
        expect(job?.steps?.['locate']?.gcsPath).toBeUndefined();
        expect(job?.steps?.['stitch']?.gcsPath).toBeUndefined();
        expect(job?.error).toBeUndefined();
        expect(job?.waitReason).toBeUndefined();
    });

    it('happyPath_theVersionForgetsTheRefusalSoASearchThatNowProvesWritesItsOwn @S-A69-HAPPY-REFUSED-MAY-PROVE', async () => {
        const world = await parkedWorld();
        store(world, SEGMENT);

        await locateAgain(world);

        const version = await readVersion(world, JOB);
        expect(version?.state).toBe('processing');
        expect(version?.error).toBeUndefined();
        expect(version?.calibration).toBeUndefined();
        expect(version?.georef).toBeUndefined();
        expect(version?.suggestions).toBeUndefined();
        expect(version?.scan).toBeDefined();
    });

    it('happyPath_aWeakCropsDeliveryIsEnoughWhenTheSegmentsAreGone @S-A69-HAPPY-DELIVERY-KEPT', async () => {
        const world = await parkedWorld();
        store(world, DELIVERY);

        await expect(locateAgain(world)).resolves.toMatchObject({ status: 'queued' });

        expect((await readJob(world, JOB))?.steps?.['fetch']).toMatchObject({ status: DONE, gcsPath: DELIVERY });
    });

    it('happyPath_itIsNoNewImportSoTheDailyLimitIsNotAsked @S-A69-HAPPY-NOT-AN-IMPORT', async () => {
        const world = await parkedWorld();
        store(world, SEGMENT);
        for (let index = 0; index < JOBS_PER_DAY; index += 1) {
            await seedJob(
                world,
                `job-today-${String(index)}`,
                parked({ versionId: `v-${String(index)}`, createdAt: at(NOW), status: 'succeeded' }),
            );
        }

        await expect(locateAgain(world)).resolves.toMatchObject({ status: 'queued' });
    });

    it('happyPath_aJobOnTheOwnersComputerKeepsItsFilesOutOfTheServersSight', async () => {
        const world = await parkedWorld({ runOn: 'local' });

        await expect(locateAgain(world)).resolves.toMatchObject({ status: 'queued' });
    });

    it('happyPath_aRunningOnTheOwnersComputerWithNothingRecordedYetCountsNoAttempt', async () => {
        const world = await parkedWorld();
        await seedJob(world, JOB, omit(parked({ runOn: 'local' }), ['steps', 'attempt']));

        await expect(locateAgain(world)).resolves.toEqual({ status: 'queued', attempt: 0 });
    });

    it('happyPath_theRecordedGenerationOfTheSegmentsIsStillThere', async () => {
        const world = await parkedWorld();
        store(world, SEGMENT);
        // This fake's generation grows by one per `stat`: the next one answers what the job recorded.
        const seen = await world.deps.blobs.stat('private', SEGMENT);
        const generation = String(Number(seen?.generation) + 1);
        await seedJob(world, JOB, parked({ steps: { extract: { status: DONE, gcsPath: SEGMENT, generation } } }));

        await expect(locateAgain(world)).resolves.toMatchObject({ status: 'queued' });
    });

    it('badPath_aJobWithoutStepsOrAttemptOnTheCloudHasNothingToSearchIn', async () => {
        const world = await parkedWorld();
        await seedJob(world, JOB, omit(parked(), ['steps', 'attempt']));

        expect(await failureOf(locateAgain(world))).toMatchObject({ details: { code: 'apiError.imagery.locateInputsGone' } });
    });
});

describe('imagery.locateAgain refuses', () => {
    it('badPath_withNeitherSegmentsNorDeliveryTheRefusalSaysWhyAndNothingMoves @S-A69-BAD-INPUTS-GONE', async () => {
        const world = await parkedWorld();

        expect(await failureOf(locateAgain(world))).toMatchObject({ details: { code: 'apiError.imagery.locateInputsGone' } });

        expect((await readJob(world, JOB))?.status).toBe('awaiting_gcps');
        expect((await readVersion(world, JOB))?.state).toBe('needs_gcps');
    });

    it('badPath_anOutputThatWasReplacedIsNotTheOneRecorded', async () => {
        const world = await parkedWorld({ steps: { extract: { status: DONE, gcsPath: SEGMENT, generation: '999999' } } });
        store(world, SEGMENT);

        expect(await failureOf(locateAgain(world))).toMatchObject({ details: { code: 'apiError.imagery.locateInputsGone' } });
    });

    it('badPath_aJobWithNoRecordedStepsHasNothingToSearchIn', async () => {
        const world = await parkedWorld({ steps: {} });

        expect(await failureOf(locateAgain(world))).toMatchObject({ details: { code: 'apiError.imagery.locateInputsGone' } });
    });

    // M18 item 3: Locate again is free, as the admin's points: one run of its own, whatever the runs before used.
    it('happyPath_attemptsUsedUpStillGiveTheSearchOneRunOfItsOwn @S-A69-BAD-ATTEMPTS', async () => {
        const world = await parkedWorld({ attempt: JOB_MAX_ATTEMPTS });
        store(world, SEGMENT);

        await expect(locateAgain(world)).resolves.toEqual({ status: 'queued', attempt: JOB_MAX_ATTEMPTS - 1 });
    });

    it.each(['cloud', 'local'] as const)(
        'badPath_filesLeftOnTheOtherPlaceAreRefusedSoNothingDownloadsAgain_%s @S-A69-BAD-FILES-ELSEWHERE',
        async (filesOn) => {
            const world = await parkedWorld({ runOn: filesOn === 'cloud' ? 'local' : 'cloud', filesOn });
            store(world, SEGMENT);

            expect(await failureOf(locateAgain(world))).toMatchObject({ details: { code: 'apiError.imagery.locateFilesElsewhere' } });

            expect((await readJob(world, JOB))?.status).toBe('awaiting_gcps');
        },
    );

    it('badPath_aRedGuardStopsItAsAnyStart', async () => {
        const world = await parkedWorld();
        store(world, SEGMENT);
        await seedGuard(world, 'red');

        expect(await failureOf(locateAgain(world))).toMatchObject({ details: { code: 'apiError.guardPaused' } });
    });

    it.each<readonly [string, Partial<JobDoc>, Partial<LayerVersionDoc>]>([
        ['a job not waiting', { status: 'running' }, {}],
        ['a job asked to stop', { cancelRequested: true }, {}],
        ['a job type with no locate', { type: 'regeoref', params: { basedOn: 'v0' } }, {}],
    ])('badPath_itRefuses_%s @S-A69-BAD-NOT-WAITING', async (_name, job, version) => {
        const world = await parkedWorld(job, version);
        store(world, SEGMENT);

        expect(await failureOf(locateAgain(world))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
    });

    it('badPath_aVersionThatMovedDuringTheCheckIsRefusedInTheTransaction', async () => {
        const world = await parkedWorld();
        store(world, SEGMENT);
        const stat = world.deps.blobs.stat.bind(world.deps.blobs);
        world.deps.blobs.stat = async (bucket, path) => {
            await seedJob(world, JOB, parked({ status: 'queued' }));
            return stat(bucket, path);
        };

        expect(await failureOf(locateAgain(world))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
    });

    it('badPath_anUnknownVersionIsRefused', async () => {
        const world = await readyWorld();

        expect(await failureOf(locateAgain(world, 'nope'))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
    });

    it('happyPath_attemptsUsedUpMeanwhileStillGiveOneRun', async () => {
        const world = await parkedWorld();
        store(world, SEGMENT);
        const stat = world.deps.blobs.stat.bind(world.deps.blobs);
        world.deps.blobs.stat = async (bucket, path) => {
            await seedJob(world, JOB, parked({ attempt: JOB_MAX_ATTEMPTS }));
            return stat(bucket, path);
        };

        await expect(locateAgain(world)).resolves.toMatchObject({ attempt: JOB_MAX_ATTEMPTS - 1 });
    });
});

// M18 item 3 (docs/research/M18-improvements.md): a frame whose crop failed searches again before anyone imports it anew.
describe('imagery.locateAgain: a failed crop', () => {
    const failedAt = (step: 'stitch' | 'locate' | 'georef'): Partial<JobDoc> => ({
        status: 'failed',
        error: { code: 'apiError.internal', message: 'the crop failed' },
        steps: { ...parked().steps, [step]: { status: 'failed' } },
    });

    it.each(['stitch', 'locate'] as const)(
        'happyPath_aCropThatFailedAt_%s_searchesAgainFromStitch @S-A69-HAPPY-FAILED-CROP',
        async (step) => {
            const world = await parkedWorld(failedAt(step), { state: 'failed' });
            store(world, SEGMENT);

            await expect(locateAgain(world)).resolves.toMatchObject({ status: 'queued' });

            expect(await readJob(world, JOB)).toMatchObject({
                status: 'queued',
                steps: { stitch: { status: 'pending' }, locate: { status: 'pending' } },
            });
            expect(await readVersion(world, JOB)).toMatchObject({ state: 'processing' });
        },
    );

    // Review of M18 item 3: with the pipeline unchanged a failed crop's search brings nothing new; its runs count as a retry's.
    it('badPath_aCropThatFailsEachTimeStopsAtTheAttemptsLimit @S-A69-BAD-FAILED-CROP-ATTEMPTS', async () => {
        const world = await parkedWorld({ ...failedAt('stitch'), attempt: JOB_MAX_ATTEMPTS }, { state: 'failed' });
        store(world, SEGMENT);

        expect(await failureOf(locateAgain(world))).toMatchObject({
            details: { code: 'apiError.imagery.attemptsExhausted', params: { attempts: String(JOB_MAX_ATTEMPTS) } },
        });
        expect((await readJob(world, JOB))?.status).toBe('failed');

        const left = await parkedWorld({ ...failedAt('stitch'), attempt: JOB_MAX_ATTEMPTS - 1 }, { state: 'failed' });
        store(left, SEGMENT);
        await expect(locateAgain(left)).resolves.toEqual({ status: 'queued', attempt: JOB_MAX_ATTEMPTS - 1 });
    });

    it('badPath_aFailureAfterTheCropIsRetrysNotLocateAgains @S-A69-BAD-FAILED-LATER', async () => {
        const world = await parkedWorld(failedAt('georef'), { state: 'failed' });
        store(world, SEGMENT);

        expect(await failureOf(locateAgain(world))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
        expect((await readJob(world, JOB))?.status).toBe('failed');
    });
});
