/**
 * `history.revert` (`functions/src/history/revert.ts`, M2-interfaces §3.2) through its callable's `.run()` on the
 * Firestore emulator, with the entries the real history handler records: the client-editable fields come back, the
 * server-owned ones stay, and a version today's schema refuses is never written.
 */
import {
    FIRESTORE_PATHS,
    adminDocSchema,
    cityDocSchema,
    historyEntryDocSchema,
    historyEntryId,
    poiDocSchema,
    timestampFromDate,
    type AuditedDocument,
    type CityDoc,
    type PoiDoc,
} from '@hcm/shared';
import { afterAll, describe, expect, it } from 'vitest';

import { recordHistory, type DocumentChange } from '../../src/history/record.js';
import { revertFunction } from '../../src/history/revert.js';
import { callableRequest, failureOf, googleToken, openEmulators, sorted, type World } from '../admin/world.js';
import { contentDeps } from '../publish/fakes.js';

const emulators = openEmulators('fn-history-revert');

afterAll(async () => {
    await emulators.close();
});

const CITY = 'revert-city';
const ADMIN = 'u-revert-admin';
const POI: AuditedDocument = { entity: 'poi', cityId: CITY, entityId: 'p1' };
const POI_PATH = FIRESTORE_PATHS.poi(CITY, 'p1');
const T1 = timestampFromDate(new Date('2026-10-12T07:00:00.000Z'));
const T2 = timestampFromDate(new Date('2026-10-12T07:30:00.000Z'));
const NOW = timestampFromDate(new Date('2026-10-12T08:30:00.000Z'));

function poi(title: string, overrides: Partial<PoiDoc> = {}): PoiDoc {
    return {
        category: 'monuments',
        geometry: { type: 'Point', point: { lat: 44.43, lng: 26.1 } },
        title: { ro: title },
        published: false,
        createdAt: T1,
        createdBy: 'u-creator',
        updatedBy: 'u-creator',
        updatedAt: T1,
        ...overrides,
    };
}

async function seedAdmin(world: World): Promise<void> {
    await world.documents.set(FIRESTORE_PATHS.admin(ADMIN), adminDocSchema, {
        role: 'admin',
        // M5: an editor of the city whose history is reverted (history.revert is a city callable).
        cities: { [CITY]: 'editor' },
        createdAt: T1,
        updatedBy: ADMIN,
        updatedAt: T1,
    });
}

/** Writes `next` (or deletes the document) and records the change as the trigger would; answers the entry's id. */
async function edit(
    world: World,
    path: string,
    next: Record<string, unknown> | undefined,
    event: { id: string; at: string },
): Promise<string> {
    const before = (await world.db.doc(path).get()).data();
    await (next === undefined ? world.db.doc(path).delete() : world.db.doc(path).set(next));
    const after = (await world.db.doc(path).get()).data();
    const change: DocumentChange = {
        document: path,
        before,
        after,
        eventId: event.id,
        time: new Date(event.at),
        authType: 'unknown',
        authId: ADMIN,
    };
    await recordHistory(world, change);
    return historyEntryId(new Date(event.at), event.id);
}

/** The stored document has exactly the expected fields and values (timestamps compared by their instant). */
function expectDocument(actual: object | undefined, expected: object): void {
    expect(actual).toMatchObject(expected);
    expect(sorted(Object.keys(actual ?? {}))).toEqual(sorted(Object.keys(expected)));
}

function revert(world: World, data: unknown) {
    return revertFunction(() => ({ ...world, blobs: contentDeps().blobs })).run(
        callableRequest(data, { uid: ADMIN, token: googleToken('admin@example.test', { admin: true }) }),
    );
}

describe('history.revert', () => {
    it('happyPath_restoresTheEditedFieldsAndRecordsTheRevertOnce', async () => {
        const world = emulators.newWorld();
        await seedAdmin(world);
        await edit(world, POI_PATH, poi('Unu'), { id: 'e1', at: '2026-10-12T07:00:00.000Z' });
        const update = await edit(world, POI_PATH, poi('Doi', { updatedBy: 'u-editor', updatedAt: T2 }), {
            id: 'e2',
            at: '2026-10-12T07:30:00.000Z',
        });

        const response = await revert(world, { cityId: CITY, entity: 'poi', entityId: 'p1', entryId: update });

        expect(response).toEqual({ restoredFields: ['title'] });
        expectDocument(await world.documents.get(POI_PATH, poiDocSchema), poi('Unu', { updatedBy: ADMIN, updatedAt: NOW }));
        const history = (await world.documents.query(FIRESTORE_PATHS.history(POI), historyEntryDocSchema)).documents;
        expect(history.at(-1)?.data).toMatchObject({
            cityId: CITY,
            action: 'revert',
            revertOf: update,
            previous: { title: { ro: 'Doi' } },
            changedFields: ['title', 'updatedAt', 'updatedBy'],
            updatedBy: ADMIN,
            updatedAt: NOW,
        });
        const before = (await world.db.doc(POI_PATH).get()).data();
        const reverted: DocumentChange = {
            document: POI_PATH,
            before: { ...before, title: { ro: 'Doi' } },
            after: before,
            eventId: 'e3',
            time: new Date('2026-10-12T08:30:01.000Z'),
            authType: 'service_account',
            authId: undefined,
        };
        await expect(recordHistory(world, reverted)).resolves.toBe('skipped');
    });

    it('happyPath_aDeletedDocumentComesBackWithItsServerOwnedFields', async () => {
        const world = emulators.newWorld();
        await seedAdmin(world);
        await edit(world, POI_PATH, poi('Unu'), { id: 'e1', at: '2026-10-12T07:00:00.000Z' });
        const deleted = await edit(world, POI_PATH, undefined, { id: 'e2', at: '2026-10-12T07:30:00.000Z' });

        const response = await revert(world, { cityId: CITY, entity: 'poi', entityId: 'p1', entryId: deleted });

        expect(response.restoredFields).toEqual(['category', 'createdAt', 'createdBy', 'geometry', 'published', 'title']);
        expectDocument(await world.documents.get(POI_PATH, poiDocSchema), poi('Unu', { updatedBy: ADMIN, updatedAt: NOW }));
        const history = (await world.documents.query(FIRESTORE_PATHS.history(POI), historyEntryDocSchema)).documents;
        expect(history.at(-1)?.data).toMatchObject({ action: 'revert', previous: null });
    });

    it('happyPath_aCityRevertKeepsItsCurrentServerOwnedToken', async () => {
        const world = emulators.newWorld();
        await seedAdmin(world);
        const path = FIRESTORE_PATHS.city(CITY);
        const city = (name: string, tokenId: string, updatedAt = T1): CityDoc => ({
            name: { ro: name },
            bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6 },
            mapbox: { user: 'e2e-user', publicTokenId: tokenId },
            published: true,
            updatedBy: ADMIN,
            updatedAt,
        });
        await edit(world, path, city('București', 'oldtoken'), { id: 'e1', at: '2026-10-12T07:00:00.000Z' });
        const renamed = await edit(world, path, city('Bucharest', 'rotatedtoken', T2), { id: 'e2', at: '2026-10-12T07:30:00.000Z' });

        await revert(world, { cityId: CITY, entity: 'city', entityId: CITY, entryId: renamed });

        await expect(world.documents.get(path, cityDocSchema)).resolves.toMatchObject({
            name: { ro: 'București' },
            mapbox: { publicTokenId: 'rotatedtoken' },
        });
    });

    it('badPath_theCreationEntryHasNothingToRestore @S-A23-BAD-CREATION-ENTRY', async () => {
        const world = emulators.newWorld();
        await seedAdmin(world);
        const created = await edit(world, POI_PATH, poi('Unu'), { id: 'e1', at: '2026-10-12T07:00:00.000Z' });

        const failure = await failureOf(revert(world, { cityId: CITY, entity: 'poi', entityId: 'p1', entryId: created }));

        expect(failure).toMatchObject({ code: 'failed-precondition', details: { code: 'apiError.history.nothingToRestore' } });
    });

    it('badPath_aVersionTodaysSchemaRefusesIsNotRestored @S-A23-BAD-INVALID-SNAPSHOT', async () => {
        const world = emulators.newWorld();
        await seedAdmin(world);
        const legacy = { ...poi('Unu'), title: { en: 'English only' }, yearStart: 1700 };
        await edit(world, POI_PATH, legacy, { id: 'e1', at: '2026-10-12T07:00:00.000Z' });
        const update = await edit(world, POI_PATH, poi('Doi', { updatedAt: T2 }), { id: 'e2', at: '2026-10-12T07:30:00.000Z' });

        const failure = await failureOf(revert(world, { cityId: CITY, entity: 'poi', entityId: 'p1', entryId: update }));

        expect(failure).toMatchObject({
            code: 'failed-precondition',
            details: { code: 'apiError.history.invalidSnapshot', params: { count: '2' } },
        });
        expectDocument(await world.documents.get(POI_PATH, poiDocSchema), poi('Doi', { updatedAt: T2 }));
    });

    it('badPath_anUnknownEntryOrAMismatchedCityIsRefused', async () => {
        const world = emulators.newWorld();
        await seedAdmin(world);

        const unknown = await failureOf(revert(world, { cityId: CITY, entity: 'poi', entityId: 'p1', entryId: '1760000000000-nothing' }));
        const mismatched = await failureOf(
            revert(world, { cityId: CITY, entity: 'city', entityId: 'other-city', entryId: '1760000000000-x' }),
        );

        expect([unknown, mismatched]).toMatchObject([
            { code: 'not-found', details: { code: 'apiError.history.notFound' } },
            {
                code: 'invalid-argument',
                details: { code: 'apiError.invalidRequest', issues: [{ path: 'entityId', code: 'validation.reference' }] },
            },
        ]);
    });
});

describe('history.revert: a place keeps its years', () => {
    it('badPath_aVersionWithoutAYearIsNotRestoredOverADatedPlace @S-A32-BAD-PLACE-YEAR', async () => {
        const world = emulators.newWorld();
        await seedAdmin(world);
        await edit(world, POI_PATH, poi('Unu'), { id: 'e1', at: '2026-10-12T07:00:00.000Z' });
        const dated = poi('Doi', { yearStart: 1890, updatedAt: T2 });
        const update = await edit(world, POI_PATH, dated, { id: 'e2', at: '2026-10-12T07:30:00.000Z' });

        const failure = await failureOf(revert(world, { cityId: CITY, entity: 'poi', entityId: 'p1', entryId: update }));

        expect(failure).toMatchObject({ code: 'failed-precondition', details: { code: 'apiError.history.placeYear' } });
        expectDocument(await world.documents.get(POI_PATH, poiDocSchema), dated);
    });

    it('happyPath_anUndatedPlaceAndAnUndoneDeleteStillRestore @S-A32-HAPPY-PLACE-YEAR', async () => {
        const world = emulators.newWorld();
        await seedAdmin(world);
        await edit(world, POI_PATH, poi('Unu'), { id: 'e1', at: '2026-10-12T07:00:00.000Z' });
        const renamed = await edit(world, POI_PATH, poi('Doi', { updatedAt: T2 }), { id: 'e2', at: '2026-10-12T07:30:00.000Z' });
        await revert(world, { cityId: CITY, entity: 'poi', entityId: 'p1', entryId: renamed });
        const deleted = await edit(world, POI_PATH, undefined, { id: 'e4', at: '2026-10-12T08:40:00.000Z' });

        const response = await revert(world, { cityId: CITY, entity: 'poi', entityId: 'p1', entryId: deleted });

        expect(response.restoredFields).toContain('title');
        expect(await world.documents.get(POI_PATH, poiDocSchema)).toMatchObject({ title: { ro: 'Unu' } });
    });
});
