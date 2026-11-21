import type { Schema } from '@hcm/shared';
import { describe, expect, it, vi } from 'vitest';

import { FieldWatch, areaOf, measuredStore } from '../../src/app/field.js';
import type { AdminFieldEvent } from '../../src/app/telemetry.js';
import type { ContentStore, Stored, StoredPage, WriteOutcome } from '../../src/content/services.js';
import { initialTargetView } from '../../src/install/model.js';
import { initialSetupState, withStep, type SetupState } from '../../src/setup/state.js';
import { createHarness } from '../setup/harness.js';

function watch(): { field: FieldWatch; sent: AdminFieldEvent[]; clock: { time: number } } {
    const sent: AdminFieldEvent[] = [];
    const clock = { time: 1000 };
    const field = new FieldWatch(
        (event) => sent.push(event),
        () => clock.time,
    );
    return { field, sent, clock };
}

const setup = (): SetupState => initialSetupState(createHarness().host, 'normal');

describe('the admin field watch', () => {
    it('happyPath_theFirstSignedInShellIsTimedFromTheNavigationOnce', () => {
        const { field, sent, clock } = watch();
        field.observe({ auth: 'starting', setup: null });
        clock.time = 2400.4;
        field.observe({ auth: 'admin', setup: null });
        field.observe({ auth: 'signedOut', setup: null });
        field.observe({ auth: 'admin', setup: null });

        expect(sent).toEqual([{ name: 'admin_ready', params: { duration_ms: 2400, restored: true } }]);
    });

    it('badPath_aShellAfterASignInIsNotRestored', () => {
        const { field, sent } = watch();
        field.observe({ auth: 'signedOut', setup: null });
        field.observe({ auth: 'bootstrap', setup: null });

        expect(sent).toEqual([{ name: 'admin_ready', params: { duration_ms: 1000, restored: false } }]);
    });

    it('happyPath_aStepsCheckIsTimedWithItsOutcomeAndProvisionReportsEachItem', () => {
        const { field, sent, clock } = watch();
        const idle = setup();
        field.observe({ auth: 'admin', setup: idle });
        const busy = withStep(idle, 'provision', { busy: true });
        field.observe({ auth: 'admin', setup: busy });
        clock.time += 5000;
        const items = busy.provision.items.map((item) => ({ ...item, state: item.id === 'iam' ? ('invalid' as const) : ('ok' as const) }));
        const ended = withStep({ ...busy, provision: { items } }, 'provision', {
            busy: false,
            state: 'invalid',
            error: { key: 'apiError.cloud.permission' },
        });
        field.observe({ auth: 'admin', setup: ended });

        const checks = sent.filter((event) => event.name === 'setup_check');
        expect(checks).toEqual([
            {
                name: 'setup_check',
                params: { step: 'provision', outcome: 'invalid', error_code: 'apiError.cloud.permission', duration_ms: 5000 },
            },
        ]);
        const provision = sent.filter((event) => event.name === 'provision_item');
        expect(provision).toHaveLength(items.length);
        expect(provision.find((event) => event.params['item'] === 'iam')?.params).toEqual({ item: 'iam', outcome: 'invalid' });
    });

    it('happyPath_theWholePageCheckIsTimedToo', () => {
        const { field, sent, clock } = watch();
        const idle = setup();
        field.observe({ auth: 'admin', setup: idle });
        field.observe({ auth: 'admin', setup: { ...idle, checking: true } });
        clock.time += 300;
        field.observe({ auth: 'admin', setup: { ...idle, checking: false, ready: true } });

        expect(sent.at(-1)).toEqual({ name: 'setup_check', params: { step: 'all', outcome: 'ready', duration_ms: 300 } });
    });

    it('badPath_aCheckThatEndsWithoutAStartIsNotReported', () => {
        const { field, sent } = watch();
        const busy = withStep(setup(), 'billing', { busy: true });
        field.observe({ auth: 'admin', setup: busy });
        field.observe({ auth: 'admin', setup: withStep(busy, 'billing', { busy: false }) });
        field.observe({ auth: 'admin', setup: { not: 'setup' } });

        expect(sent.filter((event) => event.name === 'setup_check')).toEqual([]);
    });

    it('happyPath_anInstallBuildThatEndsReportsItsDurationAndFailingStep', () => {
        const { field, sent } = watch();
        const before = setup();
        const running = { ...initialTargetView('server'), state: 'working' as const };
        const failed = {
            ...running,
            state: 'failed' as const,
            startedAt: '2026-10-31T10:00:00Z',
            finishedAt: '2026-10-31T10:06:40Z',
            failedStep: 'functions' as const,
        };
        field.observe({ auth: 'admin', setup: { ...before, install: { ...before.install, server: running } } });
        field.observe({ auth: 'admin', setup: { ...before, install: { ...before.install, server: failed } } });

        expect(sent.at(-1)).toEqual({
            name: 'install_build',
            params: { target: 'server', outcome: 'failed', duration_ms: 400_000, failed_step: 'functions' },
        });
    });

    it('badPath_aBuildWithoutTimesStillReportsItsOutcome', () => {
        const { field, sent } = watch();
        const before = setup();
        const running = { ...initialTargetView('site'), state: 'queued' as const };
        const installed = { ...running, state: 'installed' as const, startedAt: 'not a time' };
        field.observe({ auth: 'admin', setup: { ...before, install: { ...before.install, site: running } } });
        field.observe({ auth: 'admin', setup: { ...before, install: { ...before.install, site: installed } } });

        expect(sent.at(-1)).toEqual({ name: 'install_build', params: { target: 'site', outcome: 'installed' } });
    });
});

/** A ContentStore whose writes answer `outcome` (or throw), whose watches hand their listener out. */
function fakeStore(outcome: WriteOutcome | Error) {
    const listeners: { doc?: (doc: Stored<unknown> | null) => void; page?: (page: StoredPage<unknown>) => void } = {};
    const write = (): Promise<WriteOutcome> => (outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome));
    const store: ContentStore = {
        watchDoc: (_path, _schema, listener) => {
            listeners.doc = listener as (doc: Stored<unknown> | null) => void;
            return () => undefined;
        },
        watchQuery: (_collection, _schema, _query, listener) => {
            listeners.page = listener as (page: StoredPage<unknown>) => void;
            return () => undefined;
        },
        count: vi.fn(() => Promise.resolve(3)),
        update: write,
        create: write,
        remove: write,
        batch: write,
        newId: () => 'new-id',
    };
    return { store, listeners };
}

function measured(outcome: WriteOutcome | Error) {
    const sent: AdminFieldEvent[] = [];
    const clock = { now: 100, epoch: Date.parse('2026-10-31T10:10:00Z') };
    const fake = fakeStore(outcome);
    const store = measuredStore(fake.store, { measure: (event) => sent.push(event), now: () => clock.now, epoch: () => clock.epoch });
    return { store, sent, clock, listeners: fake.listeners };
}

const SCHEMA = {} as Schema<unknown>;

function job(id: string, status: string, createdSeconds?: number): Stored<unknown> {
    const createdAt = createdSeconds === undefined ? undefined : { seconds: createdSeconds, nanoseconds: 0 };
    return { id, path: `cities/bucharest/jobs/${id}`, data: { type: 'raster', status, createdAt }, version: 'v', pending: false };
}

function page(...docs: Stored<unknown>[]): StoredPage<unknown> {
    return { docs, invalid: [], hasMore: false, fromCache: false };
}

describe('the measured content store', () => {
    it('happyPath_eachWriteReportsItsAreaOperationOutcomeAndLatency', async () => {
        const { store, sent } = measured({ ok: true });
        await store.update('cities/bucharest/photos/p1', {}, 'v1');
        await store.create('cities/bucharest/pois/x', {});
        await store.remove('cities/bucharest', null);
        await store.batch([{ kind: 'delete', path: 'cities/bucharest/layers/l1' }]);
        await store.batch([]);

        expect(sent.map((event) => event.params)).toEqual([
            { area: 'photos', operation: 'update', outcome: 'ok', duration_ms: 0 },
            { area: 'pois', operation: 'create', outcome: 'ok', duration_ms: 0 },
            { area: 'city', operation: 'remove', outcome: 'ok', duration_ms: 0 },
            { area: 'layers', operation: 'batch', outcome: 'ok', duration_ms: 0 },
            { area: 'other', operation: 'batch', outcome: 'ok', duration_ms: 0 },
        ]);
        expect(store.newId()).toBe('new-id');
        expect(await store.count('cities/bucharest/photos', {})).toBe(3);
    });

    it('badPath_aRefusedOrThrowingWriteReportsWhy', async () => {
        const conflict = measured({ ok: false, reason: 'conflict' });
        await conflict.store.update('cities/bucharest/photos/p1', {}, 'v1');
        const failing = measured(new Error('offline'));
        await expect(failing.store.update('admins/uid', {}, null)).rejects.toThrow('offline');

        expect(conflict.sent[0]?.params).toMatchObject({ outcome: 'conflict' });
        expect(failing.sent[0]?.params).toMatchObject({ area: 'admins', outcome: 'error' });
        expect(areaOf('a b/c')).toBe('other');
    });

    it('happyPath_aJobSeenUnfinishedThenDoneIsTimedFromItsCreation', () => {
        const { store, sent, listeners } = measured({ ok: true });
        const heard: unknown[] = [];
        store.watchQuery('cities/bucharest/jobs', SCHEMA, {}, (list) => heard.push(list), vi.fn());
        const created = Date.parse('2026-10-31T10:00:00Z') / 1000;
        listeners.page?.(page(job('j1', 'running', created), job('j2', 'succeeded', created)));
        listeners.page?.(page(job('j1', 'succeeded', created), job('j2', 'succeeded', created)));
        listeners.page?.(page(job('j1', 'succeeded', created)));

        expect(sent).toEqual([{ name: 'job_done', params: { job_type: 'raster', status: 'succeeded', duration_ms: 600_000 } }]);
        expect(heard).toHaveLength(3);
    });

    it('badPath_aJobDocWithoutACreationTimeIsZeroAndOtherWatchesPassThrough', () => {
        const { store, sent, listeners } = measured({ ok: true });
        const heard: unknown[] = [];
        store.watchDoc('cities/bucharest/jobs/j9', SCHEMA, (doc) => heard.push(doc), vi.fn());
        listeners.doc?.(job('j9', 'queued'));
        listeners.doc?.(null);
        listeners.doc?.(job('j9', 'failed'));
        store.watchDoc('cities/bucharest/photos/p1', SCHEMA, (doc) => heard.push(doc), vi.fn());
        listeners.doc?.(job('p1', 'failed'));
        store.watchQuery('cities/bucharest/photos', SCHEMA, {}, (list) => heard.push(list), vi.fn());
        listeners.page?.(page(job('p2', 'running'), job('p2', 'failed')));

        expect(sent).toEqual([{ name: 'job_done', params: { job_type: 'raster', status: 'failed', duration_ms: 0 } }]);
        expect(heard).toHaveLength(5);
    });
});
