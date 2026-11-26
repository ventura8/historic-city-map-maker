/**
 * `imagery.markScene` (`functions/src/imagery/mark-scene.ts`; the owner's report of 2026-11-13, "this scan is useless, too many
 * clouds"): an editor sets a scene aside as not useful with why, the whole-city plan drops it and says what else completes the date,
 * and the mark can be taken back; an imported scene, a missing one and a moderator or uploader are refused.
 */
import { FIRESTORE_PATHS, datePlanDocSchema } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { rewriteDatePlan } from '../../src/imagery/join-plan.js';
import { markSceneFunction, type MarkSceneDeps } from '../../src/imagery/mark-scene.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import { fakeAdmins } from '../support/fakes.js';
import { EAST, F039, F040, F041, frameFields } from './join-world.js';
import { CITY, readScene, readyWorld, seedScene, type ImageryWorld } from './world.js';

type Deps = ImageryWorld['deps'];

function mark(world: ImageryWorld, unusable: string | null, entityId = F040, deps: MarkSceneDeps & Deps = world.deps) {
    return markSceneFunction(() => deps).run(adminCall({ cityId: CITY, entityId, unusable }));
}

async function plan(world: ImageryWorld) {
    return world.deps.documents.get(FIRESTORE_PATHS.imageryPlan(CITY), datePlanDocSchema);
}

/** 1972-08-08: a free west frame, a paid east one (the plan offers Buy this scan) and a second, free east one. */
async function worldOfThree(): Promise<ImageryWorld> {
    const world = await readyWorld();
    await seedScene(world, F039, frameFields());
    await seedScene(world, F040, frameFields({ footprint: EAST, downloadAvailable: false }));
    await rewriteDatePlan(world.deps, CITY);
    return world;
}

describe('imagery.markScene', () => {
    it('happyPath_aCloudyScanLeavesThePlanAndItsBuySuggestion @S-A152-HAPPY', async () => {
        const world = await worldOfThree();
        expect((await plan(world))?.rows[0]?.paidFrames).toEqual([F040]);
        await seedScene(world, F041, frameFields({ footprint: EAST }));

        await expect(mark(world, 'clouds')).resolves.toEqual({ status: 'rejected' });

        expect(await readScene(world, F040)).toMatchObject({ status: 'rejected', unusable: { reason: 'clouds' }, updatedBy: 'u-admin' });
        // Written again at once: the free east frame completes the date in its place.
        const row = (await plan(world))?.rows[0];
        expect(row?.paidFrames).toEqual([]);
        expect(row?.frames.map((frame) => frame.entityId)).toEqual(expect.arrayContaining([F039, F041]));
    });

    it('happyPath_theMarkIsTakenBack_theSceneIsOfferedAgain @S-A152-HAPPY-UNDO', async () => {
        const world = await worldOfThree();
        await mark(world, 'haze');

        await expect(mark(world, null)).resolves.toEqual({ status: 'candidate' });

        const scene = await readScene(world, F040);
        expect(scene?.status).toBe('candidate');
        expect(scene).not.toHaveProperty('unusable');
        expect((await plan(world))?.rows[0]?.paidFrames).toEqual([F040]);
    });

    it('badPath_anImportedSceneIsRefused_itsLayerIsWhatToRemove', async () => {
        const world = await readyWorld();
        await seedScene(world, F040, frameFields({ status: 'imported', layerId: 'layer-1' }));

        await expect(failureOf(mark(world, 'clouds'))).resolves.toMatchObject({ details: { code: 'apiError.imagery.alreadyImported' } });
        expect((await readScene(world, F040))?.status).toBe('imported');
    });

    it('badPath_aSceneThatIsNotThereIsNotFound', async () => {
        const world = await readyWorld();

        await expect(failureOf(mark(world, 'other', 'NOPE'))).resolves.toMatchObject({ details: { code: 'apiError.notFound' } });
    });

    it('badPath_anUnknownReasonIsRefused', async () => {
        const world = await worldOfThree();

        await expect(failureOf(mark(world, 'ugly'))).resolves.toMatchObject({ code: 'invalid-argument' });
        expect((await readScene(world, F040))?.status).toBe('candidate');
    });

    it.each<['moderator' | 'uploader']>([['moderator'], ['uploader']])('badPath_a%sCannotMark @S-A152-BAD-NOT-EDITOR', async (role) => {
        const world = await worldOfThree();
        const admins = fakeAdmins(['u-admin'], { projectRole: 'admin', cities: { [CITY]: role } });

        await expect(failureOf(mark(world, 'clouds', F040, { ...world.deps, admins }))).resolves.toMatchObject({
            details: { code: 'apiError.city.notEditor' },
        });
        expect((await readScene(world, F040))?.status).toBe('candidate');
    });

    it('badPath_aPlanThatCannotBeWrittenLeavesTheMarkStanding', async () => {
        const world = await worldOfThree();
        world.deps.documents.recorder.failNext('query', new Error('firestore down'));

        await expect(mark(world, 'area')).resolves.toEqual({ status: 'rejected' });
        expect((await readScene(world, F040))?.unusable?.reason).toBe('area');
    });
});
