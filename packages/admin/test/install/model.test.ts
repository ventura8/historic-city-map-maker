import { describe, expect, it } from 'vitest';

import type { CloudBuild } from '../../src/google/cloud-build.js';
import {
    buildSlug,
    deriveInstallState,
    elapsedOnGoogle,
    workStartOnBrowser,
    endedByGoogle,
    failedStepOf,
    fixedInProvision,
    hasEnded,
    initialInstallSlice,
    initialTargetView,
    isRunning,
    missingFunctions,
    pendingRetry,
    recordedState,
    releaseState,
    stepsOf,
    type StateInput,
} from '../../src/install/model.js';

const RELEASE = '1.0.0+abc1234';
const SLUG = '1-0-0-abc1234';
const RELEASE_TIME = 1_761_955_200;

function build(changes: Partial<CloudBuild> = {}): CloudBuild {
    return { id: 'b-1', status: 'WORKING', steps: [], tags: ['hcm-install', 'hcm-server', `hcm-r-${SLUG}`], substitutions: {}, ...changes };
}

function input(changes: Partial<StateInput> = {}): StateInput {
    return {
        installed: { complete: false, release: null },
        build: null,
        bundle: { release: RELEASE, time: RELEASE_TIME },
        bundleSlug: SLUG,
        retrying: false,
        missing: [],
        ...changes,
    };
}

describe('deriveInstallState', () => {
    it('happyPath_nothingAndNoBuildIsNotInstalled_theAdminsReleaseIsInstalled', () => {
        expect(deriveInstallState(input())).toBe('notInstalled');
        expect(deriveInstallState(input({ installed: { complete: true, release: RELEASE } }))).toBe('installed');
    });

    it('happyPath_aBuildThatRunsDecidesFirst', () => {
        const installed = { complete: true, release: RELEASE };

        expect(deriveInstallState(input({ installed, build: build({ status: 'QUEUED' }) }))).toBe('queued');
        expect(deriveInstallState(input({ build: build({ status: 'PENDING' }) }))).toBe('queued');
        expect(deriveInstallState(input({ build: build() }))).toBe('working');
        expect(deriveInstallState(input({ build: build(), retrying: true }))).toBe('retrying');
    });

    it('happyPath_anOlderOrUnnamedReleaseOffersUpdate_aNewerOneIsNeverReplaced', () => {
        expect(deriveInstallState(input({ installed: { complete: true, release: '0.9.0+0000000' } }))).toBe('updateAvailable');
        expect(deriveInstallState(input({ installed: { complete: true, release: null } }))).toBe('updateAvailable');
        expect(deriveInstallState(input({ installed: { complete: true, release: '2.0.0+0000000' } }))).toBe('newerInstalled');
    });

    it('happyPath_aPartOfTheTargetInPlaceIsAnUpdate_notAFirstInstall', () => {
        // A server from before M6 that lacks M6's functions (finding 1 of the M6 review): Update the map, never Install.
        expect(deriveInstallState(input({ installed: { complete: false, release: null, partial: true, newest: null } }))).toBe(
            'updateAvailable',
        );
        expect(deriveInstallState(input({ installed: { complete: false, release: null, partial: false, newest: null } }))).toBe(
            'notInstalled',
        );
    });

    it('badPath_aNewerReleaseAnywhereIsNeverReplaced_evenWithAPartMissing', () => {
        // Finding 2 of the M6 security review: the deploy's --force would delete the newer release's functions.
        const incomplete = { complete: false, release: null, partial: true, newest: '2.0.0+0000000' };

        expect(deriveInstallState(input({ installed: incomplete }))).toBe('newerInstalled');
        expect(deriveInstallState(input({ installed: incomplete, build: build({ status: 'FAILURE' }) }))).toBe('newerInstalled');
        expect(deriveInstallState(input({ installed: { ...incomplete, newest: '0.9.0+0000000' } }))).toBe('updateAvailable');
        expect(deriveInstallState(input({ installed: { complete: true, release: RELEASE, newest: '2.0.0+0000000' } }))).toBe(
            'newerInstalled',
        );
    });

    it('badPath_aFailedBuildOfTheAdminsReleaseIsFailed_unlessTheReleaseIsInPlace', () => {
        const failed = build({ status: 'FAILURE' });

        expect(deriveInstallState(input({ build: failed }))).toBe('failed');
        expect(deriveInstallState(input({ build: build({ status: 'TIMEOUT' }), installed: { complete: true, release: '0.9.0' } }))).toBe(
            'failed',
        );
        expect(deriveInstallState(input({ build: failed, installed: { complete: true, release: RELEASE } }))).toBe('installed');
    });

    it('badPath_aFailedBuildOfAnotherReleaseIsHistory', () => {
        const other = build({ status: 'FAILURE', tags: ['hcm-install', 'hcm-server', 'hcm-r-0-9-0'] });

        expect(deriveInstallState(input({ build: other }))).toBe('notInstalled');
        expect(deriveInstallState(input({ build: build({ status: 'FAILURE', tags: [] }) }))).toBe('notInstalled');
    });

    it('badPath_aSucceededBuildWhoseVerifyNamedMissingFunctionsIsFailed', () => {
        expect(deriveInstallState(input({ build: build({ status: 'SUCCESS' }), missing: ['ops-tick'] }))).toBe('failed');
        expect(deriveInstallState(input({ build: build({ status: 'SUCCESS' }) }))).toBe('notInstalled');
    });
});

describe('builds of one version (finding 39 of 2026-11-01)', () => {
    const SAME_VERSION_OLDER = '1.0.0+9e2e6b5';
    const SAME_VERSION_NEWER = '1.0.0+fffffff';

    it('happyPath_anOlderBuildOfTheSameVersionOffersUpdate_withOrWithoutItsTime', () => {
        // The live server 1.0.0+9e2e6b5 was deployed before the build times: no time, a different commit, an update.
        expect(deriveInstallState(input({ installed: { complete: true, release: SAME_VERSION_OLDER } }))).toBe('updateAvailable');
        expect(
            deriveInstallState(input({ installed: { complete: true, release: SAME_VERSION_OLDER, releaseTime: RELEASE_TIME - 3600 } })),
        ).toBe('updateAvailable');
        // The same commit is installed whatever the times say.
        expect(deriveInstallState(input({ installed: { complete: true, release: RELEASE, releaseTime: null } }))).toBe('installed');
    });

    it('badPath_aNewerBuildOfTheSameVersionIsNeverReplaced_complete_orAPartOfIt', () => {
        const newer = { complete: true, release: SAME_VERSION_NEWER, releaseTime: RELEASE_TIME + 3600 };

        expect(deriveInstallState(input({ installed: newer }))).toBe('newerInstalled');
        expect(
            deriveInstallState(
                input({
                    installed: { complete: false, release: null, partial: true, newest: SAME_VERSION_NEWER, newestTime: RELEASE_TIME + 1 },
                }),
            ),
        ).toBe('newerInstalled');
        // An admin that knows no time of its own never replaces a timed build of its version.
        expect(deriveInstallState(input({ installed: newer, bundle: { release: RELEASE, time: null } }))).toBe('newerInstalled');
    });

    it('happyPath_aRecordedReleaseIsReadAgainAgainstThisAdmin', () => {
        const bundle = { release: RELEASE, time: RELEASE_TIME };

        // What the admin 1.0.0+9e2e6b5 recorded of itself: installed, no time. For this admin it is an update.
        expect(recordedState({ state: 'installed', release: SAME_VERSION_OLDER }, bundle)).toBe('updateAvailable');
        expect(recordedState({ state: 'updateAvailable', release: RELEASE }, bundle)).toBe('installed');
        expect(recordedState({ state: 'installed', release: SAME_VERSION_NEWER, releaseTime: RELEASE_TIME + 60 }, bundle)).toBe(
            'newerInstalled',
        );
    });

    it('badPath_aRecordWithoutARelease_aBuildUnderWay_orAnAdminWithoutOneKeepsWhatWasRecorded', () => {
        const bundle = { release: RELEASE, time: RELEASE_TIME };

        expect(recordedState({ state: 'installed' }, bundle)).toBe('installed');
        expect(recordedState({ state: 'failed', release: SAME_VERSION_OLDER }, bundle)).toBe('failed');
        expect(recordedState({ state: 'working', release: SAME_VERSION_OLDER }, bundle)).toBe('working');
        expect(recordedState({ state: 'installed', release: SAME_VERSION_OLDER }, { release: 'e2e', time: null })).toBe('installed');
        expect([releaseState(-1), releaseState(0), releaseState(1)]).toEqual(['updateAvailable', 'installed', 'newerInstalled']);
    });
});

describe('the build steps', () => {
    it('happyPath_theFirstStepNotDoneIsUnderWayWhileTheBuildWorks', () => {
        const working = build({
            steps: [
                { id: 'fetch', status: 'SUCCESS' },
                { id: 'tools', status: 'SUCCESS' },
                { id: 'packages', status: 'SUCCESS' },
                { id: 'rules', status: 'WORKING' },
            ],
        });

        expect(stepsOf('server', working).map((step) => step.state)).toEqual(['done', 'done', 'done', 'now', 'waiting', 'waiting']);
        expect(stepsOf('site', null).every((step) => step.state === 'waiting')).toBe(true);
        expect(stepsOf('pipeline', build({ status: 'QUEUED' })).map((step) => step.state)).toEqual([
            'waiting',
            'waiting',
            'waiting',
            'waiting',
        ]);
    });

    it('badPath_aStoppedBuildNamesItsStep', () => {
        const failed = build({
            status: 'FAILURE',
            steps: [
                { id: 'fetch', status: 'SUCCESS' },
                { id: 'tools', status: 'SUCCESS' },
                { id: 'packages', status: 'SUCCESS' },
                { id: 'rules', status: 'SUCCESS' },
                { id: 'functions', status: 'FAILURE' },
            ],
        });

        expect(stepsOf('server', failed).map((step) => step.state)).toEqual(['done', 'done', 'done', 'done', 'failed', 'waiting']);
        expect(failedStepOf('server', failed)).toBe('functions');
        // An admin from before finding 30 submitted no `packages` step: its stopped build still names `functions`.
        const older = build({
            status: 'FAILURE',
            steps: [
                ...['fetch', 'tools', 'rules'].map((id) => ({ id, status: 'SUCCESS' as const })),
                { id: 'functions', status: 'FAILURE' },
            ],
        });
        expect(failedStepOf('server', older)).toBe('functions');
        expect(failedStepOf('server', build({ status: 'TIMEOUT', steps: [{ id: 'fetch', status: 'SUCCESS' }] }))).toBe('tools');
        const allDone = build({
            status: 'FAILURE',
            steps: ['fetch', 'tools', 'hosting', 'config'].map((id) => ({ id, status: 'SUCCESS' })),
        });
        expect(failedStepOf('site', allDone)).toBeNull();
    });
});

describe('the log events', () => {
    it('happyPath_aRetryThatIsTheLastEventIsPending_aLaterEventMovedOn', () => {
        const retry = { event: 'retry', attempt: 1, waitSeconds: 60, reason: 'eventarcAgent' } as const;

        expect(pendingRetry([retry])).toEqual(retry);
        expect(pendingRetry([retry, { event: 'missing', name: 'ops-tick' }])).toBeNull();
        expect(pendingRetry([])).toBeNull();
    });

    it('happyPath_missingAndFailedFunctionsAreNamedOnce', () => {
        expect(
            missingFunctions([
                { event: 'missing', name: 'ops-tick' },
                { event: 'failed', name: 'admin-session' },
                { event: 'missing', name: 'ops-tick' },
                { event: 'image', digest: `sha256:${'a'.repeat(64)}` },
            ]),
        ).toEqual(['ops-tick', 'admin-session']);
    });
});

describe('a permission Prepare the project grants (finding 28 of 2026-10-31)', () => {
    it.each([
        'Error: Missing permissions required for functions deploy. You must have permission iam.serviceAccounts.ActAs on service account p@appspot.gserviceaccount.com.',
        'Error: Missing required permission on project p to deploy new HTTPS functions. The permission cloudfunctions.functions.setIamPolicy is required',
    ])('happyPath_firebaseToolsOwnCheck_%s_isFixedInStepC', (line) => {
        expect(fixedInProvision(['i  functions: preparing', line])).toBe(true);
    });

    it('badPath_anyOtherFailureIsTryAgainOnly', () => {
        expect(fixedInProvision(['Error: functions failed', 'The functions step exited with status 1.'])).toBe(false);
        expect(fixedInProvision([])).toBe(false);
        expect(initialTargetView('server').fixInProvision).toBe(false);
    });
});

describe('the build helpers', () => {
    it('happyPath_theReleaseTagNamesTheSlug_badPath_noTagNoSlug', () => {
        expect(buildSlug(build())).toBe(SLUG);
        expect(buildSlug(build({ tags: ['hcm-install'] }))).toBeNull();
    });

    it('happyPath_googlesOwnEndingsAreToldApart', () => {
        expect(endedByGoogle(build({ status: 'INTERNAL_ERROR' }))).toBe(true);
        expect(endedByGoogle(build({ status: 'EXPIRED' }))).toBe(true);
        expect(endedByGoogle(build({ status: 'FAILURE' }))).toBe(false);
        expect(endedByGoogle(null)).toBe(false);
        expect([hasEnded(build({ status: 'SUCCESS' })), hasEnded(build()), hasEnded(null)]).toEqual([true, false, false]);
        expect([isRunning('queued'), isRunning('retrying'), isRunning('failed')]).toEqual([true, true, false]);
    });

    it('happyPath_aFreshSliceKnowsTheReleaseTheAddressAndTheCosts', () => {
        const slice = initialInstallSlice(RELEASE, 'https://demo-hcm.web.app/');
        expect(initialInstallSlice(RELEASE, 'https://demo-hcm.web.app/', RELEASE_TIME).releaseTime).toBe(RELEASE_TIME);
        expect(slice.releaseTime).toBeNull();

        expect(slice).toMatchObject({
            release: RELEASE,
            freeMinutes: 2500,
            estimates: { server: 85, pipeline: 20, site: 5 },
            siteTransferMegabytes: 60,
        });
        expect(slice.server).toEqual(initialTargetView('server'));
        expect(slice.pipelineOff).toBeNull();
        expect(slice.pipeline.steps.map((step) => step.id)).toEqual(['fetch', 'build', 'push', 'jobs']);
    });
});

describe("a build's time at work on Google's own clock (the live finding of 2026-11-08)", () => {
    const START = '2026-11-08T10:00:00.000Z';

    it('happyPath_theLatestStepTimeAfterTheStartIsHowLongItHasWorkedAtLeast', () => {
        const steps = [
            { id: 'fetch', status: 'SUCCESS' as const, startTime: START, endTime: '2026-11-08T10:01:00.000Z' },
            { id: 'tools', status: 'WORKING' as const, startTime: '2026-11-08T10:04:30.000Z' },
        ];
        expect(elapsedOnGoogle(build({ startTime: START, steps }))).toBe(270_000);
    });

    it('badPath_aBuildNotStarted_withoutStepTimes_orWithTimesBeforeItsStartHasWorkedNoTime', () => {
        expect(elapsedOnGoogle(build({ status: 'QUEUED', createTime: START }))).toBe(0);
        expect(elapsedOnGoogle(build({ startTime: START }))).toBe(0);
        const early = [{ id: 'fetch', status: 'WORKING' as const, startTime: '2026-11-08T09:00:00.000Z' }];
        expect(elapsedOnGoogle(build({ startTime: START, steps: early }))).toBe(0);
        expect(elapsedOnGoogle(build({ startTime: 'not a time', steps: early }))).toBe(0);
    });
});

describe("where the browser's clock puts a build's start (the review of the running-time line)", () => {
    const START = Date.parse('2026-11-08T10:00:00.000Z');
    const at = (ms: number): string => new Date(START + ms).toISOString();
    /** A build at work whose one long step started 40 s in. */
    const longStep = build({ startTime: at(0), steps: [{ id: 'deploy', status: 'WORKING', startTime: at(40_000) }] });

    it('happyPath_aBuildFirstSeenPartwayThroughALongStepCountsFromItsStart_notFromItsLastStepTime', () => {
        // Seen 9 min in: the old line said "Running for 0 min." (now less the 40 s of its step times).
        expect(workStartOnBrowser(longStep, START + 540_000)).toBe(START);
    });

    it('badPath_aClockAheadOfGooglesNeverCountsFromBeforeTheTabSawTheBuildQueued', () => {
        // The browser 3 min ahead: Google's start reads 3 min before the click that submitted the build.
        expect(workStartOnBrowser(longStep, START + 300_000, START + 180_000)).toBe(START + 180_000);
    });

    it('badPath_aClockBehindGooglesOrAStartThatIsNoTimeCountsFromWhatItHasWorkedAtLeast', () => {
        expect(workStartOnBrowser(longStep, START - 60_000)).toBe(START - 100_000);
        expect(workStartOnBrowser({ ...longStep, startTime: 'not a time' }, START + 60_000)).toBe(START + 60_000);
    });
});
