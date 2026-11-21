/**
 * Cloud Run Admin API v2 over REST (`docs/research/M3-interfaces.md` §4.3): the raster pipeline's executions. `run` is
 * `POST jobs/{job}:run` with one task and the container's environment and arguments overridden; the long-running
 * operation's `metadata.name` is the execution. `cancel` is `POST executions/{id}:cancel`; `get` reads the execution's
 * counts and conditions, and names an out-of-memory exit (137, "Memory limit exceeded") and a timeout; `job` reads a job's
 * first container's image and its string labels (finding 74; 404: undefined). Tokens come from
 * `TokenProvider` (the runtime's service account); failures are `UpstreamError('cloud-run', …)`.
 */
import type { CloudRunJobs, ExecutionStatus, JobDescription, JobRunOptions } from '../ports/cloud-run-jobs.js';
import { UpstreamError } from '../ports/errors.js';
import type { TokenProvider } from '../ports/token-provider.js';
import { googleJson } from './google-call.js';
import { at, list, stringAt, type Fetch } from './upstream-http.js';

const SERVICE = 'cloud-run';
const RUN_API = 'https://run.googleapis.com/v2';

/** An execution name this adapter accepts for `cancel` and `get` (never a URL or a path that could leave the API). */
const JOB_NAME = /^[a-z0-9-]{1,63}$/;
const EXECUTION_NAME = /^projects\/[a-z0-9-]{1,63}\/locations\/[a-z0-9-]{1,63}\/jobs\/[a-z0-9-]{1,63}\/executions\/[a-z0-9-]{1,100}$/;

interface CloudRunOptions {
    readonly fetch: Fetch;
    readonly tokens: TokenProvider;
    readonly projectId: string;
    readonly region: string;
}

function count(execution: unknown, field: string): number {
    const value = at(execution, field);
    return typeof value === 'number' ? value : 0;
}

/** The failed condition's words (Cloud Run's reason and message), lower-cased. */
function failureText(execution: unknown): string {
    return list(at(execution, 'conditions'))
        .map((condition) => `${stringAt(condition, 'reason') ?? ''} ${stringAt(condition, 'message') ?? ''}`)
        .join(' ')
        .toLowerCase();
}

/** The exit code Cloud Run's message names (`Task … failed with exit code 137.`). */
function exitCodeOf(text: string): Pick<ExecutionStatus, 'exitCode'> {
    const match = /exit code (\d{1,3})/.exec(text);
    return match === null ? {} : { exitCode: Number(match[1]) };
}

/** Out of memory (exit 137, or "Memory limit exceeded"), a timeout, or another exit. */
function failureKind(text: string, exitCode: number | undefined): NonNullable<ExecutionStatus['failure']> {
    if (text.includes('memory limit') || exitCode === 137) {
        return 'oom';
    }
    return text.includes('deadline') || text.includes('timeout') ? 'timeout' : 'exit';
}

/** Why a failed execution failed. */
function failureOf(text: string): Pick<ExecutionStatus, 'failure' | 'exitCode'> {
    const code = exitCodeOf(text);
    return { failure: failureKind(text, code.exitCode), ...code };
}

/** The execution's state from its counts (one task: exactly one count ends it). */
export function executionStatus(execution: unknown): ExecutionStatus {
    if (count(execution, 'succeededCount') > 0) {
        return { state: 'succeeded' };
    }
    if (count(execution, 'cancelledCount') > 0) {
        return { state: 'cancelled' };
    }
    return count(execution, 'failedCount') > 0 ? { state: 'failed', ...failureOf(failureText(execution)) } : { state: 'running' };
}

function requireExecution(execution: string): string {
    if (!EXECUTION_NAME.test(execution)) {
        throw new UpstreamError(SERVICE, 'invalid');
    }
    return execution;
}

/** The run request: one task, the container's environment (and arguments, and timeout, when given) overridden. */
function runRequest(env: Readonly<Record<string, string>>, runOptions: JobRunOptions): unknown {
    const container = {
        env: Object.entries(env).map(([name, value]) => ({ name, value })),
        ...(runOptions.args === undefined ? {} : { args: [...runOptions.args] }),
    };
    const timeout = runOptions.timeoutSeconds === undefined ? {} : { timeout: `${String(runOptions.timeoutSeconds)}s` };
    return { overrides: { containerOverrides: [container], taskCount: 1, ...timeout } };
}

/** The execution an operation started, or `invalid`. */
function executionOf(operation: unknown): { readonly name: string } {
    const name = stringAt(operation, 'metadata', 'name');
    if (name === undefined || !EXECUTION_NAME.test(name)) {
        throw new UpstreamError(SERVICE, 'invalid');
    }
    return { name };
}

/** A job's first container's image and its labels with string values (`template.template.containers[0].image`). */
export function jobDescription(job: unknown): JobDescription {
    const labels = at(job, 'labels');
    const named = typeof labels === 'object' && labels !== null ? Object.entries(labels) : [];
    return {
        image: stringAt(list(at(job, 'template', 'template', 'containers'))[0], 'image') ?? '',
        labels: Object.fromEntries(named.filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
    };
}

function requireJob(job: string): string {
    if (!JOB_NAME.test(job)) {
        throw new UpstreamError(SERVICE, 'invalid');
    }
    return job;
}

/** A 404 of Google's is no job; anything else is thrown on. */
function absentJob(error: unknown): undefined {
    if (error instanceof UpstreamError && error.failure === 'notFound') {
        return undefined;
    }
    throw error;
}

export function createCloudRunJobs(options: CloudRunOptions): CloudRunJobs {
    const call = async (method: 'GET' | 'POST', url: string, body?: unknown): Promise<unknown> => {
        const accessToken = await options.tokens.accessToken();
        return googleJson(options.fetch, SERVICE, url, body === undefined ? { method, accessToken } : { method, accessToken, body });
    };
    const jobsUrl = `${RUN_API}/projects/${options.projectId}/locations/${options.region}/jobs`;
    return {
        run: async (job, env, runOptions = {}) =>
            executionOf(await call('POST', `${jobsUrl}/${encodeURIComponent(job)}:run`, runRequest(env, runOptions))),
        cancel: async (execution) => {
            await call('POST', `${RUN_API}/${requireExecution(execution)}:cancel`, {});
        },
        get: async (execution) => executionStatus(await call('GET', `${RUN_API}/${requireExecution(execution)}`)),
        job: async (job) => {
            const url = `${jobsUrl}/${requireJob(job)}`;
            return call('GET', url).then(jobDescription, absentJob);
        },
    };
}
