/**
 * Cloud Run Admin API v2 over REST: the raster pipeline's executions (docs/research/design-review-security-cost.md §4.1,
 * docs/research/M3-interfaces.md §4.3). `run` is `jobs/{job}:run` with container overrides (the job's `JOB_ID` and
 * `CITY_ID`, the arguments `PIPELINE_RUN_ARGS`), `cancel` is `executions/{id}:cancel`, `get` reads an execution's
 * outcome (`imagery.tick`: a lost execution, an out-of-memory exit), and `job` what a job runs (finding 74 of 2026-11-03:
 * the installed pipeline image is the one the job `raster-pipeline` runs, `worker.image`). Adapter `functions/src/adapters/cloud-run.ts`
 * (fn-imagery); failures are `UpstreamError('cloud-run', …)`.
 */
interface JobExecution {
    /** projects/{p}/locations/{l}/jobs/{job}/executions/{id} */
    readonly name: string;
}

/** Overrides of one execution beyond its environment. */
export interface JobRunOptions {
    /** The container's arguments (`PIPELINE_RUN_ARGS`). */
    readonly args?: readonly string[];
    /** The task timeout in seconds, when it should differ from the job's (6 hours). */
    readonly timeoutSeconds?: number;
}

/** Where an execution stands; a failed one says why when Cloud Run does (`oom`: exit 137 or "Memory limit exceeded"). */
export interface ExecutionStatus {
    readonly state: 'running' | 'succeeded' | 'failed' | 'cancelled';
    readonly failure?: 'oom' | 'timeout' | 'exit';
    readonly exitCode?: number;
}

/** What a job runs: its first container's image (as the pipeline build's `jobs` step set it) and its labels. */
export interface JobDescription {
    readonly image: string;
    readonly labels: Readonly<Record<string, string>>;
}

export interface CloudRunJobs {
    run(job: string, env: Readonly<Record<string, string>>, options?: JobRunOptions): Promise<JobExecution>;
    cancel(execution: string): Promise<void>;
    get(execution: string): Promise<ExecutionStatus>;
    /** The job's image and labels; undefined when the job does not exist (404). */
    job(job: string): Promise<JobDescription | undefined>;
}
