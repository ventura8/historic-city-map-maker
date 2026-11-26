// Update the map's pipeline after the server when the page's token ran out (the live finding of 2026-11-14): the server went
// in, the update of the imagery pipeline was dropped with an info line only and its card said nothing, so the computers kept
// the old processing. Now the update stays due, the cards say why with Continue, and the next token starts it.
import { describe, expect, it } from 'vitest';

import type { CloudBuild } from '../../src/google/cloud-build.js';
import { InstallBundleError } from '../../src/install/bundle.js';
import type { TargetObservation } from '../../src/install/ports.js';
import { createSetupContext, createSetupStore } from '../../src/setup/context.js';
import { createInstallCards } from '../../src/setup/install.js';
import { withRecordedInstall } from '../../src/setup/install-records.js';
import { initialSetupState, withStep } from '../../src/setup/state.js';
import { ADMIN_RELEASE, createHarness, flush } from './harness.js';

function build(target: string, status: CloudBuild['status']): CloudBuild {
    return { id: `b-${target}`, status, steps: [], tags: ['hcm-install', `hcm-${target}`, 'hcm-r-1-0-0-abc1234'], substitutions: {} };
}

function observed(changes: Partial<TargetObservation> = {}): TargetObservation {
    return { installed: { complete: false, release: null }, build: null, progress: null, blocker: null, ...changes };
}

function setup() {
    const harness = createHarness();
    const base = (['signIn', 'billing', 'provision'] as const).reduce(
        (state, id) => withStep(state, id, { state: 'ok' }),
        initialSetupState(harness.host, 'normal'),
    );
    const ctx = createSetupContext(harness.deps, createSetupStore(base));
    const cards = createInstallCards(ctx, () => Promise.resolve());
    return { harness, ctx, cards };
}

/** Both behind; the server's build works until `server.done`, then the server is installed. */
function behindWorld() {
    const world = setup();
    const server = { done: false, working: false };
    world.harness.installer.observe.mockImplementation((target) => {
        if (target === 'server' && server.done) {
            return Promise.resolve(observed({ installed: { complete: true, release: ADMIN_RELEASE }, build: build('server', 'SUCCESS') }));
        }
        const at = target === 'server' && server.working ? { build: build('server', 'WORKING') } : {};
        return Promise.resolve(observed({ installed: { complete: true, release: '0.9.0' }, ...at }));
    });
    return { ...world, server };
}

async function updateBoth(world: ReturnType<typeof behindWorld>): Promise<void> {
    world.harness.google.grant('cloudPlatform');
    world.cards.watch(['server', 'pipeline']);
    await flush();
    await world.cards.updateMap('deploy');
    world.server.working = true;
    await world.harness.clock.advance(10_000);
    await flush();
}

function submitted(world: ReturnType<typeof setup>): string[] {
    return world.harness.installer.submit.mock.calls.map(([target]) => target);
}

describe("Update the map: the pipeline's update survives a token that ran out (2026-11-14)", () => {
    it('badPath_aWatchWithoutATokenSaysItStoppedFollowing_withContinue', async () => {
        const world = behindWorld();
        await updateBoth(world);
        expect(world.ctx.state().install.server.state).toBe('working');

        world.harness.google.drop();
        await world.harness.clock.advance(10_000);
        await flush();

        expect(world.ctx.state().steps.deploy).toMatchObject({ needsContinue: true, error: { key: 'adminSetup.install.followPaused' } });
        world.cards.dispose();
    });

    it('happyPath_theServerSeenInWithoutATokenHoldsThePipeline_andContinuesTokenStartsIt @S-A56-BAD-UPDATE-TOKEN-RAN-OUT', async () => {
        const world = behindWorld();
        await updateBoth(world);
        // The token runs out during the look that sees the server in: before, the pipeline's update was dropped here.
        world.harness.installer.observe.mockImplementationOnce(() => {
            world.harness.google.drop();
            return Promise.resolve(observed({ installed: { complete: true, release: ADMIN_RELEASE }, build: build('server', 'SUCCESS') }));
        });
        world.server.done = true;
        await world.harness.clock.advance(10_000);
        await flush();
        expect(world.ctx.state().install.server.state).toBe('installed');
        expect(submitted(world)).toEqual(['server']);
        expect(world.ctx.state().steps.pipeline).toMatchObject({
            needsContinue: true,
            error: { key: 'adminSetup.install.waitsForSignIn' },
        });

        // Continue on the pipeline's card: its consent's look at the server starts the held update.
        await world.cards.recheck('pipeline');
        await flush();

        expect(world.harness.google.requests).toEqual(['cloudPlatform']);
        expect(submitted(world)).toEqual(['server', 'pipeline']);
        expect(world.ctx.state().steps.pipeline).toMatchObject({ needsContinue: false, error: null });
        world.cards.dispose();
    });

    it('badPath_aServerThatStoppedSaysSoOnThePipelinesCard_untilThePipelineBuildsAgain', async () => {
        const world = setup();
        const server = { failed: false };
        world.harness.installer.observe.mockImplementation((target) =>
            Promise.resolve(
                target === 'server' && server.failed
                    ? observed({ installed: { complete: true, release: '0.9.0' }, build: build('server', 'FAILURE') })
                    : observed({ installed: { complete: true, release: '0.9.0' } }),
            ),
        );
        world.harness.google.grant('cloudPlatform');
        world.cards.watch(['server', 'pipeline']);
        await flush();
        await world.cards.updateMap('deploy');
        server.failed = true;
        await world.harness.clock.advance(10_000);
        await flush();

        expect(world.ctx.state().steps.pipeline.error).toEqual({ key: 'adminSetup.install.serverStopped' });
        expect(world.ctx.state().steps.pipeline.needsContinue).toBe(false);
        // A later look at the pipeline, still behind, keeps the reason.
        await world.harness.clock.advance(60_000);
        await flush();
        expect(world.ctx.state().steps.pipeline.error).toEqual({ key: 'adminSetup.install.serverStopped' });
        world.cards.dispose();
    });
});

describe('a refused pipeline update is never hidden under a done chip (2026-11-14)', () => {
    it('badPath_anAdminRedeployedWhileTheServerBuiltShowsTheReasonWithAnAttentionChip', async () => {
        const world = behindWorld();
        world.harness.installer.submit.mockImplementation((target) =>
            target === 'pipeline'
                ? Promise.reject(new InstallBundleError('apiError.install.adminOutdated', { release: '1.0.1' }))
                : Promise.resolve(build(target, 'QUEUED')),
        );
        await updateBoth(world);
        world.server.done = true;
        await world.harness.clock.advance(10_000);
        await flush();

        expect(submitted(world)).toEqual(['server', 'pipeline']);
        expect(world.ctx.state().install.pipeline.error).toMatchObject({ key: 'apiError.install.adminOutdated' });
        expect(world.ctx.state().steps.pipeline.state).toBe('invalid');
        world.cards.dispose();
    });

    it('happyPath_aPipelineBehindWithoutAnErrorKeepsItsDoneChip', async () => {
        const world = behindWorld();
        world.harness.google.grant('cloudPlatform');
        world.cards.watch(['pipeline']);
        await flush();
        expect(world.ctx.state().install.pipeline.state).toBe('updateAvailable');
        expect(world.ctx.state().steps.pipeline.state).toBe('ok');
        world.cards.dispose();
    });
});

describe('a build only the record says is at work offers Continue on a page without a token (lesson 721)', () => {
    function reloadedWorld() {
        const world = setup();
        const record = { state: 'working' as const, release: '0.9.0', buildId: 'b-pipeline', checkedAt: '2026-11-14T16:41:31.073Z' };
        world.ctx.update((state) => withRecordedInstall(state, { pipeline: record }));
        world.harness.installer.observe.mockResolvedValue(
            observed({ installed: { complete: true, release: ADMIN_RELEASE }, build: build('pipeline', 'SUCCESS') }),
        );
        return world;
    }

    it('badPath_aRecordedBuildAtWorkWithoutATokenSaysTheFollowIsPaused_withContinue @S-A56-BAD-RECORDED-WORKING', async () => {
        const world = reloadedWorld();
        world.cards.watch(['server', 'pipeline']);
        await flush();

        expect(world.ctx.state().install.pipeline).toMatchObject({ state: 'working', recorded: true });
        expect(world.ctx.state().steps.pipeline).toMatchObject({ needsContinue: true, error: { key: 'adminSetup.install.followPaused' } });
        expect(world.ctx.state().steps.deploy.error).toBeNull();
        world.cards.dispose();
    });

    it('happyPath_continuesTokenLooksAtTheBuildAndTheCardSaysInstalled @S-A56-HAPPY-RECORDED-WORKING', async () => {
        const world = reloadedWorld();
        world.cards.watch(['server', 'pipeline']);
        await flush();

        await world.cards.recheck('pipeline');
        await flush();

        expect(world.ctx.state().install.pipeline).toMatchObject({ state: 'installed', recorded: false });
        expect(world.ctx.state().steps.pipeline).toMatchObject({ needsContinue: false, error: null });
        world.cards.dispose();
    });

    it('happyPath_aPageWithALiveTokenJustLooks_noNotice', async () => {
        const world = reloadedWorld();
        world.harness.google.grant('cloudPlatform');
        world.cards.watch(['server', 'pipeline']);
        await flush();

        expect(world.ctx.state().steps.pipeline.error).toBeNull();
        expect(world.ctx.state().install.pipeline.state).toBe('installed');
        world.cards.dispose();
    });
});
