import { describe, expect, it, vi } from 'vitest';

import { createSetupContext, createSetupStore } from '../../src/setup/context.js';
import { createDeployFlow } from '../../src/setup/deploy.js';
import { initialSetupState, withStep, type SetupMode } from '../../src/setup/state.js';
import { access, createHarness, flush, googleError } from './harness.js';

function setup(mode: SetupMode = 'bootstrap') {
    const harness = createHarness();
    const base = ['signIn', 'billing', 'provision'].reduce(
        (state, id) => withStep(state, id as 'signIn', { state: 'ok' }),
        initialSetupState(harness.host, mode),
    );
    const ctx = createSetupContext(harness.deps, createSetupStore({ ...base, openStep: 'deploy' }));
    const onDeployed = vi.fn(() => Promise.resolve());
    return { harness, ctx, onDeployed, flow: createDeployFlow(ctx, onDeployed) };
}

describe('deploy: watching', () => {
    it('happyPath_everyFunctionActiveAndTheServerAnsweringFinishTheStep', async () => {
        const { harness, ctx, onDeployed, flow } = setup();
        harness.google.grant('cloudPlatform');
        harness.cloud.deployment.mockResolvedValueOnce({ ready: 10, total: 32, failed: [] });
        harness.cloud.deployment.mockResolvedValueOnce({ ready: 32, total: 32, failed: [] });

        flow.watch();
        await flush();
        // The count is the card body's, said once (finding 7 of 2026-10-25): the step itself names no reason.
        expect(ctx.state().steps.deploy).toMatchObject({ state: 'pending', detail: null });
        expect(ctx.state().deploy).toMatchObject({ ready: 10, total: 32, watching: true });

        await harness.clock.advance(30_000);

        expect(harness.host.serverDeployed).toHaveBeenCalledTimes(1);
        expect(ctx.state().steps.deploy).toMatchObject({ state: 'ok', detail: null });
        expect(ctx.state().steps.claim).toMatchObject({ state: 'pending', detail: { key: 'adminSetup.claim.automatic' } });
        expect(ctx.state().deploy.watching).toBe(false);
        expect(onDeployed).toHaveBeenCalledTimes(1);
        expect(harness.clock.pending()).toBe(0);
        expect(ctx.state().steps.deploy.used).toEqual({ inputs: 0, consents: 0 });
    });

    it('badPath_inAnAdminSessionALookLeavesTheClaimDone', async () => {
        // Finding 4 of the M6 review: Check again or Install the server on step (d) put the claim back to waiting, and
        // closed steps (e) to (i), which wait for it.
        const { harness, ctx, flow } = setup('normal');
        ctx.patchStep('claim', { state: 'ok' });
        harness.google.grant('cloudPlatform');
        harness.cloud.deployment.mockResolvedValue({ ready: 32, total: 32, failed: [] });

        flow.watch();
        await flush();

        expect(ctx.state().steps.deploy.state).toBe('ok');
        expect(ctx.state().steps.claim.state).toBe('ok');
        expect(ctx.state().steps.mapbox.available).toBe(true);
    });

    it('badPath_aFailedFunctionIsNamedAndTheWatchGoesOn', async () => {
        const { harness, ctx, flow } = setup();
        harness.google.grant('cloudPlatform');
        harness.cloud.deployment.mockResolvedValue({ ready: 31, total: 32, failed: ['admin-claim'] });

        flow.watch();
        await flush();

        expect(ctx.state().steps.deploy).toMatchObject({
            state: 'invalid',
            detail: { key: 'adminSetup.deploy.failed', params: { name: 'admin-claim' } },
        });
        expect(harness.clock.pending()).toBe(1);
        flow.dispose();
        expect(harness.clock.pending()).toBe(0);
    });

    it('badPath_aServerThatDoesNotAnswerIsUnreachable', async () => {
        const { harness, ctx, onDeployed, flow } = setup();
        harness.google.grant('cloudPlatform');
        harness.cloud.deployment.mockResolvedValue({ ready: 32, total: 32, failed: [] });
        harness.host.serverDeployed.mockResolvedValue(false);

        flow.watch();
        await flush();

        expect(ctx.state().steps.deploy).toMatchObject({ state: 'invalid', detail: { key: 'adminSetup.deploy.unreachable' } });
        expect(onDeployed).not.toHaveBeenCalled();
        flow.dispose();
    });

    it('badPath_cloudFunctionsStillDisabledIsNothingInstalled', async () => {
        const { harness, ctx, flow } = setup();
        harness.google.grant('cloudPlatform');
        harness.cloud.deployment.mockRejectedValue(googleError('forbidden', { api: 'cloudfunctions.googleapis.com' }));

        flow.watch();
        await flush();

        expect(ctx.state().steps.deploy).toMatchObject({ state: 'missing', detail: { key: 'adminSetup.deploy.notStarted' }, error: null });
        flow.dispose();
    });

    it('badPath_aListThatFailsIsShownAndTriedAgainLater', async () => {
        const { harness, ctx, flow } = setup();
        harness.google.grant('cloudPlatform');
        harness.cloud.deployment.mockRejectedValueOnce(googleError('unavailable'));

        flow.watch();
        await flush();
        expect(ctx.state().steps.deploy.error).toEqual({ key: 'apiError.unavailable' });

        await harness.clock.advance(60_000);
        expect(harness.cloud.deployment).toHaveBeenCalledTimes(2);
        flow.dispose();
    });

    it('badPath_anExpiredTokenStopsTheWatchWithContinue', async () => {
        const { harness, ctx, flow } = setup();
        harness.google.grant('cloudPlatform');
        harness.cloud.deployment.mockRejectedValue(googleError('unauthorized'));

        flow.watch();
        await flush();

        expect(ctx.state().steps.deploy).toMatchObject({ needsContinue: true });
        expect(ctx.state().deploy.watching).toBe(false);
        expect(harness.clock.pending()).toBe(0);
    });

    it('badPath_withoutALiveTokenTheCardOffersContinue', async () => {
        const { harness, ctx, flow } = setup();

        flow.watch();
        await flush();

        expect(harness.cloud.deployment).not.toHaveBeenCalled();
        expect(ctx.state().steps.deploy.needsContinue).toBe(true);
        expect(ctx.state().deploy.watching).toBe(false);
    });

    it('badPath_twoHoursWithoutTheServerAskToCheckAgain', async () => {
        const { harness, ctx, flow } = setup();
        harness.google.current = { ...access(harness.clock.now(), 'cloudPlatform'), expiresAt: harness.clock.now() + 10 * 3_600_000 };

        flow.watch();
        flow.watch();
        await flush();
        await harness.clock.advance(2 * 3_600_000);

        expect(ctx.state().steps.deploy.detail).toEqual({ key: 'adminSetup.deploy.timeout' });
        expect(ctx.state().deploy.watching).toBe(false);
    });
});

describe('deploy: check again', () => {
    it('happyPath_checkAgainWithoutATokenAsksOneConsentAndWatches', async () => {
        const { harness, ctx, flow } = setup();
        harness.cloud.deployment.mockResolvedValue({ ready: 32, total: 32, failed: [] });

        await flow.recheck();
        await flush();

        expect(harness.google.requests).toEqual(['cloudPlatform']);
        expect(ctx.state().steps.deploy).toMatchObject({ state: 'ok', used: { inputs: 1, consents: 1 } });
    });

    it('badPath_aRefusedConsentWatchesNothing', async () => {
        const { harness, flow } = setup();
        harness.google.answer = () => Promise.resolve(null);

        await flow.recheck();

        expect(harness.cloud.deployment).not.toHaveBeenCalled();
    });
});
