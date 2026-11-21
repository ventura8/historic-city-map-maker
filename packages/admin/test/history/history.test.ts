import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { canRevert, changesOf, documentOf, documentOfEntryPath, nameOf, recentQuery, type HistoryItem } from '../../src/history/entries.js';
import { changesFor, HISTORY_MODULE } from '../../src/history/history.js';
import { failure } from '../app/fakes.js';
import { at, CITY, contentWorld, nth } from '../content/world.js';

const POI = { entity: 'poi', cityId: CITY, entityId: 'gara' } as const;
const POI_PATH = `cities/${CITY}/pois/gara`;

function entry(id: string, overrides: Record<string, unknown>): [string, Record<string, unknown>] {
    return [
        FIRESTORE_PATHS.historyEntry(POI, id),
        {
            cityId: CITY,
            entity: 'poi',
            entityId: 'gara',
            action: 'update',
            previous: { title: { ro: 'Gara veche' }, published: true },
            changedFields: ['title'],
            updatedBy: 'admin-uid',
            updatedAt: at('2026-10-17T10:00:00Z'),
            ...overrides,
        },
    ];
}

function world() {
    const base = contentWorld();
    const docs: [string, Record<string, unknown>][] = [
        entry('1760600000000-create', { action: 'create', previous: null, changedFields: [], updatedAt: at('2026-10-16T08:00:00Z') }),
        entry('1760690000000-title', { previous: { title: { ro: 'Gara veche' }, published: true }, updatedAt: at('2026-10-17T08:00:00Z') }),
        entry('1760700000000-pub', {
            previous: { title: { ro: 'Gara de Nord', en: 'North Station' }, published: true },
            changedFields: ['published'],
            updatedAt: at('2026-10-17T10:00:00Z'),
            updatedBy: 'other-uid',
        }),
        [
            `cities/${CITY}/photos/foto/history/1760710000000-del`,
            {
                cityId: CITY,
                entity: 'photo',
                entityId: 'foto',
                action: 'delete',
                previous: { title: { ro: 'Foto' } },
                changedFields: [],
                updatedBy: 'system:photos',
                updatedAt: at('2026-10-17T11:00:00Z'),
            },
        ],
        [
            'cities/cluj/pois/x/history/1760720000000-elsewhere',
            {
                cityId: 'cluj',
                entity: 'poi',
                entityId: 'x',
                action: 'update',
                previous: {},
                changedFields: ['title'],
                updatedBy: 'u',
                updatedAt: at('2026-10-17T12:00:00Z'),
            },
        ],
        [POI_PATH, { title: { ro: 'Gara de Nord' }, published: false, updatedBy: 'other-uid', updatedAt: at('2026-10-17T10:00:00Z') }],
    ];
    for (const [path, data] of docs) {
        base.store.docs.set(path, data);
    }
    base.callables.answer('admins.list', () => ({
        admins: [
            {
                uid: 'other-uid',
                role: 'editor',
                projectOwner: false,
                displayName: 'Ion',
                createdAt: '2026-10-01T00:00:00.000Z',
                self: false,
            },
            { uid: 'quiet-uid', role: 'editor', projectOwner: false, createdAt: '2026-10-01T00:00:00.000Z', self: false },
        ],
        invites: [],
    }));
    return base;
}

async function settled(): Promise<void> {
    for (let round = 0; round < 10; round += 1) {
        await Promise.resolve();
    }
}

describe('history entries', () => {
    it('happyPath_namesQueriesAndDocumentsFromTheAddress', () => {
        expect(nameOf({ label: { ro: 'Biserici', en: 'Churches' } })).toEqual({ ro: 'Biserici', en: 'Churches' });
        expect(nameOf({ name: { ro: 'București' } })).toEqual({ ro: 'București' });
        expect([nameOf(null), nameOf({ title: 'plain' }), nameOf({ title: { ro: 3 } })]).toEqual([null, null, null]);
        expect(recentQuery(CITY, { entity: 'poi', action: 'delete' })).toEqual({
            where: [
                ['cityId', '==', CITY],
                ['entity', '==', 'poi'],
                ['action', '==', 'delete'],
            ],
            orderBy: [['updatedAt', 'desc']],
            group: true,
        });
        expect(documentOf(CITY, 'city', CITY)).toEqual({ entity: 'city', cityId: CITY, entityId: CITY });
        expect([documentOf(CITY, 'city', 'cluj'), documentOf(CITY, 'nope', 'x'), documentOf(CITY, 'poi', 'a b')]).toEqual([
            null,
            null,
            null,
        ]);
        expect(documentOfEntryPath(`${POI_PATH}/history/1760700000000-x`)).toEqual(POI);
        expect(documentOfEntryPath('other/path')).toBeNull();
    });

    it('happyPath_eachEntrysFieldsBeforeAndAfter', () => {
        const item = (overrides: Partial<HistoryItem>): HistoryItem => ({
            ...{ entryId: 'e', path: 'p', entity: 'poi', entityId: 'gara', action: 'update', changedFields: ['title'], by: 'u', at: '' },
            ...{ revertOf: null, previous: { title: 'old' }, name: null },
            ...overrides,
        });
        const entries = [item({ entryId: 'new', previous: { title: 'middle' } }), item({ entryId: 'old', previous: { title: 'old' } })];

        expect(changesOf(entries, 0, { title: 'now' })).toEqual([{ field: 'title', before: 'middle', after: 'now' }]);
        expect(changesOf(entries, 1, { title: 'now' })).toEqual([{ field: 'title', before: 'old', after: 'middle' }]);
        expect(changesOf([item({ action: 'delete', changedFields: [], previous: { a: 1 } })], 0, null)).toEqual([
            { field: 'a', before: 1, after: undefined },
        ]);
        expect(changesOf([item({ action: 'create', changedFields: [], previous: null })], 0, { b: 2 })).toEqual([
            { field: 'b', before: undefined, after: 2 },
        ]);
        expect(changesOf([], 0, null)).toEqual([]);
        expect(changesOf([item({ changedFields: [], previous: null })], 0, null)).toEqual([]);
        expect([canRevert(item({ action: 'create' })), canRevert(item({ action: 'delete' }))]).toEqual([false, true]);
    });
});

describe('the history area', () => {
    it('happyPath_theCitysRecentChangesNewestFirstWithNamesFromTheAdminsList', async () => {
        const { services } = world();
        const history = HISTORY_MODULE.create(services);

        history.open([]);
        await settled();

        expect(history.state.recent.items.map((item) => [item.entity, item.entityId, item.action])).toEqual([
            ['photo', 'foto', 'delete'],
            ['poi', 'gara', 'update'],
            ['poi', 'gara', 'update'],
            ['poi', 'gara', 'create'],
        ]);
        // The creation is named by the version it made: the next entry's (finding 38 of 2026-11-01).
        expect(history.state.recent.items.at(-1)?.name).toEqual({ ro: 'Gara veche' });
        expect(history.state.people).toEqual({ 'other-uid': 'Ion' });
        expect(HISTORY_MODULE.area).toBe('history');
        expect(history.hasUnsavedChanges()).toBe(false);
    });

    it('badPath_otherCitiesEntriesNeverReachThePageNorOfferShowMore', () => {
        const { services, store } = world();
        // A full page of another city's newer entries, and an entry of this city written before entries named their city.
        for (let index = 0; index < 60; index += 1) {
            const id = `p${String(index)}`;
            store.docs.set(`cities/cluj/pois/${id}/history/1760800000000-${id}`, {
                ...{ cityId: 'cluj', entity: 'poi', entityId: id, action: 'delete', previous: {}, changedFields: [] },
                ...{ updatedBy: 'u', updatedAt: at('2026-10-18T12:00:00Z') },
            });
        }
        const [olderPath, older] = entry('1760500000000-older', { updatedAt: at('2026-10-15T08:00:00Z') });
        store.docs.set(olderPath, Object.fromEntries(Object.entries(older).filter(([field]) => field !== 'cityId')));
        const history = HISTORY_MODULE.create(services);

        history.open([]);
        history.intents.setFilter({ action: 'delete' });

        expect(history.state.recent.items.map((item) => item.path)).toEqual([`cities/${CITY}/photos/foto/history/1760710000000-del`]);
        expect(history.state.recent.hasMore).toBe(false);
        history.open(['poi', 'gara']);
        expect(history.state.document?.entries.items.map((item) => item.entryId)).toContain('1760500000000-older');
    });

    it('happyPath_theDeletedFilterAndRestoreCallsTheRevert', async () => {
        const { services, callables, notices } = world();
        callables.answer('history.revert', () => ({ restoredFields: ['title', 'published'] }));
        const history = HISTORY_MODULE.create(services);
        history.open([]);

        history.intents.setFilter({ action: 'delete' });
        const deleted = history.state.recent.items;
        const restored = await history.intents.revert(nth(deleted));
        history.intents.setFilter({ entity: 'poi', action: 'all' });

        expect(deleted.map((item) => item.entityId)).toEqual(['foto']);
        expect(restored).toBe(true);
        expect(callables.calls.at(-1)).toMatchObject({
            name: 'history.revert',
            request: { cityId: CITY, entity: 'photo', entityId: 'foto', entryId: '1760710000000-del' },
        });
        expect(notices).toEqual([{ key: 'adminContent.history.restored', params: { count: '2' } }]);
        expect(history.state.recent.items.every((item) => item.entity === 'poi')).toBe(true);
        history.intents.more();
        expect(history.state.recent.status).toBe('ready');
    });

    it('happyPath_aDocumentsVersionsWithTheSelectedEntrysChanges', () => {
        const { services } = world();
        const history = HISTORY_MODULE.create(services);

        history.open(['poi', 'gara']);
        const newest = history.state.changes;
        history.intents.select('1760690000000-title');
        const older = history.state.changes;

        expect(history.state.document?.entries.items.map((item) => item.entryId)).toEqual([
            '1760700000000-pub',
            '1760690000000-title',
            '1760600000000-create',
        ]);
        expect(history.state.document?.current.doc?.data).toMatchObject({ published: false });
        expect(newest).toEqual([{ field: 'published', before: true, after: false }]);
        expect(older).toEqual([{ field: 'title', before: { ro: 'Gara veche' }, after: { ro: 'Gara de Nord', en: 'North Station' } }]);
        history.open(['poi', 'gara']);
        expect(history.state.selected).toBe('1760690000000-title');
    });

    it('happyPath_aRevertReportsTheRestoredFields', async () => {
        const { services, callables, notices } = world();
        callables.answer('history.revert', () => ({ restoredFields: ['title'] }));
        const history = HISTORY_MODULE.create(services);
        history.open(['poi', 'gara']);

        await expect(history.intents.revert(nth(history.state.document?.entries.items))).resolves.toBe(true);

        expect(notices).toEqual([{ key: 'adminContent.history.reverted', params: { count: '1' } }]);
        expect(history.state.reverting).toBeNull();
    });
});

describe('the history area: refusals and failures', () => {
    it('badPath_aRefusedRevertIsKeptAsAnAlertAndChangesNothing', async () => {
        const { services, callables, store, notices } = world();
        callables.fail('history.revert', failure('failed-precondition', 'apiError.history.invalidSnapshot', { count: '2' }));
        const history = HISTORY_MODULE.create(services);
        history.open(['poi', 'gara']);
        const before = store.docs.get(POI_PATH);

        const item = nth(history.state.document?.entries.items, 1);
        const pending = history.intents.revert(item);
        await expect(history.intents.revert(item)).resolves.toBe(false);
        await expect(pending).resolves.toBe(false);

        expect(history.state.refusal).toEqual({ key: 'apiError.history.invalidSnapshot', params: { count: '2' } });
        expect(store.docs.get(POI_PATH)).toBe(before);
        expect(notices).toEqual([]);
        history.intents.dismissRefusal();
        expect(history.state.refusal).toBeNull();
    });

    it('badPath_anAddressThatNamesNoDocumentIsNotFoundAtOnce', () => {
        const { services, store } = world();
        const history = HISTORY_MODULE.create(services);

        history.open(['city', 'cluj']);

        expect(history.state.document).toMatchObject({ key: 'city/cluj', document: null, entries: { status: 'ready', items: [] } });
        expect(store.listeners()).toBe(0);
    });

    it('badPath_failingListenersRecoverWithTryAgainInBothViews', async () => {
        const { services, store, callables, denials } = world();
        callables.fail('admins.list', failure('internal', 'apiError.internal'));
        const history = HISTORY_MODULE.create(services);
        history.open([]);
        await settled();
        store.fail('history', { kind: 'denied', code: 'permission-denied' });
        history.intents.retry();
        store.fail('history', { kind: 'failed', code: 'failed-precondition' });
        expect(history.state.recent.status).toBe('error');
        history.intents.retry();
        expect(history.state.recent.status).toBe('ready');

        history.open(['poi', 'gara']);
        store.fail(FIRESTORE_PATHS.history(POI), { kind: 'failed', code: 'internal' });
        store.fail(POI_PATH, { kind: 'failed', code: 'internal' });
        expect(history.state.document?.entries.status).toBe('error');
        history.intents.retry();
        history.intents.more();
        expect(history.state.document?.entries.status).toBe('ready');
        expect(history.state.people).toEqual({});
        expect(denials.count).toBe(1);

        history.open([]);
        expect(history.state.document).toBeNull();
        history.destroy();
        expect(store.listeners()).toBe(0);
    });

    it('happyPath_changesForWithoutAView', () => {
        expect(changesFor(null, null)).toEqual([]);
    });

    it('happyPath_subscribersHearChanges', () => {
        const { services } = world();
        const history = HISTORY_MODULE.create(services);
        let heard = 0;
        const stop = history.subscribe(() => {
            heard += 1;
        });
        history.open([]);
        stop();

        expect(heard).toBeGreaterThan(0);
    });
});
