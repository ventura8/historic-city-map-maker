/**
 * The `history.on*Write` triggers (`functions/src/history/record.ts`, M2-interfaces §2.2) through their v2 `.run()`
 * with real snapshots of the Firestore emulator: one entry per change with the previous version and the change's own
 * stamp, `history.revert`'s own writes skipped, at most `HISTORY_KEEP` entries kept.
 */
import {
    FIRESTORE_PATHS,
    HISTORY_KEEP,
    historyEntryDocSchema,
    historyEntryId,
    timestampFromDate,
    type AuditedDocument,
    type PoiDoc,
} from '@hcm/shared';
import { Timestamp } from 'firebase-admin/firestore';
import { Change, type AuthType, type DocumentSnapshot } from 'firebase-functions/firestore';
import { afterAll, describe, expect, it } from 'vitest';

import { historyTrigger, recordHistory } from '../../src/history/record.js';
import { openEmulators, sorted, type World } from '../admin/world.js';

const emulators = openEmulators('fn-history-record');

afterAll(async () => {
    await emulators.close();
});

const CITY = 'record-city';
const POI: AuditedDocument = { entity: 'poi', cityId: CITY, entityId: 'p1' };
const POI_PATH = FIRESTORE_PATHS.poi(CITY, 'p1');
const T1 = timestampFromDate(new Date('2026-10-12T08:00:00.000Z'));
const T2 = timestampFromDate(new Date('2026-10-12T08:10:00.000Z'));
const EVENT_TIME = '2026-10-12T08:10:00.250Z';

function poi(title: string, updatedBy: string, updatedAt = T1): PoiDoc {
    return {
        category: 'monuments',
        geometry: { type: 'Point', point: { lat: 44.43, lng: 26.1 } },
        title: { ro: title },
        published: false,
        createdAt: T1,
        createdBy: 'u-creator',
        updatedBy,
        updatedAt,
    };
}

interface EventOptions {
    readonly id?: string;
    readonly time?: string;
    readonly authType?: AuthType;
    readonly authId?: string;
}

/** The write event Firestore delivers, around two snapshots read from the emulator. */
function writeEvent(document: string, before: DocumentSnapshot, after: DocumentSnapshot, options: EventOptions = {}) {
    const [, city = '', , id = ''] = document.split('/');
    return {
        specversion: '1.0' as const,
        id: options.id ?? 'e2e-event-1',
        source: '//firestore.googleapis.com/projects/demo-hcm/databases/(default)',
        type: 'google.cloud.firestore.document.v1.written.withAuthContext',
        time: options.time ?? EVENT_TIME,
        location: 'nam5',
        project: 'demo-hcm',
        database: '(default)',
        namespace: '(default)',
        document,
        params: { city, id },
        authType: options.authType ?? 'unknown',
        ...(options.authId === undefined ? {} : { authId: options.authId }),
        data: Change.fromObjects(before, after),
    };
}

/** Writes (or deletes, for `undefined`) the POI and runs the trigger on the change. */
async function change(world: World, next: PoiDoc | Record<string, unknown> | undefined, options: EventOptions = {}): Promise<unknown> {
    const before = await world.db.doc(POI_PATH).get();
    await (next === undefined ? world.db.doc(POI_PATH).delete() : world.db.doc(POI_PATH).set(next));
    const after = await world.db.doc(POI_PATH).get();
    return historyTrigger('history.onPoiWrite', () => world).run(writeEvent(POI_PATH, before, after, options));
}

async function entries(world: World) {
    return (await world.documents.query(FIRESTORE_PATHS.history(POI), historyEntryDocSchema)).documents;
}

describe('history.onPoiWrite: the stamp of a delete', () => {
    it('badPath_aDeleteInTheSecondOfTheLastWriteIsStillItsNewestEntry', async () => {
        const world = emulators.newWorld();
        // The emulator's event times have whole seconds: the delete's says 08:20:00 for a version written at 08:20:00.640.
        await world.db.doc(POI_PATH).set(poi('Unu', 'u-editor', timestampFromDate(new Date('2026-10-12T08:20:00.640Z'))));

        await change(world, undefined, { id: 'e-delete', time: '2026-10-12T08:20:00Z', authId: 'u-deleter' });

        const [deleted] = await entries(world);
        expect(deleted?.data).toMatchObject({ action: 'delete', updatedAt: timestampFromDate(new Date('2026-10-12T08:20:00.641Z')) });
    });
});

describe('history.onPoiWrite', () => {
    it('happyPath_aCreateAnUpdateAndADeleteEachKeepTheVersionBefore', async () => {
        const world = emulators.newWorld();

        await expect(change(world, poi('Unu', 'u-creator'), { id: 'e-create', time: '2026-10-12T08:00:00.100Z' })).resolves.toBe(
            'recorded',
        );
        await expect(change(world, poi('Doi', 'u-editor', T2), { id: 'e-update' })).resolves.toBe('recorded');
        await expect(change(world, undefined, { id: 'e-delete', time: '2026-10-12T08:20:00.000Z', authId: 'u-deleter' })).resolves.toBe(
            'recorded',
        );

        const [created, updated, deleted] = await entries(world);
        expect(created?.id).toBe(historyEntryId(new Date('2026-10-12T08:00:00.100Z'), 'e-create'));
        // Each entry names its city, so the admin's recent changes ask one city's entries (CR-M2c-14).
        expect(created?.data).toMatchObject({ cityId: CITY, entity: 'poi', entityId: 'p1', action: 'create', previous: null });
        expect(created?.data.updatedBy).toBe('u-creator');
        expect(created?.data.changedFields).toEqual(sorted(Object.keys(poi('Unu', 'u-creator'))));
        expect(updated?.data).toMatchObject({
            action: 'update',
            previous: { title: { ro: 'Unu' }, updatedBy: 'u-creator' },
            changedFields: ['title', 'updatedAt', 'updatedBy'],
            updatedBy: 'u-editor',
            updatedAt: T2,
        });
        expect(deleted?.data).toMatchObject({
            action: 'delete',
            previous: { title: { ro: 'Doi' } },
            updatedBy: 'u-deleter',
            updatedAt: timestampFromDate(new Date('2026-10-12T08:20:00.000Z')),
        });
        expect(updated?.data.previous?.['updatedAt']).toBeInstanceOf(Timestamp);
    });

    it('happyPath_aDeleteWithoutAPrincipalIdIsStampedWithItsAuthType', async () => {
        const world = emulators.newWorld();
        await world.db.doc(POI_PATH).set(poi('Unu', 'u-creator'));

        await change(world, undefined, { authType: 'service_account' });

        expect((await entries(world))[0]?.data.updatedBy).toBe('system:service_account');
    });

    it('badPath_aVersionWithoutAValidStampIsStampedByTheEvent', async () => {
        const world = emulators.newWorld();

        await change(world, { title: { ro: 'Fără ștampilă' }, updatedBy: '' }, { authType: 'system' });

        expect((await entries(world))[0]?.data).toMatchObject({
            updatedBy: 'system:system',
            updatedAt: timestampFromDate(new Date(EVENT_TIME)),
        });
    });

    it('happyPath_aRedeliveredEventWritesTheSameEntry', async () => {
        const world = emulators.newWorld();
        const before = await world.db.doc(POI_PATH).get();
        await world.db.doc(POI_PATH).set(poi('Unu', 'u-creator'));
        const event = writeEvent(POI_PATH, before, await world.db.doc(POI_PATH).get());
        const trigger = historyTrigger('history.onPoiWrite', () => world);

        await trigger.run(event);
        await trigger.run(event);

        expect(await entries(world)).toHaveLength(1);
    });

    it('happyPath_theWriteOfARevertIsNotRecordedTwice', async () => {
        const world = emulators.newWorld();
        await world.db.doc(POI_PATH).set(poi('Doi', 'u-editor', T1));
        const revertId = historyEntryId(new Date('2026-10-12T08:10:00.000Z'), 'revert-u-admin');
        await world.documents.set(FIRESTORE_PATHS.historyEntry(POI, revertId), historyEntryDocSchema, {
            entity: 'poi',
            entityId: 'p1',
            action: 'revert',
            previous: poi('Doi', 'u-editor', T1),
            changedFields: ['title', 'updatedAt', 'updatedBy'],
            revertOf: historyEntryId(new Date('2026-10-12T08:00:00.000Z'), 'e-update'),
            updatedBy: 'u-admin',
            updatedAt: T2,
        });

        await expect(change(world, poi('Unu', 'u-admin', T2))).resolves.toBe('skipped');
        await expect(change(world, poi('Trei', 'u-admin', timestampFromDate(new Date('2026-10-12T08:15:00.000Z'))))).resolves.toBe(
            'recorded',
        );

        expect((await entries(world)).map((entry) => entry.data.action)).toEqual(['revert', 'update']);
    });

    it('happyPath_onlyTheNewestEntriesAreKept', async () => {
        const world = emulators.newWorld();
        await world.db.doc(POI_PATH).set(poi('Unu', 'u-creator'));
        const batch = world.db.batch();
        const seeded = HISTORY_KEEP + 4;
        for (let index = 0; index < seeded; index += 1) {
            const at = new Date(Date.UTC(2026, 9, 1, 8, index));
            const entry = { entity: 'poi', entityId: 'p1', action: 'update', previous: {}, changedFields: [], updatedBy: 'u-editor' };
            batch.set(world.db.doc(FIRESTORE_PATHS.historyEntry(POI, historyEntryId(at, `seed-${String(index)}`))), {
                ...entry,
                updatedAt: Timestamp.fromDate(at),
            });
        }
        batch.set(world.db.doc(`${FIRESTORE_PATHS.history(POI)}/0000000000000-invalid`), { action: 'tampered', updatedAt: T1 });
        await batch.commit();

        await expect(change(world, poi('Doi', 'u-editor', T2))).resolves.toBe('recorded');

        const kept = await world.db.collection(FIRESTORE_PATHS.history(POI)).get();
        const ids = sorted(kept.docs.map((document) => document.id));
        expect(ids).toHaveLength(HISTORY_KEEP);
        expect(ids[0]).toBe(historyEntryId(new Date(Date.UTC(2026, 9, 1, 8, 5)), 'seed-5'));
        expect(ids.at(-1)).toBe(historyEntryId(new Date(EVENT_TIME), 'e2e-event-1'));
    });

    it('badPath_aWriteOutsideTheAuditedDocumentsOrWithoutDataIsIgnored', async () => {
        const world = emulators.newWorld();
        const job = FIRESTORE_PATHS.job(CITY, 'j1');
        const snapshot = await world.db.doc(job).get();

        await expect(historyTrigger('history.onPoiWrite', () => world).run(writeEvent(job, snapshot, snapshot))).resolves.toBe('ignored');
        await expect(
            recordHistory(world, {
                document: POI_PATH,
                before: undefined,
                after: undefined,
                eventId: 'e',
                time: new Date(),
                authType: 'unknown',
                authId: undefined,
            }),
        ).resolves.toBe('ignored');
        expect(world.recording.records.map((record) => record.data)).toEqual([{ document: job }, { document: POI_PATH }]);
    });
});

describe('history.onCityWrite', () => {
    it('happyPath_theCityItselfKeepsAHistoryToo', async () => {
        const world = emulators.newWorld();
        const path = FIRESTORE_PATHS.city(CITY);
        const before = await world.db.doc(path).get();
        await world.db.doc(path).set({ name: { ro: 'Oraș' }, published: false, updatedBy: 'u-editor', updatedAt: T1 });
        const after = await world.db.doc(path).get();

        await historyTrigger('history.onCityWrite', () => world).run({ ...writeEvent(path, before, after), params: { city: CITY } });

        const history = await world.documents.query(
            FIRESTORE_PATHS.history({ entity: 'city', cityId: CITY, entityId: CITY }),
            historyEntryDocSchema,
        );
        expect(history.documents.map((entry) => [entry.data.cityId, entry.data.entity, entry.data.action])).toEqual([
            [CITY, 'city', 'create'],
        ]);
    });

    it('happyPath_aWriteOfTheTabIconAloneIsNotListed', async () => {
        const world = emulators.newWorld();
        const path = FIRESTORE_PATHS.city(CITY);
        const city = { name: { ro: 'Oraș' }, published: false, updatedBy: 'u-editor', updatedAt: T1 };
        await world.db.doc(path).set(city);
        const before = await world.db.doc(path).get();
        const icon = {
            source: 'custom',
            url: 'https://storage.googleapis.com/demo-hcm-public/cities/x/icon-180.png',
            sha256: 'a'.repeat(64),
        };
        await world.db.doc(path).set({ ...city, icon: { ...icon, updatedBy: 'u-editor', updatedAt: T2 } });
        const after = await world.db.doc(path).get();

        await expect(
            historyTrigger('history.onCityWrite', () => world).run({ ...writeEvent(path, before, after), params: { city: CITY } }),
        ).resolves.toBe('skipped');
    });

    it('badPath_anIconWrittenWithAnotherFieldIsStillListed', async () => {
        const world = emulators.newWorld();
        const path = FIRESTORE_PATHS.city(CITY);
        await world.db.doc(path).set({ name: { ro: 'Oraș' }, published: false, updatedBy: 'u-editor', updatedAt: T1 });
        const before = await world.db.doc(path).get();
        await world.db
            .doc(path)
            .set({ name: { ro: 'Alt oraș' }, icon: { source: 'default' }, published: false, updatedBy: 'u-editor', updatedAt: T2 });
        const after = await world.db.doc(path).get();

        await expect(
            historyTrigger('history.onCityWrite', () => world).run({ ...writeEvent(path, before, after), params: { city: CITY } }),
        ).resolves.toBe('recorded');
    });
});
