/**
 * The `DocumentStore` adapter (`functions/src/adapters/documents.ts`) on the Firestore emulator through the real Admin
 * SDK: validation before every write and after every read, timestamps at any depth, queries ordered by document id,
 * transactions, and the `conflict` of a create that finds its document. Each test owns a fresh named database.
 */
import {
    FIRESTORE_PATHS,
    historyEntryDocSchema,
    inviteDocSchema,
    isoTimeSchema,
    ownerDocSchema,
    timestampFromDate,
    type HistoryEntryDoc,
    type InviteDoc,
} from '@hcm/shared';
import { Timestamp } from 'firebase-admin/firestore';
import { afterAll, describe, expect, it } from 'vitest';

import { formatUpdateTime } from '../../src/adapters/documents.js';
import { InvalidDocumentError, UpstreamError } from '../../src/ports/errors.js';
import { openEmulators, sorted } from '../admin/world.js';

const emulators = openEmulators('fn-adapter-documents');

afterAll(async () => {
    await emulators.close();
});

const AT = timestampFromDate(new Date('2026-10-12T08:30:00.000Z'));
const LATER = timestampFromDate(new Date('2026-10-26T08:30:00.000Z'));

function invite(invitedBy: string): InviteDoc {
    return { role: 'admin', invitedBy, createdAt: AT, expiresAt: LATER, updatedBy: invitedBy, updatedAt: AT };
}

const INVITE_A = 'a'.repeat(64);
const INVITE_B = 'b'.repeat(64);
const INVITE_C = 'c'.repeat(64);

describe('get and set', () => {
    it('happyPath_aWrittenDocumentReadsBackValidatedWithFirestoreTimestamps', async () => {
        const { db, documents } = emulators.newWorld();

        await documents.set(FIRESTORE_PATHS.invite(INVITE_A), inviteDocSchema, invite('u-owner'));

        const stored = (await db.doc(FIRESTORE_PATHS.invite(INVITE_A)).get()).data();
        expect(stored?.['expiresAt']).toBeInstanceOf(Timestamp);
        await expect(documents.get(FIRESTORE_PATHS.invite(INVITE_A), inviteDocSchema)).resolves.toMatchObject({
            role: 'admin',
            invitedBy: 'u-owner',
            expiresAt: { seconds: LATER.seconds, nanoseconds: 0 },
        });
    });

    it('happyPath_timestampsInsideMapsAndListsAreStoredAsTimestampsAndUndefinedFieldsLeftOut', async () => {
        const { db, documents } = emulators.newWorld();
        const entry: HistoryEntryDoc = {
            entity: 'poi',
            entityId: 'p1',
            action: 'update',
            previous: { title: { ro: 'Vechi' }, updatedAt: AT, stamps: [AT], note: undefined },
            changedFields: ['title'],
            updatedBy: 'u-admin',
            updatedAt: LATER,
        };
        const path = FIRESTORE_PATHS.historyEntry({ entity: 'poi', cityId: 'bucharest', entityId: 'p1' }, '1760257800000-e1');

        await documents.set(path, historyEntryDocSchema, entry);

        const previous = (await db.doc(path).get()).get('previous') as Record<string, unknown>;
        expect(previous['updatedAt']).toBeInstanceOf(Timestamp);
        expect((previous['stamps'] as unknown[])[0]).toBeInstanceOf(Timestamp);
        expect(sorted(Object.keys(previous))).toEqual(['stamps', 'title', 'updatedAt']);
    });

    it('badPath_aMissingDocumentIsUndefined', async () => {
        const { documents } = emulators.newWorld();

        await expect(documents.get(FIRESTORE_PATHS.setupOwner, ownerDocSchema)).resolves.toBeUndefined();
    });

    it('badPath_aDocumentItsSchemaRefusesIsNeverWritten', async () => {
        const { db, documents } = emulators.newWorld();
        const refused = { ...invite('u-owner'), role: 'owner' } as unknown as InviteDoc;

        await expect(documents.set(FIRESTORE_PATHS.invite(INVITE_A), inviteDocSchema, refused)).rejects.toMatchObject({
            name: 'InvalidDocumentError',
            path: FIRESTORE_PATHS.invite(INVITE_A),
            issues: [{ path: 'role', code: 'validation.value' }],
        });
        expect((await db.doc(FIRESTORE_PATHS.invite(INVITE_A)).get()).exists).toBe(false);
    });

    it('badPath_aStoredDocumentItsSchemaRefusesIsNeverReturned', async () => {
        const { db, documents } = emulators.newWorld();
        await db.doc(FIRESTORE_PATHS.setupOwner).set({ uid: 'u-owner', claimedAt: 'yesterday' });

        await expect(documents.get(FIRESTORE_PATHS.setupOwner, ownerDocSchema)).rejects.toBeInstanceOf(InvalidDocumentError);
    });

    it('badPath_aSchemaOfSomethingOtherThanAMapIsRefused', async () => {
        const { documents } = emulators.newWorld();

        await expect(documents.set('tmp/not-a-map', isoTimeSchema, '2026-10-12T08:30:00.000Z')).rejects.toBeInstanceOf(TypeError);
    });
});

describe('create and delete', () => {
    it('happyPath_createsOnceThenDeletes', async () => {
        const { db, documents } = emulators.newWorld();
        const owner = { uid: 'u-owner', claimedAt: AT, updatedBy: 'u-owner', updatedAt: AT };

        await documents.create(FIRESTORE_PATHS.setupOwner, ownerDocSchema, owner);
        await documents.delete(FIRESTORE_PATHS.setupOwner);
        await documents.delete(FIRESTORE_PATHS.setupOwner);

        expect((await db.doc(FIRESTORE_PATHS.setupOwner).get()).exists).toBe(false);
    });

    it('badPath_createOfAnExistingDocumentIsAConflict', async () => {
        const { documents } = emulators.newWorld();
        const owner = { uid: 'u-owner', claimedAt: AT, updatedBy: 'u-owner', updatedAt: AT };
        await documents.create(FIRESTORE_PATHS.setupOwner, ownerDocSchema, owner);

        const error = await documents
            .create(FIRESTORE_PATHS.setupOwner, ownerDocSchema, { ...owner, uid: 'u-other' })
            .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(UpstreamError);
        expect(error).toMatchObject({ service: 'firestore', failure: 'conflict', status: 409 });
        await expect(documents.get(FIRESTORE_PATHS.setupOwner, ownerDocSchema)).resolves.toMatchObject({ uid: 'u-owner' });
    });
});

describe('query', () => {
    it('happyPath_filtersOrdersByIdOrFieldAndLimits', async () => {
        const { documents } = emulators.newWorld();
        await documents.set(FIRESTORE_PATHS.invite(INVITE_A), inviteDocSchema, invite('u-one'));
        await documents.set(FIRESTORE_PATHS.invite(INVITE_B), inviteDocSchema, invite('u-two'));
        await documents.set(FIRESTORE_PATHS.invite(INVITE_C), inviteDocSchema, invite('u-two'));

        const byId = await documents.query(FIRESTORE_PATHS.invites, inviteDocSchema, { orderBy: ['__name__', 'asc'], limit: 2 });
        const byField = await documents.query(FIRESTORE_PATHS.invites, inviteDocSchema, { orderBy: ['invitedBy', 'desc'], limit: 1 });
        const filtered = await documents.query(FIRESTORE_PATHS.invites, inviteDocSchema, { where: [['invitedBy', '==', 'u-two']] });

        expect(byId.documents.map((document) => document.id)).toEqual([INVITE_A, INVITE_B]);
        expect(byId.documents[0]).toMatchObject({ path: FIRESTORE_PATHS.invite(INVITE_A), data: { invitedBy: 'u-one' } });
        expect(byField.documents.map((document) => document.data.invitedBy)).toEqual(['u-two']);
        expect(sorted(filtered.documents.map((document) => document.id))).toEqual([INVITE_B, INVITE_C]);
    });

    it('happyPath_aTimestampOperandMatchesStoredTimestampsInARangeAndInAList', async () => {
        const { documents } = emulators.newWorld();
        await documents.set(FIRESTORE_PATHS.invite(INVITE_A), inviteDocSchema, invite('u-one'));
        await documents.set(FIRESTORE_PATHS.invite(INVITE_B), inviteDocSchema, { ...invite('u-two'), createdAt: LATER });

        const since = await documents.query(FIRESTORE_PATHS.invites, inviteDocSchema, { where: [['createdAt', '>=', AT]] });
        const later = await documents.query(FIRESTORE_PATHS.invites, inviteDocSchema, { where: [['createdAt', '>', AT]] });
        const listed = await documents.query(FIRESTORE_PATHS.invites, inviteDocSchema, { where: [['createdAt', 'in', [LATER]]] });

        expect(sorted(since.documents.map((document) => document.id))).toEqual([INVITE_A, INVITE_B]);
        expect(later.documents.map((document) => document.id)).toEqual([INVITE_B]);
        expect(listed.documents.map((document) => document.id)).toEqual([INVITE_B]);
    });

    it('happyPath_countsTheMatchingDocumentsWithoutReadingThem', async () => {
        const { db, documents } = emulators.newWorld();
        await documents.set(FIRESTORE_PATHS.invite(INVITE_A), inviteDocSchema, invite('u-one'));
        await documents.set(FIRESTORE_PATHS.invite(INVITE_B), inviteDocSchema, invite('u-two'));
        // A document its schema would refuse is counted too: the count reads no document.
        await db.doc(FIRESTORE_PATHS.invite(INVITE_C)).set({ role: 'admin', invitedBy: 'u-two' });

        expect(await documents.count(FIRESTORE_PATHS.invites)).toBe(3);
        expect(await documents.count(FIRESTORE_PATHS.invites, [['invitedBy', '==', 'u-two']])).toBe(2);
        expect(await documents.count(FIRESTORE_PATHS.inbox('u-nobody'))).toBe(0);
    });

    it('badPath_documentsTheSchemaRefusesAreListedApart', async () => {
        const { db, documents } = emulators.newWorld();
        await documents.set(FIRESTORE_PATHS.invite(INVITE_A), inviteDocSchema, invite('u-one'));
        await db.doc(FIRESTORE_PATHS.invite(INVITE_B)).set({ role: 'admin' });

        const result = await documents.query(FIRESTORE_PATHS.invites, inviteDocSchema);

        expect(result.documents.map((document) => document.id)).toEqual([INVITE_A]);
        expect(result.invalid.map((document) => [document.id, document.path])).toEqual([[INVITE_B, FIRESTORE_PATHS.invite(INVITE_B)]]);
        expect(result.invalid[0]?.issues).toContainEqual({ path: 'invitedBy', code: 'validation.required' });
    });
});

describe('transaction', () => {
    it('happyPath_readsThenWritesAllOrNothing', async () => {
        const { documents } = emulators.newWorld();
        await documents.set(FIRESTORE_PATHS.invite(INVITE_A), inviteDocSchema, invite('u-one'));

        const read = await documents.transaction(async (transaction) => {
            const found = await transaction.get(FIRESTORE_PATHS.invite(INVITE_A), inviteDocSchema);
            await transaction.create(FIRESTORE_PATHS.invite(INVITE_B), inviteDocSchema, invite('u-two'));
            await transaction.set(FIRESTORE_PATHS.invite(INVITE_C), inviteDocSchema, invite('u-three'));
            await transaction.delete(FIRESTORE_PATHS.invite(INVITE_A));
            return found?.invitedBy;
        });

        expect(read).toBe('u-one');
        const left = await documents.query(FIRESTORE_PATHS.invites, inviteDocSchema);
        expect(sorted(left.documents.map((document) => document.data.invitedBy))).toEqual(['u-three', 'u-two']);
    });

    it('badPath_aCreateOfAnExistingDocumentIsAConflictAndNothingIsWritten', async () => {
        const { documents } = emulators.newWorld();
        await documents.set(FIRESTORE_PATHS.invite(INVITE_A), inviteDocSchema, invite('u-one'));

        const error = await documents
            .transaction(async (transaction) => {
                await transaction.set(FIRESTORE_PATHS.invite(INVITE_B), inviteDocSchema, invite('u-two'));
                await transaction.create(FIRESTORE_PATHS.invite(INVITE_A), inviteDocSchema, invite('u-three'));
            })
            .catch((e: unknown) => e);

        expect(error).toMatchObject({ service: 'firestore', failure: 'conflict' });
        await expect(documents.get(FIRESTORE_PATHS.invite(INVITE_B), inviteDocSchema)).resolves.toBeUndefined();
    });

    it('badPath_aRefusedDocumentOrAThrownErrorAbortsTheTransaction', async () => {
        const { documents } = emulators.newWorld();
        const refused = { ...invite('u-two'), invitedBy: '' };

        await expect(
            documents.transaction((transaction) => transaction.set(FIRESTORE_PATHS.invite(INVITE_B), inviteDocSchema, refused)),
        ).rejects.toBeInstanceOf(InvalidDocumentError);
        await expect(
            documents.transaction(async (transaction) => {
                await transaction.set(FIRESTORE_PATHS.invite(INVITE_C), inviteDocSchema, invite('u-three'));
                throw new RangeError('handler gave up');
            }),
        ).rejects.toThrow('handler gave up');
        expect((await documents.query(FIRESTORE_PATHS.invites, inviteDocSchema)).documents).toEqual([]);
    });

    it('happyPath_aVersionedReadCarriesFirestoresUpdateTimeWhichEveryWriteMoves', async () => {
        const { db, documents } = emulators.newWorld();
        const path = FIRESTORE_PATHS.invite(INVITE_A);
        await documents.set(path, inviteDocSchema, invite('u-one'));
        const readTime = () => documents.transaction((transaction) => transaction.getVersioned(path, inviteDocSchema));

        const first = await readTime();
        await documents.set(path, inviteDocSchema, invite('u-two'));
        const second = await readTime();

        const stored = (await db.doc(path).get()).updateTime;
        expect(first?.data.invitedBy).toBe('u-one');
        expect(second?.updateTime).toBe(formatUpdateTime({ seconds: Number(stored?.seconds), nanoseconds: Number(stored?.nanoseconds) }));
        expect(second?.updateTime).toMatch(/^\d+\.\d{9}$/);
        expect(second?.updateTime).not.toBe(first?.updateTime);
        await expect(
            documents.transaction((transaction) => transaction.getVersioned(FIRESTORE_PATHS.invite(INVITE_B), inviteDocSchema)),
        ).resolves.toBeUndefined();
    });

    it('happyPath_anUpdateTimeKeepsItsNanosecondsToNineDigits', () => {
        expect(formatUpdateTime({ seconds: 1792000000, nanoseconds: 42 })).toBe('1792000000.000000042');
    });
});
