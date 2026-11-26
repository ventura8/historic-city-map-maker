import { describe, expect, it } from 'vitest';

import { bootstrapRecordKey, readBootstrapRecord } from '../../src/setup/bootstrap-record.js';
import { createSetupContext, createSetupStore } from '../../src/setup/context.js';
import { initialSetupState, type SetupState } from '../../src/setup/state.js';
import { PROJECT_ID, createHarness, statusView } from './harness.js';

function setup(mode: 'bootstrap' | 'normal') {
    const harness = createHarness();
    const store = createSetupStore(initialSetupState(harness.host, mode));
    return { harness, store, ctx: createSetupContext(harness.deps, store) };
}

describe('createSetupStore', () => {
    it('happyPath_listenersSeeEveryChangeUntilTheyUnsubscribe', () => {
        const { store } = setup('normal');
        const seen: boolean[] = [];
        const stop = store.subscribe((state) => {
            seen.push(state.checking);
        });

        store.set({ ...store.get(), checking: true });
        stop();
        store.set({ ...store.get(), checking: false });

        expect(seen).toEqual([true]);
    });

    it('badPath_aChangeMadeByAListenerReachesEveryoneAfterwardsNeverOutOfOrder', () => {
        const { store } = setup('normal');
        const seen: string[] = [];
        store.subscribe((state) => {
            if (state.checking && state.openStep === null) {
                store.set({ ...state, openStep: 'mapbox' });
            }
        });
        store.subscribe((state) => {
            seen.push(`${String(state.checking)}:${String(state.openStep)}`);
        });

        store.set({ ...store.get(), checking: true });

        expect(seen).toEqual(['true:mapbox', 'true:mapbox']);
        expect(store.get().openStep).toBe('mapbox');
    });

    it('badPath_aThrowingListenerDoesNotBlockTheNextChange', () => {
        const { store } = setup('normal');
        const seen: SetupState[] = [];
        const stop = store.subscribe(() => {
            throw new Error('listener failed');
        });

        expect(() => {
            store.set({ ...store.get(), checking: true });
        }).toThrow('listener failed');
        stop();
        store.subscribe((state) => seen.push(state));
        store.set({ ...store.get(), checking: false });

        expect(seen).toHaveLength(1);
    });
});

describe('createSetupContext', () => {
    it('happyPath_bootstrapModeMirrorsEveryChangeIntoTheRecordOnceItWasRead', () => {
        const { ctx, harness } = setup('bootstrap');
        ctx.patchStep('claim', { state: 'pending' });
        expect(harness.session.get(bootstrapRecordKey(PROJECT_ID))).toBeNull();

        ctx.mirrorBootstrap();
        ctx.patchStep('billing', { state: 'ok', checkedAt: ctx.nowIso() });

        expect(readBootstrapRecord(harness.session, PROJECT_ID)?.steps.billing).toEqual({
            state: 'ok',
            checkedAt: '2026-10-12T09:00:00.000Z',
        });
    });

    it('happyPath_normalModeWritesNoRecord', () => {
        const { ctx, harness } = setup('normal');

        ctx.patchStep('billing', { state: 'ok', checkedAt: ctx.nowIso() });
        ctx.count('billing', 'inputs');

        expect(harness.session.get(bootstrapRecordKey(PROJECT_ID))).toBeNull();
        expect(ctx.state().steps.billing.used.inputs).toBe(1);
    });

    it('badPath_aFailureShowsOnTheStep_andAnExpiredTokenIsDropped', () => {
        const { ctx, harness } = setup('normal');
        harness.google.grant('cloudPlatform');
        ctx.patchStep('provision', { busy: true });

        ctx.fail('provision', { state: 'unavailable', message: { key: 'adminShell.session.googleExpired' }, expired: true });

        expect(ctx.state().steps.provision).toMatchObject({
            busy: false,
            needsContinue: true,
            error: { key: 'adminShell.session.googleExpired' },
        });
        expect(harness.google.dropped).toBe(1);

        ctx.fail('provision', { state: 'invalid', message: { key: 'apiError.notFound' }, expired: false });
        expect(harness.google.dropped).toBe(1);
        expect(ctx.state().steps.provision.needsContinue).toBe(false);
    });

    it('happyPath_theServersRecordReplacesTheCards', () => {
        const { ctx } = setup('normal');

        ctx.applyStatus(statusView({ mapbox: { state: 'ok', checkedAt: null, user: 'ventura86' } }));

        expect(ctx.state().steps.mapbox.state).toBe('ok');
        expect(ctx.state().mapbox.user).toBe('ventura86');
    });
});
