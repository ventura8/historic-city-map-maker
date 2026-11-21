import { describe, expect, it } from 'vitest';

import {
    DOCKER_BUILDER_IMAGE,
    DOCKER_BUILDER_PIN,
    INSTALL_STEP_IDS,
    INSTALL_STEPS,
    INSTALL_TARGETS,
    compareRelease,
    releaseChannel,
    installLogLine,
    installManifestSchema,
    installRecordSchema,
    installReleaseSlug,
    parseInstallLogLine,
    parseReleaseTime,
    releaseOfSlug,
    setupInstallSchema,
    transientDeployReason,
    type InstallManifest,
} from '../src/schemas/install.js';

const NODE = `node:24-bookworm-slim@sha256:${'d'.repeat(64)}`;

function manifest(changes: Partial<Record<keyof InstallManifest, unknown>> = {}): Record<string, unknown> {
    return {
        format: 1,
        release: '1.0.0+abc1234',
        releaseTime: 1_761_955_200,
        slug: '1-0-0-abc1234',
        projectId: 'demo-hcm',
        files: {
            server: { name: 'server.tgz', bytes: 1000, sha256: 'a'.repeat(64) },
            pipeline: { name: 'pipeline.tgz', bytes: 2000, sha256: 'b'.repeat(64) },
            site: { name: 'hosting.tgz', bytes: 3000, sha256: 'c'.repeat(64) },
        },
        functions: ['admin-session', 'setup-status'],
        tools: { firebaseTools: '15.36.0', node: NODE, docker: null },
        estimates: { server: { buildMinutes: 85 }, pipeline: { buildMinutes: 20 }, site: { buildMinutes: 5 } },
        ...changes,
    };
}

describe('the install release', () => {
    it('happyPath_aReleaseBecomesASlugSafeInAPathATagAndALabel', () => {
        expect(installReleaseSlug('1.0.0+abc1234')).toBe('1-0-0-abc1234');
        expect(installReleaseSlug('0.0.0')).toBe('0-0-0');
        expect(installReleaseSlug('--A.B--')).toBe('a-b');
    });

    it('badPath_aSlugNeverEndsInAHyphenNorRunsLongerThanALabel', () => {
        const slug = installReleaseSlug(`${'a'.repeat(62)}.b`);

        expect(slug).toBe('a'.repeat(62));
        expect(installReleaseSlug('+++')).toBe('release');
    });

    it('happyPath_aSlugGoesBackToItsRelease_badPath_anyOtherSlugHasNone', () => {
        expect(releaseOfSlug('1-0-0-abc1234')).toBe('1.0.0+abc1234');
        expect(releaseOfSlug('0-0-0')).toBe('0.0.0');
        expect(releaseOfSlug('release')).toBeNull();
        expect(releaseOfSlug(installReleaseSlug('2.10.3+0f1e2d3'))).toBe('2.10.3+0f1e2d3');
        // The live finding of 2026-11-12: a pre-release's slug goes back to it, with or without a commit.
        expect(releaseOfSlug(installReleaseSlug('1.0.0-beta.1+593d539'))).toBe('1.0.0-beta.1+593d539');
        expect(releaseOfSlug(installReleaseSlug('1.0.0-rc.2'))).toBe('1.0.0-rc.2');
        expect(releaseOfSlug('1-0-0-gamma-1')).toBeNull();
    });

    it('happyPath_theVersionDecidesFirst', () => {
        expect(compareRelease('1.0.0+aaaaaaa', '1.1.0+bbbbbbb')).toBe(-1);
        expect(compareRelease('2.0.0+aaaaaaa', '1.9.9+bbbbbbb')).toBe(1);
        expect(compareRelease('1.0.0+abc1234', '1.0.0+abc1234')).toBe(0);
    });

    it('badPath_anotherBuildOfTheSameVersionCountsAsOlder', () => {
        expect(compareRelease('1.0.0+aaaaaaa', '1.0.0+bbbbbbb')).toBe(-1);
        // A tagged release that cannot be placed is never replaced by a dev build of its version that cannot either.
        expect(compareRelease('1.0.0', '1.0.0+bbbbbbb')).toBe(1);
    });

    it('happyPath_aReleaseNamesItsChannel_badPath_oneThatDoesNotParseHasNone', () => {
        expect(['1.0.0', '1.0.0-beta.1', '1.0.0-rc.2', '1.0.0+dcfb067', '1.0.0-beta.1+593d539'].map(releaseChannel)).toEqual([
            'release',
            'prerelease',
            'prerelease',
            'dev',
            'dev',
        ]);
        expect(releaseChannel('e2e')).toBeNull();
    });

    it('happyPath_aDevBuildIsOlderThanALaterPrereleaseOfItsCore', () => {
        // The live finding of 2026-11-12: the untagged 1.0.0+dcfb067 (16:18) against the admin 1.0.0-beta.1+593d539 (21:44).
        const times = { installed: 1_794_493_124, bundle: 1_794_512_688 };
        expect(compareRelease('1.0.0+dcfb067', '1.0.0-beta.1+593d539', times)).toBe(-1);
        expect(compareRelease('1.0.0+dcfb067', '1.0.0-beta.1', times)).toBe(-1);
        expect(compareRelease('1.0.0+dcfb067', '1.0.0', times)).toBe(-1);
        // A dev build made after a tagged pre-release of its core is the newer one.
        expect(compareRelease('1.0.0-beta.1+593d539', '1.0.0-beta.1', { installed: 2, bundle: 1 })).toBe(1);
        // A dev build without a time (deployed before the times) is replaced by any build of its core.
        expect(compareRelease('1.0.0+dcfb067', '1.0.0-beta.1+593d539', { installed: null, bundle: null })).toBe(-1);
        // Another core still decides first.
        expect(compareRelease('1.0.0+dcfb067', '0.9.0', { installed: 1, bundle: 2 })).toBe(1);
    });

    it('badPath_aTaggedReleaseIsNewerThanAnOlderPrerelease_theDowngradeGuard', () => {
        expect(compareRelease('1.0.0', '1.0.0-beta.1', { installed: 1, bundle: 2 })).toBe(1);
        expect(compareRelease('1.0.0-rc.1', '1.0.0-beta.2')).toBe(1);
        expect(compareRelease('1.0.0-beta.1', '1.0.0')).toBe(-1);
        expect(compareRelease('1.0.0-beta.1', '1.0.0-beta.1', { installed: null, bundle: null })).toBe(0);
        // Times missing on one side: SemVer decides between a tagged release and a dev build of another pre-release.
        expect(compareRelease('1.0.0', '1.0.0-beta.1+593d539', { installed: null, bundle: 5 })).toBe(1);
        expect(compareRelease('1.0.0-beta.1+593d539', '1.0.0', { installed: 5, bundle: null })).toBe(-1);
    });

    it('happyPath_twoBuildsOfOneVersionAreOrderedByTheirBuildTimes', () => {
        // Finding 39 of 2026-11-01: every release is 1.0.0; the later commit is the newer build.
        expect(compareRelease('1.0.0+9e2e6b5', '1.0.0+457201e', { installed: 1_761_900_000, bundle: 1_761_990_000 })).toBe(-1);
        expect(compareRelease('1.0.0+457201e', '1.0.0+9e2e6b5', { installed: 1_761_990_000, bundle: 1_761_900_000 })).toBe(1);
        expect(compareRelease('1.0.0+457201e', '1.0.0+457201e', { installed: null, bundle: 1_761_990_000 })).toBe(0);
        // A higher version wins whatever the times say.
        expect(compareRelease('1.1.0+aaaaaaa', '1.0.0+bbbbbbb', { installed: 1, bundle: 2 })).toBe(1);
    });

    it('badPath_aBuildWithoutATimeIsOlderWhenInstalled_newerWhenOnlyTheAdminLacksOne_equalTimesAreOlder', () => {
        // A record or a server from before the build times: the admin's bundle replaces it.
        expect(compareRelease('1.0.0+9e2e6b5', '1.0.0+457201e', { installed: null, bundle: 1_761_990_000 })).toBe(-1);
        // An admin that cannot place itself never replaces a timed build.
        expect(compareRelease('1.0.0+9e2e6b5', '1.0.0+457201e', { installed: 1_761_900_000, bundle: null })).toBe(1);
        expect(compareRelease('1.0.0+aaaaaaa', '1.0.0+bbbbbbb', { installed: 5, bundle: 5 })).toBe(-1);
    });

    it('happyPath_aBuildTimeIsReadFromTextOrANumber_badPath_anythingElseIsNone', () => {
        expect(parseReleaseTime('1761990000')).toBe(1_761_990_000);
        expect(parseReleaseTime(1_761_990_000)).toBe(1_761_990_000);
        expect(parseReleaseTime('0')).toBe(0);
        expect([parseReleaseTime(''), parseReleaseTime('-1'), parseReleaseTime('1.5'), parseReleaseTime(undefined)]).toEqual([
            null,
            null,
            null,
            null,
        ]);
        expect([parseReleaseTime('9999999999'), parseReleaseTime(1.5)]).toEqual([null, null]);
    });

    it('badPath_anInstalledReleaseThatDoesNotParseIsOlder_aBundleThatDoesNotParseIsNever', () => {
        expect(compareRelease('e2e', '1.0.0+abc1234')).toBe(-1);
        expect(compareRelease('1.0.0+abc1234', 'not a release')).toBe(1);
    });
});

describe('the install manifest', () => {
    it('happyPath_aBundleManifestParses', () => {
        expect(installManifestSchema.safeParse(manifest()).success).toBe(true);
        expect(installManifestSchema.safeParse(manifest({ releaseTime: null })).success).toBe(true);
        expect(installManifestSchema.safeParse(manifest({ channel: 'dev' })).success).toBe(true);
        expect(
            installManifestSchema.safeParse(manifest({ release: '1.0.0-beta.1', slug: '1-0-0-beta-1', channel: 'prerelease' })).success,
        ).toBe(true);
        expect(installManifestSchema.safeParse(manifest({ tools: { firebaseTools: '15.36.0', node: NODE, docker: NODE } })).success).toBe(
            true,
        );
    });

    it('happyPath_theDockerBuilderIsNamedByTheDigestOfItsTrackedTag', () => {
        const [named, digest] = DOCKER_BUILDER_PIN.split('@');
        const tools = { firebaseTools: '15.36.0', node: NODE, docker: DOCKER_BUILDER_IMAGE };

        expect(named).toMatch(/^gcr\.io\/cloud-builders\/docker:\d+$/);
        expect(DOCKER_BUILDER_IMAGE).toBe(`gcr.io/cloud-builders/docker@${digest ?? ''}`);
        expect(installManifestSchema.safeParse(manifest({ tools })).success).toBe(true);
    });

    it.each([
        ['another format', { format: 2 }],
        ['a build time that is not one', { releaseTime: '1761955200' }],
        ['a slug of another release', { slug: '1-0-1-abc1234' }],
        ['a channel its release does not name', { channel: 'release' }],
        [
            'a tarball under another name',
            { files: { ...(manifest()['files'] as object), site: { name: 'site.tgz', bytes: 1, sha256: 'c'.repeat(64) } } },
        ],
        ['an image by tag only', { tools: { firebaseTools: '15.36.0', node: 'node:24', docker: null } }],
        ['another firebase-tools', { tools: { firebaseTools: '15.0.0', node: NODE, docker: null } }],
        [
            'a digest that is not hex',
            { files: { ...(manifest()['files'] as object), server: { name: 'server.tgz', bytes: 1, sha256: 'z'.repeat(64) } } },
        ],
        ['no function', { functions: [] }],
    ])('badPath_aManifestWith %s is refused', (_name, changes) => {
        expect(installManifestSchema.safeParse(manifest(changes)).success).toBe(false);
    });
});

describe('the build log events', () => {
    it('happyPath_anEventRoundTripsThroughItsLogLine', () => {
        const retry = { event: 'retry', attempt: 2, waitSeconds: 120, reason: 'eventarcAgent' } as const;

        expect(installLogLine(retry)).toBe('HCM_INSTALL {"event":"retry","attempt":2,"waitSeconds":120,"reason":"eventarcAgent"}');
        expect(parseInstallLogLine(`Step #3 - "functions": ${installLogLine(retry)}`)).toEqual(retry);
        expect(parseInstallLogLine(installLogLine({ event: 'missing', name: 'ops-tick' }))).toEqual({ event: 'missing', name: 'ops-tick' });
    });

    it.each([
        ['an ordinary line', 'i  deploying functions'],
        ['a line that is not JSON', 'HCM_INSTALL {not json'],
        ['an unknown event', 'HCM_INSTALL {"event":"surprise"}'],
        ['a retry for an unknown reason', 'HCM_INSTALL {"event":"retry","attempt":1,"waitSeconds":60,"reason":"other"}'],
    ])('badPath_%s carries no event', (_name, line) => {
        expect(parseInstallLogLine(line)).toBeNull();
    });

    it('happyPath_theKnownRacesAreRecognised_badPath_anyOtherFailureIsNot', () => {
        expect(transientDeployReason('Permission denied while using the Eventarc Service Agent. ... may take a few minutes')).toBe(
            'eventarcAgent',
        );
        expect(transientDeployReason('HTTP Error: 429, Quota exceeded for quota metric')).toBe('quota');
        expect(transientDeployReason('HTTP Error: 409, unable to queue the operation')).toBe('operationInProgress');
        expect(transientDeployReason('HTTP Error: 503, The service is currently unavailable.')).toBe('unavailable');
        expect(transientDeployReason('Error: Failed to load function definition from source')).toBeNull();
    });
});

describe('the install records', () => {
    it('happyPath_eachTargetKeepsItsStateReleaseAndBuild', () => {
        const record = {
            state: 'installed',
            release: '1.0.0+abc1234',
            releaseTime: 1_761_955_200,
            buildId: '0123abcd-0000',
            checkedAt: '2026-10-25T10:00:00.000Z',
        };

        expect(setupInstallSchema.parse({ server: record, site: { state: 'notInstalled', checkedAt: record.checkedAt } })).toEqual({
            server: record,
            site: { state: 'notInstalled', checkedAt: record.checkedAt },
        });
        expect(installRecordSchema.safeParse({ ...record, detail: 'apiError.install.failed', params: { step: 'functions' } }).success).toBe(
            true,
        );
    });

    it.each([
        ['an unknown state', { state: 'done', checkedAt: '2026-10-25T10:00:00.000Z' }],
        ['a free-text reason', { state: 'failed', checkedAt: '2026-10-25T10:00:00.000Z', detail: 'it broke' }],
        [
            'too many params',
            { state: 'failed', checkedAt: '2026-10-25T10:00:00.000Z', params: { a: '1', b: '2', c: '3', d: '4', e: '5', f: '6' } },
        ],
        ['an unknown field', { state: 'failed', checkedAt: '2026-10-25T10:00:00.000Z', log: 'ya29.secret' }],
        ['a build time that is not one', { state: 'installed', checkedAt: '2026-10-25T10:00:00.000Z', releaseTime: -1 }],
    ])('badPath_a record with %s is refused', (_name, record) => {
        expect(installRecordSchema.safeParse(record).success).toBe(false);
    });

    it('happyPath_everyTargetHasItsStepsAndEveryStepIsListedOnce', () => {
        expect(INSTALL_TARGETS.flatMap((target) => INSTALL_STEPS[target]).every((step) => INSTALL_STEP_IDS.includes(step))).toBe(true);
        expect(new Set(INSTALL_STEP_IDS).size).toBe(INSTALL_STEP_IDS.length);
        expect(INSTALL_STEPS.server[0]).toBe('fetch');
    });
});
