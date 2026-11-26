/**
 * The edges of the tick's and the publisher's helpers (CR-M3-47): what a refused monthly harvest tells Setup, a scene USGS
 * says is not scanned, and a file Mapbox refuses as too large when the publish has moved on or kept no guard.
 */
import { FIRESTORE_PATHS, jobLogDocSchema, setupStatusDocSchema, usgsSceneDocSchema } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../src/api/api-error.js';
import { tooLargeForMts } from '../../src/imagery/publish-studio.js';
import { markNotScanned } from '../../src/imagery/scene-rank.js';
import { noteUsgsRefusal } from '../../src/imagery/usgs-status.js';
import {
    CITY,
    NOW,
    at,
    goldenOutput,
    readJob,
    readScene,
    readVersion,
    readyWorld,
    renderedVersion,
    runningJob,
    seedJob,
    seedLayer,
    seedScene,
    seedSetup,
    seedVersion,
} from './world.js';

const SCENE = 'DS1035-1057DA023';
const TOO_LARGE = new ApiError('apiError.imagery.sourceTooLarge');

describe('what a refused monthly harvest tells Setup', () => {
    it('happyPath_noAccessAnyMoreIsPendingAgainCheckedInSixHours', async () => {
        const world = await readyWorld();

        await noteUsgsRefusal(world.deps, new ApiError('apiError.usgs.accessPending'), new Date(NOW));

        expect((await world.deps.documents.get(FIRESTORE_PATHS.setupStatus, setupStatusDocSchema))?.usgs).toMatchObject({
            state: 'pending',
            role: 'search',
            detail: 'apiError.usgs.accessPending',
            nextCheckAt: at('2026-10-23T14:00:00.000Z'),
        });
    });

    it.each([
        ['a failure that is no refusal', new ApiError('apiError.usgs.unavailable')],
        ['an error of no API', new Error('socket hang up')],
    ])('badPath_leavesTheCardAlone_%s', async (_case, error) => {
        const world = await readyWorld();

        await noteUsgsRefusal(world.deps, error, new Date(NOW));

        expect((await world.deps.documents.get(FIRESTORE_PATHS.setupStatus, setupStatusDocSchema))?.usgs).toEqual({
            state: 'ok',
            role: 'download',
        });
    });

    it('badPath_aSetupWithoutAUsgsCardGetsNone', async () => {
        const world = await readyWorld();
        await seedSetup(world, { usgs: undefined });

        await noteUsgsRefusal(world.deps, new ApiError('apiError.usgs.credentials'), new Date(NOW));

        expect((await world.deps.documents.get(FIRESTORE_PATHS.setupStatus, setupStatusDocSchema))?.usgs).toBeUndefined();
    });
});

describe('a scene USGS says is not scanned', () => {
    it('badPath_aMissingOrAlreadyPaidSceneIsLeftAsItIs', async () => {
        const world = await readyWorld();
        await seedScene(world, SCENE, { downloadAvailable: false });

        await markNotScanned(world.deps, CITY, 'DS-NONE');
        await markNotScanned(world.deps, CITY, SCENE);

        expect(await readScene(world, 'DS-NONE')).toBeUndefined();
        expect((await readScene(world, SCENE))?.updatedBy).toBe('system:imagery');
        expect((await readScene(world, SCENE))?.updatedAt).toEqual(at('2026-10-01T08:00:00.000Z'));
    });

    it('happyPath_aCityGoneMeanwhileIsRankedWithoutTargetYears', async () => {
        const world = await readyWorld();
        await seedScene(world, SCENE);
        await seedLayer(world, 'kh-4a-corona-1968', { year: 1968 });
        await world.deps.documents.delete(FIRESTORE_PATHS.city(CITY));

        await markNotScanned(world.deps, CITY, SCENE);

        const scene = await world.deps.documents.get(FIRESTORE_PATHS.usgsScene(CITY, SCENE), usgsSceneDocSchema);
        expect(scene?.downloadAvailable).toBe(false);
        expect(scene?.rank.reasons.map((reason) => reason.code)).not.toContain('targetYear');
        expect(scene?.rank.reasons).toContainEqual({ code: 'newYear', params: { years: '2' } });
    });
});

describe('a file too large for Mapbox', () => {
    const task = { cityId: CITY, jobId: 'job-1966-0712', phase: 'start' as const, poll: 0 };

    it('badPath_aPublishThatMovedOnIsNotSentBack', async () => {
        const world = await readyWorld();
        await seedJob(world, task.jobId, runningJob({ status: 'awaiting_approval' }));
        await seedVersion(
            world,
            task.jobId,
            renderedVersion({ state: 'approved', approval: { auto: true, by: 'system:imagery', at: at(NOW) } }),
        );

        expect(await tooLargeForMts(world.deps, task, TOO_LARGE)).toBe(false);
        expect((await readVersion(world, task.jobId))?.guard).toBeUndefined();
    });

    it('happyPath_aVersionWithoutAGuardOrACounterIsSentBackAndSaysItsSizeOrNone', async () => {
        const world = await readyWorld();
        await seedJob(world, task.jobId, runningJob({ status: 'mts_processing', steps: undefined }));
        const approval = { auto: true, by: 'system:imagery', at: at(NOW) };
        await seedVersion(world, task.jobId, renderedVersion({ state: 'publishing', approval, output: goldenOutput() }));

        expect(await tooLargeForMts(world.deps, task, TOO_LARGE)).toBe(true);

        expect(await readVersion(world, task.jobId)).toMatchObject({ state: 'approved', guard: { verdict: 'too-large', available: 20 } });
        expect(await readJob(world, task.jobId)).toMatchObject({ status: 'awaiting_approval', waitReason: 'compute-units', steps: {} });
        const lines = await world.deps.documents.query(FIRESTORE_PATHS.jobLogs(CITY, task.jobId), jobLogDocSchema);
        expect(lines.documents.map((line) => line.data.message)).toEqual([
            'Mapbox refused the ? MB file as too large; the free Studio upload is offered instead.',
        ]);
    });
});
