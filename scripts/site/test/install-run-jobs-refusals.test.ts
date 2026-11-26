import { createUpstreamFakes, jsonResponse, route, routeTable, createFakeFetch } from '@hcm/test-support/fakes';
import { parseInstallLogLine } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { readRefusal, redactGoogleText } from '../src/install/steps/google-error.js';
import { rateWaitSeconds, runJobs } from '../src/install/steps/run-jobs.js';
import { GoogleCallError, type StepDeps } from '../src/install/steps/step-io.js';

/**
 * Finding 47 of 2026-11-01 (docs/research/manual-test-2026-10-25.md): the pipeline build's `jobs` step stopped at
 * `HTTP 429` with no reason. Over the fake Cloud Run: a refusal for the request rate is waited out with backoff and
 * jitter, one job after the other; a quota is named (a line and a `quota` event) and not tried again; every refusal
 * prints Google's reason, redacted.
 */

const IMAGE = `us-central1-docker.pkg.dev/demo-hcm/hcm/pipeline@sha256:${'b'.repeat(64)}`;
const ARGS = ['--project', 'demo-hcm', '--region', 'us-central1', '--image-file', 'digest', '--slug', '1-0-0-abc1234'];
const JOBS = 'https://run.googleapis.com/v2/projects/demo-hcm/locations/us-central1/jobs';

interface World {
    readonly deps: StepDeps;
    readonly lines: string[];
    readonly sleeps: number[];
}

function world(fetcher: typeof fetch, random = 0.5): World {
    const lines: string[] = [];
    const sleeps: number[] = [];
    const deps: StepDeps = {
        run: () => Promise.resolve({ code: 0, output: '' }),
        fetch: fetcher,
        token: () => Promise.resolve('e2e-build-token'),
        readFile: () => IMAGE,
        sleep: (ms) => {
            sleeps.push(ms);
            return Promise.resolve();
        },
        random: () => random,
        log: (line) => {
            lines.push(line);
        },
    };
    return { deps, lines, sleeps };
}

function events(lines: readonly string[]) {
    return lines.map(parseInstallLogLine).filter((event) => event !== null);
}

describe('run-jobs refusals (finding 47)', () => {
    it('happyPath_aRateLimitedCreateIsWaitedOutThenTheThreeJobsAreMadeOneAfterTheOther', async () => {
        const upstream = createUpstreamFakes();
        upstream.scenario('cloud-run.jobsRateLimited');
        const { deps, lines, sleeps } = world(upstream.fetch);

        await expect(runJobs(ARGS, deps)).resolves.toBe(0);

        const writes = upstream.calls.filter((call) => call.operation === 'cloud-run.jobs.create');
        // Two refusals of the first job's create, then one create a job, in order; never two at once.
        expect(writes.map((call) => [call.status, new URL(call.url).searchParams.get('jobId')])).toEqual([
            [429, 'raster-fetch'],
            [429, 'raster-fetch'],
            [200, 'raster-fetch'],
            [200, 'raster-pipeline'],
            [200, 'raster-pipeline-xl'],
        ]);
        // Google's reason is in the log: its status, its ErrorInfo and the quota metadata, not only "HTTP 429".
        expect(lines[0]).toContain(
            'POST https://run.googleapis.com/v2/projects/demo-hcm/locations/us-central1/jobs: HTTP 429 RESOURCE_EXHAUSTED',
        );
        expect(lines[0]).toContain('ErrorInfo RATE_LIMIT_EXCEEDED');
        expect(lines[0]).toContain('service=run.googleapis.com');
        // Retry-After (30 s) is longer than the first two waits (5 and 10 s at the middle of their jitter).
        expect(events(lines).filter((event) => event.event === 'retry')).toEqual([
            { event: 'retry', attempt: 1, waitSeconds: 30, reason: 'quota' },
            { event: 'retry', attempt: 2, waitSeconds: 30, reason: 'quota' },
        ]);
        expect(sleeps).toEqual([30_000, 30_000]);
        const specs = upstream.snapshot()['cloud-run'] as { jobSpecs: Record<string, { image: string; labels: Record<string, string> }> };
        expect(specs.jobSpecs['demo-hcm/us-central1/raster-pipeline-xl']).toEqual({
            image: IMAGE,
            labels: { 'hcm-release': '1-0-0-abc1234' },
        });
        expect(events(lines).some((event) => event.event === 'quota')).toBe(false);
    });

    it('badPath_aQuotaIsNamedAndNotTriedAgain', async () => {
        const upstream = createUpstreamFakes();
        upstream.scenario('cloud-run.jobsQuotaExceeded');
        const { deps, lines, sleeps } = world(upstream.fetch);

        const refused = runJobs(ARGS, deps);

        await expect(refused).rejects.toBeInstanceOf(GoogleCallError);
        await expect(refused).rejects.toThrow('ErrorInfo RESOURCE_QUOTA_EXCEEDED');
        await expect(refused).rejects.toThrow('QuotaFailure projects/123456789012/locations/us-central1');
        expect(upstream.calls.filter((call) => call.operation === 'cloud-run.jobs.create')).toHaveLength(1);
        expect(sleeps).toEqual([]);
        expect(lines).toContain(
            'jobs: Google Cloud refused raster-fetch for the quota run.googleapis.com/cpu_allocation (limit CpuAllocPerProjectRegion) ' +
                'of run.googleapis.com. A free-trial project has lower quotas: upgrade the account, or ask for a higher quota on the ' +
                'Quotas page, then try again.',
        );
        expect(events(lines)).toEqual([
            {
                event: 'quota',
                service: 'run.googleapis.com',
                metric: 'run.googleapis.com/cpu_allocation',
                limit: 'CpuAllocPerProjectRegion',
            },
        ]);
    });

    it('badPath_aRateLimitThatLastsEndsTheStepAfterFourWaitsUnderFourMinutes', async () => {
        const fetcher = createFakeFetch(
            routeTable([
                route('GET', `${JOBS}/{job}`, 'get', () => jsonResponse({ error: { code: 404 } }, 404)),
                route('POST', JOBS, 'create', () => new Response('not json', { status: 429 })),
            ]),
        );
        const { deps, lines, sleeps } = world(fetcher.fetch, 0.999);

        await expect(runJobs(ARGS, deps)).rejects.toThrow('HTTP 429');

        expect(fetcher.calls.filter((call) => call.operation === 'create')).toHaveLength(5);
        expect(sleeps).toEqual([7000, 15_000, 30_000, 60_000]);
        expect(sleeps.reduce((sum, ms) => sum + ms, 0)).toBeLessThan(240_000);
        // No quota was named: the card shows the log's last lines.
        expect(events(lines).filter((event) => event.event === 'quota')).toEqual([]);
    });

    it('happyPath_theWaitsGrowWithJitterAndHonourRetryAfter_badPath_neverLongerThanAMinute', () => {
        expect(rateWaitSeconds(1, 0, 0)).toBe(3);
        expect(rateWaitSeconds(2, 0, 0.5)).toBe(10);
        expect(rateWaitSeconds(3, 45, 0)).toBe(45);
        expect(rateWaitSeconds(4, 0, 0.999)).toBe(60);
        expect(rateWaitSeconds(1, 3600, 0.5)).toBe(60);
    });

    it('happyPath_aRefusalIsReadAndRedacted_badPath_anythingElseIsNoExhaustion', () => {
        const forbidden = readRefusal(
            403,
            { error: { status: 'PERMISSION_DENIED', message: 'Bearer ya29.abcdefghij denied' } },
            'x.googleapis.com',
        );
        expect(forbidden).toEqual({ summary: 'PERMISSION_DENIED: Bearer [redacted] denied', exhaustion: null, quota: null });
        expect(readRefusal(500, 'oops', 'x.googleapis.com')).toEqual({ summary: '', exhaustion: null, quota: null });
        // A quota without names in its details is still a quota, named by the call's host.
        const bare = readRefusal(
            429,
            { error: { details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaValue: 8 }] }] } },
            'run.googleapis.com',
        );
        expect(bare).toEqual({
            summary: 'QuotaFailure 8',
            exhaustion: 'quota',
            quota: { service: 'run.googleapis.com', metric: '', limit: '' },
        });
        expect(readRefusal(200, { error: { status: 'RESOURCE_EXHAUSTED' } }, 'h').exhaustion).toBe('rate');
        expect(redactGoogleText('https://storage.googleapis.com/b/o?X-Goog-Signature=abc key AIzaSyA-0123456789abcdefghijkl')).toBe(
            'https://storage.googleapis.com/b/o key [redacted]',
        );
    });
});
