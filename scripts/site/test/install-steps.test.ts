import { createFakeFetch, jsonResponse, route, routeTable, type Route } from '@hcm/test-support/fakes';
import { describe, expect, it, vi } from 'vitest';

import { deployWithRetry, failedTargets, FIREBASE_BIN } from '../src/install/steps/deploy-with-retry.js';
import { hostingConfig } from '../src/install/steps/hosting-config.js';
import { runStep, STEPS } from '../src/install/steps/index.js';
import { imageOf, jobBody, PIPELINE_JOBS, runJobs } from '../src/install/steps/run-jobs.js';
import {
    GoogleCallError,
    googleJson,
    MAX_OUTPUT,
    metadataToken,
    METADATA_TOKEN_URL,
    nodeStepDeps,
    runCommand,
    tail,
    type CommandResult,
    type StepDeps,
} from '../src/install/steps/step-io.js';
import { expectedNames, verifyServer } from '../src/install/steps/verify-server.js';

/**
 * The install builds' step scripts (docs/research/M6-interfaces.md §1.4, §1.5) over fakes of their world: the deploy's
 * retries of the known races, `verify`'s missing and failed functions, the pipeline's two jobs, the site's kept
 * releases, and the real world's own parts (a real command, the metadata server's token).
 */

const TOKEN = 'e2e-build-token';
const IMAGE = `us-central1-docker.pkg.dev/demo-hcm/hcm/pipeline@sha256:${'a'.repeat(64)}`;

interface Fakes {
    readonly deps: StepDeps;
    readonly lines: string[];
    readonly runs: (readonly string[])[];
    readonly sleeps: number[];
    readonly calls: ReturnType<typeof createFakeFetch>['calls'];
}

function fakes(
    options: {
        readonly results?: readonly CommandResult[];
        readonly routes?: readonly Route[];
        readonly files?: Record<string, string>;
    } = {},
): Fakes {
    const lines: string[] = [];
    const runs: (readonly string[])[] = [];
    const sleeps: number[] = [];
    const results = [...(options.results ?? [])];
    const fetcher = createFakeFetch(routeTable(options.routes ?? []));
    const deps: StepDeps = {
        run: (_command, args) => {
            runs.push(args);
            return Promise.resolve(results.shift() ?? { code: 0, output: '' });
        },
        fetch: fetcher.fetch,
        token: () => Promise.resolve(TOKEN),
        readFile: (path) => {
            const text = options.files?.[path];
            if (text === undefined) {
                throw new Error(`no file ${path}`);
            }
            return text;
        },
        sleep: (ms) => {
            sleeps.push(ms);
            return Promise.resolve();
        },
        random: () => 0.5,
        log: (line) => {
            lines.push(line);
        },
    };
    return { deps, lines, runs, sleeps, calls: fetcher.calls };
}

const EVENTARC = { code: 1, output: 'Error: Permission denied while using the Eventarc Service Agent. Retry in a few minutes.' };

describe('deploy-with-retry', () => {
    it('happyPath_oneDeployWithForceIsEnough', async () => {
        const world = fakes();

        await expect(deployWithRetry(['--project', 'demo-hcm', '--force'], world.deps)).resolves.toBe(0);
        expect(world.runs).toEqual([
            [FIREBASE_BIN, 'deploy', '--only', 'functions', '--project', 'demo-hcm', '--non-interactive', '--force'],
        ]);
        expect(world.lines).toEqual([]);
    });

    it('happyPath_aRaceIsRetriedAfterAMinuteWithOnlyTheFunctionsThatFailed', async () => {
        const failed = {
            code: 1,
            output: `${EVENTARC.output}\nFunctions deploy had errors with the following functions:\n\tphotos-onupload(us-central1)\n\tops-tick(us-central1)\n`,
        };
        const world = fakes({ results: [failed, { code: 0, output: '' }] });

        await expect(deployWithRetry(['--project', 'demo-hcm'], world.deps)).resolves.toBe(0);
        expect(world.runs[1]).toEqual([
            FIREBASE_BIN,
            'deploy',
            '--only',
            'functions:photos.onupload,functions:ops.tick',
            '--project',
            'demo-hcm',
            '--non-interactive',
        ]);
        expect(world.sleeps).toEqual([60_000]);
        expect(world.lines).toEqual(['HCM_INSTALL {"event":"retry","attempt":1,"waitSeconds":60,"reason":"eventarcAgent"}']);
    });

    it('badPath_aRaceThatOutlastsFourAttemptsFailsTheStep', async () => {
        const world = fakes({ results: [EVENTARC, EVENTARC, { code: 1, output: 'HTTP Error: 429, Quota exceeded' }, EVENTARC] });

        await expect(deployWithRetry(['--project', 'demo-hcm'], world.deps)).resolves.toBe(1);
        expect(world.runs).toHaveLength(4);
        expect(world.sleeps).toEqual([60_000, 120_000, 240_000]);
        expect(world.runs[1]?.[3]).toBe('functions');
    });

    it('badPath_anyOtherFailureFailsAtOnce', async () => {
        const world = fakes({ results: [{ code: 2, output: 'Error: Failed to load function definition from source' }] });

        await expect(deployWithRetry(['--project', 'demo-hcm'], world.deps)).resolves.toBe(2);
        expect(world.runs).toHaveLength(1);
    });

    it('badPath_withoutAProjectTheStepRefuses', async () => {
        await expect(deployWithRetry([], fakes().deps)).rejects.toThrow('usage: deploy-with-retry');
        expect(failedTargets('nothing listed')).toEqual([]);
        expect(failedTargets('the following functions:\nnot a function line')).toEqual([]);
    });
});

const FUNCTIONS = 'https://cloudfunctions.googleapis.com/v2/projects/demo-hcm/locations/us-central1/functions';

function functionsRoute(pages: readonly unknown[]): Route {
    return route('GET', FUNCTIONS, 'functions.list', (request) => {
        const index = Number(request.url.searchParams.get('pageToken') ?? '0');
        return jsonResponse(pages[index] ?? {});
    });
}

function fn(name: string, state = 'ACTIVE', release: string | null = '1.0.0+abc1234'): unknown {
    const serviceConfig = release === null ? {} : { serviceConfig: { environmentVariables: { HCM_RELEASE: release } } };
    return { name: `projects/demo-hcm/locations/us-central1/functions/${name}`, state, ...serviceConfig };
}

const VERIFY = ['--project', 'demo-hcm', '--region', 'us-central1', '--release', '1.0.0+abc1234', '--manifest', 'm.json'];

describe('verify-server', () => {
    it('happyPath_everyFunctionActiveOnTheReleaseOverTwoPages', async () => {
        const world = fakes({
            files: { 'm.json': JSON.stringify({ functions: ['a-one', 'b-two'] }) },
            routes: [functionsRoute([{ functions: [fn('a-one')], nextPageToken: '1' }, { functions: [fn('b-two')] }])],
        });

        await expect(verifyServer(VERIFY, world.deps)).resolves.toBe(0);
        expect(world.lines).toEqual(['verify: 2 of 2 functions are ACTIVE on 1.0.0+abc1234']);
        expect(world.calls[0]?.headers['authorization']).toBe(`Bearer ${TOKEN}`);
    });

    it('badPath_missingFailedAndOtherReleasesAreNamed', async () => {
        const world = fakes({
            files: { 'm.json': JSON.stringify({ functions: ['a-one', 'b-two', 'c-three', 'd-four'] }) },
            routes: [
                functionsRoute([{ functions: [fn('a-one'), fn('b-two', 'FAILED'), fn('c-three', 'ACTIVE', null), { state: 'ACTIVE' }] }]),
            ],
        });

        await expect(verifyServer(VERIFY, world.deps)).resolves.toBe(1);
        expect(world.lines).toEqual([
            'HCM_INSTALL {"event":"failed","name":"b-two"}',
            'HCM_INSTALL {"event":"failed","name":"c-three"}',
            'HCM_INSTALL {"event":"missing","name":"d-four"}',
            'verify: 1 of 4 functions are ACTIVE on 1.0.0+abc1234',
        ]);
    });

    it('badPath_aManifestWithoutFunctionsIsAFailure_andArgumentsAreRequired', async () => {
        const world = fakes({ files: { 'm.json': '{}' }, routes: [functionsRoute([{}])] });

        await expect(verifyServer(VERIFY, world.deps)).resolves.toBe(1);
        expect(expectedNames('{"functions":["a",1]}')).toEqual(['a']);
        await expect(verifyServer(['--project', 'p'], world.deps)).rejects.toThrow('usage: verify-server');
    });
});

const JOBS = 'https://run.googleapis.com/v2/projects/demo-hcm/locations/us-central1/jobs';
const JOB_ARGS = [
    ...['--project', 'demo-hcm', '--region', 'us-central1', '--image-file', 'digest', '--slug', '1-0-0-abc1234'],
    ...['--release-time', '1761955200'],
];

describe('run-jobs', () => {
    it('happyPath_aMissingJobIsCreatedAnExistingOneReplacedEachWaitedFor', async () => {
        const polled = vi.fn(() => jsonResponse({ name: 'projects/demo-hcm/locations/us-central1/operations/op-1', done: true }));
        const world = fakes({
            files: { digest: `'${IMAGE}'\n` },
            routes: [
                route('GET', `${JOBS}/raster-fetch`, 'get-fetch', () => jsonResponse({ name: 'fetch' })),
                route('PATCH', `${JOBS}/raster-fetch`, 'patch-fetch', () => jsonResponse({ done: true })),
                route('GET', `${JOBS}/raster-pipeline`, 'get-std', () => jsonResponse({ error: { code: 404 } }, 404)),
                route('GET', `${JOBS}/raster-pipeline-xl`, 'get-xl', () => jsonResponse({ name: 'xl' })),
                route('POST', JOBS, 'create', () =>
                    jsonResponse({ name: 'projects/demo-hcm/locations/us-central1/operations/op-1', done: false }),
                ),
                route('PATCH', `${JOBS}/raster-pipeline-xl`, 'patch', () => jsonResponse({ done: true })),
                route('GET', 'https://run.googleapis.com/v2/projects/demo-hcm/locations/us-central1/operations/op-1', 'operation', polled),
            ],
        });

        await expect(runJobs(JOB_ARGS, world.deps)).resolves.toBe(0);
        const create = world.calls.find((call) => call.operation === 'create');
        expect(new URL(create?.url ?? 'https://x').searchParams.get('jobId')).toBe('raster-pipeline');
        expect(JSON.parse(create?.body ?? '{}')).toEqual(
            jobBody(
                { project: 'demo-hcm', region: 'us-central1', imageFile: 'digest', slug: '1-0-0-abc1234', releaseTime: '1761955200' },
                IMAGE,
                PIPELINE_JOBS[1],
            ),
        );
        // Finding 56: the small download job is made (here replaced) first, at 1 vCPU and 4 GiB; 2026-11-12 (resource audit item 7):
        // the processing jobs at 2 vCPU / 8 GiB and 4 / 16, the free-tier meter's own sizes.
        expect(PIPELINE_JOBS).toEqual([
            { name: 'raster-fetch', cpu: '1', memory: '4Gi' },
            { name: 'raster-pipeline', cpu: '2', memory: '8Gi' },
            { name: 'raster-pipeline-xl', cpu: '4', memory: '16Gi' },
        ]);
        expect(world.calls.map((call) => call.operation).slice(0, 2)).toEqual(['get-fetch', 'patch-fetch']);
        // Finding 39 of 2026-11-01: the build time labels the job next to the release's slug.
        expect(JSON.parse(create?.body ?? '{}')).toMatchObject({
            labels: { 'hcm-release': '1-0-0-abc1234', 'hcm-release-time': '1761955200' },
        });
        expect(world.calls.some((call) => call.operation === 'patch')).toBe(true);
        expect(polled).toHaveBeenCalledTimes(1);
        expect(world.lines.at(-1)).toBe(`HCM_INSTALL {"event":"image","digest":"sha256:${'a'.repeat(64)}"}`);
    });

    it('happyPath_theJobIsTheOneD5Deployed', () => {
        const body = jobBody(
            { project: 'demo-hcm', region: 'us-central1', imageFile: 'x', slug: 's', releaseTime: '' },
            IMAGE,
            PIPELINE_JOBS[2],
        );

        // A release without a build time labels nothing more.
        expect(body['labels']).toEqual({ 'hcm-release': 's' });
        expect(body).toMatchObject({
            labels: { 'hcm-release': 's' },
            template: {
                taskCount: 1,
                template: {
                    serviceAccount: 'job-raster@demo-hcm.iam.gserviceaccount.com',
                    timeout: '21600s',
                    maxRetries: 0,
                    containers: [{ image: IMAGE, args: ['run'], resources: { limits: { cpu: '4', memory: '16Gi' } } }],
                },
            },
        });
    });

    it('badPath_noDigestNoJob_aFailedOperationFailsTheStep_aRefusalPropagates', async () => {
        expect(() => imageOf('us-central1-docker.pkg.dev/demo-hcm/hcm/pipeline:latest')).toThrow('no image digest');
        const failing = fakes({
            files: { digest: IMAGE },
            routes: [
                route('GET', `${JOBS}/{job}`, 'get', () => jsonResponse({ error: { code: 404 } }, 404)),
                route('POST', JOBS, 'create', () => jsonResponse({ done: true, error: { code: 9, message: 'bad image' } })),
            ],
        });
        await expect(runJobs(JOB_ARGS, failing.deps)).rejects.toThrow('the job operation failed');
        const refused = fakes({ files: { digest: IMAGE }, routes: [route('GET', `${JOBS}/{job}`, 'get', () => jsonResponse({}, 403))] });
        await expect(runJobs(JOB_ARGS, refused.deps)).rejects.toBeInstanceOf(GoogleCallError);
        const unnamed = fakes({
            files: { digest: IMAGE },
            routes: [
                route('GET', `${JOBS}/{job}`, 'get', () => jsonResponse({ error: { code: 404 } }, 404)),
                route('POST', JOBS, 'create', () => jsonResponse({ done: false })),
            ],
        });
        await expect(runJobs(JOB_ARGS, unnamed.deps)).rejects.toThrow('did not finish');
        await expect(runJobs(['--project', 'p'], unnamed.deps)).rejects.toThrow('usage: run-jobs');
    });
});

describe('hosting-config', () => {
    it('happyPath_theSiteKeepsItsLastTenReleases', async () => {
        const world = fakes({
            routes: [
                route('PATCH', 'https://firebasehosting.googleapis.com/v1beta1/sites/demo-hcm/config', 'config', () =>
                    jsonResponse({ maxVersions: 10 }),
                ),
            ],
        });

        await expect(hostingConfig(['--project', 'demo-hcm', '--max-versions', '10'], world.deps)).resolves.toBe(0);
        expect(new URL(world.calls[0]?.url ?? 'https://x').searchParams.get('updateMask')).toBe('maxVersions');
        expect(JSON.parse(world.calls[0]?.body ?? '{}')).toEqual({ maxVersions: 10 });
    });

    it('badPath_noSiteOrNoCountIsUsage', async () => {
        await expect(hostingConfig(['--max-versions', '10'], fakes().deps)).rejects.toThrow('usage: hosting-config');
        await expect(hostingConfig(['--project', 'p', '--max-versions', '0'], fakes().deps)).rejects.toThrow('usage: hosting-config');
    });
});

describe('the steps by name and their real world', () => {
    it('happyPath_aStepRunsByName_badPath_whatItThrowsIsItsMessageAndStatusOne', async () => {
        const world = fakes();

        await expect(runStep('deploy-with-retry', ['--project', 'p'], world.deps)).resolves.toBe(0);
        await expect(runStep('hosting-config', [], world.deps)).resolves.toBe(1);
        expect(world.lines.at(-1)).toMatch(/^hosting-config: Error: usage: hosting-config/);
        expect(Object.keys(STEPS)).toEqual(['deploy-with-retry', 'verify-server', 'run-jobs', 'hosting-config', 'deploy-hosting']);
    });

    it('happyPath_aRealCommandsOutputIsShownAndKept_badPath_aMissingCommandIsStatusOne', async () => {
        const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
        try {
            const done = await runCommand(process.execPath, [
                '-e',
                'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)',
            ]);
            const missing = await runCommand('/nonexistent/command', []);

            expect(done.code).toBe(3);
            expect(done.output).toContain('out');
            expect(done.output).toContain('err');
            expect(missing.code).toBe(1);
        } finally {
            write.mockRestore();
        }
        expect(tail('x'.repeat(MAX_OUTPUT + 5))).toHaveLength(MAX_OUTPUT);
    });

    it('happyPath_theMetadataServersToken_badPath_noTokenThrows', async () => {
        const answer = (body: unknown, status = 200) =>
            createFakeFetch(routeTable([route('GET', METADATA_TOKEN_URL, 'token', () => jsonResponse(body, status))])).fetch;

        await expect(metadataToken(answer({ access_token: 'ya29.build' }))).resolves.toBe('ya29.build');
        await expect(metadataToken(answer({}, 500))).rejects.toThrow('HTTP 500');
        await expect(metadataToken(answer({ access_token: '' }))).rejects.toThrow('no token');
    });

    it('happyPath_aGoogleCallWithAnEmptyAnswer_badPath_aRefusalNamesTheCallNotItsQuery', async () => {
        const fetcher = createFakeFetch(
            routeTable([
                route('DELETE', 'https://example.googleapis.com/v1/thing', 'delete', () => new Response('', { status: 200 })),
                route('GET', 'https://example.googleapis.com/v1/thing', 'get', () => jsonResponse({}, 403)),
            ]),
        );

        await expect(
            googleJson({ fetch: fetcher.fetch }, TOKEN, 'https://example.googleapis.com/v1/thing', { method: 'DELETE' }),
        ).resolves.toEqual({});
        await expect(googleJson({ fetch: fetcher.fetch }, TOKEN, 'https://example.googleapis.com/v1/thing?secret=1')).rejects.toThrow(
            'GET https://example.googleapis.com/v1/thing: HTTP 403',
        );
    });

    it('happyPath_theRealWorldReadsTheMetadataServerAFileAndTheClock', async () => {
        const metadata = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ access_token: 'ya29.build' }));
        const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
        try {
            const real = nodeStepDeps();

            await expect(real.token()).resolves.toBe('ya29.build');
            expect(metadata.mock.calls[0]?.[0]).toBe(METADATA_TOKEN_URL);
            real.log('a line');
            expect(write).toHaveBeenCalledWith('a line\n');
            await expect(real.sleep(1)).resolves.toBeUndefined();
            expect(real.readFile('package.json')).toContain('historic-city-map');
            expect(real.run).toBe(runCommand);
            expect(real.random()).toBeLessThan(1);
        } finally {
            metadata.mockRestore();
            write.mockRestore();
        }
    });
});
