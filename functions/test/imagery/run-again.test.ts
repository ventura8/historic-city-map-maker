/**
 * Lesson 728 (the owner's request of 2026-11-14): Run again with the latest pipeline is `imagery.import` with `again`, from a version's
 * page, a job's page or Find. Bucharest's 1991 and 2008 Landsat 5 imports were cancelled to run again on the fixed pipeline: a
 * cancelled first import frees its scene, and one whose layer id another version holds keeps it `imported`; either way the scene runs
 * again for free, a new job and version, the cancelled one kept.
 */
import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { cancelJob } from '../../src/imagery/cancel.js';
import { importFunction } from '../../src/imagery/import.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import { CITY, NOW, readScene, readVersion, readyWorld, seedScene, type ImageryWorld } from './world.js';

const L1991 = 'LT51820291991181XXX03';
const LANDSAT = { dataset: 'landsat_tm_c2_l1', sensor: 'L5-TM', acquisitionDate: '1991-06-30', resolutionM: 30 } as const;

async function landsatWorld(): Promise<ImageryWorld> {
    const world = await readyWorld();
    await seedScene(world, L1991, LANDSAT);
    world.scenes.options.set(L1991, { entityId: L1991, available: true, bytes: 180_000_000 });
    return world;
}

function run(world: ImageryWorld, again: boolean) {
    return importFunction(() => world.deps).run(adminCall({ cityId: CITY, entityId: L1991, ...(again ? { again: true as const } : {}) }));
}

function later(world: ImageryWorld, hours: number): void {
    world.deps.clock.set(new Date(Date.parse(NOW) + hours * 3_600_000).toISOString());
}

describe('Run again with the latest pipeline', () => {
    it('happyPath_aCancelledLandsatImportRunsAgainAsANewVersionTheCancelledOneKept @S-A130-HAPPY-RUN-AGAIN @S-A130-HAPPY-RUN-AGAIN-JOB', async () => {
        const world = await landsatWorld();
        const first = await run(world, false);
        await cancelJob(world.deps, CITY, first.jobId);
        later(world, 1);

        const second = await run(world, true);

        expect(second.jobId).not.toBe(first.jobId);
        expect((await readVersion(world, first.versionId))?.state).toBe('cancelled');
        expect((await readVersion(world, second.versionId))?.state).toBe('processing');
        expect(await readScene(world, L1991)).toMatchObject({ status: 'imported', layerId: second.layerId });
        expect(world.deps.documents.paths(FIRESTORE_PATHS.jobs(CITY))).toHaveLength(2);
    });

    it('happyPath_aSceneStillImportedRunsAgainIntoItsOwnLayer @S-A130-HAPPY-RUN-AGAIN', async () => {
        const world = await landsatWorld();
        const first = await run(world, false);
        later(world, 1);

        const second = await run(world, true);

        expect(second.layerId).toBe(first.layerId);
        expect(second.versionId).not.toBe(first.versionId);
    });

    it('badPath_aSceneUsgsNoLongerOffersIsRefusedAndNoJobStarts @S-A130-BAD-RUN-AGAIN @S-A130-BAD-RUN-AGAIN-JOB', async () => {
        const world = await landsatWorld();
        const first = await run(world, false);
        await cancelJob(world.deps, CITY, first.jobId);
        world.scenes.options.set(L1991, { entityId: L1991, available: false, bytes: 0 });
        later(world, 1);

        expect(await failureOf(run(world, true))).toMatchObject({ details: { code: 'apiError.imagery.notScanned' } });
        expect(world.deps.documents.paths(FIRESTORE_PATHS.jobs(CITY))).toHaveLength(1);
    });
});
