import { createLogger, installReleaseSlug, type InstallTarget } from '@hcm/shared';
import {
    NEWER_BUILD_RELEASE,
    NEWER_BUILD_TIME,
    NEWER_SERVER_RELEASE,
    PIPELINE_DIGEST,
    PLANTED_LOG_SECRETS,
    registryFunctions,
} from '@hcm/test-support/fakes';
import { describe, expect, it, vi } from 'vitest';

import type { CloudBuild } from '../../src/google/cloud-build.js';
import { InstallBundleError } from '../../src/install/bundle.js';
import { createInstallFlow, IDLE_LOOK_MS, RUNNING_LOOK_MS, type InstallFlowDeps } from '../../src/install/install-flow.js';
import type { InstallTargetView } from '../../src/install/model.js';
import type { InstallAccess, InstallerPort } from '../../src/install/ports.js';
import { FakeClock, FakeVisibility, flush, googleError, START as START_MS } from '../setup/harness.js';
import { ACCESS, installWorld, RELEASE, RELEASE_TIME, type InstallWorld } from './world.js';

/**
 * One install target as its card follows it (`docs/research/M6-interfaces.md` §1.5, §1.7): looks on the injected clock,
 * the build's log read when it matters, a click that installs once, a race retried inside the build, a build Google
 * ended submitted again once.
 */

interface FlowWorld {
    readonly clock: FakeClock;
    readonly views: InstallTargetView[];
    readonly expired: ReturnType<typeof vi.fn>;
    readonly paused: ReturnType<typeof vi.fn>;
    readonly flow: ReturnType<typeof createInstallFlow>;
    live: InstallAccess | null;
    click: InstallAccess | null;
    readonly latest: () => InstallTargetView;
}

function flowOver(installer: InstallerPort, target: InstallTarget = 'server'): FlowWorld {
    const clock = new FakeClock();
    const views: InstallTargetView[] = [];
    const expired = vi.fn();
    const paused = vi.fn();
    const state = { live: ACCESS as InstallAccess | null, click: ACCESS as InstallAccess | null };
    const deps: InstallFlowDeps = {
        target,
        installer,
        clock,
        visibility: new FakeVisibility(),
        log: createLogger('test', { sink: () => undefined }),
        release: RELEASE,
        releaseTime: RELEASE_TIME,
        liveAccess: () => state.live,
        clickAccess: () => Promise.resolve(state.click),
        report: (view) => {
            views.push(view);
        },
        expired,
        paused,
    };
    const flow = createInstallFlow(deps);
    return Object.assign(state, {
        clock,
        views,
        expired,
        paused,
        flow,
        latest: () => {
            const view = views.at(-1);
            if (view === undefined) {
                throw new Error('no view yet');
            }
            return view;
        },
    });
}

/** The flow over the fake upstreams (the returned object is the one the flow reads `live` and `click` from). */
async function world(target: InstallTarget = 'server'): Promise<{ readonly install: InstallWorld } & FlowWorld> {
    const install = await installWorld();
    return Object.assign(flowOver(install.installer, target), { install });
}

describe('watching', () => {
    it('happyPath_aTargetIsLookedAtNowThenEveryMinuteWhileNothingRuns', async () => {
        const { install, clock, flow } = await world();

        flow.watch();
        await vi.waitFor(() => {
            expect(flow.view().checkedAt).not.toBeNull();
        });
        expect(flow.view()).toMatchObject({ state: 'notInstalled', blocker: null, checkedAt: new Date(clock.now()).toISOString() });
        const looks = install.fakes.callsTo('cloud-build.builds.list').length;

        await clock.advance(RUNNING_LOOK_MS);
        expect(install.fakes.callsTo('cloud-build.builds.list')).toHaveLength(looks);
        await clock.advance(IDLE_LOOK_MS);
        expect(install.fakes.callsTo('cloud-build.builds.list')).toHaveLength(looks + 1);
        flow.dispose();
    });

    it('badPath_withoutALiveTokenNothingIsAsked', async () => {
        const w = await world();
        w.live = null;

        w.flow.watch();
        await flush();
        await w.flow.refresh();

        expect(w.install.fakes.callsTo('cloud-build.builds.list')).toHaveLength(0);
        expect(w.clock.pending()).toBe(0);
        // Nothing at work: nothing to follow, so no Continue either.
        expect(w.paused).not.toHaveBeenCalled();
    });
});

describe('a build at work without a token (the live finding of 2026-11-14)', () => {
    it('badPath_aBuildAtWorkWhoseTokenRanOutPausesTheWatchAndSaysSo_neverFreezesSilently', async () => {
        // The live finding of 2026-11-14: the token's hour ran out while the server built; the watch stopped without a
        // word and the card stayed on "Build the pipeline's image" until Check again.
        const w = await world('pipeline');
        await w.flow.install();
        w.install.fakes.scenario('cloud-build.start');
        await w.clock.advance(RUNNING_LOOK_MS);
        expect(w.latest().state).toBe('working');
        expect(w.paused).not.toHaveBeenCalled();

        w.live = null;
        await w.clock.advance(RUNNING_LOOK_MS);

        expect(w.paused).toHaveBeenCalledTimes(1);
        expect(w.clock.pending()).toBe(0);
        w.flow.dispose();
    });
});

describe('installing', () => {
    it('happyPath_oneClickQueuesOneBuildThatIsFollowedUntilTheServerIsInstalled', async () => {
        const { install, clock, flow, latest } = await world();

        await flow.install();
        expect(latest()).toMatchObject({ state: 'queued', busy: false, error: null });
        expect(install.fakes.callsTo('cloud-build.builds.create')).toHaveLength(1);

        install.fakes.scenario('cloud-build.start');
        await clock.advance(RUNNING_LOOK_MS);
        expect(latest().state).toBe('working');
        expect(latest().steps[0]).toEqual({ id: 'fetch', state: 'now' });

        install.fakes.scenario('cloud-build.finish');
        await clock.advance(RUNNING_LOOK_MS);
        expect(latest()).toMatchObject({ state: 'installed', installedRelease: RELEASE });
        expect(latest().consoleUrl).toContain(latest().buildId ?? 'none');
        flow.dispose();
    });

    it('badPath_aBuildAlreadyQueuedIsFollowedNotDoubled', async () => {
        const { install, flow, latest } = await world();
        install.fakes.scenario('cloud-build.serverQueuedElsewhere');

        await flow.install();

        expect(install.fakes.callsTo('cloud-build.builds.create')).toHaveLength(0);
        expect(latest().state).toBe('queued');
        flow.dispose();
    });

    it('badPath_aNewerServerIsNeverReplaced', async () => {
        const { install, flow, latest } = await world();
        install.fakes.scenario('cloud-functions.deployedNewerRelease');

        await flow.install();

        expect(install.fakes.callsTo('cloud-build.builds.create')).toHaveLength(0);
        expect(latest().state).toBe('newerInstalled');
        flow.dispose();
    });

    it('badPath_aNewerServerMissingAFunctionIsNamedAndNeverReplaced', async () => {
        const { install, flow, latest } = await world();
        install.fakes.scenario('cloud-functions.partialNewerRelease');

        await flow.install();

        expect(install.fakes.callsTo('cloud-build.builds.create')).toHaveLength(0);
        expect(latest()).toMatchObject({ state: 'newerInstalled', installedRelease: NEWER_SERVER_RELEASE });
        flow.dispose();
    });

    it('happyPath_anOlderBuildOfTheAdminsVersionIsUpdated', async () => {
        // Finding 39 of 2026-11-01: every release is 1.0.0; the server deployed before the build times is behind this admin.
        const { install, flow, latest } = await world();
        install.fakes.scenario('cloud-functions.deployedOlderBuild');

        await flow.install();

        expect(install.fakes.callsTo('cloud-build.builds.create')).toHaveLength(1);
        expect(latest()).toMatchObject({ state: 'queued' });
        flow.dispose();
    });

    it('badPath_aNewerBuildOfTheAdminsVersionIsNamedWithItsTimeAndNeverReplaced', async () => {
        const { install, flow, latest } = await world();
        install.fakes.scenario('cloud-functions.deployedNewerBuild');

        await flow.install();

        expect(install.fakes.callsTo('cloud-build.builds.create')).toHaveLength(0);
        expect(latest()).toMatchObject({
            state: 'newerInstalled',
            installedRelease: NEWER_BUILD_RELEASE,
            installedReleaseTime: NEWER_BUILD_TIME,
        });
        flow.dispose();
    });

    it('happyPath_theOwnersOverrideInstallsTheAdminsReleaseOverANewerOne', async () => {
        // The live finding of 2026-11-12: "Install this admin's version anyway", confirmed, is a rollback with its tag.
        const { install, flow, latest } = await world();
        install.fakes.scenario('cloud-functions.deployedNewerRelease');

        await flow.installOver(ACCESS);

        const calls = install.fakes.callsTo('cloud-build.builds.create');
        expect(calls).toHaveLength(1);
        expect((JSON.parse(calls[0]?.body ?? '{}') as { tags: string[] }).tags).toContain('hcm-over');
        expect(latest().state).toBe('queued');
        flow.dispose();
    });

    it('badPath_theOverrideOverAnOlderServerIsAPlainUpdate_andOverOneInPlaceSubmitsNothing', async () => {
        const older = await world();
        older.install.fakes.scenario('cloud-functions.deployedOlderRelease');
        await older.flow.installOver(ACCESS);
        const calls = older.install.fakes.callsTo('cloud-build.builds.create');
        expect(calls).toHaveLength(1);
        expect((JSON.parse(calls[0]?.body ?? '{}') as { tags: string[] }).tags).not.toContain('hcm-over');
        older.flow.dispose();

        const queued = await world();
        queued.install.fakes.scenario('cloud-build.serverQueuedElsewhere');
        await queued.flow.installOver(ACCESS);
        expect(queued.install.fakes.callsTo('cloud-build.builds.create')).toHaveLength(0);
        queued.flow.dispose();
    });

    it('badPath_aBlockedTargetSubmitsNothing', async () => {
        const { install, flow, latest } = await world('pipeline');
        install.fakes.state.artifactRegistry.repositories.clear();

        await flow.install();

        expect(install.fakes.callsTo('cloud-build.builds.create')).toHaveLength(0);
        expect(latest().blocker).toEqual({ key: 'apiError.install.noRepository', params: { repository: 'hcm' } });
        flow.dispose();
    });

    it('badPath_aConsentNotGivenLeavesTheCardAsItWas', async () => {
        const w = await world();
        w.click = null;

        await w.flow.install();

        expect(w.install.fakes.callsTo('cloud-build.builds.create')).toHaveLength(0);
        expect(w.latest()).toMatchObject({ state: 'notInstalled', busy: false });
    });

    it('happyPath_anOlderServerIsUpdatedWithTheHoldersToken', async () => {
        const { install, flow, latest } = await world();
        install.fakes.scenario('cloud-functions.deployedOlderRelease');

        await flow.installWith(ACCESS);

        expect(install.fakes.callsTo('cloud-build.builds.create')).toHaveLength(1);
        expect(latest().state).toBe('queued');
        flow.dispose();
    });
});

describe('what the build says', () => {
    it('happyPath_aFirstDeployRaceIsShownAsARetryWithItsTime', async () => {
        const { install, clock, flow, latest } = await world();
        install.fakes.scenario('cloud-build.serverRetries');
        await flow.install();
        install.fakes.scenario('cloud-build.start');

        await clock.advance(RUNNING_LOOK_MS);

        expect(latest()).toMatchObject({ state: 'retrying', retryReason: 'eventarcAgent' });
        expect(latest().retryAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        install.fakes.scenario('cloud-build.finish');
        await clock.advance(RUNNING_LOOK_MS);
        expect(latest().state).toBe('installed');
        flow.dispose();
    });

    it('badPath_aProjectWhoseInstallerMayNotActAsTheAppEngineAccountStopsAtFunctionsWithTheFixInStepC', async () => {
        // Finding 28 of 2026-10-31: the fake's server step enforces firebase-tools' checkServiceAccountIam as the live one.
        const { install, clock, flow, latest } = await world();
        install.fakes.scenario('iam.appEngineActAsMissing');
        await flow.install();
        install.fakes.scenario('cloud-build.finish');

        await clock.advance(RUNNING_LOOK_MS);

        expect(latest()).toMatchObject({ state: 'failed', failedStep: 'functions', fixInProvision: true });
        // The address is redacted as every e-mail address of a log is; the permission stays.
        expect(latest().log.join('\n')).toContain('You must have permission iam.serviceAccounts.ActAs on service account [redacted].');
        flow.dispose();
    });

    it('badPath_theCloudFunctionsApis403ForTheBuildAccountIsFoundAboveTheTailAndSendsTheOwnerToStepC @S-A55-BAD-NO-COMPUTE-ACTAS', async () => {
        // Finding 33 of 2026-10-31: the API refuses every function's build as the Compute Engine default account; the 403s
        // come before one summary line per function, so the card's last lines name functions only.
        const { install, clock, flow, latest } = await world();
        install.fakes.scenario('iam.computeActAsMissing');
        await flow.install();
        install.fakes.scenario('cloud-build.finish');

        await clock.advance(RUNNING_LOOK_MS);

        expect(latest()).toMatchObject({ state: 'failed', failedStep: 'functions', fixInProvision: true });
        expect(latest().log.at(-1)).toBe('Error: There was an error deploying functions');
        expect(latest().log.join('\n')).not.toContain('iam.serviceaccounts.actAs');
        flow.dispose();
    });

    it('badPath_aStoppedBuildNamesItsStepAndShowsItsRedactedLog', async () => {
        const { install, clock, flow, latest } = await world();
        install.fakes.scenario('cloud-build.serverFailsAtFunctions');
        await flow.install();
        install.fakes.scenario('cloud-build.finish');

        await clock.advance(RUNNING_LOOK_MS);

        expect(latest()).toMatchObject({ state: 'failed', failedStep: 'functions', fixInProvision: false });
        expect(latest().log.length).toBeGreaterThan(0);
        expect(latest().log.join('\n')).not.toContain(PLANTED_LOG_SECRETS[0]);
        const reads = install.fakes.callsTo('logging.entries.list').length;
        await clock.advance(IDLE_LOOK_MS);
        expect(install.fakes.callsTo('logging.entries.list')).toHaveLength(reads);
        flow.dispose();
    });

    it('badPath_retriesExhaustedNameTheMissingFunctions', async () => {
        const { install, clock, flow, latest } = await world();
        install.fakes.scenario('cloud-build.serverRetriesExhausted');
        await flow.install();
        install.fakes.scenario('cloud-build.finish');

        await clock.advance(RUNNING_LOOK_MS);

        expect(latest()).toMatchObject({ state: 'failed', failedStep: 'verify', missing: registryFunctions().slice(0, 2) });
        flow.dispose();
    });

    it('happyPath_aPipelineWaitingOutCloudRunsRateIsShownAsARetryThenInstalled', async () => {
        // Finding 47 of 2026-11-01: the `jobs` step's retry line; a working pipeline build's log is read for it.
        const { install, clock, flow, latest } = await world('pipeline');
        install.fakes.scenario('cloud-build.pipelineRetriesAtJobs');
        await flow.install();
        install.fakes.scenario('cloud-build.start');

        await clock.advance(RUNNING_LOOK_MS);
        expect(latest()).toMatchObject({ state: 'retrying', retryReason: 'quota', quota: null });

        install.fakes.scenario('cloud-build.finish');
        await clock.advance(RUNNING_LOOK_MS);
        expect(latest()).toMatchObject({ state: 'installed', quota: null });
        flow.dispose();
    });

    it('happyPath_aPipelineThatEndedWellNamesItsImagesDigest', async () => {
        // M7 (docs/research/M7-local-worker.md §1.1): the push step's `image` event, read once the build ended well.
        const { install, clock, flow, latest } = await world('pipeline');
        await flow.install();
        expect(latest().image).toBeNull();
        install.fakes.scenario('cloud-build.finish');

        await clock.advance(RUNNING_LOOK_MS);

        expect(latest()).toMatchObject({ state: 'installed', image: PIPELINE_DIGEST });
        // Another build under way keeps the digest of the one installed until it names its own.
        await flow.install();
        expect(latest().image).toBe(PIPELINE_DIGEST);
        flow.dispose();
    });

    it('badPath_aPipelineStoppedForAQuotaNamesIt', async () => {
        const { install, clock, flow, latest } = await world('pipeline');
        install.fakes.scenario('cloud-build.pipelineFailsAtJobsQuota');
        await flow.install();
        install.fakes.scenario('cloud-build.finish');

        await clock.advance(RUNNING_LOOK_MS);

        expect(latest()).toMatchObject({
            state: 'failed',
            failedStep: 'jobs',
            quota: {
                event: 'quota',
                service: 'run.googleapis.com',
                metric: 'run.googleapis.com/cpu_allocation',
                limit: 'CpuAllocPerProjectRegion',
            },
        });
        // Try again starts a new build: the quota line goes with the stopped one.
        await flow.install();
        expect(latest()).toMatchObject({ state: 'queued', quota: null });
        flow.dispose();
    });

    it('happyPath_aBuildGoogleEndedIsSubmittedAgainOnce', async () => {
        const { install, clock, flow, latest } = await world();
        install.fakes.scenario('cloud-build.serverInternalError');
        await flow.install();
        install.fakes.scenario('cloud-build.finish');

        await clock.advance(RUNNING_LOOK_MS);
        expect(install.fakes.callsTo('cloud-build.builds.create')).toHaveLength(2);
        expect(latest().state).toBe('queued');

        install.fakes.scenario('cloud-build.finish');
        await clock.advance(RUNNING_LOOK_MS);
        await clock.advance(IDLE_LOOK_MS);
        expect(install.fakes.callsTo('cloud-build.builds.create')).toHaveLength(2);
        expect(latest().state).toBe('failed');
        flow.dispose();
    });
});

describe('how long a build has been at work (the live finding of 2026-11-08)', () => {
    it('happyPath_theTimeAtWorkCountsOnTheBrowsersClockFromTheLookThatSawItStart', async () => {
        const { install, clock, flow, latest } = await world();
        await flow.install();
        install.fakes.scenario('cloud-build.start');
        await clock.advance(RUNNING_LOOK_MS);
        const since = new Date(clock.now()).toISOString();
        expect(latest()).toMatchObject({ state: 'working', runningSince: since, checkedAt: since });

        await clock.advance(18 * RUNNING_LOOK_MS);
        expect(latest().runningSince).toBe(since);
        expect(Date.parse(latest().checkedAt ?? '') - Date.parse(since)).toBe(180_000);
        flow.dispose();
    });

    it('badPath_aQueuedBuildHasNoTimeAtWork_whateverGooglesClockSaysOfItsCreation', async () => {
        // Right after Update the map, step d said "Running for 3 min." at once: Google's creation time against the
        // browser's clock. The fake Cloud Build's clock is the host's; the flow's is days away from it.
        const { install, clock, flow, latest } = await world();
        await flow.install();
        await clock.advance(RUNNING_LOOK_MS);

        expect(latest()).toMatchObject({ state: 'queued', runningSince: null });
        expect(latest().startedAt).not.toBeNull();
        expect(install.fakes.callsTo('cloud-build.builds.create')).toHaveLength(1);
        flow.dispose();
    });

    it('happyPath_aLookSaysItIsUnderWay_badPath_aFailedLookEndsIt', async () => {
        const observe = vi.fn<InstallerPort['observe']>().mockRejectedValue(googleError('unavailable'));
        const views: InstallTargetView[] = [];
        const { flow, latest } = flowOver({
            observe: (...args) => {
                views.push(latest());
                return observe(...args);
            },
            submit: () => Promise.reject(new Error('no submit')),
            buildLog: () => Promise.resolve([]),
            consoleUrl: (id) => id,
            localBlocker: () => Promise.resolve(null),
        });

        await flow.refresh();

        expect(views.map((view) => view.looking)).toEqual([true]);
        expect(latest()).toMatchObject({ state: 'unavailable', looking: false });
        flow.dispose();
    });
});

/** A server build of the admin's release at work since `startTime`, one long step under way since `stepStart`. */
function serverAtWork(startTime: string, stepStart: string): CloudBuild {
    return {
        id: 'b-long',
        status: 'WORKING',
        startTime,
        createTime: startTime,
        steps: [{ id: 'deploy', status: 'WORKING', startTime: stepStart }],
        tags: ['hcm-install', 'hcm-server', `hcm-r-${installReleaseSlug(RELEASE)}`],
        substitutions: {},
    };
}

/** An installer whose only answer is `observe`'s. */
function observing(observe: InstallerPort['observe']): InstallerPort {
    return {
        observe,
        submit: () => Promise.reject(new Error('no submit')),
        buildLog: () => Promise.resolve([]),
        consoleUrl: (id) => id,
        localBlocker: () => Promise.resolve(null),
    };
}

describe('a build first seen at work, and a read that fails while it works (the review of the stale fixes)', () => {
    it('happyPath_aBuildFirstSeenNineMinutesInCountsNineMinutes_notTheTimeOfItsLastStepStart', async () => {
        // Its deploy step started 40 s in and runs 10 min: the line said "Running for 0 min." for a 9-minute build.
        const at = (ms: number): string => new Date(START_MS + ms).toISOString();
        const observe = vi.fn<InstallerPort['observe']>().mockResolvedValue({
            installed: { complete: true, release: '0.9.0' },
            build: serverAtWork(at(-540_000), at(-500_000)),
            progress: null,
            blocker: null,
        });
        const { flow, latest } = flowOver(observing(observe));

        await flow.refresh();

        expect(latest()).toMatchObject({ state: 'working', runningSince: at(-540_000), checkedAt: at(0) });
        flow.dispose();
    });

    it('badPath_aReadThatFailsWhileTheBuildWorksKeepsItAtWorkWithTheError_neverUnavailable', async () => {
        // Unavailable is no running state: Update the map came back and Provision's record went to the old server.
        const at = (ms: number): string => new Date(START_MS + ms).toISOString();
        const observe = vi.fn<InstallerPort['observe']>().mockResolvedValueOnce({
            installed: { complete: true, release: '0.9.0' },
            build: serverAtWork(at(-60_000), at(-50_000)),
            progress: null,
            blocker: null,
        });
        observe.mockRejectedValue(googleError('unavailable'));
        const { flow, latest } = flowOver(observing(observe));

        await flow.refresh();
        await flow.refresh();

        expect(latest()).toMatchObject({ state: 'working', buildId: 'b-long', looking: false, error: { key: 'apiError.unavailable' } });
        flow.dispose();
    });
});

describe('failures', () => {
    function port(changes: Partial<InstallerPort>): InstallerPort {
        return {
            observe: () => Promise.resolve({ installed: { complete: false, release: null }, build: null, progress: null, blocker: null }),
            submit: () => Promise.reject(new InstallBundleError('apiError.install.bundleMissing')),
            buildLog: () => Promise.resolve([]),
            consoleUrl: (id) => id,
            localBlocker: () => Promise.resolve(null),
            ...changes,
        };
    }

    it('badPath_aBundleThatCannotBeUsedIsSaidOnTheCard', async () => {
        const { flow, latest } = flowOver(port({}));

        await flow.install();

        expect(latest()).toMatchObject({ error: { key: 'apiError.install.bundleMissing' }, busy: false });
        flow.dispose();
    });

    it('badPath_anAdminReplacedMeanwhileNamesTheNewerRelease', async () => {
        const refused = new InstallBundleError('apiError.install.adminOutdated', { release: '1.0.1+def5678' });
        const { flow, latest } = flowOver(port({ submit: () => Promise.reject(refused) }));

        await flow.install();

        expect(latest()).toMatchObject({
            error: { key: 'apiError.install.adminOutdated', params: { release: '1.0.1+def5678' } },
            busy: false,
        });
        flow.dispose();
    });

    it('badPath_anUnavailableGoogleIsShownAndLookedAtAgainLater', async () => {
        const observe = vi.fn<InstallerPort['observe']>().mockRejectedValueOnce(googleError('unavailable'));
        const { clock, flow, latest } = flowOver(port({ observe }));

        flow.watch();
        await flush();
        expect(latest()).toMatchObject({ state: 'unavailable', error: { key: 'apiError.unavailable' } });

        observe.mockResolvedValue({ installed: { complete: false, release: null }, build: null, progress: null, blocker: null });
        await clock.advance(4 * RUNNING_LOOK_MS);
        expect(latest()).toMatchObject({ state: 'notInstalled', error: null });
        flow.dispose();
    });

    it('badPath_anExpiredTokenStopsTheWatchAndSaysSo', async () => {
        const observe = vi.fn<InstallerPort['observe']>().mockRejectedValue(googleError('unauthorized'));
        const { clock, flow, expired, latest } = flowOver(port({ observe }));

        flow.watch();
        await flush();

        expect(expired).toHaveBeenCalledTimes(1);
        expect(latest().error).toEqual({ key: 'adminShell.session.googleExpired' });
        expect(clock.pending()).toBe(0);
    });

    it('badPath_aRefusalThatIsNotUnavailableKeepsTheState', async () => {
        const observe = vi.fn<InstallerPort['observe']>().mockRejectedValue(googleError('forbidden', { api: 'cloudbuild.googleapis.com' }));
        const { flow, latest } = flowOver(port({ observe }));

        await flow.refresh();

        expect(latest()).toMatchObject({ state: 'notInstalled', error: { key: 'apiError.cloud.apiDisabled' } });
    });

    describe("a blocker of the admin's own data, with no Google token", () => {
        const NOTHING = { key: 'apiError.install.nothingToShow' } as const;

        function blockedSite(localBlocker: InstallerPort['localBlocker']): FlowWorld {
            const observe = vi
                .fn<InstallerPort['observe']>()
                .mockResolvedValue({ installed: { complete: false, release: null }, build: null, progress: null, blocker: NOTHING });
            return flowOver(port({ observe, localBlocker }), 'site');
        }

        it('happyPath_theFirstCityPublishedWhileTheTokenWasGoneLiftsTheSitesBlocker', async () => {
            const localBlocker = vi.fn<InstallerPort['localBlocker']>().mockResolvedValueOnce(NOTHING).mockResolvedValue(null);
            const w = blockedSite(localBlocker);
            w.flow.watch();
            await flush();
            expect(w.latest().blocker).toEqual(NOTHING);

            w.live = null;
            await w.clock.advance(IDLE_LOOK_MS);
            expect(w.latest().blocker).toEqual(NOTHING);
            await w.clock.advance(IDLE_LOOK_MS);

            expect(localBlocker).toHaveBeenCalledTimes(2);
            expect(localBlocker).toHaveBeenCalledWith('site');
            expect(w.latest().blocker).toBeNull();
            expect(w.clock.pending()).toBe(0);
        });

        it('badPath_aFailedReadKeepsTheBlockerAndAnotherBlockerStopsTheWatch', async () => {
            const w = blockedSite(() => Promise.reject(new Error('offline')));
            w.flow.watch();
            await flush();
            w.live = null;
            await w.clock.advance(IDLE_LOOK_MS);
            expect(w.latest().blocker).toEqual(NOTHING);
            w.flow.dispose();

            const other = flowOver(port({}), 'server');
            other.live = null;
            other.flow.watch();
            await flush();
            expect(other.clock.pending()).toBe(0);
        });
    });
});

describe('the pipeline image a finished update shows (finding 74 of 2026-11-03)', () => {
    it('badPath_aFinishedUpdateWhoseLogLagsStillNamesTheImageItsJobRuns', async () => {
        // Finding 74 of 2026-11-03: Cloud Logging had not yet the `jobs` step's last line (the `image` event) when the
        // card first saw the build end; the card kept the release before's digest beside the new release. The jobs run
        // the new image: that is the one shown, and a log read once more is not needed for it.
        const install = await installWorld();
        const installer: InstallerPort = {
            localBlocker: (target) => install.installer.localBlocker(target),
            observe: (target, access) => install.installer.observe(target, access),
            submit: (target, access) => install.installer.submit(target, access),
            buildLog: async (buildId, access) =>
                (await install.installer.buildLog(buildId, access)).filter((line) => !line.text.includes('"event":"image"')),
            consoleUrl: (buildId) => install.installer.consoleUrl(buildId),
        };
        const { clock, flow, latest } = flowOver(installer, 'pipeline');
        await flow.install();
        install.fakes.scenario('cloud-build.finish');

        await clock.advance(RUNNING_LOOK_MS);

        expect(latest()).toMatchObject({ state: 'installed', installedRelease: RELEASE, image: PIPELINE_DIGEST });
        flow.dispose();
    });
});
