import { FakeContentStore } from '@hcm/test-support/fake-content-store';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { LiveDoc } from '../../src/content/doc.js';
import { isoOf, listAfterFailure, LiveList, LOADING_LIST, type ListState } from '../../src/content/list.js';
import { LiveListener, RECONNECT_DELAYS_MS, type LiveStatus } from '../../src/content/live.js';
import { FakeClock } from '../app/fakes.js';
import { asContentStore, at } from './world.js';

const itemSchema = z.object({ name: z.string(), rank: z.number(), updatedAt: z.custom<unknown>(() => true) });

function seed(store: FakeContentStore, count: number): void {
    for (let index = 0; index < count; index += 1) {
        store.docs.set(`things/t${String(index).padStart(3, '0')}`, {
            name: `t${String(index)}`,
            rank: index,
            updatedAt: at('2026-10-17T10:00:00Z'),
        });
    }
}

describe('LiveListener', () => {
    it('happyPath_aDroppedListenerAttachesAgainAfterAGrowingPauseAndStartsOverOnceItAnswers', () => {
        const clock = new FakeClock();
        const statuses: LiveStatus[] = [];
        const failures: ((failure: { readonly kind: 'unavailable'; readonly code: string }) => void)[] = [];
        let attached = 0;
        const listener = new LiveListener({
            clock,
            attach: (failed) => {
                attached += 1;
                failures.push(failed);
                return () => undefined;
            },
            status: (status) => statuses.push(status),
        });

        listener.start();
        failures.at(-1)?.({ kind: 'unavailable', code: 'unavailable' });
        expect(listener.active).toBe(true);
        clock.advance(RECONNECT_DELAYS_MS[0] ?? 0);
        failures.at(-1)?.({ kind: 'unavailable', code: 'unavailable' });
        clock.advance((RECONNECT_DELAYS_MS[1] ?? 0) - 1);
        expect(attached).toBe(2);
        clock.advance(1);
        listener.answered();
        failures.at(-1)?.({ kind: 'unavailable', code: 'unavailable' });
        clock.advance(RECONNECT_DELAYS_MS[0] ?? 0);

        expect(attached).toBe(4);
        expect(statuses).toHaveLength(3);
        expect(statuses[0]).toEqual({ failure: { kind: 'unavailable', code: 'unavailable' }, retrying: true });
    });

    it('badPath_aRefusalStopsUntilTryAgainAndAnOldAttachmentsFailureIsIgnored', () => {
        const clock = new FakeClock();
        const statuses: LiveStatus[] = [];
        const failures: ((failure: { readonly kind: 'denied' | 'failed'; readonly code: string }) => void)[] = [];
        let detached = 0;
        const listener = new LiveListener({
            clock,
            attach: (failed) => {
                failures.push(failed);
                return () => {
                    detached += 1;
                };
            },
            status: (status) => statuses.push(status),
        });

        listener.start();
        const first = failures[0];
        listener.start();
        first?.({ kind: 'failed', code: 'old' });
        failures[1]?.({ kind: 'denied', code: 'permission-denied' });
        clock.advance(60_000);

        expect(statuses).toEqual([{ failure: { kind: 'denied', code: 'permission-denied' }, retrying: false }]);
        expect(listener.active).toBe(false);
        expect(failures).toHaveLength(2);
        expect(detached).toBe(2);
    });

    it('badPath_aListenerThatFailsWhileAttachingIsDetachedAndRetried', () => {
        const clock = new FakeClock();
        let detached = 0;
        let attempts = 0;
        const listener = new LiveListener({
            clock,
            attach: (failed) => {
                attempts += 1;
                if (attempts === 1) {
                    failed({ kind: 'unavailable', code: 'unavailable' });
                }
                return () => {
                    detached += 1;
                };
            },
            status: () => undefined,
        });

        listener.start();
        clock.advance(RECONNECT_DELAYS_MS[0] ?? 0);
        listener.stop();
        listener.stop();

        expect([attempts, detached]).toEqual([2, 2]);
    });

    it('badPath_stopCancelsAPendingReconnection', () => {
        const clock = new FakeClock();
        let attempts = 0;
        const failures: ((failure: { readonly kind: 'unavailable'; readonly code: string }) => void)[] = [];
        const listener = new LiveListener({
            clock,
            attach: (failed) => {
                attempts += 1;
                failures.push(failed);
                return () => undefined;
            },
            status: () => undefined,
        });
        listener.start();
        failures[0]?.({ kind: 'unavailable', code: 'unavailable' });

        listener.stop();
        clock.advance(60_000);

        expect([attempts, clock.pending, listener.active]).toEqual([1, 0, false]);
    });
});

describe('LiveList', () => {
    function list(store: FakeContentStore, clock = new FakeClock(), pageSize?: number) {
        const states: ListState<string>[] = [];
        const denials = { count: 0 };
        const live = new LiveList<z.infer<typeof itemSchema>, string>({
            ...{ store: asContentStore(store), clock, collection: 'things', schema: itemSchema, map: (doc) => doc.data.name },
            ...(pageSize === undefined ? {} : { pageSize }),
            changed: (state) => states.push(state),
            denied: () => {
                denials.count += 1;
            },
        });
        return { live, states, denials, clock };
    }

    it('happyPath_showsAPageThenMoreFollowsChangesAndStops', () => {
        const store = new FakeContentStore();
        seed(store, 3);
        const { live, states } = list(store, new FakeClock(), 2);

        live.show({ orderBy: [['rank', 'desc']] });
        expect(live.list).toEqual({ status: 'ready', items: ['t2', 't1'], hasMore: true, reconnecting: false, failure: null });
        live.more();
        store.put('things/t999', { name: 'late', rank: 99, updatedAt: at('2026-10-17T10:00:00Z') });
        live.stop();
        store.put('things/t998', { name: 'gone', rank: 98, updatedAt: at('2026-10-17T10:00:00Z') });

        expect(live.list.items).toEqual(['late', 't2', 't1', 't0']);
        expect(states[0]).toEqual(LOADING_LIST);
        expect(store.listeners()).toBe(0);
    });

    it('happyPath_anotherCollectionStartsEmptyAndOfflineAnswersSayReconnecting', () => {
        const store = new FakeContentStore();
        seed(store, 1);
        store.docs.set('other/o1', { name: 'o1', rank: 1, updatedAt: at('2026-10-17T10:00:00Z') });
        const { live, states } = list(store);
        live.show({});

        live.showIn('other', {});
        store.setOffline(true);

        expect(states.at(-1)).toEqual({ status: 'ready', items: ['o1'], hasMore: false, reconnecting: true, failure: null });
        expect(states.some((state) => state.status === 'loading' && state.items.length === 0)).toBe(true);
    });

    it('badPath_aDroppedListenerKeepsTheItemsAndAttachesAgain', () => {
        const store = new FakeContentStore();
        seed(store, 1);
        const { live, clock } = list(store);
        live.show({});

        store.fail('things', { kind: 'unavailable', code: 'unavailable' });
        expect(live.list).toMatchObject({ status: 'ready', items: ['t0'], reconnecting: true });
        clock.advance(RECONNECT_DELAYS_MS[0] ?? 0);

        expect(live.list).toMatchObject({ status: 'ready', items: ['t0'], reconnecting: false, failure: null });
    });

    it('badPath_aRefusalIsAnErrorUntilTryAgainAndAsksWhoThisIs', () => {
        const store = new FakeContentStore();
        seed(store, 1);
        const { live, denials } = list(store);
        live.show({});

        store.fail('things', { kind: 'denied', code: 'permission-denied' });
        expect(live.list).toMatchObject({ status: 'error', failure: { kind: 'denied' }, reconnecting: false });
        live.retry();

        expect(live.list).toMatchObject({ status: 'ready', items: ['t0'] });
        expect(denials.count).toBe(1);
    });

    it('happyPath_listAfterFailureAndIsoOf', () => {
        const failure = { kind: 'failed', code: 'x' } as const;

        expect(listAfterFailure(LOADING_LIST, { failure, retrying: false })).toMatchObject({ status: 'error', failure });
        expect(isoOf(at('2026-10-17T10:00:00.250Z'))).toBe('2026-10-17T10:00:00.250Z');
    });
});

describe('LiveDoc', () => {
    function doc(store: FakeContentStore) {
        const clock = new FakeClock();
        const denials = { count: 0 };
        const live = new LiveDoc({
            store: asContentStore(store),
            clock,
            schema: itemSchema,
            changed: () => undefined,
            denied: () => {
                denials.count += 1;
            },
        });
        return { live, clock, denials };
    }

    it('happyPath_followsTheDocumentUntilItIsDeleted', () => {
        const store = new FakeContentStore();
        seed(store, 1);
        const { live } = doc(store);

        live.show('things/t000');
        expect(live.state.doc?.data.name).toBe('t0');
        expect(live.path).toBe('things/t000');
        store.drop('things/t000');

        expect(live.state).toEqual({ status: 'ready', doc: null, reconnecting: false, failure: null });
        live.stop();
        expect(live.path).toBe('');
    });

    it('badPath_dropsReconnectAndRefusalsAskWhoThisIs', () => {
        const store = new FakeContentStore();
        seed(store, 1);
        const { live, clock, denials } = doc(store);
        live.show('things/t000');

        store.fail('things/t000', { kind: 'unavailable', code: 'unavailable' });
        expect(live.state).toMatchObject({ status: 'ready', reconnecting: true });
        clock.advance(RECONNECT_DELAYS_MS[0] ?? 0);
        store.fail('things/t000', { kind: 'denied', code: 'permission-denied' });
        expect(live.state).toMatchObject({ status: 'error', failure: { kind: 'denied' } });
        live.retry();

        expect(live.state).toMatchObject({ status: 'ready', reconnecting: false });
        expect(denials.count).toBe(1);
    });
});
