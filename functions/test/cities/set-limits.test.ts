/**
 * `cities.setLimits` (`functions/src/cities/set-limits.ts`, M5-interfaces §1.8) through its callable's `.run()` on the
 * Firestore emulator: the project's owner sets a city's share of the budgets; nobody else.
 */
import { DEFAULT_NEW_CITY_LIMITS, FIRESTORE_PATHS, cityDocSchema } from '@hcm/shared';
import { afterAll, describe, expect, it } from 'vitest';

import { setLimitsFunction } from '../../src/cities/set-limits.js';
import { callableRequest, failureOf, openEmulators, type World } from '../admin/world.js';
import { adminCaller, seedAdmin, seedCity } from './world.js';

const emulators = openEmulators('fn-cities-limits');

afterAll(async () => {
    await emulators.close();
});

const OWNER = 'u-project-owner';
const LIMITS = { ...DEFAULT_NEW_CITY_LIMITS, computeUnitsPerMonth: 8, rasterJobsPerDay: 5 };

function setLimits(world: World, data: unknown, uid = OWNER) {
    return setLimitsFunction(() => world).run(callableRequest(data, adminCaller(uid)));
}

async function seeded(): Promise<World> {
    const world = emulators.newWorld();
    await seedAdmin(world, OWNER, 'owner', { cluj: 'owner' });
    await seedAdmin(world, 'u-city-owner', 'admin', { cluj: 'owner' });
    await seedCity(world, 'cluj');
    return world;
}

describe('cities.setLimits', () => {
    it('happyPath_theProjectOwnerSetsACitysShare @S-A52-HAPPY', async () => {
        const world = await seeded();

        await expect(setLimits(world, { cityId: 'cluj', limits: LIMITS })).resolves.toEqual({ limits: LIMITS });
        await expect(world.documents.get(FIRESTORE_PATHS.city('cluj'), cityDocSchema)).resolves.toMatchObject({
            limits: LIMITS,
            updatedBy: OWNER,
            published: true,
        });
    });

    it('badPath_aCityOwnerWhoIsNotTheProjectsSetsNothing @S-A52-BAD-NOT-PROJECT-OWNER', async () => {
        const world = await seeded();

        await expect(failureOf(setLimits(world, { cityId: 'cluj', limits: LIMITS }, 'u-city-owner'))).resolves.toMatchObject({
            code: 'permission-denied',
            details: { code: 'apiError.city.notProjectOwner' },
        });
        await expect(world.documents.get(FIRESTORE_PATHS.city('cluj'), cityDocSchema)).resolves.not.toHaveProperty('limits');
    });

    it.each([
        ['more daily jobs than the project allows', { cityId: 'cluj', limits: { ...LIMITS, rasterJobsPerDay: 11 } }, 'invalid-argument'],
        ['a city that does not exist', { cityId: 'bacau', limits: LIMITS }, 'not-found'],
    ])('badPath_%s', async (_name, data, code) => {
        const world = await seeded();

        await expect(failureOf(setLimits(world, data))).resolves.toMatchObject({ code });
    });
});
