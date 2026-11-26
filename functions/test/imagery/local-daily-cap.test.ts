/**
 * The daily cap bounds the paid cloud work (`functions/src/imagery/limits.ts`, `docs/research/M7-local-worker.md` §4.5; the
 * owner, 2026-11-12): a job on the owner's computer never counts, a city whose choice is `local` starts imports and joins
 * past the cap (each recorded `runOn: 'local'`), a cloud city is still refused at the cap, and a local job moved to the cloud
 * is checked against the cap then and counts on the day of the move.
 */
import { FIRESTORE_PATHS, JOBS_PER_DAY, jobDocSchema, runChoiceDocSchema, type JobDoc, type RunChoice } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { importFunction } from '../../src/imagery/import.js';
import { joinFunction } from '../../src/imagery/join.js';
import { runOnFunction } from '../../src/imagery/run-on.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import { F039, F040, frameFields } from './join-world.js';
import { CITY, NOW, at, readJob, readyWorld, seedScene, type ImageryWorld } from './world.js';

const ENTITY = 'DS1035-1057DA023';
const MOVED = 'im-local-yesterday';

function importScene(world: ImageryWorld) {
    return importFunction(() => world.deps).run(adminCall({ cityId: CITY, entityId: ENTITY }));
}

function join(world: ImageryWorld, entityIds: readonly string[]) {
    return joinFunction(() => world.deps).run(adminCall({ cityId: CITY, entityIds }));
}

function runOn(world: ImageryWorld, jobId: string, place: 'local' | 'cloud') {
    return runOnFunction(() => world.deps).run(adminCall({ cityId: CITY, jobId, runOn: place }));
}

async function seedChoice(world: ImageryWorld, choice: RunChoice): Promise<void> {
    await world.deps.documents.set(FIRESTORE_PATHS.runChoice(CITY), runChoiceDocSchema, {
        choice,
        updatedBy: 'u-admin',
        updatedAt: at(NOW),
    });
}

function importJob(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'usgs-import',
        status: 'succeeded',
        params: { entityId: 'e' },
        createdBy: 'u-admin',
        createdAt: at(NOW),
        updatedBy: 'u-admin',
        updatedAt: at(NOW),
        ...overrides,
    };
}

/** `JOBS_PER_DAY` imports created today, placed as `overrides` say. */
async function seedToday(world: ImageryWorld, overrides: Partial<JobDoc> = {}): Promise<void> {
    for (let index = 0; index < JOBS_PER_DAY; index += 1) {
        await world.deps.documents.set(FIRESTORE_PATHS.job(CITY, `today-${String(index)}`), jobDocSchema, importJob(overrides));
    }
}

async function scannedWorld(): Promise<ImageryWorld> {
    const world = await readyWorld();
    for (const entityId of [ENTITY, F039, F040]) {
        await seedScene(world, entityId, entityId === ENTITY ? {} : frameFields());
        world.scenes.options.set(entityId, { entityId, available: true, bytes: 1 });
    }
    return world;
}

async function codeOf(promise: Promise<unknown>): Promise<unknown> {
    return (await failureOf(promise)).details;
}

describe('the daily cap counts only cloud work', () => {
    it('happyPath_aLocalCityImportsAndJoinsPastTheCap_eachJobPlacedOnTheComputer @S-A12-HAPPY-LOCAL-PAST-DAILY-CAP', async () => {
        const world = await scannedWorld();
        await seedToday(world);
        await seedChoice(world, 'local');

        const imported = await importScene(world);
        const joined = await join(world, [F039, F040]);

        expect(await readJob(world, imported.jobId)).toMatchObject({ type: 'usgs-import', status: 'queued', runOn: 'local' });
        const job = await readJob(world, joined.jobId);
        expect(job).toMatchObject({ type: 'layer-join', waitReason: 'parts', runOn: 'local' });
        for (const part of (job?.params as { parts: { versionId: string }[] }).parts) {
            expect(await readJob(world, part.versionId)).toMatchObject({ type: 'usgs-import', runOn: 'local' });
        }
    });

    it('happyPath_jobsOnTheComputerDoNotFillTheCapOfACloudCity @S-A12-HAPPY-LOCAL-PAST-DAILY-CAP', async () => {
        const world = await scannedWorld();
        await seedToday(world, { runOn: 'local' });
        await seedChoice(world, 'cloud');

        const imported = await importScene(world);

        expect((await readJob(world, imported.jobId))?.runOn).toBeUndefined();
    });

    it('badPath_aCloudCityIsStillRefusedAtTheCap @S-A12-BAD-DAILY-LIMIT', async () => {
        const world = await scannedWorld();
        await seedToday(world, { runOn: 'cloud' });
        await seedChoice(world, 'cloud');

        expect(await codeOf(importScene(world))).toMatchObject({ code: 'apiError.imagery.dailyLimit', params: { limit: '10' } });
        expect(await codeOf(join(world, [F039, F040]))).toMatchObject({ code: 'apiError.imagery.dailyLimit' });
    });

    it('badPath_aLocalJobMovedToTheCloudPastTheCapIsRefused_nothingChanged @S-A12-BAD-RUNON-CLOUD-PAST-CAP', async () => {
        const world = await scannedWorld();
        await seedToday(world, { runOn: 'cloud' });
        const local = importJob({ status: 'queued', runOn: 'local', waitReason: 'worker', createdAt: at('2026-01-01T00:00:00.000Z') });
        await world.deps.documents.set(FIRESTORE_PATHS.job(CITY, MOVED), jobDocSchema, local);

        expect(await codeOf(runOn(world, MOVED, 'cloud'))).toMatchObject({ code: 'apiError.imagery.dailyLimit', params: { limit: '10' } });
        expect(await readJob(world, MOVED)).toEqual(local);
    });

    it('badPath_aLocalJobMovedToTheCloudUnderTheCapCountsToday_theNextImportIsRefused @S-A12-BAD-RUNON-CLOUD-PAST-CAP', async () => {
        const world = await scannedWorld();
        for (let index = 0; index < JOBS_PER_DAY - 1; index += 1) {
            await world.deps.documents.set(FIRESTORE_PATHS.job(CITY, `today-${String(index)}`), jobDocSchema, importJob());
        }
        const local = importJob({ status: 'queued', runOn: 'local', waitReason: 'worker', createdAt: at('2026-01-01T00:00:00.000Z') });
        await world.deps.documents.set(FIRESTORE_PATHS.job(CITY, MOVED), jobDocSchema, local);

        await runOn(world, MOVED, 'cloud');

        expect(await readJob(world, MOVED)).toMatchObject({ runOn: 'cloud', countedAt: at(NOW) });
        expect(await codeOf(importScene(world))).toMatchObject({ code: 'apiError.imagery.dailyLimit' });
    });

    it('happyPath_aRerunMovedToTheCloudIsNotCounted', async () => {
        const world = await scannedWorld();
        await seedToday(world, { runOn: 'cloud' });
        const rerun = importJob({ type: 'regeoref', params: { basedOn: 'v0' }, status: 'queued', runOn: 'local' });
        await world.deps.documents.set(FIRESTORE_PATHS.job(CITY, MOVED), jobDocSchema, rerun);

        await runOn(world, MOVED, 'cloud');

        expect((await readJob(world, MOVED))?.countedAt).toBeUndefined();
    });
});
