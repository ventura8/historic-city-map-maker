/**
 * The `memberships` step of `ops.tick` (`functions/src/ops/memberships.ts`, M5-interfaces §1.2): the admins from before
 * M5 get every existing city, so nobody who has not signed in since stays locked out.
 */
import { FIRESTORE_PATHS, adminDocSchema, cityDocSchema, inviteDocSchema, timestampFromDate } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { migrateMemberships } from '../../src/ops/memberships.js';
import { runTick } from '../../src/ops/tick.js';
import { CITY_ID, cityDoc } from '../publish/city.js';
import { opsDeps } from './fakes.js';

const NOW = '2026-10-12T14:30:00.000Z';
const AT = timestampFromDate(new Date('2026-10-01T08:00:00.000Z'));
const stamp = { createdAt: AT, updatedBy: 'u-owner', updatedAt: AT };

describe('the memberships step', () => {
    it('happyPath_everyAdminFromBeforeM5GetsEveryCityOnce @S-A51-HAPPY-MIGRATION', async () => {
        const deps = opsDeps(NOW);
        await deps.documents.set(FIRESTORE_PATHS.city(CITY_ID), cityDocSchema, cityDoc());
        await deps.documents.set(FIRESTORE_PATHS.city('cluj'), cityDocSchema, cityDoc());
        await deps.documents.set(FIRESTORE_PATHS.admin('u-owner'), adminDocSchema, { role: 'owner', ...stamp });
        await deps.documents.set(FIRESTORE_PATHS.admin('u-editor'), adminDocSchema, { role: 'admin', ...stamp });
        await deps.documents.set(FIRESTORE_PATHS.admin('u-m5'), adminDocSchema, { role: 'admin', cities: { cluj: 'editor' }, ...stamp });

        await runTick(deps);

        await expect(deps.documents.get(FIRESTORE_PATHS.admin('u-owner'), adminDocSchema)).resolves.toMatchObject({
            cities: { [CITY_ID]: 'owner', cluj: 'owner' },
            updatedBy: 'system:cities',
        });
        await expect(deps.documents.get(FIRESTORE_PATHS.admin('u-editor'), adminDocSchema)).resolves.toMatchObject({
            cities: { [CITY_ID]: 'editor', cluj: 'editor' },
        });
        await expect(deps.documents.get(FIRESTORE_PATHS.admin('u-m5'), adminDocSchema)).resolves.toMatchObject({
            cities: { cluj: 'editor' },
            updatedBy: 'u-owner',
        });
        await expect(migrateMemberships(deps)).resolves.toBe(0);
    });

    it.each([
        ['deleted', undefined],
        ['migrated by its own session', { role: 'admin', cities: { cluj: 'owner' }, ...stamp }],
    ] as const)('badPath_anAdmin%sMeanwhileIsNotWrittenOver', async (_name, meanwhile) => {
        const deps = opsDeps(NOW);
        const path = FIRESTORE_PATHS.admin('u-raced');
        await deps.documents.set(path, adminDocSchema, { role: 'admin', ...stamp });
        const query = deps.documents.query.bind(deps.documents);
        const racing = async (collection: string) => {
            if (collection === FIRESTORE_PATHS.cities) {
                await (meanwhile === undefined ? deps.documents.delete(path) : deps.documents.set(path, adminDocSchema, meanwhile));
            }
        };
        const documents = {
            ...deps.documents,
            query: (async (collection, schema, options) => {
                await racing(collection);
                return query(collection, schema, options);
            }) as typeof query,
        };

        await expect(migrateMemberships({ ...deps, documents })).resolves.toBe(1);
        await expect(deps.documents.get(path, adminDocSchema)).resolves.toEqual(meanwhile);
    });
});

describe('the memberships step: invitations from before M5', () => {
    const invite = { role: 'admin', invitedBy: 'u-owner', createdAt: AT, expiresAt: AT, updatedBy: 'u-owner', updatedAt: AT } as const;

    it('happyPath_aPendingInvitationGetsTheCitiesOfNowAsAnEditor @S-A51-HAPPY-LEGACY-INVITE', async () => {
        const deps = opsDeps(NOW);
        await deps.documents.set(FIRESTORE_PATHS.city(CITY_ID), cityDocSchema, cityDoc());
        await deps.documents.set(FIRESTORE_PATHS.invite('a'.repeat(64)), inviteDocSchema, invite);
        await deps.documents.set(FIRESTORE_PATHS.invite('b'.repeat(64)), inviteDocSchema, { ...invite, cities: { cluj: 'owner' } });

        await expect(migrateMemberships(deps)).resolves.toBe(1);

        await expect(deps.documents.get(FIRESTORE_PATHS.invite('a'.repeat(64)), inviteDocSchema)).resolves.toMatchObject({
            cities: { [CITY_ID]: 'editor' },
            updatedBy: 'system:cities',
        });
        await expect(deps.documents.get(FIRESTORE_PATHS.invite('b'.repeat(64)), inviteDocSchema)).resolves.toMatchObject({
            cities: { cluj: 'owner' },
            updatedBy: 'u-owner',
        });
        await expect(migrateMemberships(deps)).resolves.toBe(0);
    });

    it.each([
        ['accepted', undefined],
        ['converted', { ...invite, cities: { cluj: 'editor' } }],
    ] as const)('badPath_anInvitation%sMeanwhileIsNotWrittenOver', async (_name, meanwhile) => {
        const deps = opsDeps(NOW);
        const path = FIRESTORE_PATHS.invite('c'.repeat(64));
        await deps.documents.set(path, inviteDocSchema, invite);
        const query = deps.documents.query.bind(deps.documents);
        const documents = {
            ...deps.documents,
            query: (async (collection, schema, options) => {
                if (collection === FIRESTORE_PATHS.cities) {
                    await (meanwhile === undefined ? deps.documents.delete(path) : deps.documents.set(path, inviteDocSchema, meanwhile));
                }
                return query(collection, schema, options);
            }) as typeof query,
        };

        await expect(migrateMemberships({ ...deps, documents })).resolves.toBe(1);

        await expect(deps.documents.get(path, inviteDocSchema)).resolves.toEqual(meanwhile);
    });
});
