import { CLOUD_RUN_JOBS } from '@hcm/shared';

import { FIXTURE_VALUES, fixtureBody, fixtureResponse, type FixtureName } from '../api-fixtures/index.js';
import { authenticated, googleError, googleFailure, type GoogleApi, type GoogleProjects } from './google-common.js';
import type { UpstreamRequest } from './fetch.js';
import { bodyField, jsonResponse, requestObject, route, type Route, type RouteParams } from './routes.js';
import { sequence, type ServiceFake } from './service.js';

/**
 * Cloud Run Admin API v2 for the raster pipeline's executions (`CloudRunJobs`, security review §4.1,
 * docs/research/M3-interfaces.md §4.3): `jobs/{job}:run` with container env and args overrides, executions that stay
 * running until a scenario (or the runner) finishes them, and `:cancel`. A job must be provisioned first
 * (`cloud-run.jobProvisioned`, `cloud-run.pipelineJobsProvisioned`). With a `runner` (the e2e world's stand-in or the
 * real pipeline, e2e/admin/support/imagery-runner.ts) each run is handed to it, `:cancel` becomes its SIGTERM, and the
 * execution ends when the runner says so; an out-of-memory end answers exit 137 (`execution.failed-oom.json`).
 *
 * M6: the pipeline build's `jobs` step creates (`jobs?jobId=`) and replaces (`PATCH`) the two jobs, each answered with a
 * finished operation; finding 47 of 2026-11-01: `jobsRateLimited` refuses the next two writes for the request rate
 * (`google/error.rate-limited`, which the step waits out) and `jobsQuotaExceeded` every write for a quota
 * (`cloud-run/jobs.create.quota-exceeded`, which it names and does not try again) until `jobsWritable`.
 */

type ExecutionState = 'running' | 'succeeded' | 'failed' | 'cancelled';

interface Execution {
    readonly projectId: string;
    readonly region: string;
    readonly job: string;
    readonly id: string;
    /** The env overrides of the run request (`JOB_ID`, `CITY_ID`, ...). */
    readonly env: Readonly<Record<string, string>>;
    /** The args overrides of the run request (`run`). */
    readonly args: readonly string[];
    state: ExecutionState;
    /** `oom`: the task exceeded its memory (exit 137). */
    failure?: 'oom' | undefined;
    /** `:cancel` was called (Cloud Run sends the container SIGTERM). */
    cancelRequested: boolean;
}

/** A run as the runner sees it: what it was asked to do, how it ends it, and Cloud Run's SIGTERM. */
export interface PipelineExecution {
    /** `projects/<p>/locations/<r>/jobs/<job>/executions/<id>`. */
    readonly name: string;
    /** `raster-pipeline` or `raster-pipeline-xl`. */
    readonly job: string;
    /** `<id>`: what the container reads as `CLOUD_RUN_EXECUTION`. */
    readonly id: string;
    readonly env: Readonly<Record<string, string>>;
    readonly args: readonly string[];
    /** True once `:cancel` was called. */
    readonly cancelRequested: boolean;
    /** Ends the execution (a second call is ignored); `failure: 'oom'` for a task killed by its memory limit. */
    finish(state: Exclude<ExecutionState, 'running'>, failure?: 'oom'): void;
    /** Called once when `:cancel` arrives (the SIGTERM handler). */
    onCancel(listener: () => void): void;
}

/** Plays the executions of the pipeline jobs (`start` must return at once; the run goes on in the background). */
export interface CloudRunRunner {
    start(execution: PipelineExecution): void;
}

export interface CloudRunState {
    /** `<project>/<region>/<job>` of every job that exists. */
    readonly jobs: Set<string>;
    /** Execution name → execution. */
    readonly executions: Map<string, Execution>;
    /** Who plays the runs (the e2e world sets it on every partition); without one an execution runs until a scenario. */
    runner?: CloudRunRunner;
    /** M6: what the installer's pipeline build put on a job (`<project>/<region>/<job>` → its labels and image). */
    jobSpecs?: Map<string, JobSpec>;
    /** Finding 47: how the next job writes are refused (`rate` for `remaining` of them, `quota` until cleared), if at all. */
    jobWrites?: { readonly refusal: 'rate' | 'quota'; remaining: number };
}

/** A job as the installer's pipeline build makes it (M6, `docs/research/M6-interfaces.md` §1.4.2). */
export interface JobSpec {
    readonly labels: Readonly<Record<string, string>>;
    readonly image: string;
}

/** Creates or replaces the job `key` (`<project>/<region>/<job>`) with `spec`, as the pipeline build's `jobs` step does. */
export function setJobSpec(state: CloudRunState, key: string, spec: JobSpec): void {
    state.jobs.add(key);
    state.jobSpecs ??= new Map();
    state.jobSpecs.set(key, spec);
}

/** A job's answer: its name and, when the pipeline build made it, its labels and image. */
function jobBody(state: CloudRunState, key: string, name: string): Record<string, unknown> {
    const spec = state.jobSpecs?.get(key);
    return spec === undefined ? { name } : { name, labels: spec.labels, template: { template: { containers: [{ image: spec.image }] } } };
}

const CLOUD_RUN: GoogleApi = { service: 'run.googleapis.com', title: 'Cloud Run Admin API', permission: 'run.jobs.run' };

/** The refusal of a job write the state holds, counting a rate limit down (finding 47), or undefined. */
function refusedWrite(state: CloudRunState, projectNumber: string): Response | undefined {
    const writes = state.jobWrites;
    if (writes === undefined) {
        return undefined;
    }
    if (writes.refusal === 'quota') {
        return fixtureResponse('cloud-run/jobs.create.quota-exceeded', {
            values: { projectNumber, region: String(FIXTURE_VALUES['region']) },
        });
    }
    writes.remaining -= 1;
    if (writes.remaining <= 0) {
        delete state.jobWrites;
    }
    return googleError('google/error.rate-limited', CLOUD_RUN, { projectNumber });
}

/** The value at `path` of a JSON value, or undefined. */
function at(value: unknown, path: readonly (string | number)[]): unknown {
    return path.reduce<unknown>(
        (current, key) =>
            typeof current === 'object' && current !== null ? (current as Record<string | number, unknown>)[key] : undefined,
        value,
    );
}

/** The labels and the first container's image of a job a write sends. */
function specOf(request: UpstreamRequest): JobSpec {
    const body = requestObject(request);
    const image = at(body, ['template', 'template', 'containers', 0, 'image']);
    return { labels: (body['labels'] ?? {}) as Record<string, string>, image: typeof image === 'string' ? image : '' };
}

/** M6: an older release's slug and image, as an update finds them. */
const OLDER_RELEASE_SLUG = '0-9-0-e2e0000';
const OLDER_PIPELINE_IMAGE = `us-central1-docker.pkg.dev/demo-hcm/hcm/pipeline@sha256:${'0'.repeat(64)}`;

const STATE_FIXTURES: Readonly<Record<ExecutionState, FixtureName>> = {
    running: 'cloud-run/execution.running',
    succeeded: 'cloud-run/execution.succeeded',
    failed: 'cloud-run/execution.failed',
    cancelled: 'cloud-run/execution.cancelled',
};

function stateFixture(execution: Execution): FixtureName {
    return execution.failure === 'oom' ? 'cloud-run/execution.failed-oom' : STATE_FIXTURES[execution.state];
}

function containersOf(overrides: unknown): { env?: unknown; args?: unknown }[] {
    const containers = (overrides as { containerOverrides?: unknown } | undefined)?.containerOverrides;
    return Array.isArray(containers) ? (containers as { env?: unknown; args?: unknown }[]) : [];
}

/** The args overrides of a run request (`overrides.containerOverrides[0].args`). */
function argsOf(overrides: unknown): string[] {
    const args = containersOf(overrides)[0]?.args;
    return Array.isArray(args) ? args.map(String) : [];
}

/** The execution as its runner drives it. */
function handleOf(name: string, execution: Execution): PipelineExecution & { cancel(): void } {
    const listeners: (() => void)[] = [];
    return {
        name,
        job: execution.job,
        id: execution.id,
        env: execution.env,
        args: execution.args,
        get cancelRequested() {
            return execution.cancelRequested;
        },
        finish: (state, failure) => {
            if (execution.state === 'running') {
                execution.state = state;
                execution.failure = failure;
            }
        },
        onCancel: (listener) => {
            listeners.push(listener);
        },
        cancel: () => {
            execution.cancelRequested = true;
            listeners.splice(0).forEach((listener) => {
                listener();
            });
        },
    };
}

/** The env overrides of a run request (`overrides.containerOverrides[].env[]`). */
function envOf(overrides: unknown): Record<string, string> {
    const entries = containersOf(overrides).flatMap((container) =>
        Array.isArray(container.env) ? (container.env as { name?: unknown; value?: unknown }[]) : [],
    );
    return Object.fromEntries(
        entries
            .filter((entry) => typeof entry.name === 'string')
            .map((entry) => [String(entry.name), typeof entry.value === 'string' ? entry.value : '']),
    );
}

function executionValues(execution: Execution): Record<string, string> {
    return { projectId: execution.projectId, region: execution.region, job: execution.job, execution: execution.id };
}

/** The named state changes of the fake Cloud Run (`cloud-run.<name>`). */
function cloudRunScenarios(state: CloudRunState): Record<string, () => void> {
    const finish = (target: ExecutionState): void => {
        state.executions.forEach((execution) => {
            if (execution.state === 'running') {
                execution.state = target;
            }
        });
    };
    return {
        jobProvisioned: () => {
            state.jobs.add(`${String(FIXTURE_VALUES['projectId'])}/${String(FIXTURE_VALUES['region'])}/${String(FIXTURE_VALUES['job'])}`);
        },
        executionsSucceed: () => {
            finish('succeeded');
        },
        executionsFail: () => {
            finish('failed');
        },
        pipelineJobsProvisioned: () => {
            Object.values(CLOUD_RUN_JOBS).forEach((job) => {
                state.jobs.add(`${String(FIXTURE_VALUES['projectId'])}/${String(FIXTURE_VALUES['region'])}/${job}`);
            });
        },
        /** M6: both jobs made by an older release's pipeline build (S-A56-HAPPY-UPDATE). */
        pipelineJobsOlderRelease: () => {
            Object.values(CLOUD_RUN_JOBS).forEach((job) => {
                const key = `${String(FIXTURE_VALUES['projectId'])}/${String(FIXTURE_VALUES['region'])}/${job}`;
                setJobSpec(state, key, { labels: { 'hcm-release': OLDER_RELEASE_SLUG }, image: OLDER_PIPELINE_IMAGE });
            });
        },
        /** Finding 47: the next two job writes are refused for the request rate, then accepted. */
        jobsRateLimited: () => {
            state.jobWrites = { refusal: 'rate', remaining: 2 };
        },
        /** Finding 47: every job write is refused for a quota until `jobsWritable`. */
        jobsQuotaExceeded: () => {
            state.jobWrites = { refusal: 'quota', remaining: 0 };
        },
        jobsWritable: () => {
            delete state.jobWrites;
        },
        executionsOutOfMemory: () => {
            state.executions.forEach((execution) => {
                if (execution.state === 'running') {
                    execution.state = 'failed';
                    execution.failure = 'oom';
                }
            });
        },
    };
}

/** The fake Cloud Run Admin API. */
export function createCloudRunFake(state: CloudRunState, projects: GoogleProjects): ServiceFake {
    const nextExecution = sequence('e2e', 2);
    const nextOperation = sequence('e2e-run-op-');
    const handles = new Map<string, ReturnType<typeof handleOf>>();
    const jobKey = (params: RouteParams): string =>
        `${projects.resolve(String(params['project'])).id}/${String(params['region'])}/${String(params['job'])}`;
    const executionName = (params: RouteParams): string =>
        `projects/${projects.resolve(String(params['project'])).id}/locations/${String(params['region'])}/jobs/${String(params['job'])}/executions/${String(params['execution'])}`;
    const operation = (execution: Execution, done: boolean): Response => {
        const values = { ...executionValues(execution), operationId: nextOperation() };
        const body = fixtureBody('cloud-run/jobs.run.operation', values) as Record<string, unknown>;
        return jsonResponse({ ...body, done });
    };
    const run: Route['answer'] = (request, params) => {
        if (!state.jobs.has(jobKey(params))) {
            return fixtureResponse('cloud-run/job.not-found', {
                values: {
                    projectId: projects.resolve(String(params['project'])).id,
                    region: String(params['region']),
                    job: String(params['job']),
                },
            });
        }
        const execution: Execution = {
            projectId: projects.resolve(String(params['project'])).id,
            region: String(params['region']),
            job: String(params['job']),
            id: `${String(params['job'])}-${nextExecution()}`,
            env: envOf(bodyField(request, 'overrides')),
            args: argsOf(bodyField(request, 'overrides')),
            state: 'running',
            cancelRequested: false,
        };
        const name = `projects/${execution.projectId}/locations/${execution.region}/jobs/${execution.job}/executions/${execution.id}`;
        state.executions.set(name, execution);
        if (state.runner !== undefined) {
            const handle = handleOf(name, execution);
            handles.set(name, handle);
            state.runner.start(handle);
        }
        return operation(execution, false);
    };
    const withExecution = (params: RouteParams, answer: (execution: Execution) => Response): Response => {
        const execution = state.executions.get(executionName(params));
        return execution === undefined ? googleError('google/error.not-found', CLOUD_RUN) : answer(execution);
    };
    const base = 'https://run.googleapis.com/v2/projects/{project}/locations/{region}/jobs';
    const auth = (answer: Route['answer']): Route['answer'] => authenticated(CLOUD_RUN, answer);
    /** A create (`jobId` in the query) or a replace (`{job}` in the path): the job holds the request's labels and image. */
    const write: Route['answer'] = (request, params) => {
        const project = projects.resolve(String(params['project']));
        const refused = refusedWrite(state, project.number);
        if (refused !== undefined) {
            return refused;
        }
        const job = String(params['job'] ?? request.url.searchParams.get('jobId'));
        setJobSpec(state, `${project.id}/${String(params['region'])}/${job}`, specOf(request));
        const name = `projects/${project.id}/locations/${String(params['region'])}/operations/${nextOperation()}`;
        return jsonResponse({ name, done: true });
    };
    return {
        name: 'cloud-run',
        routes: [
            route('POST', `${base}/{job}:run`, 'cloud-run.jobs.run', auth(run)),
            route('POST', base, 'cloud-run.jobs.create', auth(write)),
            route('PATCH', `${base}/{job}`, 'cloud-run.jobs.patch', auth(write)),
            route(
                'POST',
                `${base}/{job}/executions/{execution}:cancel`,
                'cloud-run.executions.cancel',
                auth((_request, params) =>
                    withExecution(params, (execution) => {
                        const handle = handles.get(executionName(params));
                        if (handle === undefined) {
                            execution.state = execution.state === 'running' ? 'cancelled' : execution.state;
                        } else {
                            handle.cancel();
                        }
                        return operation(execution, false);
                    }),
                ),
            ),
            route(
                'GET',
                `${base}/{job}/executions/{execution}`,
                'cloud-run.executions.get',
                auth((_request, params) =>
                    withExecution(params, (execution) => fixtureResponse(stateFixture(execution), { values: executionValues(execution) })),
                ),
            ),
            route(
                'GET',
                `${base}/{job}`,
                'cloud-run.jobs.get',
                auth((_request, params) =>
                    state.jobs.has(jobKey(params))
                        ? jsonResponse(
                              jobBody(
                                  state,
                                  jobKey(params),
                                  `projects/${projects.resolve(String(params['project'])).id}/locations/${String(params['region'])}/jobs/${String(params['job'])}`,
                              ),
                          )
                        : googleError('google/error.not-found', CLOUD_RUN),
                ),
            ),
        ],
        failure: (mode) => googleFailure(CLOUD_RUN, mode),
        scenarios: cloudRunScenarios(state),
        snapshot: () => ({
            jobs: [...state.jobs].sort((left, right) => left.localeCompare(right)),
            executions: Object.fromEntries(state.executions),
            jobSpecs: Object.fromEntries(state.jobSpecs ?? []),
        }),
    };
}
