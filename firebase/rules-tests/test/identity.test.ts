/**
 * Who counts as an admin (firebase/firestore.rules `isAdmin()`: a verified Google account, the `admin` claim and an
 * admins/{uid} document), the admins/{uid} documents themselves, invitations that grant nothing until admin.join,
 * immediate revocation, and the default deny for every path the contract does not name.
 */
import { FIRESTORE_PATHS, inviteIdFor } from '@hcm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminDoc, cityDoc, inviteDoc, setupStatusDoc } from './support/documents.js';
import {
    ANY_ADMIN,
    EVERYONE,
    GOOGLE_ACCOUNTS,
    createWorld,
    expected,
    past,
    stampedBy,
    systemStamp,
    verdict,
    verdicts,
    type World,
} from './support/world.js';

const CITY_ID = 'identity-city';

let world: World;

beforeAll(async () => {
    world = await createWorld('identity');
    await world.seed(FIRESTORE_PATHS.setupStatus, setupStatusDoc());
    await world.seed(FIRESTORE_PATHS.city(CITY_ID), cityDoc(CITY_ID));
});

afterAll(async () => {
    await world.close();
});

describe('admin identity', () => {
    it('happyPath_onlyAVerifiedGoogleAccountWithClaimAndDocumentIsAnAdmin', async () => {
        const result = await verdicts(EVERYONE, (persona) => world.db(persona).doc(FIRESTORE_PATHS.setupStatus).get());

        expect(result).toEqual(expected(EVERYONE, ANY_ADMIN));
    });

    it('badPath_removingTheDocumentRevokesAccessAtOnceDespiteTheClaim', async () => {
        const admins = world.db('admin');
        const path = FIRESTORE_PATHS.admin(world.uid('admin'));
        const before = await verdict(admins.doc(FIRESTORE_PATHS.city(CITY_ID)).get());

        await world.env.withSecurityRulesDisabled(async (context) => {
            await context.firestore().doc(path).delete();
        });
        const after = await verdict(admins.doc(FIRESTORE_PATHS.city(CITY_ID)).get());
        await world.seed(path, world.adminDocOf('admin'));

        expect({ before, after }).toEqual({ before: 'allow', after: 'deny' });
    });
});

describe('admins/{uid}', () => {
    it('happyPath_everyVerifiedGoogleAccountReadsItsOwnDocument', async () => {
        const result = await verdicts(EVERYONE, (persona) =>
            world
                .db(persona)
                .doc(FIRESTORE_PATHS.admin(world.uid(persona)))
                .get(),
        );

        expect(result).toEqual(expected(EVERYONE, GOOGLE_ACCOUNTS));
    });

    it('badPath_onlyTheProjectsOwnerReadsAnotherAccountsDocument', async () => {
        const result = await verdicts(EVERYONE, (persona) =>
            world
                .db(persona)
                .doc(FIRESTORE_PATHS.admin(world.uid('pending')))
                .get(),
        );

        expect(result).toEqual(expected(EVERYONE, ['pending', 'admin']));
    });

    it('badPath_nobodyGrantsThemselvesAdmin', async () => {
        const result = await verdicts(EVERYONE, (persona) =>
            world
                .db(persona)
                .doc(FIRESTORE_PATHS.admin(world.uid(persona)))
                .set({ ...adminDoc(), ...stampedBy(world.uid(persona)) }),
        );

        expect(result).toEqual(expected(EVERYONE, []));
    });

    it('badPath_noClientWritesAMembershipItsOwnIncluded @S-A51-BAD-CLIENT-MEMBERSHIP', async () => {
        const own = await verdicts(EVERYONE, (persona) =>
            world
                .db(persona)
                .doc(FIRESTORE_PATHS.admin(world.uid(persona)))
                .update({ cities: { [world.elsewhere]: 'owner', [CITY_ID]: 'owner' }, ...stampedBy(world.uid(persona)) }),
        );
        const anothers = await verdicts(EVERYONE, (persona) =>
            world
                .db(persona)
                .doc(FIRESTORE_PATHS.admin(world.uid('outsider')))
                .update({ [`cities.${CITY_ID}`]: 'editor', ...stampedBy(world.uid(persona)) }),
        );

        expect({ own, anothers }).toEqual({ own: expected(EVERYONE, []), anothers: expected(EVERYONE, []) });
        expect(await verdict(world.db('outsider').doc(FIRESTORE_PATHS.city(CITY_ID)).get())).toBe('deny');
    });

    it('badPath_nobodyChangesARoleOrRemovesAnAdmin', async () => {
        const path = FIRESTORE_PATHS.admin(world.uid('pending'));

        const updates = await verdicts(EVERYONE, (persona) =>
            world
                .db(persona)
                .doc(path)
                .update({ role: 'owner', ...stampedBy(world.uid(persona)) }),
        );
        const deletes = await verdicts(EVERYONE, (persona) => world.db(persona).doc(path).delete());

        expect({ updates, deletes }).toEqual({ updates: expected(EVERYONE, []), deletes: expected(EVERYONE, []) });
    });
});

describe('invitations', () => {
    it('badPath_anInvitationGrantsNothingUntilAdminJoinRuns', async () => {
        const db = world.db('invited');
        const own = await inviteIdFor(world.email('invited'));

        expect(await verdict(db.doc(FIRESTORE_PATHS.invite(own)).get())).toBe('deny');
        expect(await verdict(db.doc(FIRESTORE_PATHS.city(CITY_ID)).get())).toBe('deny');
        expect(await verdict(db.doc(FIRESTORE_PATHS.invite(own)).delete())).toBe('deny');
        expect(
            await verdict(
                db.doc(FIRESTORE_PATHS.admin(world.uid('invited'))).set({ role: 'admin', createdAt: past(), ...systemStamp('admins') }),
            ),
        ).toBe('deny');
    });

    it('badPath_nobodyInvitesWithTheFirestoreSdk', async () => {
        const id = await inviteIdFor('someone-new@example.test');

        const result = await verdicts(EVERYONE, (persona) =>
            world
                .db(persona)
                .doc(FIRESTORE_PATHS.invite(id))
                .set(inviteDoc(world.uid(persona))),
        );

        expect(result).toEqual(expected(EVERYONE, []));
    });
});

describe('default deny', () => {
    it.each([
        'secrets/mapbox-sk-bootstrap',
        'users/someone',
        `cities/${CITY_ID}/settings/main`,
        `cities/${CITY_ID}/photos/p1/comments/c1`,
        `cities/${CITY_ID}/jobs/j1/logs/000001/raw/r1`,
        'setup/status/history/h1',
    ])('badPath_pathsTheContractDoesNotNameAreClosedEvenToAdmins_%s', async (path) => {
        const db = world.db('admin');
        await world.seed(path, { updatedBy: 'system:setup', updatedAt: past() });

        expect(await verdict(db.doc(path).get())).toBe('deny');
        expect(await verdict(db.doc(path).set({ ...stampedBy(world.uid('admin')) }))).toBe('deny');
    });
});
