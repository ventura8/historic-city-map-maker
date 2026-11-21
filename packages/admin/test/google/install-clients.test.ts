import { createLogger } from '@hcm/shared';
import { createFakeFetch, jsonResponse, route, routeTable, type Route } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { createArtifactRegistryClient, pipelineRepositorySpec } from '../../src/google/artifact-registry.js';
import { cloudBuildConsoleUrl, cloudBuildOf, createCloudBuildClient } from '../../src/google/cloud-build.js';
import { createLoggingClient, MAX_LINE_LENGTH, safeLogLine, stepOfLabel, stepTail } from '../../src/google/logging.js';
import { createRunJobsClient } from '../../src/google/run-jobs.js';
import { createGoogleTransport, type GoogleTransport } from '../../src/google/transport.js';

/**
 * The installer's REST clients (`docs/research/M6-interfaces.md` §1.10) against answers the fakes never give: sparse
 * builds, unknown statuses, log lines to cut and redact, a job without labels, a repository that already exists.
 */

function transportOver(routes: readonly Route[]): GoogleTransport {
    return createGoogleTransport({
        fetch: createFakeFetch(routeTable(routes)).fetch,
        token: () => 'e2e-token',
        sleep: () => Promise.resolve(),
        log: createLogger('test', { sink: () => undefined }),
    });
}

const BUILDS = 'https://cloudbuild.googleapis.com/v1/projects/p/locations/r/builds';

describe('Cloud Build', () => {
    it('happyPath_aBuildIsReadWithItsStepsTimesTagsAndSubstitutions', () => {
        expect(
            cloudBuildOf({
                id: 'b-1',
                status: 'WORKING',
                createTime: '2026-10-25T10:00:00Z',
                steps: [{ id: 'fetch', status: 'SUCCESS', timing: { startTime: 't0', endTime: 't1' } }, { status: 'NOPE' }],
                tags: ['hcm-install', 3],
                substitutions: { _SLUG: 's', _BAD: 4 },
            }),
        ).toEqual({
            id: 'b-1',
            status: 'WORKING',
            createTime: '2026-10-25T10:00:00Z',
            steps: [
                { id: 'fetch', status: 'SUCCESS', startTime: 't0', endTime: 't1' },
                { id: '', status: 'STATUS_UNKNOWN' },
            ],
            tags: ['hcm-install'],
            substitutions: { _SLUG: 's' },
        });
    });

    it('badPath_anEmptyAnswerIsAnUnknownBuildNamedByItsResource', () => {
        expect(cloudBuildOf(undefined)).toEqual({ id: '', status: 'STATUS_UNKNOWN', steps: [], tags: [], substitutions: {} });
        expect(cloudBuildOf({ name: 'projects/p/locations/r/builds/b-2', status: 42 }).id).toBe('b-2');
    });

    it('happyPath_createGetAndListByTag', async () => {
        const client = createCloudBuildClient(
            transportOver([
                route('POST', BUILDS, 'create', () => jsonResponse({ name: 'op', metadata: { build: { id: 'b-1', status: 'QUEUED' } } })),
                route('GET', `${BUILDS}/{id}`, 'get', (_request, params) => jsonResponse({ id: params['id'], status: 'SUCCESS' })),
                route('GET', BUILDS, 'list', (request) =>
                    jsonResponse(request.url.searchParams.get('filter') === 'tags="hcm-server"' ? { builds: [{ id: 'b-1' }] } : {}),
                ),
            ]),
        );

        await expect(client.create('p', 'r', { steps: [] })).resolves.toMatchObject({ id: 'b-1', status: 'QUEUED' });
        await expect(client.get('p', 'r', 'b-9')).resolves.toMatchObject({ id: 'b-9', status: 'SUCCESS' });
        await expect(client.listByTag('p', 'r', 'hcm-server')).resolves.toHaveLength(1);
        await expect(client.listByTag('p', 'r', 'hcm-site')).resolves.toEqual([]);
    });

    it('badPath_aTagThatCouldLeaveTheFiltersQuotesIsRefused', async () => {
        const client = createCloudBuildClient(transportOver([]));

        await expect(client.listByTag('p', 'r', 'x" OR tags="y')).rejects.toBeInstanceOf(RangeError);
    });

    it('happyPath_theConsoleLinkIsMadeFromTheId', () => {
        expect(cloudBuildConsoleUrl('demo-hcm', 'us-central1', 'b 1')).toBe(
            'https://console.cloud.google.com/cloud-build/builds;region=us-central1/b%201?project=demo-hcm',
        );
    });
});

describe('Cloud Logging', () => {
    it('happyPath_aBuildsLinesOldestFirstWithTheirStep', async () => {
        const client = createLoggingClient(
            transportOver([
                route('POST', 'https://logging.googleapis.com/v2/entries:list', 'list', () =>
                    jsonResponse({
                        entries: [
                            { textPayload: 'second', labels: { build_step: 'Step #1 - "tools"' }, timestamp: 't2' },
                            { textPayload: '  ', labels: {} },
                            { textPayload: 'first\twith a tab', labels: { build_step: 'Step #0 - "fetch"' } },
                        ],
                    }),
                ),
            ]),
        );

        await expect(client.buildLines('p', '0e2e0000-0000')).resolves.toEqual([
            { step: 'fetch', text: 'first with a tab', time: '' },
            { step: 'tools', text: 'second', time: 't2' },
        ]);
    });

    it('badPath_aBuildIdThatIsNotOneIsRefused', async () => {
        await expect(createLoggingClient(transportOver([])).buildLines('p', 'x" OR "1')).rejects.toBeInstanceOf(RangeError);
    });

    it('badPath_aLongLineIsCutAndASecretRedacted', () => {
        const line = safeLogLine(`token ya29.abcdefghijkl ${'x'.repeat(300)}`);

        expect(line).toHaveLength(MAX_LINE_LENGTH);
        expect(line).not.toContain('ya29.abcdefghijkl');
        expect(line.endsWith('…')).toBe(true);
        expect([stepOfLabel(undefined), stepOfLabel('Step #2')]).toEqual(['', '']);
    });

    it('happyPath_aStepsTailOrEveryStepsTail', () => {
        const lines = [
            { step: 'a', text: '1', time: '' },
            { step: 'b', text: '2', time: '' },
            { step: 'a', text: '3', time: '' },
        ];

        expect(stepTail(lines, 'a')).toEqual(['1', '3']);
        expect(stepTail(lines, null, 2)).toEqual(['2', '3']);
    });
});

describe('Cloud Run jobs and Artifact Registry', () => {
    const JOBS = 'https://run.googleapis.com/v2/projects/p/locations/r/jobs';
    const REPOS = 'https://artifactregistry.googleapis.com/v1/projects/p/locations/r/repositories';

    it('happyPath_aJobsReleaseLabelAndImage_badPath_aBareJobAndNoJob', async () => {
        const client = createRunJobsClient(
            transportOver([
                route('GET', `${JOBS}/full`, 'full', () =>
                    jsonResponse({
                        labels: { 'hcm-release': '1-0-0', 'hcm-release-time': '1761955200' },
                        template: { template: { containers: [{ image: 'img@sha256:1' }] } },
                    }),
                ),
                route('GET', `${JOBS}/bare`, 'bare', () => jsonResponse({ name: 'bare' })),
                route('GET', `${JOBS}/{job}`, 'missing', () => jsonResponse({ error: { code: 404, status: 'NOT_FOUND' } }, 404)),
            ]),
        );

        await expect(client.get('p', 'r', 'full')).resolves.toEqual({
            name: 'full',
            releaseSlug: '1-0-0',
            releaseTime: '1761955200',
            image: 'img@sha256:1',
        });
        await expect(client.get('p', 'r', 'bare')).resolves.toEqual({ name: 'bare', releaseSlug: '', releaseTime: '', image: '' });
        await expect(client.get('p', 'r', 'other')).resolves.toBeUndefined();
    });

    it('happyPath_aRepositoryIsCreatedOnce_badPath_otherRefusalsPropagate', async () => {
        let exists = false;
        const client = createArtifactRegistryClient(
            transportOver([
                route('GET', `${REPOS}/bare`, 'bare', () => jsonResponse({})),
                route('GET', `${REPOS}/{repository}`, 'get', () =>
                    exists ? jsonResponse({ name: `${REPOS}/hcm`, format: 'DOCKER' }) : jsonResponse({ error: { code: 404 } }, 404),
                ),
                route('POST', REPOS, 'create', (request) => {
                    if (request.url.searchParams.get('repositoryId') === 'locked') {
                        return jsonResponse({ error: { code: 403, status: 'PERMISSION_DENIED' } }, 403);
                    }
                    if (exists) {
                        return jsonResponse({ error: { code: 409, status: 'ALREADY_EXISTS' } }, 409);
                    }
                    exists = true;
                    return jsonResponse({ name: 'op', done: true, response: {} });
                }),
            ]),
        );

        await expect(client.get('p', 'r', 'hcm')).resolves.toBeUndefined();
        await expect(client.get('p', 'r', 'bare')).resolves.toEqual({ name: '', format: '' });
        await expect(client.create('p', 'r', 'hcm', pipelineRepositorySpec())).resolves.toBe(true);
        await expect(client.create('p', 'r', 'hcm', pipelineRepositorySpec())).resolves.toBe(false);
        await expect(client.get('p', 'r', 'hcm')).resolves.toEqual({ name: `${REPOS}/hcm`, format: 'DOCKER' });
        await expect(client.create('p', 'r', 'locked', {})).rejects.toMatchObject({ kind: 'forbidden' });
        expect(pipelineRepositorySpec()).toMatchObject({ format: 'DOCKER', cleanupPolicyDryRun: false });
    });
});
