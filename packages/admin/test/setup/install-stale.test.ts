// Update the map beside a build only a record says is at work (2026-11-14, the live admin at 23:45): the click looks at the
// recorded build with its one consent first, and goes on only when no build is at work (finding 71's race stays closed).
import { describe, expect, it } from 'vitest';

import type { CloudBuild } from '../../src/google/cloud-build.js';
import type { TargetObservation } from '../../src/install/ports.js';
import { createSetupContext, createSetupStore } from '../../src/setup/context.js';
import { createInstallCards } from '../../src/setup/install.js';
import { initialSetupState, withStep } from '../../src/setup/state.js';
import { ADMIN_RELEASE, createHarness } from './harness.js';

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

describe('Update the map beside a build only a record says is at work (2026-11-14)', () => {
    /** The live admin: the server behind, the pipeline recorded at work at 23:20 and no token to look with. */
    function staleWorld(pipelineBuild: CloudBuild['status'] | null) {
        const world = setup();
        const server = { state: 'updateAvailable' as const, installedRelease: '0.9.0', checkedAt: '2026-11-13T21:20:00.000Z' };
        const pipeline = { state: 'working' as const, recorded: true, buildId: 'b-pipeline', checkedAt: '2026-11-13T21:20:00.000Z' };
        world.ctx.update((state) => ({
            ...state,
            install: {
                ...state.install,
                server: { ...state.install.server, ...server },
                pipeline: { ...state.install.pipeline, ...pipeline },
            },
        }));
        world.harness.installer.observe.mockImplementation((target) => {
            if (target === 'pipeline') {
                const found = pipelineBuild === null ? null : build('pipeline', pipelineBuild);
                return Promise.resolve(observed({ installed: { complete: true, release: ADMIN_RELEASE }, build: found }));
            }
            return Promise.resolve(observed({ installed: { complete: true, release: '0.9.0' } }));
        });
        return world;
    }

    it('happyPath_theClickLooksAtTheRecordedBuildWithItsOneConsentThenUpdates @S-A55-HAPPY-UPDATE-STALE-RECORD', async () => {
        const { harness, ctx, cards } = staleWorld(null);

        await cards.updateMap('deploy');

        expect(harness.google.requests).toEqual(['cloudPlatform']);
        expect(ctx.state().install.pipeline).toMatchObject({ state: 'installed', recorded: false });
        expect(harness.installer.submit.mock.calls.map(([target]) => target)).toEqual(['server']);
        cards.dispose();
    });

    it('badPath_aRecordedBuildTheLookFindsStillAtWorkHoldsTheUpdate @S-A55-BAD-UPDATE-STALE-RECORD', async () => {
        const { harness, ctx, cards } = staleWorld('WORKING');

        await cards.updateMap('deploy');

        expect(ctx.state().install.pipeline).toMatchObject({ state: 'working', recorded: false });
        expect(harness.installer.submit).not.toHaveBeenCalled();
        cards.dispose();
    });
});
