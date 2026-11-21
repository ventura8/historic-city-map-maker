import { createLogger } from '@hcm/shared';
import { createRecordingSink } from '@hcm/test-support';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { contentStore, failureOf, versionOf, writeFailureOf } from '../../src/firebase/content.js';
import type { ContentSdk } from '../../src/firebase/content-sdk.js';
import { at } from '../content/world.js';

const schema = z.object({ name: z.string(), updatedAt: z.unknown() });
const UPDATED = at('2026-10-17T10:00:00Z');
const VERSION = '2026-10-17T10:00:00.000Z';

function docSnapshot(path: string, data: Record<string, unknown> | null, pending = false, fromCache = false) {
    return {
        id: path.split('/').at(-1),
        ref: { path },
        metadata: { hasPendingWrites: pending, fromCache },
        exists: () => data !== null,
        data: vi.fn(() => data ?? undefined),
    };
}

interface Observer {
    readonly next: (snapshot: unknown) => void;
    readonly error: (error: unknown) => void;
}

/** A fake SDK table: references are plain objects, listeners are kept to be driven by the test, writes recorded. */
function world(options: { readonly server?: Record<string, Record<string, unknown>>; readonly transactionError?: string } = {}) {
    const server = options.server ?? {};
    const recording = createRecordingSink();
    const observers: Observer[] = [];
    const ops: unknown[] = [];
    const commit = vi.fn(() => Promise.resolve());
    const sdk = {
        doc: vi.fn((_parent: unknown, path?: string) => (path === undefined ? { id: 'generated-id' } : { path })),
        collection: vi.fn((_db: unknown, path: string) => ({ collection: path })),
        collectionGroup: vi.fn((_db: unknown, id: string) => ({ group: id })),
        where: vi.fn((field: string, op: string, value: unknown) => ({ where: [field, op, value] })),
        orderBy: vi.fn((field: string, direction: string) => ({ orderBy: [field, direction] })),
        limit: vi.fn((count: number) => ({ limit: count })),
        query: vi.fn((source: unknown, ...constraints: unknown[]) => ({ source, constraints })),
        onSnapshot: vi.fn((_ref: unknown, ...rest: unknown[]) => {
            observers.push(rest.at(-1) as Observer);
            return () => undefined;
        }),
        getCountFromServer: vi.fn((query: { readonly source: { readonly collection?: string } }) =>
            query.source.collection === 'broken' ? Promise.reject(new Error('down')) : Promise.resolve({ data: () => ({ count: 7 }) }),
        ),
        runTransaction: vi.fn(async (_db: unknown, update: (transaction: unknown) => Promise<unknown>) => {
            if (options.transactionError !== undefined) {
                throw Object.assign(new Error('transaction failed'), { code: options.transactionError });
            }
            const transaction = {
                get: (ref: { readonly path: string }) => Promise.resolve(docSnapshot(ref.path, server[ref.path] ?? null)),
                update: (ref: { readonly path: string }, data: unknown) => ops.push(['update', ref.path, data]),
                set: (ref: { readonly path: string }, data: unknown) => ops.push(['set', ref.path, data]),
                delete: (ref: { readonly path: string }) => ops.push(['delete', ref.path]),
            };
            return update(transaction);
        }),
        writeBatch: vi.fn(() => ({
            set: (ref: { readonly path: string }, data: unknown) => ops.push(['batch-set', ref.path, data]),
            update: (ref: { readonly path: string }, data: unknown) => ops.push(['batch-update', ref.path, data]),
            delete: (ref: { readonly path: string }) => ops.push(['batch-delete', ref.path]),
            commit,
        })),
        serverTimestamp: vi.fn(() => 'SERVER_TIME'),
        deleteField: vi.fn(() => 'DELETE_FIELD'),
    };
    const uid = { current: 'admin-uid' as string | null };
    const log = createLogger('store-test', { sink: recording.sink });
    const store = contentStore({ sdk: sdk as unknown as ContentSdk, firestore: () => ({}) as never, uid: () => uid.current, log });
    return { store, sdk, observers, ops, commit, uid, logged: recording.records };
}

describe('the Firestore ContentStore', () => {
    it('happyPath_aDocumentAndItsChangesValidatedWithTheirVersion', () => {
        const { store, observers } = world();
        const seen: unknown[] = [];
        const failures: unknown[] = [];

        store.watchDoc(
            'cities/b/photos/p',
            schema,
            (doc) => seen.push(doc),
            (failure) => failures.push(failure),
        );
        observers[0]?.next(docSnapshot('cities/b/photos/p', { name: 'Gara', updatedAt: UPDATED }, true));
        observers[0]?.next(docSnapshot('cities/b/photos/p', null));
        observers[0]?.next(docSnapshot('cities/b/photos/p', { name: 3 }));
        observers[0]?.error({ code: 'permission-denied' });

        expect(seen).toEqual([
            { id: 'p', path: 'cities/b/photos/p', data: { name: 'Gara', updatedAt: UPDATED }, version: VERSION, pending: true },
            null,
        ]);
        expect(failures).toEqual([
            { kind: 'failed', code: 'invalid-document' },
            { kind: 'denied', code: 'permission-denied' },
        ]);
    });

    it('badPath_aCachedCopyThatFailsItsSchemaWaitsForTheServersAnswer', () => {
        const { store, observers, logged } = world();
        const seen: unknown[] = [];
        const failures: unknown[] = [];

        store.watchDoc(
            'cities/b/photos/p',
            schema,
            (doc) => seen.push(doc),
            (failure) => failures.push(failure),
        );
        observers[0]?.next(docSnapshot('cities/b/photos/p', { name: 3 }, false, true));
        expect([seen, failures, logged]).toEqual([[], [], []]);

        observers[0]?.next(docSnapshot('cities/b/photos/p', { name: 'Gara', updatedAt: UPDATED }));
        expect(seen).toHaveLength(1);
        expect(failures).toEqual([]);
    });

    it('happyPath_aQueryPageWithItsInvalidDocumentsApartAndItsConstraints', () => {
        const { store, observers, sdk } = world();
        const pages: unknown[] = [];

        store.watchQuery(
            'history',
            schema,
            { where: [['action', '==', 'delete']], orderBy: [['updatedAt', 'desc']], limit: 2, group: true },
            (page) => pages.push(page),
            () => undefined,
        );
        observers[0]?.next({
            docs: [docSnapshot('a/1', { name: 'one', updatedAt: UPDATED }), docSnapshot('a/2', { name: 7, updatedAt: UPDATED })],
            size: 2,
            metadata: { fromCache: true },
        });
        store.watchQuery(
            'cities/b/jobs',
            schema,
            {},
            () => undefined,
            () => undefined,
        );

        expect(pages).toEqual([
            {
                docs: [{ id: '1', path: 'a/1', data: { name: 'one', updatedAt: UPDATED }, version: VERSION, pending: false }],
                invalid: [{ path: 'a/2', issues: [{ path: 'name', code: 'validation.type' }] }],
                hasMore: true,
                fromCache: true,
            },
        ]);
        expect(sdk.collectionGroup).toHaveBeenCalledWith({}, 'history');
        expect(sdk.limit.mock.calls).toEqual([[2], [50]]);
        expect(sdk.onSnapshot.mock.calls[0]?.[1]).toEqual({ includeMetadataChanges: true });
    });

    it('badPath_aQueryListenerThatFailsSaysWhy', () => {
        const { store, observers } = world();
        const failures: unknown[] = [];
        store.watchQuery(
            'x',
            schema,
            {},
            () => undefined,
            (failure) => failures.push(failure),
        );

        observers[0]?.error({ code: 'firestore/unavailable' });

        expect(failures).toEqual([{ kind: 'unavailable', code: 'unavailable' }]);
    });

    it('happyPath_countsWithoutALimitAndNullWhenTheCountFails', async () => {
        const { store, sdk } = world();

        await expect(store.count('cities/b/photos', { where: [['published', '==', false]] })).resolves.toBe(7);
        await expect(store.count('broken', {})).resolves.toBeNull();
        expect(sdk.limit).not.toHaveBeenCalled();
    });
});

describe('the Firestore ContentStore: writes', () => {
    it('happyPath_anUpdateInATransactionStampedWhenTheVersionStillMatches', async () => {
        const { store, ops } = world({ server: { 'cities/b/pois/x': { name: 'old', updatedAt: UPDATED } } });

        await expect(store.update('cities/b/pois/x', { name: 'new' }, VERSION)).resolves.toEqual({ ok: true });
        await expect(store.update('cities/b/pois/x', { name: 'newer', yearEnd: undefined }, null)).resolves.toEqual({ ok: true });
        await expect(store.update('cities/b/pois/x', { name: 'late' }, '2026-01-01T00:00:00.000Z')).resolves.toEqual({
            ok: false,
            reason: 'conflict',
        });
        await expect(store.update('cities/b/pois/gone', { name: 'late' }, VERSION)).resolves.toEqual({ ok: false, reason: 'gone' });

        expect(ops).toEqual([
            ['update', 'cities/b/pois/x', { name: 'new', updatedBy: 'admin-uid', updatedAt: 'SERVER_TIME' }],
            ['update', 'cities/b/pois/x', { name: 'newer', yearEnd: 'DELETE_FIELD', updatedBy: 'admin-uid', updatedAt: 'SERVER_TIME' }],
        ]);
    });

    it('badPath_aCreateThatFindsItsOwnLandedAttemptSucceedsAndAnyOtherDocumentIsAConflict', async () => {
        const mine = { title: { ro: 'Gara de Nord', en: undefined }, location: { lng: 26.1, lat: 44.45 }, tags: ['a', 1], note: undefined };
        const { store, ops } = world({
            server: {
                'cities/b/photos/landed': {
                    location: { lat: 44.45, lng: 26.1 },
                    title: { ro: 'Gara de Nord' },
                    tags: ['a', 1],
                    updatedBy: 'admin-uid',
                },
                'cities/b/photos/theirs': { ...mine, updatedBy: 'someone-else' },
                'cities/b/photos/changed': { ...mine, tags: ['b'], updatedBy: 'admin-uid' },
            },
        });

        // Its commit landed while its answer was an error: the transaction runs again and finds its own document.
        await expect(store.create('cities/b/photos/landed', mine, { withCreator: true })).resolves.toEqual({ ok: true });
        await expect(store.create('cities/b/photos/theirs', mine)).resolves.toEqual({ ok: false, reason: 'conflict' });
        await expect(store.create('cities/b/photos/changed', mine)).resolves.toEqual({ ok: false, reason: 'conflict' });
        expect(ops).toEqual([]);
    });

    it('happyPath_createAndRemoveRefuseWhatTheyMustNot', async () => {
        const { store, ops } = world({ server: { 'cities/b/pois/x': { name: 'here', updatedAt: UPDATED } } });

        await expect(store.create('cities/b/pois/x', { name: 'again' })).resolves.toEqual({ ok: false, reason: 'conflict' });
        await expect(store.create('cities/b/pois/y', { name: 'y' }, { withCreator: true })).resolves.toEqual({ ok: true });
        await expect(store.create('cities/b/poiCategories/c', { label: 'c' })).resolves.toEqual({ ok: true });
        await expect(store.remove('cities/b/pois/x', '2026-01-01T00:00:00.000Z')).resolves.toEqual({ ok: false, reason: 'conflict' });
        await expect(store.remove('cities/b/pois/gone', null)).resolves.toEqual({ ok: false, reason: 'gone' });
        await expect(store.remove('cities/b/pois/x', VERSION)).resolves.toEqual({ ok: true });

        expect(ops).toEqual([
            [
                'set',
                'cities/b/pois/y',
                { name: 'y', updatedBy: 'admin-uid', updatedAt: 'SERVER_TIME', createdAt: 'SERVER_TIME', createdBy: 'admin-uid' },
            ],
            ['set', 'cities/b/poiCategories/c', { label: 'c', updatedBy: 'admin-uid', updatedAt: 'SERVER_TIME', createdAt: 'SERVER_TIME' }],
            ['delete', 'cities/b/pois/x'],
        ]);
    });

    it('happyPath_aBatchStampsEveryWrite', async () => {
        const { store, ops, commit } = world();

        const outcome = await store.batch([
            { kind: 'create', path: 'p/1', data: { a: 1 }, withCreator: true },
            { kind: 'update', path: 'p/2', fields: { b: 2, c: undefined } },
            { kind: 'delete', path: 'p/3' },
        ]);

        expect(outcome).toEqual({ ok: true });
        expect(commit).toHaveBeenCalledTimes(1);
        expect(ops).toEqual([
            [
                'batch-set',
                'p/1',
                { a: 1, updatedBy: 'admin-uid', updatedAt: 'SERVER_TIME', createdAt: 'SERVER_TIME', createdBy: 'admin-uid' },
            ],
            ['batch-update', 'p/2', { b: 2, c: 'DELETE_FIELD', updatedBy: 'admin-uid', updatedAt: 'SERVER_TIME' }],
            ['batch-delete', 'p/3'],
        ]);
    });

    it('badPath_signedOutWritesAreRefusedAndFailuresMapToTheirReasons', async () => {
        const { store, uid, commit } = world();
        uid.current = null;
        await expect(store.update('p/1', {}, null)).resolves.toEqual({ ok: false, reason: 'denied' });
        await expect(store.batch([])).resolves.toEqual({ ok: false, reason: 'denied' });

        uid.current = 'admin-uid';
        commit.mockRejectedValueOnce({ code: 'permission-denied' });
        await expect(store.batch([])).resolves.toEqual({ ok: false, reason: 'denied' });
        const offline = world({ transactionError: 'unavailable' });
        await expect(offline.store.update('p/1', {}, null)).resolves.toEqual({ ok: false, reason: 'offline' });
        await expect(world({ transactionError: 'aborted' }).store.remove('p/1', null)).resolves.toEqual({
            ok: false,
            reason: 'conflict',
        });
    });

    it('happyPath_newIdsAndTheMappings', () => {
        const { store } = world();

        expect(store.newId()).toBe('generated-id');
        expect([failureOf(null), failureOf({ code: 42 }), failureOf({ code: 'internal' })]).toEqual([
            { kind: 'failed', code: 'unknown' },
            { kind: 'failed', code: 'unknown' },
            { kind: 'failed', code: 'internal' },
        ]);
        expect([
            writeFailureOf({ code: 'not-found' }),
            writeFailureOf({ code: 'invalid-argument' }),
            writeFailureOf(new Error('x')),
        ]).toEqual([
            { ok: false, reason: 'gone' },
            { ok: false, reason: 'invalid' },
            { ok: false, reason: 'offline' },
        ]);
        expect([versionOf(undefined), versionOf({ updatedAt: 'nope' })]).toEqual(['', '']);
    });
});

describe('the Firestore ContentStore and a document it refuses', () => {
    it('badPath_aDocumentThatFailsItsSchemaIsLoggedWithItsFailingFieldsOnce', () => {
        // Finding 62 of 2026-11-02: the version page said only "could not be read"; the log names the fields, never values.
        const { store, observers, logged } = world();
        const strict = z.strictObject({ name: z.string(), size: z.number().max(10) });

        store.watchDoc(
            'cities/b/layerVersions/v',
            strict,
            () => undefined,
            () => undefined,
        );
        observers[0]?.next(docSnapshot('cities/b/layerVersions/v', { name: 'scan', size: 300_000, extra: 'secret-value' }));
        observers[0]?.next(docSnapshot('cities/b/layerVersions/v', { name: 'scan', size: 300_000, extra: 'secret-value' }));
        store.watchQuery(
            'cities/b/layerVersions',
            strict,
            {},
            () => undefined,
            () => undefined,
        );
        observers[1]?.next({
            docs: [docSnapshot('cities/b/layerVersions/w', { name: 4, size: 1 })],
            size: 1,
            metadata: { fromCache: false },
        });

        expect(logged.map(({ level, message, data }) => ({ level, message, data }))).toEqual([
            {
                level: 'warn',
                message: 'a document does not match its schema and is not shown',
                data: { path: 'cities/b/layerVersions/v', fields: 'size validation.tooBig; extra validation.unknownKey' },
            },
            {
                level: 'warn',
                message: 'a document does not match its schema and is not shown',
                data: { path: 'cities/b/layerVersions/w', fields: 'name validation.type' },
            },
        ]);
        expect(JSON.stringify(logged)).not.toContain('secret-value');
    });

    it('happyPath_aStoreWithoutALogStillRefusesTheDocument', () => {
        const failures: unknown[] = [];
        const observers: Observer[] = [];
        const sdk = {
            doc: (_db: unknown, path: string) => ({ path }),
            onSnapshot: (_ref: unknown, _options: unknown, observer: Observer) => {
                observers.push(observer);
                return () => undefined;
            },
        };
        const store = contentStore({ sdk: sdk as unknown as ContentSdk, firestore: () => ({}) as never, uid: () => null });

        store.watchDoc(
            'a/1',
            schema,
            () => undefined,
            (failure) => failures.push(failure),
        );
        observers[0]?.next(docSnapshot('a/1', { name: 1 }));

        expect(failures).toEqual([{ kind: 'failed', code: 'invalid-document' }]);
    });
});
