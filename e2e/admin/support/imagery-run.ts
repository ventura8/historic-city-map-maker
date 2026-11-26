import {
    DOWNLOAD_STEPS,
    jobDocSchema,
    jobLogDocSchema,
    JOB_STEPS,
    layerVersionDocSchema,
    LEASE_SECONDS,
    PIPELINE_STEPS,
    systemWriter,
    timestampFromDate,
    type Calibration,
    type JobType,
    type JoinReport,
    type LandsatReport,
    type PipelineStep,
    type TimestampLike,
} from '@hcm/shared';
import type { PipelineExecution } from '@hcm/test-support/fakes';

import { E2E_CITY_BOUNDS, type Bounds, type LatLng } from './imagery-geometry.js';
import { deleteObjects, DocumentGone, readDocument, updateDocument } from './imagery-store.js';

/**
 * One run of the raster pipeline as the stand-in plays it (docs/research/M3-interfaces.md §4.4, §4.5, §13): the job and
 * its layer version as the pipeline reads and writes them, every write validated with the shared schemas first (a stand-in
 * that drifted from the contract fails loudly instead of feeding the admin a document the real pipeline never writes),
 * the lease, progress, log lines, waits, failures and the cancellation. The steps themselves are imagery-standin.ts.
 */

/**
 * What a run of one attempt does (the spec's script, imagery-runner.ts); `suggestions` (M4, docs/research/M4-interfaces.md
 * §2.6): the matcher found too few confident pairs and suggests four, the version waits for points.
 */
type StandinOutcome = 'under' | 'over' | 'no-match' | 'suggestions' | 'embedded' | 'scan' | 'maintenance' | 'fail' | 'oom' | 'declined';

export interface StandinAttempt {
    readonly outcome: StandinOutcome;
    /** The run stops before this step until the spec releases it (`ImageryWorld.release`), or a cancel arrives. */
    readonly holdAt?: PipelineStep;
    /** Where `fail` and `oom` happen (default `warp`). */
    readonly failAt?: PipelineStep;
    /** The `apiError.*` code of `fail` (default `apiError.imagery.processingFailed`, as the pipeline's GDAL failures). */
    readonly code?: string;
    /** What the message of `code` names (M8: the frames of `apiError.imagery.joinSeamTooFar`). */
    readonly codeParams?: Readonly<Record<string, string>>;
    /** The checkpoint RMSE the georeferencing measures (default 6.2 m under, 28.4 m over). */
    readonly checkpointRmseM?: number;
    /** The warped area (default 40 km²: within the month's free compute units at any zoom). */
    readonly areaKm2?: number;
    /** The warped layer's bounds (default the scan's corners, the whole city): a frame that holds only part of it (M8). */
    readonly outputBounds?: Bounds;
    /** M9: the share of the city the render measures (default the share its bounds hold). */
    readonly coveragePct?: number;
    /** M12: the render's measured edge over the city, and a version with no tiles yet (as one made before M12, until the sweep). */
    readonly outline?: readonly LatLng[];
    readonly noTiles?: boolean;
    /** M9: what `locate` measured (default nothing, as a frame that never went through it). */
    readonly calibration?: Calibration;
    /** M16, a recalibration: the current fit's figure on the new fit's checks (default 28.4 m); `declined` ends it with nothing better. */
    readonly beforeM?: number;
    /** M15: the automatic georef carries a panoramic camera's lattice (17 x 17 nodes of the scan's own map), as a KH-9 pan frame's. */
    readonly lattice?: boolean;
    /** M15, *Terrain*: with `lattice`, the frame was fitted over level ground 100 m up that its film shows `TERRAIN_PARALLAX_PX` east a metre. */
    readonly terrain?: boolean;
    /** M8, a `layer-join`: what its report says beyond the defaults (`imagery-standin-join.ts`), and that no seam could be measured. */
    readonly join?: Partial<JoinReport>;
    readonly seamsUnmeasured?: boolean;
    /** `maintenance`: when USGS is tried again (default 30 minutes; 0 for a tick that resumes it at once). */
    readonly retryInMinutes?: number;
    /**
     * `fetch` reports these bytes received (and the delivery's size, when given) and the run ends there with the job still
     * running: a long download as the admin watches it (finding 55 of 2026-11-01; the pipeline's `ctx.report_bytes`).
     */
    readonly downloading?: { readonly received: number; readonly total?: number };
    /** M25: a Landsat scene's report beyond the stand-in's (within a pixel, a clear city): its shift or the city's cloud. */
    readonly landsat?: Partial<LandsatReport>;
}

/** The pipeline's weights of the `usgs-import` steps (§4.4); other job types scale theirs to 1. */
const WEIGHTS: Readonly<Partial<Record<PipelineStep, number>>> = {
    fetch: 0.25,
    extract: 0.05,
    stitch: 0.1,
    inspect: 0.25,
    locate: 0.05,
    reference: 0.05,
    georef: 0.2,
    align: 0.15,
    merge: 0.25,
    warp: 0.15,
    export: 0.1,
    register: 0.05,
};

type Data = Record<string, unknown>;

const PIPELINE = systemWriter('pipeline');

/** The pipeline steps of a job type, in order. */
export function pipelineStepsOf(type: JobType): readonly PipelineStep[] {
    return JOB_STEPS[type].filter((step): step is PipelineStep => (PIPELINE_STEPS as readonly string[]).includes(step));
}

function now(): TimestampLike {
    return timestampFromDate(new Date());
}

function minutesFromNow(minutes: number): TimestampLike {
    return timestampFromDate(new Date(Date.now() + minutes * 60_000));
}

/** `target` with dotted `path` set to `value` (or removed for undefined). */
function withPath(target: Data, path: readonly string[], value: unknown): Data {
    const [head = '', ...rest] = path;
    if (rest.length === 0) {
        const copy = { ...target };
        if (value === undefined) {
            Reflect.deleteProperty(copy, head);
        } else {
            copy[head] = value;
        }
        return copy;
    }
    const inner = target[head];
    return { ...target, [head]: withPath(typeof inner === 'object' && inner !== null ? (inner as Data) : {}, rest, value) };
}

function valueAt(data: Data, path: readonly string[]): unknown {
    return path.reduce<unknown>(
        (current, key) => (typeof current === 'object' && current !== null ? (current as Data)[key] : undefined),
        data,
    );
}

/** One run: its job, version, city window, attempt and the execution Cloud Run gave it. */
/**
 * A run whose job names a layer version that does not exist (a world seeded without it): the pipeline fails the job with
 * `apiError.invalidRequest` before any step (`runner.py`, `_context`), so the job never holds one of the server's running
 * slots (`RUNNING_JOBS_MAX`, counted over every city).
 */
export async function failWithoutVersion(city: string, jobId: string): Promise<void> {
    const path = `cities/${city}/jobs/${jobId}`;
    if ((await readDocument(path)) === undefined) {
        return;
    }
    const failed = {
        status: 'failed',
        error: { code: 'apiError.invalidRequest', message: 'the layer version does not exist (e2e stand-in)' },
        finishedAt: now(),
        updatedBy: PIPELINE,
        updatedAt: now(),
    };
    await updateDocument(path, failed, [...Object.keys(failed), 'lease'], true);
}

export class Run {
    readonly city: string;
    readonly jobId: string;
    readonly execution: PipelineExecution;
    readonly attempt: StandinAttempt;
    job: Data;
    version: Data;
    bounds: Bounds;
    #logs = 0;

    constructor(context: {
        city: string;
        jobId: string;
        execution: PipelineExecution;
        attempt: StandinAttempt;
        job: Data;
        version: Data;
        bounds: Bounds;
    }) {
        this.city = context.city;
        this.jobId = context.jobId;
        this.execution = context.execution;
        this.attempt = context.attempt;
        this.job = context.job;
        this.version = context.version;
        this.bounds = context.bounds;
    }

    /** Reads the run's documents (undefined when the job or its version is missing: a run of nothing). */
    static async load(
        city: string,
        jobId: string,
        execution: PipelineExecution,
        pick: (job: Data) => StandinAttempt,
    ): Promise<Run | undefined> {
        const job = await readDocument(`cities/${city}/jobs/${jobId}`);
        const versionId = typeof job?.['versionId'] === 'string' ? job['versionId'] : jobId;
        const version = await readDocument(`cities/${city}/layerVersions/${versionId}`);
        if (job === undefined || version === undefined) {
            return undefined;
        }
        const cityDoc = await readDocument(`cities/${city}`);
        const bounds = (cityDoc?.['bounds'] as Bounds | undefined) ?? E2E_CITY_BOUNDS;
        return new Run({ city, jobId, execution, attempt: pick(job), job, version, bounds });
    }

    get type(): JobType {
        return this.job['type'] as JobType;
    }

    get versionId(): string {
        return typeof this.job['versionId'] === 'string' ? this.job['versionId'] : this.jobId;
    }

    get layerId(): string {
        return String(this.version['layerId']);
    }

    get jobPath(): string {
        return `cities/${this.city}/jobs/${this.jobId}`;
    }

    get versionPath(): string {
        return `cities/${this.city}/layerVersions/${this.versionId}`;
    }

    /** Re-reads the job (the dispatcher and the admin write it too); a job the next test's reset deleted ends the run. */
    async refresh(): Promise<Data> {
        const job = await readDocument(this.jobPath);
        if (job === undefined) {
            throw new DocumentGone(this.jobPath);
        }
        this.job = job;
        return this.job;
    }

    /** Writes job fields (dotted paths; undefined deletes), validated as the whole document first. */
    async writeJob(changes: Readonly<Record<string, unknown>>): Promise<void> {
        await this.refresh();
        const stamped: Record<string, unknown> = { ...changes, updatedBy: PIPELINE, updatedAt: now() };
        const merged = Object.entries(stamped).reduce<Data>((data, [path, value]) => withPath(data, path.split('.'), value), this.job);
        jobDocSchema.parse(merged);
        const data = Object.keys(stamped).reduce<Data>(
            (built, path) => withPath(built, path.split('.'), valueAt(merged, path.split('.'))),
            {},
        );
        await updateDocument(this.jobPath, data, Object.keys(stamped), true);
        this.job = merged;
    }

    /** Writes version fields, validated as the whole document first. */
    async writeVersion(changes: Readonly<Record<string, unknown>>): Promise<void> {
        const stamped: Record<string, unknown> = { ...changes, updatedBy: PIPELINE, updatedAt: now() };
        const merged = { ...this.version, ...stamped };
        Object.keys(stamped)
            .filter((key) => stamped[key] === undefined)
            .forEach((key) => Reflect.deleteProperty(merged, key));
        layerVersionDocSchema.parse(merged);
        await updateDocument(
            this.versionPath,
            Object.fromEntries(Object.entries(stamped).filter(([, value]) => value !== undefined)),
            Object.keys(stamped),
            true,
        );
        this.version = merged;
    }

    /** A log line of the job (`jobs/{id}/logs/{seq}`), redacted by construction: the stand-in never holds an address. */
    async log(level: 'info' | 'warn' | 'error', message: string, step?: PipelineStep): Promise<void> {
        this.#logs += 1;
        // An attempt's two runs (the download on the small job, then the rest: finding 56) number their lines apart.
        const phase = this.job['machine'] === 'fetch' ? 0 : 500;
        const seq = Number(this.job['attempt'] ?? 1) * 1000 + phase + this.#logs;
        const line = { seq, level, message, updatedBy: PIPELINE, updatedAt: now(), ...(step === undefined ? {} : { step }) };
        jobLogDocSchema.parse(line);
        await updateDocument(`${this.jobPath}/logs/${String(seq).padStart(6, '0')}`, line, Object.keys(line));
    }

    /** The share of the job's pipeline steps done (§4.4's weights, scaled to the job type). */
    progress(): number {
        const steps = pipelineStepsOf(this.type);
        const total = steps.reduce((sum, step) => sum + (WEIGHTS[step] ?? 0), 0);
        const records = (this.job['steps'] ?? {}) as Readonly<Record<string, { status?: string }>>;
        const done = steps
            .filter((step) => ['done', 'skipped'].includes(records[step]?.status ?? ''))
            .reduce((sum, step) => sum + (WEIGHTS[step] ?? 0), 0);
        return Math.min(1, Math.round((done / total) * 1000) / 1000);
    }

    /** True when the step is already done (a retried or resumed job skips it). */
    isDone(step: PipelineStep): boolean {
        const records = (this.job['steps'] ?? {}) as Readonly<Record<string, { status?: string }>>;
        return records[step]?.status === 'done' || records[step]?.status === 'skipped';
    }

    /** Takes the lease (§4.4); false when another live execution holds it (this one then exits untouched). */
    async takeLease(): Promise<boolean> {
        const lease = this.job['lease'] as { owner?: string; until?: TimestampLike } | undefined;
        const owner = `${this.execution.id}/0`;
        if (lease?.until !== undefined && lease.owner !== owner && lease.until.seconds * 1000 > Date.now()) {
            return false;
        }
        await this.writeJob({
            status: 'running',
            lease: { owner, until: timestampFromDate(new Date(Date.now() + LEASE_SECONDS * 1000)) },
            startedAt: this.job['startedAt'] ?? now(),
            waitReason: undefined,
            retryAt: undefined,
        });
        await this.log('info', `execution ${this.execution.id} took the job (attempt ${String(Number(this.job['attempt'] ?? 1))})`);
        return true;
    }

    async stepStarted(step: PipelineStep): Promise<void> {
        await this.#recordMachine(step);
        await this.writeJob({ step, progress: this.progress(), [`steps.${step}`]: { status: 'running', startedAt: now() } });
        await this.log('info', `${step} started`, step);
    }

    /** The version records the Cloud Run job each phase runs on, once a phase (finding 56; the pipeline's `_record_machine`). */
    async #recordMachine(step: PipelineStep): Promise<void> {
        const machine = this.job['machine'];
        const phase = (DOWNLOAD_STEPS as readonly string[]).includes(step) ? 'download' : 'process';
        const machines = (this.version['machines'] ?? {}) as Readonly<Record<string, string>>;
        if (typeof machine === 'string' && machines[phase] !== machine) {
            await this.writeVersion({ machines: { ...machines, [phase]: machine } });
        }
    }

    /** True on the small download job once the walk reaches a step past the download (the pipeline's `_hands_over`). */
    handsOver(step: PipelineStep): boolean {
        return this.job['machine'] === 'fetch' && !(DOWNLOAD_STEPS as readonly string[]).includes(step);
    }

    /** The download is done on the small job: the job is queued again for its processing on a larger one (`_hand_over`). */
    async handOver(): Promise<void> {
        await this.writeJob({ status: 'queued', progress: this.progress(), lease: undefined });
        await this.log('info', 'the scene is downloaded; its processing is queued for a larger machine');
    }

    /** A transfer's bytes so far on its step, and the job's progress with the step's share of them (`report_bytes`). */
    async reportBytes(step: PipelineStep, received: number, total: number | undefined): Promise<void> {
        const weights = pipelineStepsOf(this.type).reduce((sum, each) => sum + (WEIGHTS[each] ?? 0), 0);
        const share = total === undefined ? 0 : ((WEIGHTS[step] ?? 0) * received) / total / weights;
        const sizes = total === undefined ? {} : { [`steps.${step}.totalBytes`]: total };
        await this.writeJob({ [`steps.${step}.bytes`]: received, ...sizes, progress: Math.round((this.progress() + share) * 1000) / 1000 });
    }

    /** The step's record: done (or skipped), with what it wrote. */
    async stepEnded(step: PipelineStep, status: 'done' | 'skipped', output: Readonly<Record<string, unknown>> = {}): Promise<void> {
        const started = valueAt(this.job, ['steps', step, 'startedAt']) ?? now();
        await this.writeJob({ [`steps.${step}`]: { status, startedAt: started, finishedAt: now(), ...output } });
        await this.writeJob({ progress: this.progress() });
        await this.log('info', `${step} ${status}`, step);
    }

    /** The job and its version end failed at `step` with an `apiError.*` code (§5.2: exit 1). */
    async fail(step: PipelineStep, code: string, params?: Readonly<Record<string, string>>): Promise<void> {
        const started = valueAt(this.job, ['steps', step, 'startedAt']) ?? now();
        await this.writeJob({
            status: 'failed',
            [`steps.${step}`]: { status: 'failed', startedAt: started, finishedAt: now() },
            error: { code, message: `${step} failed (e2e stand-in)`, ...(params === undefined ? {} : { params }) },
            finishedAt: now(),
            lease: undefined,
        });
        await this.writeVersion({ state: 'failed', error: { code, ...(params === undefined ? {} : { params }) } });
        await this.log('error', `${step} failed: ${code}`, step);
    }

    /** M16: a refine with nothing better ends cancelled with its reason, the version too, and renders nothing (`runner.py` `_decline`). */
    async decline(step: PipelineStep, code: string, params: Readonly<Record<string, string>>): Promise<void> {
        await this.writeJob({
            status: 'cancelled',
            error: { code, message: `${step} declined (e2e stand-in)`, params },
            finishedAt: now(),
            lease: undefined,
        });
        await this.writeVersion({ state: 'cancelled', error: { code, params } });
        await this.log('info', `declined, nothing rendered: ${code}`, step);
    }

    /** USGS answered its maintenance page: the job waits and the tick resumes it (§4.6). */
    async waitForUsgs(): Promise<void> {
        await this.writeJob({
            status: 'waiting_usgs',
            waitReason: 'usgs-maintenance',
            retryAt: minutesFromNow(this.attempt.retryInMinutes ?? 30),
            'steps.fetch': { status: 'pending' },
            lease: undefined,
        });
        await this.log('warn', 'apiError.usgs.maintenance: USGS is under maintenance; tried again later', 'fetch');
    }

    /** Too few pairs, or a scan without georeference: the job waits for the admin's points (§5.3 `georef`). */
    async waitForPoints(params?: Readonly<Record<string, string>>): Promise<void> {
        await this.writeVersion({
            state: 'needs_gcps',
            ...(params === undefined ? {} : { error: { code: 'apiError.imagery.noMatch', params } }),
        });
        await this.writeJob({ status: 'awaiting_gcps', waitReason: 'gcps', 'steps.georef': { status: 'pending' }, lease: undefined });
        await this.log('warn', 'the scan waits for ground control points', 'georef');
    }

    /** Cancelled (the admin's cancel reached the pipeline): the job, its version and its scratch files go (§4.5). */
    async cancel(): Promise<void> {
        await this.writeJob({ status: 'cancelled', finishedAt: now(), lease: undefined, waitReason: undefined });
        await this.writeVersion({ state: 'cancelled' });
        await deleteObjects(`work/${this.city}/${this.jobId}/`);
        await this.log('info', 'cancelled; the scratch files were deleted');
    }

    /** Cloud Run's SIGTERM without a cancellation (a task timeout): the job goes back to the queue, its checkpoint kept. */
    async requeue(step: PipelineStep): Promise<void> {
        await this.writeJob({ status: 'queued', retryAt: minutesFromNow(1), [`steps.${step}`]: { status: 'pending' }, lease: undefined });
        await this.log('warn', 'stopped by SIGTERM; queued again', step);
    }

    /** Rendered: the version waits for approval, the lease is released and the scratch files go (§5.3 `register`). */
    async register(output: Readonly<Record<string, unknown>>): Promise<void> {
        await this.writeVersion({ output, state: 'awaiting_approval', error: undefined });
        await this.writeJob({
            status: 'awaiting_approval',
            waitReason: 'approval',
            lease: undefined,
            step: 'register',
            progress: 1,
            'steps.register': { status: 'done', startedAt: now(), finishedAt: now() },
        });
        await deleteObjects(`work/${this.city}/${this.jobId}/`);
        await this.log('info', 'register done: the version awaits approval', 'register');
    }
}
