/**
 * A new city's first USGS harvest (`docs/research/M5-interfaces.md` §1.6 step 4; behaviour A50): `cities.create` leaves
 * the city's harvest state due, so the next `imagery.tick` searches its rectangle once, with no call of the flow's; the
 * e2e content worlds' cities, written past the flow, keep waiting for their first visit (CR-M3-44).
 */
import { FIRESTORE_PATHS, adminDocSchema, harvestStateDocSchema, type CallableRequest } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { createFunction } from '../../src/cities/create.js';
import { runImageryTick } from '../../src/imagery/tick.js';
import { sceneRecord } from '../support/imagery-fakes.js';
import { adminCall } from '../publish/fakes.js';
import { BOUNDS, NOW, at, imageryWorld, seedGuard, seedSetup, type ImageryWorld } from '../imagery/world.js';
import { THEME } from './world.js';

const CITY = 'cluj';
const SCENE = 'DS1105-1071DF075';
const REQUEST: CallableRequest<'cities.create'> = { cityId: CITY, name: { ro: 'Cluj-Napoca' }, bounds: BOUNDS, theme: THEME };

async function projectWorld(): Promise<ImageryWorld> {
    const world = imageryWorld(NOW, { corona2: [sceneRecord(SCENE)] });
    await seedSetup(world);
    await seedGuard(world, 'green');
    const stamp = { createdAt: at(NOW), updatedBy: 'u-admin', updatedAt: at(NOW) };
    await world.deps.documents.set(FIRESTORE_PATHS.admin('u-admin'), adminDocSchema, { role: 'owner', cities: {}, ...stamp });
    return world;
}

describe('a new city’s first harvest', () => {
    it('happyPath_theNextTickHarvestsTheNewCityOnceWithoutACallOfTheFlow @S-A50-HAPPY-HARVEST', async () => {
        const world = await projectWorld();

        await expect(createFunction(() => world.deps).run(adminCall(REQUEST))).resolves.toEqual({ created: true, cityId: CITY });
        expect(world.scenes.recorder.calls).toEqual([]);
        expect(await world.deps.documents.get(FIRESTORE_PATHS.harvestState(CITY), harvestStateDocSchema)).toMatchObject({
            nextAt: at(NOW),
        });

        await runImageryTick(world.deps);
        const searched = world.scenes.recorder.calls.length;
        await runImageryTick(world.deps);

        expect(searched).toBeGreaterThan(0);
        expect(world.scenes.recorder.calls).toHaveLength(searched);
        expect(world.deps.documents.paths(FIRESTORE_PATHS.usgsScenes(CITY))).toContain(FIRESTORE_PATHS.usgsScene(CITY, SCENE));
    });

    it('badPath_aCityWrittenPastTheFlowStillWaitsForItsFirstVisit', async () => {
        const world = await projectWorld();
        await createFunction(() => world.deps).run(adminCall(REQUEST));
        await world.deps.documents.delete(FIRESTORE_PATHS.harvestState(CITY));

        await runImageryTick(world.deps);

        expect(world.scenes.recorder.calls).toEqual([]);
        expect(world.deps.documents.paths(FIRESTORE_PATHS.usgsScenes(CITY))).toEqual([]);
    });
});
