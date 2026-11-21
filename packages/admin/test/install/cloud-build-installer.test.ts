import { createHash } from 'node:crypto';

import {
    NEWER_BUILD_RELEASE,
    NEWER_BUILD_TIME,
    NEWER_SERVER_RELEASE,
    OLDER_BUILD_RELEASE,
    OLDER_SERVER_RELEASE,
    PLANTED_LOG_SECRETS,
    PRE_M6_LACKING,
    registryFunctions,
} from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { GoogleApiError } from '../../src/google/failure.js';
import { InstallBundleError } from '../../src/install/bundle.js';
import { ACCESS, installManifest, installWorld, RELEASE, RELEASE_TIME } from './world.js';

/**
 * The installer's Cloud Build adapter over the fake upstreams (`docs/research/M6-interfaces.md` §1.7, §1.10): what each
 * target has installed, its newest build, why it cannot install, the build it submits and the build's log.
 */

describe('observe', () => {
    it('happyPath_aProvisionedProjectHasNothingInstalledAndNothingInTheWay', async () => {
        const world = await installWorld();

        const server = await world.installer.observe('server', ACCESS);
        const pipeline = await world.installer.observe('pipeline', ACCESS);
        const site = await world.installer.observe('site', ACCESS);

        expect(server).toEqual({
            installed: { complete: false, release: null, releaseTime: null, partial: false, newest: null, newestTime: null },
            build: null,
            progress: { ready: 0, total: registryFunctions().length, failed: [] },
            blocker: null,
        });
        expect(pipeline).toMatchObject({
            installed: { complete: false, release: null, partial: false, newest: null },
            progress: null,
            blocker: null,
        });
        expect(site).toMatchObject({ installed: { complete: false, release: null, partial: false, newest: null }, blocker: null });
    });

    it('happyPath_theServersReleaseIsTheOldestOfItsFunctions', async () => {
        const world = await installWorld();
        world.fakes.scenario('cloud-functions.deployedOlderRelease');

        const server = await world.installer.observe('server', ACCESS);

        expect(server.installed).toEqual({
            complete: true,
            release: OLDER_SERVER_RELEASE,
            releaseTime: null,
            partial: false,
            newest: OLDER_SERVER_RELEASE,
            newestTime: null,
        });
        world.fakes.scenario('cloud-functions.deployedNewerRelease');
        expect((await world.installer.observe('server', ACCESS)).installed.release).toBe(NEWER_SERVER_RELEASE);
    });

    it('badPath_aServerDeployedWithoutAReleaseIsCompleteButUnnamed', async () => {
        const world = await installWorld();
        world.fakes.scenario('cloud-functions.deployed');

        expect((await world.installer.observe('server', ACCESS)).installed).toEqual({
            complete: true,
            release: null,
            releaseTime: null,
            partial: false,
            newest: null,
            newestTime: null,
        });
    });

    it('happyPath_thePipelinesJobsAndTheSitesReleaseFile', async () => {
        const world = await installWorld();
        world.fakes.scenario('cloud-run.pipelineJobsOlderRelease');
        world.release = { release: RELEASE, variant: 'public' };

        expect((await world.installer.observe('pipeline', ACCESS)).installed).toEqual({
            complete: true,
            release: '0.9.0+e2e0000',
            releaseTime: null,
            partial: false,
            newest: '0.9.0+e2e0000',
            newestTime: null,
            // Finding 74: the image the job raster-pipeline runs, by digest.
            image: `sha256:${'0'.repeat(64)}`,
        });
        expect((await world.installer.observe('site', ACCESS)).installed).toEqual({
            complete: true,
            release: RELEASE,
            releaseTime: null,
            partial: false,
            newest: RELEASE,
            newestTime: null,
        });
    });

    it('badPath_jobsWithoutALabelAndAStartUpRootAreNotTheRelease', async () => {
        const world = await installWorld();
        world.fakes.scenario('cloud-run.pipelineJobsProvisioned');
        world.release = { release: RELEASE, variant: 'start-up' };

        expect((await world.installer.observe('pipeline', ACCESS)).installed).toEqual({
            complete: true,
            release: null,
            releaseTime: null,
            partial: false,
            newest: null,
            newestTime: null,
            image: null,
        });
        expect((await world.installer.observe('site', ACCESS)).installed).toEqual({
            complete: false,
            release: null,
            releaseTime: null,
            partial: false,
            newest: null,
            newestTime: null,
        });
        world.release = null;
        expect((await world.installer.observe('site', ACCESS)).installed.complete).toBe(false);
    });
});

describe('observe: what stands in the way', () => {
    it('badPath_withoutTheInstallersAccountEveryTargetAsksForPrepareTheProject', async () => {
        const world = await installWorld({ provisioned: false });

        const blocker = (await world.installer.observe('server', ACCESS)).blocker;

        expect(blocker).toEqual({
            key: 'apiError.install.notProvisioned',
            params: { account: 'hcm-installer@demo-hcm.iam.gserviceaccount.com' },
        });
    });

    it('badPath_thePipelineWaitsForItsRepositoryAndItsBuilder', async () => {
        const world = await installWorld();
        world.fakes.state.artifactRegistry.repositories.clear();

        expect((await world.installer.observe('pipeline', ACCESS)).blocker).toEqual({
            key: 'apiError.install.noRepository',
            params: { repository: 'hcm' },
        });
        const unpinned = await installWorld();
        unpinned.manifest = installManifest({
            tools: { firebaseTools: '15.36.0', node: `node:24@sha256:${'d'.repeat(64)}`, docker: null },
        });
        expect((await unpinned.installer.observe('pipeline', ACCESS)).blocker).toEqual({ key: 'apiError.install.notAvailable' });
        // Finding 43 of 2026-11-01: known without a look at Google (the admin's own bundle).
        await expect(unpinned.installer.localBlocker('pipeline')).resolves.toEqual({ key: 'apiError.install.notAvailable' });
        await expect(world.installer.localBlocker('pipeline')).resolves.toBeNull();
    });

    it('badPath_theSiteWaitsForSomethingToShow_andAMissingBundleStopsEveryTarget', async () => {
        const world = await installWorld();
        world.published = false;

        expect((await world.installer.observe('site', ACCESS)).blocker).toEqual({ key: 'apiError.install.nothingToShow' });
        // A bundle once found is read once a session: a missing one is a fresh admin's.
        const missing = await installWorld();
        missing.manifest = null;
        expect((await missing.installer.observe('server', ACCESS)).blocker).toEqual({ key: 'apiError.install.bundleMissing' });
        // Without a bundle the pipeline's own blocker is unknown, not "not available": the look at Google says why.
        await expect(missing.installer.localBlocker('pipeline')).resolves.toBeNull();
    });

    it('badPath_aRefusedListIsAGoogleFailure', async () => {
        const world = await installWorld();
        world.fakes.fail('cloud-build', 'unavailable');

        await expect(world.installer.observe('server', ACCESS)).rejects.toBeInstanceOf(GoogleApiError);
    });
});

describe('observe: a target only partly there (the M6 reviews)', () => {
    it('happyPath_aServerFromBeforeM6LackingFunctionsIsPartial', async () => {
        const world = await installWorld();
        world.fakes.scenario('cloud-functions.preM6');

        const server = await world.installer.observe('server', ACCESS);

        expect(server.installed).toEqual({
            complete: false,
            release: null,
            releaseTime: null,
            partial: true,
            newest: null,
            newestTime: null,
        });
        expect(server.progress).toEqual({
            ready: registryFunctions().length - PRE_M6_LACKING,
            total: registryFunctions().length,
            failed: [],
        });
    });

    it('badPath_aNewerServerMissingAFunctionStillNamesItsNewestRelease', async () => {
        const world = await installWorld();
        world.fakes.scenario('cloud-functions.partialNewerRelease');

        expect((await world.installer.observe('server', ACCESS)).installed).toEqual({
            complete: false,
            release: null,
            releaseTime: null,
            partial: true,
            newest: NEWER_SERVER_RELEASE,
            newestTime: null,
        });
    });
});

describe('observe: builds of one version (finding 39 of 2026-11-01)', () => {
    it('happyPath_theFunctionsNameTheirBuildTime_aServerBuiltBeforeTheTimesNamesNone', async () => {
        const world = await installWorld();
        world.fakes.scenario('cloud-functions.deployedNewerBuild');

        expect((await world.installer.observe('server', ACCESS)).installed).toMatchObject({
            complete: true,
            release: NEWER_BUILD_RELEASE,
            releaseTime: NEWER_BUILD_TIME,
            newest: NEWER_BUILD_RELEASE,
            newestTime: NEWER_BUILD_TIME,
        });
        world.fakes.scenario('cloud-functions.deployedOlderBuild');
        expect((await world.installer.observe('server', ACCESS)).installed).toMatchObject({
            release: OLDER_BUILD_RELEASE,
            releaseTime: null,
        });
    });

    it('happyPath_releaseJsonNamesTheSitesBuildTime_badPath_oneThatIsNotWholeSecondsIsNone', async () => {
        const world = await installWorld();
        world.release = { release: RELEASE, releaseTime: RELEASE_TIME, variant: 'public' };
        expect((await world.installer.observe('site', ACCESS)).installed).toMatchObject({
            releaseTime: RELEASE_TIME,
            newestTime: RELEASE_TIME,
        });
        world.release = { release: RELEASE, releaseTime: 'yesterday', variant: 'public' };
        expect((await world.installer.observe('site', ACCESS)).installed).toMatchObject({ release: RELEASE, releaseTime: null });
    });

    it('happyPath_thePipelineJobsNameTheirBuildTimeInALabel', async () => {
        const world = await installWorld();
        await world.installer.submit('pipeline', ACCESS);
        world.fakes.scenario('cloud-build.finish');

        expect((await world.installer.observe('pipeline', ACCESS)).installed).toMatchObject({
            complete: true,
            release: RELEASE,
            releaseTime: RELEASE_TIME,
        });
    });

    it('badPath_theOldestOfTwoJobsIsTheBuildWithoutATime_twoTimedBuildsByTheirTimes', async () => {
        const world = await installWorld();
        await world.installer.submit('pipeline', ACCESS);
        world.fakes.scenario('cloud-build.finish');
        const specs = world.fakes.state.cloudRun.jobSpecs ?? new Map<string, { readonly image: string }>();
        const [first, second] = [...specs.entries()];
        const relabel = (entry: typeof first, labels: Record<string, string>): void => {
            world.fakes.state.cloudRun.jobSpecs?.set(String(entry?.[0]), { image: String(entry?.[1].image), labels });
        };
        // One job left on a build of the same version from before the build times: the pipeline is that build.
        relabel(second, { 'hcm-release': '1-0-0-0000000' });
        expect((await world.installer.observe('pipeline', ACCESS)).installed).toMatchObject({
            release: '1.0.0+0000000',
            releaseTime: null,
            newest: RELEASE,
            newestTime: RELEASE_TIME,
        });
        // Two timed builds of the version: the later time is the newer, whichever job holds it.
        relabel(first, { 'hcm-release': '1-0-0-fffffff', 'hcm-release-time': String(RELEASE_TIME + 60) });
        relabel(second, { 'hcm-release': '1-0-0-0000000', 'hcm-release-time': String(RELEASE_TIME - 60) });
        expect((await world.installer.observe('pipeline', ACCESS)).installed).toMatchObject({
            release: '1.0.0+0000000',
            releaseTime: RELEASE_TIME - 60,
            newest: '1.0.0+fffffff',
            newestTime: RELEASE_TIME + 60,
        });
    });
});

describe('submit', () => {
    it('happyPath_theServerBuildRunsAsTheInstallerWithTheBundlesDigests', async () => {
        const world = await installWorld();

        const build = await world.installer.submit('server', ACCESS);

        expect(build).toMatchObject({ status: 'QUEUED', tags: ['hcm-install', 'hcm-server', 'hcm-r-1-0-0-abc1234'] });
        const [call] = world.fakes.callsTo('cloud-build.builds.create');
        const body = JSON.parse(call?.body ?? '{}') as { serviceAccount: string; substitutions: Record<string, string> };
        expect(body.serviceAccount).toBe('projects/demo-hcm/serviceAccounts/hcm-installer@demo-hcm.iam.gserviceaccount.com');
        expect(body.substitutions['_MANIFEST_SHA256']).toBe(createHash('sha256').update(JSON.stringify(world.manifest)).digest('hex'));
        expect(body.substitutions).toMatchObject({ _ORIGIN: 'https://demo-hcm.web.app', _BASE: '/admin/', _FILE_SHA256: 'a'.repeat(64) });
        expect(call?.headers['authorization']).toBe(`Bearer ${ACCESS.token}`);
    });

    it('happyPath_anOverrideBuildCarriesTheOverTag', async () => {
        const world = await installWorld();

        const build = await world.installer.submit('server', ACCESS, { over: true });

        expect(build.tags).toEqual(['hcm-install', 'hcm-server', 'hcm-r-1-0-0-abc1234', 'hcm-over']);
    });

    it('happyPath_theNewestBuildIsFoundByItsTargetsTag', async () => {
        const world = await installWorld();
        await world.installer.submit('server', ACCESS);
        const site = await world.installer.submit('site', ACCESS);

        expect((await world.installer.observe('site', ACCESS)).build?.id).toBe(site.id);
        expect((await world.installer.observe('pipeline', ACCESS)).build).toBeNull();
    });

    it('happyPath_aSiteBuildLeavesTheLegacyOriginalsOutOnceTheImportIsComplete_badPath_beforeItOrWithoutThemNot', async () => {
        // §73k: the originals travel in legacy.tgz; a publish after step (h) moves a few MB instead of 60.
        const world = await installWorld();
        const legacy = { name: 'legacy.tgz', bytes: 45_000_000, sha256: 'e'.repeat(64) };
        world.manifest = installManifest({ files: { ...(installManifest()['files'] as object), legacy } });
        const fetchEnv = async (): Promise<readonly string[]> => {
            await world.installer.submit('site', ACCESS);
            const calls = world.fakes.callsTo('cloud-build.builds.create');
            const body = JSON.parse(calls.at(-1)?.body ?? '{}') as { steps: { env?: string[] }[] };
            return body.steps[0]?.env ?? [];
        };

        expect(await fetchEnv()).toEqual(expect.arrayContaining(['HCM_FILES=site,server,pipeline,legacy', 'HCM_UNPACK=legacy']));
        world.legacyImported = true;
        expect(await fetchEnv()).toContain('HCM_FILES=site,server,pipeline');
        expect(await fetchEnv()).not.toContain('HCM_UNPACK=legacy');
    });

    it('badPath_aBundleWithoutTheLegacyOriginalsNeverAsksForThem', async () => {
        const world = await installWorld();

        await world.installer.submit('site', ACCESS);

        const [call] = world.fakes.callsTo('cloud-build.builds.create');
        const body = JSON.parse(call?.body ?? '{}') as { steps: { env?: string[] }[] };
        expect(body.steps[0]?.env).toContain('HCM_FILES=site,server,pipeline');
    });

    it('badPath_thePipelineIsNotSubmittedWithoutItsBuilder', async () => {
        const world = await installWorld();
        world.manifest = installManifest({ tools: { firebaseTools: '15.36.0', node: `node:24@sha256:${'d'.repeat(64)}`, docker: null } });

        await expect(world.installer.submit('pipeline', ACCESS)).rejects.toBeInstanceOf(InstallBundleError);
        expect(world.fakes.callsTo('cloud-build.builds.create')).toHaveLength(0);
    });

    // Finding 29 of 2026-10-31: a tab left open across a redeploy would send the build to the old release's bundle.
    it('badPath_aTabWhoseAdminWasReplacedSubmitsNothingAndAsksForAReload', async () => {
        const world = await installWorld();
        world.newerAdmin = '1.0.1+def5678';

        const error = await world.installer.submit('server', ACCESS).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(InstallBundleError);
        expect((error as InstallBundleError).notice()).toEqual({
            key: 'apiError.install.adminOutdated',
            params: { release: '1.0.1+def5678' },
        });
        expect(world.fakes.callsTo('cloud-build.builds.create')).toHaveLength(0);
    });

    // §210: the public map's /admin/ forwards to the admin's own site; a tab still open there is told the new address.
    it('badPath_aTabLeftOnTheOldAddressSubmitsNothingAndNamesTheNewOne', async () => {
        const world = await installWorld();
        world.moved = true;

        const error = await world.installer.submit('server', ACCESS).catch((caught: unknown) => caught);

        expect((error as InstallBundleError).notice()).toEqual({
            key: 'apiError.install.adminOutdated',
            params: { release: 'https://demo-hcm-admin.web.app/admin/' },
        });
        expect(world.fakes.callsTo('cloud-build.builds.create')).toHaveLength(0);
    });
});

describe('buildLog and consoleUrl', () => {
    it('happyPath_aStoppedBuildsLinesAreRedactedAndLabelledWithTheirStep', async () => {
        const world = await installWorld();
        world.fakes.scenario('cloud-build.serverFailsAtFunctions');
        const build = await world.installer.submit('server', ACCESS);
        world.fakes.scenario('cloud-build.finish');

        const lines = await world.installer.buildLog(build.id, ACCESS);

        const functions = lines.filter((line) => line.step === 'functions').map((line) => line.text);
        expect(functions.length).toBeGreaterThan(0);
        expect(functions.join('\n')).not.toContain(PLANTED_LOG_SECRETS[0]);
        expect(functions.join('\n')).not.toContain(PLANTED_LOG_SECRETS[1]);
        expect(world.installer.consoleUrl(build.id)).toBe(
            `https://console.cloud.google.com/cloud-build/builds;region=us-central1/${build.id}?project=demo-hcm`,
        );
    });
});
