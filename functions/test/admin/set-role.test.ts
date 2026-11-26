/**
 * `admins.setRole` (`functions/src/admin/set-role.ts`, M5-interfaces §1.7) through its callable's `.run()` on the
 * Firestore emulator: a city's owner changes an admin's role in that city; the city keeps one owner.
 */
import { FIRESTORE_PATHS, adminDocSchema, timestampFromDate, type CityRoles } from '@hcm/shared';
import { afterAll, describe, expect, it } from 'vitest';

import { revokeFunction } from '../../src/admin/revoke.js';
import { setRoleFunction } from '../../src/admin/set-role.js';
import type { AdminDirectory } from '../../src/ports/admin-directory.js';
import { callableRequest, failureOf, googleToken, openEmulators, type World } from './world.js';

const emulators = openEmulators('fn-admin-set-role');

afterAll(async () => {
    await emulators.close();
});

const AT = timestampFromDate(new Date('2026-10-01T08:00:00.000Z'));
const CITY = 'bucharest';
const OWNER = 'u-role-owner';
const EDITOR = 'u-role-editor';

async function seedAdmin(world: World, uid: string, cities: CityRoles, role: 'owner' | 'admin' = 'admin'): Promise<void> {
    await world.documents.set(FIRESTORE_PATHS.admin(uid), adminDocSchema, {
        role,
        cities,
        createdAt: AT,
        updatedBy: uid,
        updatedAt: AT,
    });
}

async function seed(world: World): Promise<void> {
    await seedAdmin(world, OWNER, { [CITY]: 'owner' });
    await seedAdmin(world, EDITOR, { [CITY]: 'editor', cluj: 'editor' });
}

function setRole(world: World, caller: string, data: { readonly uid: string; readonly role: string; readonly cityId?: string }) {
    return setRoleFunction(() => world).run(
        callableRequest({ cityId: CITY, ...data }, { uid: caller, token: googleToken(`${caller}@example.test`, { admin: true }) }),
    );
}

function rolesOf(world: World, uid: string): Promise<CityRoles | undefined> {
    return world.documents.get(FIRESTORE_PATHS.admin(uid), adminDocSchema).then((admin) => admin?.cities);
}

describe('admins.setRole', () => {
    it('happyPath_anOwnerMakesAnEditorAnOwnerOfThisCityOnly @S-A51-HAPPY-ROLE', async () => {
        const world = emulators.newWorld();
        await seed(world);

        await expect(setRole(world, OWNER, { uid: EDITOR, role: 'owner' })).resolves.toEqual({ role: 'owner' });

        await expect(rolesOf(world, EDITOR)).resolves.toEqual({ [CITY]: 'owner', cluj: 'editor' });
        await expect(world.documents.get(FIRESTORE_PATHS.admin(EDITOR), adminDocSchema)).resolves.toMatchObject({ updatedBy: OWNER });
    });

    it('happyPath_theSameRoleAgainWritesNothing', async () => {
        const world = emulators.newWorld();
        await seed(world);

        await expect(setRole(world, OWNER, { uid: EDITOR, role: 'editor' })).resolves.toEqual({ role: 'editor' });
        await expect(world.documents.get(FIRESTORE_PATHS.admin(EDITOR), adminDocSchema)).resolves.toMatchObject({ updatedBy: EDITOR });
    });

    it('happyPath_anOwnerStepsDownWhenAnotherOwnerStays', async () => {
        const world = emulators.newWorld();
        await seed(world);
        await setRole(world, OWNER, { uid: EDITOR, role: 'owner' });

        await expect(setRole(world, OWNER, { uid: OWNER, role: 'editor' })).resolves.toEqual({ role: 'editor' });
        await expect(rolesOf(world, OWNER)).resolves.toEqual({ [CITY]: 'editor' });
    });

    it('badPath_theCitysLastOwnerCannotStepDown @S-A51-BAD-LAST-OWNER', async () => {
        const world = emulators.newWorld();
        await seed(world);

        await expect(failureOf(setRole(world, OWNER, { uid: OWNER, role: 'editor' }))).resolves.toMatchObject({
            code: 'failed-precondition',
            details: { code: 'apiError.city.lastOwner' },
        });
        await expect(rolesOf(world, OWNER)).resolves.toEqual({ [CITY]: 'owner' });
    });

    it('badPath_anAdminOfAnotherCityOrNobodyIsNotFoundAndAnEditorChangesNothing', async () => {
        const world = emulators.newWorld();
        await seed(world);
        await seedAdmin(world, 'u-cluj-only', { cluj: 'owner' });

        const otherCity = await failureOf(setRole(world, OWNER, { uid: 'u-cluj-only', role: 'editor' }));
        const nobody = await failureOf(setRole(world, OWNER, { uid: 'u-nobody', role: 'owner' }));
        const byEditor = await failureOf(setRole(world, EDITOR, { uid: EDITOR, role: 'owner' }));

        expect([otherCity, nobody, byEditor]).toMatchObject([
            { code: 'not-found', details: { code: 'apiError.notFound' } },
            { code: 'not-found', details: { code: 'apiError.notFound' } },
            { code: 'permission-denied', details: { code: 'apiError.city.notOwner' } },
        ]);
        await expect(rolesOf(world, EDITOR)).resolves.toEqual({ [CITY]: 'editor', cluj: 'editor' });
    });

    it('badPath_twoOwnersDemotingEachOtherAtOnceLeaveTheCityAnOwner @S-A51-BAD-ROLE-RACE', async () => {
        // docs/LESSONS.md 243: the owners were counted outside any transaction, so both demotions could pass.
        const world = emulators.newWorld();
        await seed(world);
        await setRole(world, OWNER, { uid: EDITOR, role: 'owner' });

        const outcomes = await Promise.allSettled([
            setRole(world, OWNER, { uid: EDITOR, role: 'editor' }),
            setRole(world, EDITOR, { uid: OWNER, role: 'editor' }),
        ]);

        expect(outcomes.map((outcome) => outcome.status).sort((a, b) => a.localeCompare(b))).toEqual(['fulfilled', 'rejected']);
        const owners = [await rolesOf(world, OWNER), await rolesOf(world, EDITOR)].filter((roles) => roles?.[CITY] === 'owner');
        expect(owners).toHaveLength(1);
    });

    it('badPath_theProjectsOwnerStaysAnOwnerOfTheirCities @S-A51-BAD-PROJECT-OWNER-STAYS', async () => {
        // docs/LESSONS.md 243: the project's owner is the account that can always reach a city.
        const world = emulators.newWorld();
        await seedAdmin(world, 'u-project-owner', { [CITY]: 'owner' }, 'owner');
        await seedAdmin(world, OWNER, { [CITY]: 'owner' });

        await expect(failureOf(setRole(world, OWNER, { uid: 'u-project-owner', role: 'editor' }))).resolves.toMatchObject({
            code: 'failed-precondition',
            details: { code: 'apiError.city.projectOwnerStays' },
        });
        await expect(rolesOf(world, 'u-project-owner')).resolves.toEqual({ [CITY]: 'owner' });
    });

    it('badPath_aChangeFromAStaleReadNeverBringsBackAMembershipJustTakenAway', async () => {
        const world = emulators.newWorld();
        await seed(world);
        await seedAdmin(world, 'u-co-owner', { [CITY]: 'owner' });
        const revoked = revokeFunction(() => world).run(
            callableRequest(
                { cityId: CITY, kind: 'admin', uid: EDITOR },
                { uid: OWNER, token: googleToken(`${OWNER}@example.test`, { admin: true }) },
            ),
        );

        await Promise.allSettled([revoked, setRole(world, 'u-co-owner', { uid: EDITOR, role: 'owner' })]);

        await expect(rolesOf(world, EDITOR)).resolves.toEqual({ cluj: 'editor' });
    });

    it('badPath_anOwnerDemotedAfterTheAccessCheckChangesNothing', async () => {
        // The access check read the caller as the city's owner; the transaction reads them again as they are now.
        const world = emulators.newWorld();
        await seed(world);
        await seedAdmin(world, OWNER, { [CITY]: 'editor' });
        const staleAccess: AdminDirectory = {
            isAdmin: () => Promise.resolve(true),
            membership: () => Promise.resolve({ projectRole: 'admin', contributorOnly: false, roleIn: () => 'owner' }),
        };
        const run = setRoleFunction(() => ({ ...world, admins: staleAccess })).run(
            callableRequest(
                { cityId: CITY, uid: EDITOR, role: 'owner' },
                { uid: OWNER, token: googleToken(`${OWNER}@example.test`, { admin: true }) },
            ),
        );

        await expect(failureOf(run)).resolves.toMatchObject({ details: { code: 'apiError.city.notOwner', params: { cityId: CITY } } });
        await expect(rolesOf(world, EDITOR)).resolves.toEqual({ [CITY]: 'editor', cluj: 'editor' });
    });
});
