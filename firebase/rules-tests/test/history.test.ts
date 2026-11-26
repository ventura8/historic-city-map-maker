/**
 * `<audited document>/history/{entry}` (PLAN Addendum 3, docs/research/M2-interfaces.md §2.2): the history.* triggers
 * and history.revert write it with the Admin SDK, each entry naming its city (`cityId`, CR-M2c-14); admins read it,
 * newest first, one city's entries at a time across the collection group, and no client creates, edits or deletes an
 * entry, not even an admin (S-A23-BAD-CLIENT-WRITE).
 */
import { FIRESTORE_PATHS, HISTORY_ENTITIES, historyEntryId, type HistoryEntity } from '@hcm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { historyEntryDoc } from './support/documents.js';
import { EVERYONE, createWorld, expected, stampedBy, verdict, verdicts, type Persona, type World } from './support/world.js';

const CITY_ID = 'rules-history';
const OTHER_CITY_ID = 'rules-history-other';
const ENTRY_ID = historyEntryId(new Date(Date.UTC(2026, 9, 12)), 'event-1');

let world: World;

function historyOf(entity: HistoryEntity): string {
    return FIRESTORE_PATHS.history({ entity, cityId: CITY_ID, entityId: entity === 'city' ? CITY_ID : `${entity}-1` });
}

beforeAll(async () => {
    world = await createWorld('history');
    const entry = historyEntryDoc(world.uid('admin'), CITY_ID);
    const seeds = HISTORY_ENTITIES.flatMap((entity) =>
        [ENTRY_ID, `${ENTRY_ID}x`].map((id) => world.seed(`${historyOf(entity)}/${id}`, entry)),
    );
    const other = FIRESTORE_PATHS.history({ entity: 'poi', cityId: OTHER_CITY_ID, entityId: 'poi-1' });
    await Promise.all([...seeds, world.seed(`${other}/${ENTRY_ID}`, historyEntryDoc(world.uid('admin'), OTHER_CITY_ID))]);
});

afterAll(async () => {
    await world.close();
});

describe("the city's recent changes", () => {
    it('happyPath_onlyAdminsQueryOneCitysHistoryAtOnceNewestFirst', async () => {
        const city = (persona: Persona) => world.db(persona).collectionGroup('history').where('cityId', '==', CITY_ID);
        const recent = await verdicts(EVERYONE, (persona) => city(persona).orderBy('updatedAt', 'desc').limit(50).get());
        const deleted = await verdicts(EVERYONE, (persona) =>
            city(persona).where('entity', '==', 'poi').where('action', '==', 'delete').orderBy('updatedAt', 'desc').get(),
        );

        expect({ recent, deleted }).toEqual({ recent: expected(EVERYONE, ['admin']), deleted: expected(EVERYONE, ['admin']) });
    });

    it('badPath_anotherCitysEntriesNeverAnswerTheCitysQuery', async () => {
        const answer = await world.db('admin').collectionGroup('history').where('cityId', '==', CITY_ID).orderBy('updatedAt', 'desc').get();
        const paths = answer.docs.map((doc) => doc.ref.path);

        expect(paths).toHaveLength(HISTORY_ENTITIES.length * 2);
        expect(paths.filter((path) => !path.startsWith(`cities/${CITY_ID}/`))).toEqual([]);
    });

    it('badPath_noClientWritesAnEntryThroughTheCollectionGroupEither', async () => {
        const db = world.db('admin');
        const forged = { ...historyEntryDoc(world.uid('admin')), ...stampedBy(world.uid('admin')) };

        const create = await verdict(db.doc(`elsewhere/x/history/${ENTRY_ID}`).set(forged));

        expect(create).toBe('deny');
    });
});

describe.each(HISTORY_ENTITIES)('history of a %s', (entity) => {
    it('happyPath_onlyAdminsReadTheHistoryNewestFirst', async () => {
        const entries = await verdicts(EVERYONE, (persona) =>
            world.db(persona).collection(historyOf(entity)).orderBy('updatedAt', 'desc').get(),
        );
        const entry = await verdicts(EVERYONE, (persona) =>
            world
                .db(persona)
                .doc(`${historyOf(entity)}/${ENTRY_ID}`)
                .get(),
        );

        expect({ entries, entry }).toEqual({ entries: expected(EVERYONE, ['admin']), entry: expected(EVERYONE, ['admin']) });
    });

    it('badPath_noClientCreatesChangesOrDeletesAnEntry @S-A23-BAD-CLIENT-WRITE', async () => {
        const db = world.db('admin');
        const forged = { ...historyEntryDoc(world.uid('admin')), ...stampedBy(world.uid('admin')) };

        const create = await verdict(db.doc(`${historyOf(entity)}/forged`).set(forged));
        const update = await verdict(
            db.doc(`${historyOf(entity)}/${ENTRY_ID}`).update({ action: 'revert', ...stampedBy(world.uid('admin')) }),
        );
        const remove = await verdict(db.doc(`${historyOf(entity)}/${ENTRY_ID}x`).delete());

        expect({ create, update, remove }).toEqual({ create: 'deny', update: 'deny', remove: 'deny' });
    });
});
