import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createLogger, type JobType } from '@hcm/shared';
import type { CloudRunRunner, PipelineExecution, UpstreamFakes } from '@hcm/test-support/fakes';

import { MOCK_API_ORIGIN } from '../../fixtures/world.js';
import { ADMIN_WEB_CONFIG, E2E_PROJECT_ID, emulatorOrigin } from '../world.js';
import { failWithoutVersion, Run, pipelineStepsOf, type StandinAttempt } from './imagery-run.js';
import { DocumentGone, readDocument } from './imagery-store.js';
import { playStep } from './imagery-standin.js';

/**
 * The runner of the raster pipeline's Cloud Run executions in the e2e world (docs/research/M3-interfaces.md §4.3, §13):
 * the fake Cloud Run hands it every run the dispatcher asks for, and it plays the run against the Firestore and Storage
 * emulators. Each spec scripts its city (`ImageryWorld.script`): the runner, `standin` (imagery-run.ts and
 * imagery-standin.ts: the documents and files the pipeline writes, from a script; the admin tier) or `python` (the real
 * pipeline, `python -m hcm_pipeline run` against the emulators and the mock APIs; the pipeline tier), and per attempt
 * the outcome, where to hold, fail or be killed. Lives in the mock APIs' process; its control endpoints are
 * e2e/mock-apis/imagery.ts.
 */

type RunnerKind = 'standin' | 'python';

export interface ImageryScript {
    /** `standin` by default. */
    readonly runner?: RunnerKind;
    /** One per dispatch (the job's `attempt`, 1 first); the last one repeats. */
    readonly attempts: readonly StandinAttempt[];
    /** M8: the attempts of a `layer-join` job, in place of `attempts` (one script plays a join and its frames). */
    readonly join?: readonly StandinAttempt[];
    /** M8: the attempts of one frame's import, by its entity id, in place of `attempts`. */
    readonly entities?: Readonly<Record<string, readonly StandinAttempt[]>>;
    /** M16: the attempts of a `regeoref` job (a recalibration, new points), in place of `attempts`. */
    readonly regeoref?: readonly StandinAttempt[];
}

/** One run as the runner played it (`GET /__imagery/runs?city=`). */
export interface RunRecord {
    readonly city: string;
    readonly jobId: string;
    readonly execution: string;
    readonly attempt: number;
    readonly outcome: string;
    state: 'running' | 'ended' | 'failed';
    error?: string;
}

const log = createLogger('e2e-imagery-runner');

/** What a job type does without a script: an import georeferences under the threshold, an upload carries its own. */
const DEFAULT_OUTCOMES: Readonly<Record<JobType, StandinAttempt['outcome']>> = {
    'usgs-import': 'under',
    'geotiff-import': 'embedded',
    regeoref: 'under',
    republish: 'under',
    'layer-delete': 'under',
    'layer-join': 'under',
    'archive-series': 'under',
    'layer-tiles': 'under',
};

/** How long a run waits for the dispatcher to record its execution (a container starts in about that time). */
const DISPATCH_WAIT_MS = 15_000;
const POLL_MS = 100;

function pause(ms: number): Promise<void> {
    return new Promise((done) => {
        setTimeout(done, ms);
    });
}

/** Waits until the job names this execution (the dispatcher writes it after `jobs:run` answered), or gives up. */
async function dispatched(city: string, jobId: string, execution: PipelineExecution): Promise<void> {
    for (let waited = 0; waited < DISPATCH_WAIT_MS; waited += POLL_MS) {
        const job = await readDocument(`cities/${city}/jobs/${jobId}`);
        if (job === undefined || job['executionName'] === execution.name || job['status'] !== 'starting') {
            return;
        }
        await pause(POLL_MS);
    }
}

/** What the script says of this job: a join's or a frame's own attempts, else the city's. */
function scriptedAttempts(script: ImageryScript | undefined, job: Readonly<Record<string, unknown>>): readonly StandinAttempt[] {
    const entityId = (job['params'] as { entityId?: string } | undefined)?.entityId ?? '';
    const own = job['type'] === 'layer-join' ? script?.join : script?.entities?.[entityId];
    const regeoref = job['type'] === 'regeoref' ? script?.regeoref : undefined;
    return regeoref ?? own ?? script?.attempts ?? [];
}

export class ImageryRunner implements CloudRunRunner {
    readonly #scripts = new Map<string, ImageryScript>();
    /** The held runs of each city: their execution and what lets them go on. */
    readonly #holds = new Map<string, Map<PipelineExecution, () => void>>();
    readonly #runs: RunRecord[] = [];

    /** Scripts the runs of `city`'s jobs (replacing an earlier script). */
    script(city: string, script: ImageryScript): void {
        this.#scripts.set(city, script);
    }

    /** Lets every run of `city` held at its `holdAt` step go on. */
    release(city: string): number {
        const held = [...(this.#holds.get(city)?.values() ?? [])];
        this.#holds.delete(city);
        held.forEach((go) => {
            go();
        });
        return held.length;
    }

    /** The runs of `city`, oldest first. */
    runs(city: string): readonly RunRecord[] {
        return this.#runs.filter((record) => record.city === city);
    }

    /**
     * Forgets `city`'s script, runs and held runs (every city's for null). A run an earlier test left held is never
     * released into the next test's world: its execution ends cancelled where it stands.
     */
    reset(city: string | null): void {
        const named = (name: string): boolean => city === null || name === city;
        [...this.#scripts.keys()].filter(named).forEach((name) => this.#scripts.delete(name));
        [...this.#holds.entries()]
            .filter(([name]) => named(name))
            .forEach(([name, held]) => {
                this.#holds.delete(name);
                held.forEach((_go, execution) => {
                    execution.finish('cancelled');
                });
            });
        const kept = this.#runs.filter((record) => !named(record.city));
        this.#runs.splice(0, this.#runs.length, ...kept);
    }

    start(execution: PipelineExecution): void {
        const city = execution.env['CITY_ID'] ?? '';
        const jobId = execution.env['JOB_ID'] ?? '';
        const script = this.#scripts.get(city);
        const play = script?.runner === 'python' ? playPython(execution) : this.#playStandin(city, jobId, execution, script);
        play.catch((error: unknown) => {
            if (error instanceof DocumentGone) {
                // A run of a test that ended: the next test's reset deleted its job, so it stops where it stands.
                log.info('the e2e run stopped: its job is gone', { city, jobId });
                execution.finish('cancelled');
                return;
            }
            log.error('the e2e runner failed', { city, jobId, error: String(error) });
            execution.finish('failed');
        });
    }

    #attemptOf(script: ImageryScript | undefined, job: Readonly<Record<string, unknown>>): StandinAttempt {
        const attempt = Number(job['attempt'] ?? 1);
        const attempts = scriptedAttempts(script, job);
        return attempts[Math.min(attempt, attempts.length) - 1] ?? { outcome: DEFAULT_OUTCOMES[job['type'] as JobType] };
    }

    /** Resolves when `city`'s runs are released or this execution is cancelled (a cancelled run is held no more). */
    #hold(city: string, execution: PipelineExecution): Promise<void> {
        return new Promise((go) => {
            const held = this.#holds.get(city) ?? new Map<PipelineExecution, () => void>();
            held.set(execution, go);
            this.#holds.set(city, held);
            execution.onCancel(() => {
                held.delete(execution);
                go();
            });
        });
    }

    async #playStandin(city: string, jobId: string, execution: PipelineExecution, script: ImageryScript | undefined): Promise<void> {
        await dispatched(city, jobId, execution);
        const run = await Run.load(city, jobId, execution, (job) => this.#attemptOf(script, job));
        if (run === undefined) {
            await failWithoutVersion(city, jobId);
            execution.finish('failed');
            return;
        }
        const record: RunRecord = {
            city,
            jobId,
            execution: execution.name,
            attempt: Number(run.job['attempt'] ?? 1),
            outcome: run.attempt.outcome,
            state: 'running',
        };
        this.#runs.push(record);
        try {
            await this.#steps(run);
            record.state = 'ended';
        } catch (error) {
            record.state = 'failed';
            record.error = String(error);
            execution.finish(error instanceof DocumentGone ? 'cancelled' : 'failed');
            throw error;
        } finally {
            execution.finish('succeeded');
        }
    }

    async #steps(run: Run): Promise<void> {
        if (!(await run.takeLease())) {
            return;
        }
        for (const step of pipelineStepsOf(run.type)) {
            if (run.isDone(step)) {
                continue;
            }
            if (run.handsOver(step)) {
                await run.handOver();
                return;
            }
            if (run.attempt.holdAt === step) {
                await this.#hold(run.city, run.execution);
            }
            if ((await stopped(run, step)) || (await playStep(run, step)) === 'stop') {
                return;
            }
        }
    }
}

/** A cancellation reached the run (SIGTERM, or `cancelRequested` read at a checkpoint): it ends there (§4.5). */
async function stopped(run: Run, step: Parameters<typeof playStep>[1]): Promise<boolean> {
    const job = await run.refresh();
    if (job['cancelRequested'] === true) {
        await run.cancel();
        run.execution.finish(run.execution.cancelRequested ? 'cancelled' : 'succeeded');
        return true;
    }
    if (run.execution.cancelRequested) {
        await run.requeue(step);
        run.execution.finish('cancelled');
        return true;
    }
    return false;
}

/** The real pipeline's interpreter in the quality image (docs/research/M0-handoff.md). */
export const PIPELINE_PYTHON = '/opt/hcm/pipeline-venv/bin/python';
export const REPO_ROOT = resolve(import.meta.dirname, '../../..');

/** An upstream of the mock APIs, as the pipeline reaches it (`/h/<host><path>`). */
function upstream(host: string, path: string): string {
    return `${MOCK_API_ORIGIN}/h/${host}${path}`;
}

/**
 * What every real pipeline process of the e2e world gets, a Cloud Run run (`run`) as the local worker (`worker`, M7): the
 * interpreter's path and home, the package's source, the references' roots on the mock APIs, one GDAL thread.
 */
export function pipelineBaseEnv(): NodeJS.ProcessEnv {
    return {
        PATH: process.env['PATH'],
        HOME: process.env['HOME'],
        PYTHONPATH: resolve(REPO_ROOT, 'pipeline/src'),
        HCM_STAC_URL: upstream('earth-search.aws.element84.com', '/v1'),
        HCM_OVERPASS_URL: upstream('overpass-api.de', '/api/interpreter'),
        GDAL_NUM_THREADS: '1',
    };
}

/** The environment of a real pipeline run against the emulators and the mock APIs' upstreams (§5.7). */
function pythonEnv(execution: PipelineExecution): NodeJS.ProcessEnv {
    return {
        ...pipelineBaseEnv(),
        JOB_ID: execution.env['JOB_ID'],
        CITY_ID: execution.env['CITY_ID'],
        GOOGLE_CLOUD_PROJECT: E2E_PROJECT_ID,
        HCM_PRIVATE_BUCKET: ADMIN_WEB_CONFIG.storageBucket,
        HCM_PUBLIC_BUCKET: `${E2E_PROJECT_ID}-public`,
        USGS_M2M_BASE_URL: upstream('m2m.cr.usgs.gov', '/api/api/json/stable/'),
        FIRESTORE_EMULATOR_HOST: new URL(emulatorOrigin('firestore')).host,
        STORAGE_EMULATOR_HOST: new URL(emulatorOrigin('storage')).host,
        HCM_E2E_USGS_TOKEN: 'e2e-ok',
        CLOUD_RUN_EXECUTION: execution.id,
        CLOUD_RUN_TASK_ATTEMPT: '0',
    };
}

/** Runs the real pipeline for the execution; Cloud Run's cancel is its SIGTERM, exit 137 an out-of-memory kill. */
function playPython(execution: PipelineExecution): Promise<void> {
    return new Promise((done, failed) => {
        const child = spawn(PIPELINE_PYTHON, ['-m', 'hcm_pipeline', ...execution.args], {
            cwd: REPO_ROOT,
            env: pythonEnv(execution),
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const relay = (chunk: Buffer): void => {
            log.info('pipeline output', { execution: execution.id, text: chunk.toString('utf8').slice(0, 2000) });
        };
        child.stdout.on('data', relay);
        child.stderr.on('data', relay);
        execution.onCancel(() => child.kill('SIGTERM'));
        child.on('error', failed);
        child.on('exit', (code) => {
            const ended = execution.cancelRequested ? 'cancelled' : 'succeeded';
            execution.finish(code === 0 ? ended : 'failed', code === 137 ? 'oom' : undefined);
            done();
        });
    });
}

/**
 * Where the synthetic scene of `pipeline/tests/synthetic/scenes.py --out <dir> --seed <n>` lands for the pipeline tier
 * (generated before a pipeline-tier run, git-ignored, never committed): `<entity>.tgz` (the 1966
 * frame's delivery), `sentinel2.tif` (the Sentinel-2-like COG), `overpass.json` (the world's lines as Overpass answers
 * them) and `truth.json` (the transform and the RMSE the e2e asserts). Absent: the fakes answer their fixtures.
 */
const SYNTHETIC_SCENES_DIR = resolve(REPO_ROOT, 'reports/e2e-fixtures/imagery');
const DELIVERY = /^(?<entity>.+)\.tgz$/;

/** Every delivery in `dir`, by the entity its name says. */
function registerDeliveries(fakes: UpstreamFakes, dir: string): void {
    for (const name of readdirSync(dir)) {
        const entity = DELIVERY.exec(name)?.groups?.['entity'];
        if (entity !== undefined) {
            fakes.state.usgs.deliveries.set(entity, async () => new Uint8Array(await readFile(resolve(dir, name))));
        }
    }
}

/**
 * The folders a generated scene's deliveries lie in: `dir`, and (M8, `scenes.py --join`) each entity's folder below it. The
 * first folder holding a reference answers for the world, which a join's frames share.
 */
function sceneFolders(dir: string): string[] {
    const below = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    return [dir, ...below.map((entry) => resolve(dir, entry.name))];
}

/** Points the server's fakes at the synthetic scene, when it was generated (the pipeline tier). */
export function useSyntheticScenes(fakes: UpstreamFakes, dir: string = SYNTHETIC_SCENES_DIR): void {
    if (!existsSync(dir)) {
        return;
    }
    const folders = sceneFolders(dir);
    folders.forEach((folder) => {
        registerDeliveries(fakes, folder);
    });
    const file = (name: string): string => resolve(folders.find((folder) => existsSync(resolve(folder, name))) ?? dir, name);
    if (existsSync(file('sentinel2.tif'))) {
        fakes.state.stac.cog = async () => new Uint8Array(await readFile(file('sentinel2.tif')));
    }
    if (existsSync(file('overpass.json'))) {
        fakes.state.overpass.answer = async () => JSON.parse(await readFile(file('overpass.json'), 'utf8')) as unknown;
    }
}
