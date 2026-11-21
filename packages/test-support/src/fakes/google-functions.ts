import { BACKGROUND_FUNCTIONS, CALLABLES, deployedName, HTTP_ENDPOINTS } from '@hcm/shared';

import { FIXTURE_VALUES, fixtureBody } from '../api-fixtures/index.js';
import { authenticated, googleError, googleFailure, type GoogleApi, type GoogleProjects } from './google-common.js';
import { enableService, serviceEnabled, type ServiceUsageState } from './google-services.js';
import { jsonResponse, route, type Route } from './routes.js';
import type { ServiceFake } from './service.js';

/**
 * The server's deployment as the admin's step (d) sees it (`docs/research/M2b-interfaces.md` §3.3 d, §6.1): Cloud
 * Functions v2's list of the project's functions and Cloud Scheduler's jobs (the `scheduler` doctor item). Nothing is
 * deployed in a fresh project, whose Cloud Functions API is still off (403 `SERVICE_DISABLED`); the scenarios
 * `none`, `partial`, `deployed` and `failed` play a deploy.
 */

export const DEPLOYMENTS = ['none', 'partial', 'deployed', 'failed'] as const;

export type Deployment = (typeof DEPLOYMENTS)[number];

export interface DeploymentState {
    deployment: Deployment;
    /** firebase-tools created the `ops.tick` Scheduler job (set by every scenario that deploys). */
    schedulerJob: boolean;
    /** M6: the release the deployed functions run (their `HCM_RELEASE`); unset for a deploy from before M6. */
    release?: string;
    /** Its build time (their `HCM_RELEASE_TIME`, finding 39 of 2026-11-01); unset for a deploy without one. */
    releaseTime?: number;
    /**
     * M6 review: how many of the registry's last functions the deploy lacks (unset: none), as a server from before M6
     * lacks the functions M6 added.
     */
    lacking?: number;
}

/** The functions M6 added to the registry, which a server deployed before M6 lacks (`preM6`). */
export const PRE_M6_LACKING = 8;

/** M6: an older and a newer release than the e2e admin's (S-A55-HAPPY-UPDATE, S-A55-BAD-DOWNGRADE). */
export const OLDER_SERVER_RELEASE = '0.9.0+e2e0000';
export const NEWER_SERVER_RELEASE = '99.0.0+e2e9999';

/**
 * Finding 39 of 2026-11-01: other builds of the e2e admin's own version (`1.0.0`, its build time 1761955200 in
 * `e2e/fixtures/install-bundle.ts`). The older build was deployed before the build times existed (no
 * `HCM_RELEASE_TIME`, as the live 1.0.0+9e2e6b5); the newer one names a later time.
 */
export const OLDER_BUILD_RELEASE = '1.0.0+e2e0000';
export const NEWER_BUILD_RELEASE = '1.0.0+e2e0002';
export const NEWER_BUILD_TIME = 1_762_041_600;

const FUNCTIONS: GoogleApi = {
    service: 'cloudfunctions.googleapis.com',
    title: 'Cloud Functions API',
    permission: 'cloudfunctions.functions.list',
};
const SCHEDULER: GoogleApi = {
    service: 'cloudscheduler.googleapis.com',
    title: 'Cloud Scheduler API',
    permission: 'cloudscheduler.jobs.list',
};

/** Every function the backend deploys, by its deployed name (32 today). */
export function registryFunctions(): string[] {
    return [...Object.keys(CALLABLES), ...Object.keys(HTTP_ENDPOINTS), ...Object.keys(BACKGROUND_FUNCTIONS)].map(deployedName);
}

/** The registry's functions a deploy made: all of them, or all but the last `lacking` (a server from before M6). */
function deployedNames(lacking: number | undefined): string[] {
    const all = registryFunctions();
    return all.slice(0, all.length - (lacking ?? 0));
}

/** The deployed functions and their states: `partial` has a third of them, `failed` all but one `FAILED`. */
function deployedFunctions(deployment: Deployment, names: readonly string[]): readonly (readonly [string, string])[] {
    switch (deployment) {
        case 'none':
            return [];
        case 'partial':
            return names.slice(0, Math.floor(names.length / 3)).map((name) => [name, 'ACTIVE'] as const);
        case 'deployed':
            return names.map((name) => [name, 'ACTIVE'] as const);
        case 'failed':
            return names.map((name, index) => [name, index === 0 ? 'FAILED' : 'ACTIVE'] as const);
    }
}

/** The functions' environment of a deploy: its `HCM_RELEASE` and, when it has one, its `HCM_RELEASE_TIME`. */
function releaseVariables(release: string, releaseTime: number | undefined): Record<string, string> {
    return releaseTime === undefined ? { HCM_RELEASE: release } : { HCM_RELEASE: release, HCM_RELEASE_TIME: String(releaseTime) };
}

/** A function's answer with its `HCM_RELEASE` (M6) and build time, when the deploy set one. */
function withRelease(body: unknown, state: Pick<DeploymentState, 'release' | 'releaseTime'>): unknown {
    if (state.release === undefined || typeof body !== 'object' || body === null) {
        return body;
    }
    const fn = body as Record<string, unknown>;
    const serviceConfig = {
        ...(fn['serviceConfig'] as Record<string, unknown> | undefined),
        environmentVariables: releaseVariables(state.release, state.releaseTime),
    };
    return { ...fn, serviceConfig };
}

/** One page of `items` for the request's `pageSize` and `pageToken` (the index of the page's first item). */
function page(items: readonly unknown[], query: URLSearchParams, field: string): Record<string, unknown> {
    const size = Number(query.get('pageSize') ?? items.length);
    const start = Number(query.get('pageToken') ?? 0);
    const next = start + size < items.length ? { nextPageToken: String(start + size) } : {};
    return { [field]: items.slice(start, start + size), ...next };
}

/** The fake Cloud Functions v2 list (needs the API enabled, as Google does). */
export function createCloudFunctionsFake(state: DeploymentState, services: ServiceUsageState, projects: GoogleProjects): ServiceFake {
    const list: Route['answer'] = (request, params) => {
        const project = projects.resolve(String(params['project']));
        if (!serviceEnabled(services, project.id, FUNCTIONS.service)) {
            return googleError('google/error.service-disabled', FUNCTIONS, { projectNumber: project.number });
        }
        const functions = deployedFunctions(state.deployment, deployedNames(state.lacking)).map(([functionId, functionState]) =>
            withRelease(
                fixtureBody('cloud-functions/function.get', {
                    projectId: project.id,
                    region: String(params['region']),
                    functionId,
                    functionState,
                }),
                state,
            ),
        );
        return jsonResponse(page(functions, request.url.searchParams, 'functions'));
    };
    const deployedWith =
        (release: string | undefined, deployment: Deployment = 'deployed', lacking?: number, releaseTime?: number) =>
        () => {
            state.deployment = deployment;
            state.schedulerJob = true;
            delete state.release;
            delete state.releaseTime;
            delete state.lacking;
            Object.assign(state, release === undefined ? {} : { release }, lacking === undefined ? {} : { lacking });
            Object.assign(state, releaseTime === undefined ? {} : { releaseTime });
            enableService(services, String(FIXTURE_VALUES['projectId']), FUNCTIONS.service);
        };
    const scenarios = Object.fromEntries(
        DEPLOYMENTS.map((deployment) => [
            deployment,
            () => {
                state.deployment = deployment;
                delete state.lacking;
                state.schedulerJob = deployment === 'deployed' || deployment === 'failed';
                // A deploy enables the API; `none` leaves it as it is (off in a fresh project: 403 SERVICE_DISABLED).
                if (deployment !== 'none') {
                    enableService(services, String(FIXTURE_VALUES['projectId']), FUNCTIONS.service);
                }
            },
        ]),
    );
    return {
        name: 'cloud-functions',
        routes: [
            route(
                'GET',
                'https://cloudfunctions.googleapis.com/v2/projects/{project}/locations/{region}/functions',
                'cloud-functions.list',
                authenticated(FUNCTIONS, list),
            ),
        ],
        failure: (mode) => googleFailure(FUNCTIONS, mode),
        scenarios: {
            ...scenarios,
            // M6: a server installed by an older and by a newer release than the e2e admin's.
            deployedOlderRelease: deployedWith(OLDER_SERVER_RELEASE),
            deployedNewerRelease: deployedWith(NEWER_SERVER_RELEASE),
            // Finding 39 of 2026-11-01: other builds of the admin's own version, before the build times and after it.
            deployedOlderBuild: deployedWith(OLDER_BUILD_RELEASE),
            deployedNewerBuild: deployedWith(NEWER_BUILD_RELEASE, 'deployed', undefined, NEWER_BUILD_TIME),
            // The M6 review: a server deployed before M6 (no release, M6's functions missing: an update, never a first
            // install), and a newer server one of whose functions is gone (never replaced: --force would delete it).
            preM6: deployedWith(undefined, 'deployed', PRE_M6_LACKING),
            partialNewerRelease: deployedWith(NEWER_SERVER_RELEASE, 'partial'),
        },
        snapshot: () => ({ deployment: state.deployment, release: state.release ?? null, releaseTime: state.releaseTime ?? null }),
    };
}

/** The fake Cloud Scheduler: the `ops.tick` job exists once the server is deployed (firebase-tools creates it). */
export function createCloudSchedulerFake(state: DeploymentState, projects: GoogleProjects): ServiceFake {
    const list: Route['answer'] = (_request, params) => {
        const project = projects.resolve(String(params['project']));
        const jobs = state.schedulerJob
            ? [fixtureBody('cloud-scheduler/job.get', { projectId: project.id, region: String(params['region']) })]
            : [];
        return jsonResponse(jobs.length === 0 ? {} : { jobs });
    };
    return {
        name: 'cloud-scheduler',
        routes: [
            route(
                'GET',
                'https://cloudscheduler.googleapis.com/v1/projects/{project}/locations/{region}/jobs',
                'cloud-scheduler.jobs.list',
                authenticated(SCHEDULER, list),
            ),
        ],
        failure: (mode) => googleFailure(SCHEDULER, mode),
        scenarios: {},
        snapshot: () => ({ schedulerJob: state.schedulerJob }),
    };
}
