import { spawn, type ChildProcess } from 'node:child_process';

import { createLogger } from '@hcm/shared';

import { ADMIN_ORIGIN, E2E_PROJECT_ID, emulatorOrigin } from '../world.js';
import { PIPELINE_PYTHON, pipelineBaseEnv, REPO_ROOT } from './imagery-runner.js';

/**
 * The real local worker of M7 in the admin's world (docs/research/M7-local-worker.md §1, §2): `python -m hcm_pipeline
 * worker --emulators` of the quality image's pipeline venv, on a port the system chooses, talking to the Auth and
 * Functions emulators (its five `worker.*` callables, the signed URLs to the Storage emulator, the server's USGS calls to
 * the mock APIs), reading the web configuration from the e2e admin server's `/__/firebase/init.json`, and the references
 * from the mock APIs. Its work folder is the test's (the named volume `hcm-worker` of the admin's command). Finding 67 of
 * 2026-11-02: started with the admin command's pairing code (`--pair`), it signs itself in through `worker.pair`. Finding
 * 72: started without one on the worker's own port (as the starter file's supervisor starts it), the admin's page pairs it
 * by itself (`POST /pair` from the admin's origin, which the worker's `HCM_HOSTING_HOST` names).
 */

const log = createLogger('e2e-imagery-worker');

/** The worker's log line that names its page (`worker.py`: "open http://localhost:<port>/ to see what it does"). */
const PAGE_LINE = /open http:\/\/localhost:(\d+)\//;
/** How long the worker may take to serve its page, and to stop after Ctrl-C. */
const START_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 30_000;

/** The worker's environment: the pipeline's, and the three loopback hosts of `--emulators` (`worker/args.py`). */
function workerEnv(): NodeJS.ProcessEnv {
    return {
        ...pipelineBaseEnv(),
        FIREBASE_AUTH_EMULATOR_HOST: new URL(emulatorOrigin('auth')).host,
        FUNCTIONS_EMULATOR_HOST: new URL(emulatorOrigin('functions')).host,
        HCM_HOSTING_HOST: new URL(ADMIN_ORIGIN).host,
    };
}

export class LocalWorker {
    readonly #child: ChildProcess;
    readonly #output: string[] = [];
    readonly #port: Promise<number>;
    readonly #exited: Promise<string>;

    private constructor(child: ChildProcess) {
        this.#child = child;
        this.#exited = new Promise((done) => {
            child.on('exit', (code, signal) => {
                done(code === null ? `signal ${String(signal)}` : `exit ${String(code)}`);
            });
        });
        this.#port = new Promise((found, failed) => {
            const timer = setTimeout(() => {
                failed(new Error(`the worker served no page within ${String(START_TIMEOUT_MS)} ms: ${this.output()}`));
            }, START_TIMEOUT_MS);
            const read = (chunk: Buffer): void => {
                const text = chunk.toString('utf8');
                this.#output.push(text);
                log.info('worker output', { text: text.slice(0, 2000) });
                const port = PAGE_LINE.exec(this.output())?.[1];
                if (port !== undefined) {
                    clearTimeout(timer);
                    found(Number(port));
                }
            };
            child.stdout?.on('data', read);
            child.stderr?.on('data', read);
            void this.#exited.then((how) => {
                clearTimeout(timer);
                failed(new Error(`the worker ended (${how}) before serving its page: ${this.output()}`));
            });
        });
    }

    /**
     * Starts the worker for `city` with its work folder at `work`, with the admin command's pairing code if given, on `port`
     * (0: one the system chooses; `WORKER_PORT`, where the admin's auto-pair looks: one such worker at a time, the admin
     * tier's lock).
     */
    static start(city: string, work: string, pair?: string, port = 0): LocalWorker {
        const args = [
            '-m',
            'hcm_pipeline',
            'worker',
            '--city',
            city,
            '--project',
            E2E_PROJECT_ID,
            '--port',
            String(port),
            '--work',
            work,
            '--emulators',
            ...(pair === undefined ? [] : ['--pair', pair]),
        ];
        const child = spawn(PIPELINE_PYTHON, args, { cwd: REPO_ROOT, env: workerEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
        return new LocalWorker(child);
    }

    /** The page's origin, as its own link names it but on the loopback address (`http://127.0.0.1:<port>`). */
    async origin(): Promise<string> {
        return `http://127.0.0.1:${String(await this.#port)}`;
    }

    /** Everything the worker logged so far. */
    output(): string {
        return this.#output.join('');
    }

    /**
     * One Ctrl-C in the worker's terminal (SIGINT), the way the admin guide stops it: the worker stops and exits; how it
     * ended (`exit 0` when it stopped cleanly; a worker still running after `STOP_TIMEOUT_MS` is killed and says so).
     */
    async stop(): Promise<string> {
        if (this.#child.exitCode === null && this.#child.signalCode === null) {
            this.#child.kill('SIGINT');
        }
        const late = new Promise<'late'>((done) => {
            setTimeout(() => {
                done('late');
            }, STOP_TIMEOUT_MS);
        });
        const ended = await Promise.race([this.#exited, late]);
        if (ended === 'late') {
            this.#child.kill('SIGKILL');
            return `still running ${String(STOP_TIMEOUT_MS)} ms after Ctrl-C: killed`;
        }
        return ended;
    }
}
