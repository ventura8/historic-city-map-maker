/**
 * The Cloud Run Admin adapter (`functions/src/adapters/cloud-run.ts`) against a fake `fetch` answering the shared
 * fixtures of `@hcm/test-support/api-fixtures/cloud-run`: an execution started with its environment and arguments, its
 * outcome read (out of memory, a timeout, another exit), its cancellation, and Google's failures.
 */
import { fixtureBody, fixtureResponse } from '@hcm/test-support/api-fixtures';
import { createFakeFetch, jsonResponse, route, routeTable } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { createCloudRunJobs, executionStatus, jobDescription } from '../../src/adapters/cloud-run.js';

const RUN = 'https://run.googleapis.com/v2';
const JOBS = `${RUN}/projects/demo-hcm/locations/us-central1/jobs`;
const EXECUTION = 'projects/demo-hcm/locations/us-central1/jobs/raster-pipeline/executions/raster-pipeline-e2e01';
const VALUES = {
    projectId: 'demo-hcm',
    region: 'us-central1',
    job: 'raster-pipeline',
    execution: 'raster-pipeline-e2e01',
    operationId: 'op-1',
};

function adapter(routes: Parameters<typeof routeTable>[0]) {
    const upstream = createFakeFetch(routeTable(routes));
    const jobs = createCloudRunJobs({
        fetch: upstream.fetch,
        tokens: { accessToken: () => Promise.resolve('test-access-token') },
        projectId: 'demo-hcm',
        region: 'us-central1',
    });
    return { upstream, jobs };
}

function execution(state: 'running' | 'succeeded' | 'failed' | 'cancelled') {
    return route('GET', `${JOBS}/{job}/executions/{execution}`, 'cloud-run.executions.get', () =>
        fixtureResponse(`cloud-run/execution.${state}`, { values: VALUES }),
    );
}

describe('createCloudRunJobs', () => {
    it('happyPath_runStartsOneTaskWithTheJobsEnvironmentAndArguments', async () => {
        const { upstream, jobs } = adapter([
            route('POST', `${JOBS}/{job}:run`, 'cloud-run.jobs.run', () =>
                fixtureResponse('cloud-run/jobs.run.operation', { values: VALUES }),
            ),
        ]);

        const started = await jobs.run('raster-pipeline', { JOB_ID: 'j1', CITY_ID: 'bucharest' }, { args: ['run'], timeoutSeconds: 3600 });

        expect(started).toEqual({ name: EXECUTION });
        expect(upstream.calls[0]).toMatchObject({
            method: 'POST',
            url: `${JOBS}/raster-pipeline:run`,
            headers: { authorization: 'Bearer test-access-token' },
        });
        expect(JSON.parse(String(upstream.calls[0]?.body))).toEqual({
            overrides: {
                containerOverrides: [
                    {
                        env: [
                            { name: 'JOB_ID', value: 'j1' },
                            { name: 'CITY_ID', value: 'bucharest' },
                        ],
                        args: ['run'],
                    },
                ],
                taskCount: 1,
                timeout: '3600s',
            },
        });
    });

    it('happyPath_runWithoutOptionsOverridesTheEnvironmentOnly', async () => {
        const { upstream, jobs } = adapter([
            route('POST', `${JOBS}/{job}:run`, 'cloud-run.jobs.run', () =>
                fixtureResponse('cloud-run/jobs.run.operation', { values: VALUES }),
            ),
        ]);

        await jobs.run('raster-pipeline', { JOB_ID: 'j1' });

        expect(JSON.parse(String(upstream.calls[0]?.body))).toEqual({
            overrides: { containerOverrides: [{ env: [{ name: 'JOB_ID', value: 'j1' }] }], taskCount: 1 },
        });
    });

    it('badPath_aJobThatDoesNotExistIsNotFound', async () => {
        const { jobs } = adapter([
            route('POST', `${JOBS}/{job}:run`, 'cloud-run.jobs.run', () => fixtureResponse('cloud-run/job.not-found', { values: VALUES })),
        ]);

        await expect(jobs.run('raster-pipeline', {})).rejects.toMatchObject({ service: 'cloud-run', failure: 'notFound', status: 404 });
    });

    it.each([
        ['no execution in the operation', { name: 'operations/x' }],
        ['an execution name outside the API', { metadata: { name: 'https://evil.example/x' } }],
    ])('badPath_anUnreadableOperationIsInvalid_%s', async (_case, body) => {
        const { jobs } = adapter([route('POST', `${JOBS}/{job}:run`, 'cloud-run.jobs.run', () => jsonResponse(body))]);

        await expect(jobs.run('raster-pipeline', {})).rejects.toMatchObject({ failure: 'invalid' });
    });

    it.each([
        ['running', { state: 'running' }],
        ['succeeded', { state: 'succeeded' }],
        ['cancelled', { state: 'cancelled' }],
        ['failed', { state: 'failed', failure: 'exit', exitCode: 1 }],
    ] as const)('happyPath_getReadsAnExecutionThatIs_%s', async (state, status) => {
        const { jobs } = adapter([execution(state)]);

        await expect(jobs.get(EXECUTION)).resolves.toEqual(status);
    });

    it('happyPath_cancelAsksCloudRunToStopTheExecution', async () => {
        const { upstream, jobs } = adapter([
            route('POST', `${JOBS}/{job}/executions/{execution}:cancel`, 'cloud-run.executions.cancel', () =>
                fixtureResponse('cloud-run/execution.cancel.operation', { values: VALUES }),
            ),
        ]);

        await jobs.cancel(EXECUTION);

        expect(upstream.calls[0]).toMatchObject({ method: 'POST', url: `${RUN}/${EXECUTION}:cancel`, body: '{}' });
    });

    it('badPath_anExecutionNameOutsideTheApiIsRefusedBeforeAnyCall', async () => {
        const { upstream, jobs } = adapter([]);

        await expect(jobs.get('../../x')).rejects.toMatchObject({ failure: 'invalid' });
        await expect(jobs.cancel('projects/demo-hcm/other')).rejects.toMatchObject({ failure: 'invalid' });
        expect(upstream.calls).toEqual([]);
    });

    it('badPath_aMissingRoleIsForbidden', async () => {
        const { jobs } = adapter([
            route('GET', `${JOBS}/{job}/executions/{execution}`, 'cloud-run.executions.get', () =>
                fixtureResponse('google/error.permission-denied', {
                    values: { service: 'run.googleapis.com', serviceTitle: 'Cloud Run Admin API', permission: 'run.executions.get' },
                }),
            ),
        ]);

        await expect(jobs.get(EXECUTION)).rejects.toMatchObject({ failure: 'forbidden', status: 403 });
    });

    it('happyPath_jobReadsTheImageAndTheLabelsAJobRuns', async () => {
        const image = `us-central1-docker.pkg.dev/demo-hcm/hcm/pipeline@sha256:${'eb'.repeat(32)}`;
        const { upstream, jobs } = adapter([
            route('GET', `${JOBS}/{job}`, 'cloud-run.jobs.get', () =>
                jsonResponse({ labels: { 'hcm-release': '1-0-0-bf74d17', count: 3 }, template: { template: { containers: [{ image }] } } }),
            ),
        ]);

        await expect(jobs.job('raster-pipeline')).resolves.toEqual({ image, labels: { 'hcm-release': '1-0-0-bf74d17' } });
        expect(upstream.calls[0]).toMatchObject({ method: 'GET', url: `${JOBS}/raster-pipeline` });
    });

    it('badPath_jobOfAMissingJobIsNoneAndOtherFailuresAreThrown', async () => {
        const { jobs } = adapter([
            route('GET', `${JOBS}/{job}`, 'cloud-run.jobs.get', (_request, params) =>
                params['job'] === 'raster-pipeline'
                    ? fixtureResponse('cloud-run/job.not-found', { values: VALUES })
                    : fixtureResponse('google/error.permission-denied', {
                          values: { service: 'run.googleapis.com', serviceTitle: 'Cloud Run Admin API', permission: 'run.jobs.get' },
                      }),
            ),
        ]);

        await expect(jobs.job('raster-pipeline')).resolves.toBeUndefined();
        await expect(jobs.job('raster-fetch')).rejects.toMatchObject({ failure: 'forbidden' });
        await expect(jobs.job('../x')).rejects.toMatchObject({ failure: 'invalid' });
    });

    it('happyPath_aJobWithoutContainersOrLabelsReadsAsNoImage', () => {
        expect(jobDescription({})).toEqual({ image: '', labels: {} });
        expect(jobDescription({ labels: 'x', template: { template: { containers: [] } } })).toEqual({ image: '', labels: {} });
    });
});

describe('executionStatus', () => {
    const failed = fixtureBody('cloud-run/execution.failed', VALUES) as Record<string, unknown>;

    it.each([
        ['the memory limit', 'Memory limit of 16384M exceeded with 16502M used.', 'Unknown', { failure: 'oom' }],
        [
            'exit code 137',
            'Task raster-pipeline-e2e01-task0 failed with exit code 137.',
            'NonZeroExitCode',
            { failure: 'oom', exitCode: 137 },
        ],
        ['the task timeout', 'Task raster-pipeline-e2e01-task0 exceeded its timeout.', 'DeadlineExceeded', { failure: 'timeout' }],
    ])('happyPath_aFailureSaysWhy_%s', (_case, message, reason, expected) => {
        expect(executionStatus({ ...failed, conditions: [{ type: 'Completed', state: 'CONDITION_FAILED', message, reason }] })).toEqual({
            state: 'failed',
            ...expected,
        });
    });

    it('badPath_aFailureWithoutConditionsIsAnExit', () => {
        expect(executionStatus({ failedCount: 1 })).toEqual({ state: 'failed', failure: 'exit' });
        expect(executionStatus(undefined)).toEqual({ state: 'running' });
    });
});
