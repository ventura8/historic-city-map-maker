// The Setup Assistant's install cards (docs/research/M6-interfaces.md §1.7, §1.8, §4.1): Install the server also starts
// the imagery pipeline, Publish the map, Update the map with one consent, Check again, the chips, the records.
import type { InstallState } from '@hcm/shared';
import { GOOGLE_TOKENS } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import type { CloudBuild } from '../../src/google/cloud-build.js';
import type { TargetObservation } from '../../src/install/ports.js';
import { createSetupContext, createSetupStore } from '../../src/setup/context.js';
import { createInstallCards } from '../../src/setup/install.js';
import { initialSetupState, withStep, type SetupMode } from '../../src/setup/state.js';
import { ADMIN_RELEASE, ADMIN_RELEASE_TIME, createHarness, flush, googleError } from './harness.js';

const SLUG = '1-0-0-abc1234';

function build(target: string, status: CloudBuild['status'], id = `b-${target}`): CloudBuild {
    return { id, status, steps: [], tags: ['hcm-install', `hcm-${target}`, `hcm-r-${SLUG}`], substitutions: {} };
}

function observed(changes: Partial<TargetObservation> = {}): TargetObservation {
    return { installed: { complete: false, release: null }, build: null, progress: null, blocker: null, ...changes };
}

function setup(mode: SetupMode = 'bootstrap') {
    const harness = createHarness();
    const base = (['signIn', 'billing', 'provision'] as const).reduce(
        (state, id) => withStep(state, id, { state: 'ok' }),
        initialSetupState(harness.host, mode),
    );
    const store = createSetupStore(base);
    const ctx = createSetupContext(harness.deps, store);
    const provisioned: string[][] = [];
    /** Whether each Provision part's record may go ahead yet (finding 71). */
    const recordable: boolean[] = [];
    const cards = createInstallCards(ctx, (access, recordAfter) => {
        provisioned.push([access.token, ...ctx.state().install.provisionDue]);
        const index = recordable.push(false) - 1;
        void recordAfter.then(() => {
            recordable[index] = true;
        });
        return Promise.resolve();
    });
    return { harness, ctx, cards, provisioned, recordable, store };
}

describe('Install the server', () => {
    it('happyPath_oneClickWithTheLiveTokenInstallsTheServerAndThePipeline', async () => {
        const { harness, ctx, cards } = setup();
        harness.google.grant('cloudPlatform');

        await cards.installServer();

        expect(harness.installer.submit.mock.calls.map(([target]) => target)).toEqual(['server', 'pipeline']);
        expect(ctx.state().install.server).toMatchObject({ state: 'queued', buildId: 'build-server-0001', busy: false });
        expect(ctx.state().steps.pipeline).toMatchObject({ state: 'pending' });
        expect(ctx.state().steps.deploy.used).toEqual({ inputs: 1, consents: 0 });
        expect(harness.google.requests).toEqual([]);
        cards.dispose();
    });

    it('badPath_withoutATokenTheSameClickAsksOneConsent_andABlockedPipelineWaits', async () => {
        const { harness, ctx, cards } = setup();
        harness.installer.observe.mockImplementation((target) =>
            Promise.resolve(
                observed(target === 'pipeline' ? { blocker: { key: 'apiError.install.noRepository', params: { repository: 'hcm' } } } : {}),
            ),
        );
        // The pipeline's blocker is known once the card looked (its watch).
        cards.watch(['pipeline']);

        await cards.installServer();
        await flush();

        expect(harness.google.requests).toEqual(['cloudPlatform']);
        expect(ctx.state().steps.deploy.used).toEqual({ inputs: 1, consents: 1 });
        expect(harness.installer.submit.mock.calls.map(([target]) => target)).toEqual(['server']);
        expect(ctx.state().install.pipeline.blocker).toEqual({ key: 'apiError.install.noRepository', params: { repository: 'hcm' } });
        cards.dispose();
    });

    it('badPath_anExpiredTokenOffersContinueOnTheCard', async () => {
        const { harness, ctx, cards } = setup();
        harness.google.grant('cloudPlatform');
        harness.installer.observe.mockRejectedValue(googleError('unauthorized'));

        cards.watch(['pipeline']);
        await flush();

        expect(ctx.state().steps.pipeline.needsContinue).toBe(true);
        expect(harness.google.dropped).toBe(1);
        cards.dispose();
    });
});

describe('Publish the map, Check again, Update the map', () => {
    it('happyPath_publishIsOneClickOnTheSiteCard', async () => {
        const { harness, ctx, cards } = setup('normal');
        harness.google.grant('cloudPlatform');

        await cards.install('site');

        expect(harness.installer.submit.mock.calls[0]?.[0]).toBe('site');
        expect(harness.installer.submit.mock.calls[0]?.[1].token).toBe(harness.google.current?.token);
        expect(ctx.state().steps.site).toMatchObject({ state: 'pending', used: { inputs: 1, consents: 0 } });
        cards.dispose();
    });

    it('happyPath_checkAgainLooksOnce_badPath_aRefusedConsentLooksAtNothing', async () => {
        const { harness, ctx, cards } = setup();
        harness.installer.observe.mockResolvedValue(observed({ installed: { complete: true, release: ADMIN_RELEASE } }));

        await cards.recheck('pipeline');
        expect(ctx.state().steps.pipeline).toMatchObject({ state: 'ok', used: { inputs: 1, consents: 1 } });

        harness.google.drop();
        harness.google.answer = () => Promise.resolve(null);
        const looks = harness.installer.observe.mock.calls.length;
        await cards.recheck('site');
        expect(harness.installer.observe.mock.calls).toHaveLength(looks);
        cards.dispose();
    });

    it('happyPath_updateTheMapAsksOnceForEveryTargetBehind_theSiteAfterTheServer', async () => {
        const { harness, ctx, cards } = setup('normal');
        const server = { state: 'updateAvailable' as InstallState };
        harness.installer.observe.mockImplementation((target) => {
            if (target === 'server' && server.state === 'installed') {
                return Promise.resolve(
                    observed({ installed: { complete: true, release: ADMIN_RELEASE }, build: build('server', 'SUCCESS') }),
                );
            }
            const older = target === 'pipeline' ? { complete: true, release: ADMIN_RELEASE } : { complete: true, release: '0.9.0' };
            return Promise.resolve(observed({ installed: older }));
        });
        harness.google.grant('cloudPlatform');
        cards.watch(['server', 'pipeline', 'site']);
        await flush();
        harness.google.drop();

        await cards.updateMap('site');

        expect(harness.google.requests).toEqual(['cloudPlatform']);
        expect(harness.installer.submit.mock.calls.map(([target]) => target)).toEqual(['server']);
        server.state = 'installed';
        await harness.clock.advance(10_000);
        await flush();
        expect(harness.installer.submit.mock.calls.map(([target]) => target)).toEqual(['server', 'site']);
        expect(ctx.state().steps.site.used).toEqual({ inputs: 1, consents: 1 });
        cards.dispose();
    });

    it('happyPath_aTargetRecordedBehindIsUpdatedBeforeItsCardLooked', async () => {
        const { harness, ctx, cards } = setup('normal');
        ctx.update((state) => ({
            ...state,
            install: { ...state.install, pipeline: { ...state.install.pipeline, state: 'updateAvailable' } },
        }));
        harness.installer.observe.mockResolvedValue(observed({ installed: { complete: true, release: '0.9.0' } }));

        await cards.updateMap('pipeline');

        expect(harness.google.requests).toEqual(['cloudPlatform']);
        expect(harness.installer.submit.mock.calls.map(([target]) => target)).toEqual(['pipeline']);
        cards.dispose();
    });

    it('happyPath_updateTheMapAlsoInstallsAMissingPipeline_andRetriesAStoppedTarget', async () => {
        // Finding 3 of the M6 review: a pipeline not installed (blocked at the server's click, or a server installed from
        // GitHub Actions) had no way in; finding 1: a stopped target had no Try again in an admin session.
        const { harness, ctx, cards } = setup('normal');
        ctx.update((state) => ({
            ...state,
            install: {
                ...state.install,
                server: { ...state.install.server, state: 'failed' },
                pipeline: { ...state.install.pipeline, state: 'notInstalled', checkedAt: '2026-10-30T09:00:00.000Z' },
                site: { ...state.install.site, state: 'notInstalled', checkedAt: '2026-10-30T09:00:00.000Z' },
            },
        }));
        harness.installer.observe.mockImplementation((target) =>
            Promise.resolve(
                target === 'server'
                    ? observed({ installed: { complete: true, release: '0.9.0' }, build: build('server', 'FAILURE') })
                    : observed(),
            ),
        );

        await cards.updateMap('deploy');

        // The pipeline waits for the server (2026-11-12): only the server goes now.
        expect(harness.installer.submit.mock.calls.map(([target]) => target)).toEqual(['server']);
        cards.dispose();
    });

    it('happyPath_theOwnersConfirmedOverrideInstallsOverANewerServer @S-A55-HAPPY-INSTALL-OVER', async () => {
        // The live finding of 2026-11-12: a rollback over a newer server, after the card's confirmation.
        const { harness, ctx, cards } = setup('normal');
        harness.installer.observe.mockResolvedValue(observed({ installed: { complete: true, release: '99.0.0+e2e9999' } }));

        await cards.installOver('server');

        expect(harness.google.requests).toEqual(['cloudPlatform']);
        expect(harness.installer.submit.mock.calls.map(([target, , options]) => [target, options])).toEqual([['server', { over: true }]]);
        expect(ctx.state().steps.deploy.used.inputs).toBe(1);
        cards.dispose();
    });

    it('badPath_theOverrideWithoutAConsentSubmitsNothing', async () => {
        const { harness, cards } = setup('normal');
        harness.google.answer = () => Promise.resolve(null);

        await cards.installOver('server');

        expect(harness.installer.submit).not.toHaveBeenCalled();
        cards.dispose();
    });

    it('badPath_nothingBehindAsksNothing', async () => {
        const { harness, cards, provisioned } = setup('normal');

        await cards.updateMap('deploy');

        expect(harness.google.requests).toEqual([]);
        expect(harness.installer.submit).not.toHaveBeenCalled();
        expect(provisioned).toEqual([]);
    });
});

describe('Update the map: the pipeline after the server (2026-11-12)', () => {
    it('happyPath_thePipelineWaitsForTheServerTheSameUpdateInstalls', async () => {
        // 2026-11-12: the pipeline's build finished first, so `worker.image` handed the local worker the new image while
        // the old server still answered its claims, and refused them until the server's build caught up.
        const { harness, ctx, cards } = setup('normal');
        const server = { state: 'updateAvailable' as InstallState };
        harness.installer.observe.mockImplementation((target) => {
            if (target === 'server' && server.state === 'installed') {
                return Promise.resolve(
                    observed({ installed: { complete: true, release: ADMIN_RELEASE }, build: build('server', 'SUCCESS') }),
                );
            }
            return Promise.resolve(observed({ installed: { complete: true, release: '0.9.0' } }));
        });
        harness.google.grant('cloudPlatform');
        cards.watch(['server', 'pipeline']);
        await flush();
        harness.google.drop();

        await cards.updateMap('deploy');

        expect(harness.installer.submit.mock.calls.map(([target]) => target)).toEqual(['server']);
        expect(ctx.state().install.pipeline.state).toBe('updateAvailable');
        server.state = 'installed';
        await harness.clock.advance(10_000);
        await flush();
        expect(harness.installer.submit.mock.calls.map(([target]) => target)).toEqual(['server', 'pipeline']);
        cards.dispose();
    });

    it('badPath_aServerThatStoppedNeverLetsThePipelineGo_itsCardOffersTheUpdateAgain', async () => {
        const { harness, ctx, cards } = setup('normal');
        const server = { failed: false };
        harness.installer.observe.mockImplementation((target) =>
            Promise.resolve(
                target === 'server' && server.failed
                    ? observed({ installed: { complete: true, release: '0.9.0' }, build: build('server', 'FAILURE') })
                    : observed({ installed: { complete: true, release: '0.9.0' } }),
            ),
        );
        harness.google.grant('cloudPlatform');
        cards.watch(['server', 'pipeline']);
        await flush();
        harness.google.drop();

        await cards.updateMap('deploy');
        harness.google.grant('cloudPlatform');
        server.failed = true;
        await harness.clock.advance(10_000);
        await flush();
        await harness.clock.advance(10_000);
        await flush();

        expect(ctx.state().install.server.state).toBe('failed');
        expect(harness.installer.submit.mock.calls.map(([target]) => target)).toEqual(['server']);
        expect(ctx.state().install.pipeline.state).toBe('updateAvailable');
        cards.dispose();
    });
});

describe('Update the map and Provision (finding 65 of 2026-11-02)', () => {
    it('happyPath_updateTheMapAlsoAppliesTheProvisionItemsThatChangedInTheSameConsent @S-A04-HAPPY-UPDATE-PROVISION', async () => {
        // Finding 65 of 2026-11-02: M7's release changed two Provision items; nothing else is behind.
        const { harness, ctx, cards, provisioned } = setup('normal');
        ctx.update((state) => ({ ...state, install: { ...state.install, provisionDue: ['artifact-registry', 'bucket-lifecycle'] } }));

        await cards.updateMap('deploy');

        expect(harness.google.requests).toEqual(['cloudPlatform']);
        expect(provisioned).toEqual([[GOOGLE_TOKENS.owner, 'artifact-registry', 'bucket-lifecycle']]);
        expect(harness.installer.submit).not.toHaveBeenCalled();
        cards.dispose();
    });

    it('happyPath_aTargetBehindAndProvisionsChangesGoTogether', async () => {
        const { harness, ctx, cards, provisioned } = setup('normal');
        harness.google.grant('cloudPlatform');
        ctx.update((state) => ({
            ...state,
            install: {
                ...state.install,
                provisionDue: ['artifact-registry'],
                pipeline: { ...state.install.pipeline, state: 'updateAvailable' },
            },
        }));
        harness.installer.observe.mockResolvedValue(observed({ installed: { complete: true, release: '0.9.0' } }));

        await cards.updateMap('pipeline');

        expect(harness.google.requests).toEqual([]);
        expect(provisioned).toHaveLength(1);
        expect(harness.installer.submit.mock.calls.map(([target]) => target)).toEqual(['pipeline']);
        cards.dispose();
    });

    it('happyPath_provisionsRecordWaitsForTheServerTheSameUpdateInstalls @S-A04-HAPPY-UPDATE-PROVISION-RECORD', async () => {
        // Finding 71 of 2026-11-02: the server before the update refuses a record naming the item set's version.
        const { harness, ctx, cards, provisioned, recordable } = setup('normal');
        const server = { installed: false };
        harness.installer.observe.mockImplementation((target) =>
            Promise.resolve(
                target === 'server' && server.installed
                    ? observed({ installed: { complete: true, release: ADMIN_RELEASE }, build: build('server', 'SUCCESS') })
                    : observed({ installed: { complete: true, release: target === 'server' ? '0.9.0' : ADMIN_RELEASE } }),
            ),
        );
        harness.google.grant('cloudPlatform');
        cards.watch(['server', 'pipeline', 'site']);
        await flush();
        ctx.update((state) => ({ ...state, install: { ...state.install, provisionDue: ['artifact-registry', 'bucket-lifecycle'] } }));

        await cards.updateMap('deploy');
        await flush();

        expect(provisioned).toHaveLength(1);
        expect(harness.installer.submit.mock.calls.map(([target]) => target)).toEqual(['server']);
        expect(recordable).toEqual([false]);
        server.installed = true;
        await harness.clock.advance(10_000);
        await flush();
        expect(recordable).toEqual([true]);
        cards.dispose();
    });

    it('badPath_withoutTheServerInTheUpdateProvisionRecordsAtOnce_andLeavingSetupLetsItGo', async () => {
        const { harness, ctx, cards, recordable } = setup('normal');
        ctx.update((state) => ({ ...state, install: { ...state.install, provisionDue: ['bucket-lifecycle'] } }));

        await cards.updateMap('deploy');
        await flush();
        expect(recordable).toEqual([true]);

        // A server update the owner leaves Setup during: the wait ends with the cards.
        ctx.update((state) => ({ ...state, install: { ...state.install, server: { ...state.install.server, state: 'updateAvailable' } } }));
        harness.installer.observe.mockResolvedValue(observed({ installed: { complete: true, release: '0.9.0' } }));
        await cards.updateMap('deploy');
        await flush();
        expect(recordable).toEqual([true, false]);
        cards.dispose();
        await flush();
        expect(recordable).toEqual([true, true]);
    });

    it('badPath_anUpdateClickedBeforeTheCardsFirstLookNeverShowsNotInstalled @S-A55-BAD-UPDATE-NOT-INSTALLED', async () => {
        // Finding 59 of 2026-11-02: the card showed "Not installed" until the update's first look answered.
        const { harness, ctx, cards, store } = setup('normal');
        const recorded = { state: 'updateAvailable' as const, installedRelease: '0.9.0', checkedAt: '2026-11-02T16:59:00.000Z' };
        ctx.update((state) => ({ ...state, install: { ...state.install, server: { ...state.install.server, ...recorded } } }));
        const pending: { answer?: (observation: TargetObservation) => void } = {};
        harness.installer.observe.mockImplementation(
            () =>
                new Promise<TargetObservation>((resolve) => {
                    pending.answer = resolve;
                }),
        );
        const seen: string[] = [];
        store.subscribe((state) => seen.push(state.install.server.state));

        const updating = cards.updateMap('deploy');
        await flush();

        expect(ctx.state().install.server).toMatchObject({ ...recorded, busy: true });
        pending.answer?.(observed({ installed: { complete: true, release: '0.9.0' } }));
        await updating;
        expect(seen).not.toContain('notInstalled');
        expect(harness.installer.submit.mock.calls.map(([target]) => target)).toEqual(['server']);
        cards.dispose();
    });

    it('badPath_aClosedConsentAppliesNothing', async () => {
        const { harness, ctx, cards, provisioned } = setup('normal');
        ctx.update((state) => ({ ...state, install: { ...state.install, provisionDue: ['bucket-lifecycle'] } }));
        harness.google.answer = () => Promise.resolve(null);

        await cards.updateMap('deploy');

        expect(provisioned).toEqual([]);
        cards.dispose();
    });
});

describe('a pipeline this admin cannot install (finding 43 of 2026-11-01)', () => {
    it('badPath_aPipelineTheBundleCannotInstallIsNeverSubmitted', async () => {
        // Finding 43 of 2026-11-01: a record says the pipeline was looked at and is not installed; the bundle names no
        // Docker builder (§67e), which the cards read without a token.
        const { harness, ctx, cards } = setup('normal');
        harness.installer.localBlocker.mockImplementation((target) =>
            Promise.resolve(target === 'pipeline' ? { key: 'apiError.install.notAvailable' } : null),
        );
        ctx.update((state) => ({
            ...state,
            install: {
                ...state.install,
                server: { ...state.install.server, state: 'failed' },
                pipeline: { ...state.install.pipeline, state: 'notInstalled', checkedAt: '2026-10-30T09:00:00.000Z' },
            },
        }));
        harness.installer.observe.mockResolvedValue(observed());
        cards.watch(['pipeline']);
        await flush();
        expect(ctx.state().install.pipelineOff).toEqual({ key: 'apiError.install.notAvailable' });

        await cards.updateMap('deploy');
        await cards.installServer();

        expect(harness.installer.submit.mock.calls.map(([target]) => target)).toEqual(['server', 'server']);
        expect(harness.installer.localBlocker.mock.calls.filter(([target]) => target === 'pipeline')).toHaveLength(1);
        cards.dispose();
    });

    it('happyPath_aBundleThatCanInstallThePipelineOrCannotBeReadSaysNothing', async () => {
        const { harness, ctx, cards } = setup('normal');
        harness.installer.localBlocker.mockRejectedValueOnce(new Error('offline'));

        cards.watch(['server', 'pipeline']);
        await flush();

        expect(ctx.state().install.pipelineOff).toBeNull();
        cards.dispose();
    });
});

describe('records', () => {
    it('happyPath_inAnAdminSessionAChangedStateIsRecordedOnce', async () => {
        const { harness, cards } = setup('normal');
        harness.google.grant('cloudPlatform');
        harness.installer.observe.mockResolvedValue(observed({ installed: { complete: true, release: ADMIN_RELEASE } }));

        cards.watch(['pipeline']);
        await flush();
        await harness.clock.advance(60_000);
        await flush();

        expect(harness.backend.recordCloud).toHaveBeenCalledTimes(1);
        expect(harness.backend.recordCloud.mock.calls[0]?.[0]).toMatchObject({
            install: { pipeline: { state: 'installed', release: ADMIN_RELEASE } },
        });
        cards.dispose();
    });

    it('happyPath_aServerThatNamesItsBuildTimeIsRecordedWithIt_andSoAreTheOtherTargetsOnceItDoes', async () => {
        // Finding 39 of 2026-11-01: a server that reads build times names its own (HCM_RELEASE_TIME).
        const { harness, cards } = setup('normal');
        harness.google.grant('cloudPlatform');
        const timed = { complete: true, release: ADMIN_RELEASE, releaseTime: ADMIN_RELEASE_TIME };
        harness.installer.observe.mockResolvedValue(observed({ installed: timed }));

        cards.watch(['server']);
        await flush();
        cards.watch(['site']);
        await flush();

        const records = harness.backend.recordCloud.mock.calls.map(([request]) => request);
        expect(records).toEqual([
            { install: { server: expect.objectContaining({ release: ADMIN_RELEASE, releaseTime: ADMIN_RELEASE_TIME }) as unknown } },
            { install: { site: expect.objectContaining({ release: ADMIN_RELEASE, releaseTime: ADMIN_RELEASE_TIME }) as unknown } },
        ]);
        cards.dispose();
    });

    it('badPath_whileTheServerNamesNoBuildTimeNoRecordNamesOne', async () => {
        // A server from before the build times refuses a record naming one (its schema is strict).
        const { harness, cards } = setup('normal');
        harness.google.grant('cloudPlatform');
        harness.installer.observe.mockImplementation((target) =>
            Promise.resolve(
                observed({
                    installed:
                        target === 'server'
                            ? { complete: true, release: '1.0.0+9e2e6b5', releaseTime: null }
                            : { complete: true, release: ADMIN_RELEASE, releaseTime: ADMIN_RELEASE_TIME },
                }),
            ),
        );

        cards.watch(['server', 'pipeline']);
        await flush();

        const records = harness.backend.recordCloud.mock.calls.map(([request]) => request);
        expect(records).toHaveLength(2);
        expect(JSON.stringify(records)).not.toContain('releaseTime');
        expect(records).toContainEqual({ install: { server: expect.objectContaining({ state: 'updateAvailable' }) as unknown } });
        cards.dispose();
    });

    it('badPath_aRecordThatFailsIsLoggedAndTheCardGoesOn', async () => {
        const { harness, ctx, cards } = setup('normal');
        harness.google.grant('cloudPlatform');
        harness.backend.recordCloud.mockRejectedValue(new Error('offline'));

        cards.watch(['site']);
        await flush();

        expect(ctx.state().install.site.state).toBe('notInstalled');
        expect(harness.logs.records.some((record) => record.message === 'install state not recorded')).toBe(true);
        cards.dispose();
    });

    it('badPath_aPassingGoogleOutageIsNeverRecorded', async () => {
        // Finding 5 of the M6 review: a recorded `unavailable` made Setup look not done until the next look with a token.
        const { harness, ctx, cards } = setup('normal');
        harness.google.grant('cloudPlatform');
        harness.installer.observe.mockResolvedValueOnce(observed({ installed: { complete: true, release: ADMIN_RELEASE } }));
        harness.installer.observe.mockRejectedValue(googleError('unavailable'));

        cards.watch(['server']);
        await flush();
        await harness.clock.advance(60_000);
        await flush();

        expect(ctx.state().install.server.state).toBe('unavailable');
        expect(harness.backend.recordCloud).toHaveBeenCalledTimes(1);
        expect(harness.backend.recordCloud.mock.calls[0]?.[0]).toMatchObject({ install: { server: { state: 'installed' } } });
        cards.dispose();
    });

    it('badPath_aServerStoppedAtAPermissionOfStepCMarksItsIamItemOnce @S-A55-BAD-NO-ACTAS', async () => {
        // Finding 28 of 2026-10-31: firebase-tools' actAs check on the App Engine default account stopped the install.
        const { harness, ctx, cards } = setup();
        harness.google.grant('cloudPlatform');
        const stopped = { ...build('server', 'FAILURE'), steps: [{ id: 'functions', status: 'FAILURE' as const }] };
        harness.installer.observe.mockResolvedValue(observed({ build: stopped }));
        const text = 'Error: Missing permissions required for functions deploy. You must have permission iam.serviceAccounts.ActAs';
        harness.installer.buildLog.mockResolvedValue([{ step: 'functions', text, time: '' }]);

        cards.watch(['server']);
        await flush();

        expect(ctx.state().install.server).toMatchObject({ state: 'failed', failedStep: 'functions', fixInProvision: true });
        expect(ctx.state().provision.items.find((item) => item.id === 'iam')).toEqual({
            id: 'iam',
            state: 'invalid',
            detail: { key: 'adminSetup.provision.installerPermission' },
        });
        // Steps (d) onwards wait for (c): its chip stays, so the server card that says what to do stays open.
        expect(ctx.state().steps.provision.state).toBe('ok');
        expect(ctx.state().steps.deploy.available).toBe(true);

        // Retry what failed made the item right; later looks at the same stopped build leave it alone.
        ctx.update((state) => ({
            ...state,
            provision: { items: state.provision.items.map((item) => ({ ...item, state: 'ok' as const })) },
        }));
        await harness.clock.advance(60_000);
        await flush();
        expect(ctx.state().provision.items.find((item) => item.id === 'iam')?.state).toBe('ok');
        cards.dispose();
    });

    it('badPath_inStartUpModeNothingIsSentToTheServer', async () => {
        const { harness, cards } = setup('bootstrap');
        harness.google.grant('cloudPlatform');

        cards.watch(['server']);
        await flush();

        expect(harness.backend.recordCloud).not.toHaveBeenCalled();
        cards.dispose();
    });
});

describe('records: the pipeline image (finding 74 of 2026-11-03)', () => {
    it('happyPath_thePipelineIsRecordedAgainWhenTheImageItsJobRunsChanges @S-A62-HAPPY-STARTER-IMAGE-UPDATE', async () => {
        // Finding 74 of 2026-11-03: the state stays installed while the job's image changes; the record follows the image.
        const { harness, cards } = setup('normal');
        harness.google.grant('cloudPlatform');
        const first = `sha256:${'ae'.repeat(32)}`;
        const second = `sha256:${'eb'.repeat(32)}`;
        harness.installer.observe.mockResolvedValue(observed({ installed: { complete: true, release: ADMIN_RELEASE, image: first } }));

        cards.watch(['pipeline']);
        await flush();
        harness.installer.observe.mockResolvedValue(observed({ installed: { complete: true, release: ADMIN_RELEASE, image: second } }));
        await harness.clock.advance(60_000);
        await flush();
        await harness.clock.advance(60_000);
        await flush();

        const images = harness.backend.recordCloud.mock.calls.map(([request]) => request.install?.pipeline?.image);
        expect(images).toEqual([first, second]);
        cards.dispose();
    });
});

describe('a build recorded at work (the review of 6858f8a)', () => {
    const AT_WORK = { state: 'working' as const, recorded: true, buildId: 'b-recorded', checkedAt: '2026-11-08T09:00:00.000Z' };

    function recordedServer(ctx: ReturnType<typeof setup>['ctx']): void {
        ctx.update((state) => ({ ...state, install: { ...state.install, server: { ...state.install.server, ...AT_WORK } } }));
    }

    it('happyPath_theCardSaysItIsLookingOnlyWhileTheLookRuns_thenShowsWhatTheLookSaw', async () => {
        const { harness, ctx, cards } = setup('normal');
        recordedServer(ctx);
        harness.google.grant('cloudPlatform');
        const pending: { answer?: (observation: TargetObservation) => void } = {};
        harness.installer.observe.mockImplementation(
            () =>
                new Promise<TargetObservation>((resolve) => {
                    pending.answer = resolve;
                }),
        );
        expect(ctx.state().install.server.looking).toBe(false);

        cards.watch(['server']);
        await flush();
        expect(ctx.state().install.server).toMatchObject({ ...AT_WORK, looking: true });

        pending.answer?.(observed({ installed: { complete: true, release: '0.9.0' } }));
        await flush();
        expect(ctx.state().install.server).toMatchObject({ state: 'updateAvailable', recorded: false, looking: false });
        cards.dispose();
    });

    it('badPath_withoutATokenNothingLooks_andAFailedLookKeepsItRecordedAtWorkWithItsError', async () => {
        const { harness, ctx, cards } = setup('normal');
        recordedServer(ctx);

        cards.watch(['server']);
        await flush();
        expect(ctx.state().install.server).toMatchObject({ ...AT_WORK, looking: false });

        harness.google.grant('cloudPlatform');
        harness.installer.observe.mockRejectedValue(googleError('unavailable'));
        await cards.recheck('server');
        await flush();
        // Unavailable is no running state: Update the map came back beside a build that may still run.
        expect(ctx.state().install.server).toMatchObject({ ...AT_WORK, looking: false, error: { key: 'apiError.unavailable' } });
        expect(harness.backend.recordCloud).not.toHaveBeenCalled();
        cards.dispose();
    });
});

describe("Update the map while a read of the server's build fails (the review of the stale fixes)", () => {
    it('badPath_aFailedReadOfTheServersBuildAtWorkNeverLetsProvisionsRecordGoIn @S-A55-BAD-UPDATE-DURING-BUILD', async () => {
        const { harness, ctx, cards, recordable } = setup('normal');
        const server = { phase: 'old' as 'old' | 'working' | 'blip' | 'done' };
        harness.installer.observe.mockImplementation((target) => {
            if (target !== 'server' || server.phase === 'old') {
                return Promise.resolve(observed({ installed: { complete: true, release: target === 'server' ? '0.9.0' : ADMIN_RELEASE } }));
            }
            if (server.phase === 'blip') {
                return Promise.reject(googleError('unavailable'));
            }
            const done = server.phase === 'done';
            const installed = { complete: true, release: done ? ADMIN_RELEASE : '0.9.0' };
            return Promise.resolve(observed({ installed, build: build('server', done ? 'SUCCESS' : 'WORKING') }));
        });
        harness.google.grant('cloudPlatform');
        cards.watch(['server', 'pipeline', 'site']);
        await flush();
        ctx.update((state) => ({ ...state, install: { ...state.install, provisionDue: ['bucket-lifecycle'] } }));

        await cards.updateMap('deploy');
        server.phase = 'working';
        await harness.clock.advance(10_000);
        await flush();
        server.phase = 'blip';
        await harness.clock.advance(10_000);
        await flush();

        expect(ctx.state().install.server).toMatchObject({ state: 'working', error: { key: 'apiError.unavailable' } });
        expect(recordable).toEqual([false]);
        server.phase = 'done';
        await harness.clock.advance(120_000);
        await flush();
        expect(ctx.state().install.server).toMatchObject({ state: 'installed', error: null });
        expect(recordable).toEqual([true]);
        cards.dispose();
    });

    it('badPath_aReadThatFailsAtTheClickSettlesNothing_theNextLookDoes', async () => {
        const { harness, ctx, cards, recordable } = setup('normal');
        const recorded = { state: 'updateAvailable' as const, installedRelease: '0.9.0', checkedAt: '2026-11-08T09:00:00.000Z' };
        ctx.update((state) => ({
            ...state,
            install: { ...state.install, provisionDue: ['bucket-lifecycle'], server: { ...state.install.server, ...recorded } },
        }));
        harness.google.grant('cloudPlatform');
        harness.installer.observe.mockRejectedValue(googleError('unavailable'));

        await cards.updateMap('deploy');
        await flush();

        expect(ctx.state().install.server).toMatchObject({ state: 'unavailable', busy: false });
        expect(harness.installer.submit).not.toHaveBeenCalled();
        expect(recordable).toEqual([false]);
        harness.installer.observe.mockResolvedValue(observed({ installed: { complete: true, release: '0.9.0' } }));
        await harness.clock.advance(120_000);
        await flush();
        expect(recordable).toEqual([true]);
        cards.dispose();
    });
});
