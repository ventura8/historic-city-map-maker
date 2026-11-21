// The local stack for manual testing (docs/SETUP.md → *Local stack for manual testing*): the e2e world without
// Playwright, on the e2e ports, seeded with a Bucharest city. Runs inside the quality image only, started by
// scripts/dev/dev-stack.sh (`npm run dev:stack` on the host) through scripts/dev/in-stack.sh, from the repository root:
//
//     node --import ./scripts/site/register-ts.mjs e2e/stack/main.ts serve   # everything, seeded, until SIGINT or SIGTERM
//     node --import ./scripts/site/register-ts.mjs e2e/stack/main.ts tick    # imagery.tick and ops.tick once, now
//
// `serve` starts the mock APIs (e2e/mock-apis/main.ts mock) and the Firebase emulators of project demo-hcm (their output
// in reports/dev-stack/), waits until both answer, seeds the world (seed.ts; `HCM_STACK_SEED=city|fresh`), opens the
// stack's admin and site servers last (servers.ts: a browser opened as soon as a port answers finds the world ready),
// then plays Cloud Scheduler (imagery.tick and ops.tick every 15 minutes; `HCM_STACK_TICKS=0` turns it off). Exit
// status 1 when a part fails to start, 2 on a usage error.
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { connect } from 'node:net';
import process from 'node:process';

import { createLogger } from '@hcm/shared';

import { ADMIN_EMULATORS, ADMIN_URL, E2E_PROJECT_ID, EMULATOR_ENV, emulatorOrigin, PERSONAS } from '../admin/world.js';
import { E2E_CITY_ID, MOCK_API_ORIGIN, SITE_ORIGIN } from '../fixtures/world.js';
import { STACK_SECOND_CITY } from './seed-cities.js';
import { seedStack, type SeedProfile } from './seed.js';
import { startStackAdmin, startStackSite } from './servers.js';

const log = createLogger('dev-stack');

const LOG_DIR = 'reports/dev-stack';
const START_TIMEOUT_MS = 300_000;
const POLL_MS = 1000;
const MINUTE = 60_000;
/** Cloud Scheduler's cadence of the two scheduled functions (functions/src/imagery/tick.ts, functions/src/ops/tick.ts). */
const TICKS = { imagery: 15 * MINUTE, ops: 15 * MINUTE } as const;
type Tick = keyof typeof TICKS;

function pause(ms: number): Promise<void> {
    return new Promise((done) => {
        setTimeout(done, ms);
    });
}

/** The loopback ports the stack listens on: the e2e servers' and every emulator's of `firebase.json`. */
function stackPorts(): number[] {
    const emulators = (JSON.parse(readFileSync('firebase.json', 'utf8')) as { emulators: Record<string, unknown> }).emulators;
    const ports = Object.values(emulators).flatMap((entry) => {
        const record = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
        return [record['port'], record['websocketPort']].filter((port): port is number => typeof port === 'number');
    });
    return [4310, 4311, 4312, ...ports];
}

/** True when something already answers on 127.0.0.1:`port`. */
function busy(port: number): Promise<boolean> {
    return new Promise((answer) => {
        const socket = connect({ host: '127.0.0.1', port });
        socket.once('connect', () => {
            socket.destroy();
            answer(true);
        });
        socket.once('error', () => {
            answer(false);
        });
    });
}

/** Waits until `url` answers a status `accepted` takes, or throws after `START_TIMEOUT_MS`. */
async function answering(what: string, url: string, accepted: (status: number) => boolean): Promise<void> {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const status = await fetch(url).then(
            (response) => response.status,
            () => 0,
        );
        if (accepted(status)) {
            return;
        }
        await pause(POLL_MS);
    }
    throw new Error(`${what} did not answer within ${String(START_TIMEOUT_MS / 1000)} s (${url})`);
}

/** Starts a child whose output goes to `reports/dev-stack/<name>.log`. */
function child(name: string, command: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env): ChildProcess {
    const output = createWriteStream(`${LOG_DIR}/${name}.log`);
    const started = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    started.stdout.pipe(output);
    started.stderr.pipe(output);
    return started;
}

/** Runs a scheduled function once, as Cloud Scheduler would (its trigger route: the emulator cannot fire it itself). */
async function tick(name: Tick): Promise<void> {
    const url = `${emulatorOrigin('functions')}/functions/projects/${E2E_PROJECT_ID}/triggers/us-central1-${name}-tick-0`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/cloudevents+json; charset=UTF-8' },
        body: JSON.stringify({
            specversion: '1.0',
            id: `dev-stack-${name}-${String(Date.now())}`,
            source: 'dev-stack',
            type: 'google.cloud.scheduler.job.v1.executed',
            data: {},
        }),
    });
    if (response.ok) {
        log.info(`${name}.tick ran`);
    } else {
        log.warn(`${name}.tick failed`, { status: response.status, body: (await response.text()).slice(0, 300) });
    }
}

function profileOf(value: string | undefined): SeedProfile {
    return value === 'fresh' ? 'fresh' : 'city';
}

function banner(profile: SeedProfile, ticks: boolean): void {
    const emulators = (['auth', 'firestore', 'storage', 'functions'] as const)
        .map((name) => [name, emulatorOrigin(name)].join(' '))
        .join(', ');
    const lines = [
        `Local stack ready (seed: ${profile}). Open the addresses with 127.0.0.1, never localhost.`,
        `  Admin      ${ADMIN_URL}   (Sign in with Google: the stand-in opens over the page, ${PERSONAS.owner.email} preselected, Allow)`,
        `  Viewer     ${SITE_ORIGIN}/${E2E_CITY_ID}/   (the manifest the emulators published; the e2e fixture one before the first build)`,
        profile === 'city'
            ? `  Cities     ${E2E_CITY_ID} (public), ${STACK_SECOND_CITY} (not public yet: Settings → Publishing; its page ` +
              `${SITE_ORIGIN}/${STACK_SECOND_CITY}/); any city's page: ${SITE_ORIGIN}/<city>/`
            : `  Cities     none yet: Setup makes ${E2E_CITY_ID}; any city's page: ${SITE_ORIGIN}/<city>/`,
        `  Mock APIs  ${MOCK_API_ORIGIN}   (fake Google, Mapbox, USGS; GET /__upstream/scenarios, /__calls)`,
        `  Emulators  ${emulators}`,
        `  Accounts   ${PERSONAS.owner.email} (owner), ${PERSONAS.admin.email} (admin), ${PERSONAS.editor.email} (invited),` +
            ` ${PERSONAS.stranger.email} (nobody)`,
        `  Logs       ${LOG_DIR}/emulators.log, ${LOG_DIR}/mock-apis.log`,
        ticks ? '  Clock      imagery.tick and ops.tick every 15 min; now: bash scripts/dev/dev-stack.sh tick' : '  Clock      off',
        '  Stop       Ctrl+C here, or bash scripts/dev/dev-stack.sh stop',
    ];
    for (const line of lines) {
        log.info(line);
    }
}

interface Running {
    readonly children: ChildProcess[];
    readonly servers: Server[];
    readonly timers: NodeJS.Timeout[];
}

/** Stops the clock, the servers, the emulators (SIGINT: their own clean shutdown) and the mock APIs. */
async function shutDown(running: Running): Promise<void> {
    running.timers.forEach(clearInterval);
    await Promise.all(running.servers.map((server) => new Promise((done) => server.close(done))));
    const exited = running.children.map(
        (started) =>
            new Promise<void>((done) => {
                if (started.exitCode === null) {
                    started.once('exit', () => {
                        done();
                    });
                } else {
                    done();
                }
            }),
    );
    running.children.forEach((started) => started.kill('SIGINT'));
    await Promise.race([Promise.all(exited), pause(30_000)]);
    running.children.forEach((started) => started.kill('SIGKILL'));
}

/** Resolves on SIGINT or SIGTERM, or rejects when a child exits on its own. */
function stopped(children: readonly ChildProcess[]): Promise<string> {
    return new Promise((done, failed) => {
        process.once('SIGINT', () => {
            done('SIGINT');
        });
        process.once('SIGTERM', () => {
            done('SIGTERM');
        });
        for (const started of children) {
            started.once('exit', (code) => {
                failed(new Error(`${started.spawnfile} exited (${String(code)}): see ${LOG_DIR}/`));
            });
        }
    });
}

/** The mock APIs and the emulators answer (a loaded callable answers a GET with 400; before that the emulator says 404). */
async function started(): Promise<void> {
    const session = `${emulatorOrigin('functions')}/${E2E_PROJECT_ID}/us-central1/admin-session`;
    await Promise.all([
        answering('the mock APIs', `${MOCK_API_ORIGIN}/__health`, (status) => status === 200),
        answering('the functions', session, (status) => status === 400),
    ]);
}

async function serve(): Promise<void> {
    const taken = (await Promise.all(stackPorts().map(async (port) => ((await busy(port)) ? port : null)))).filter((port) => port !== null);
    if (taken.length > 0) {
        throw new Error(`ports in use: ${taken.join(', ')} (another stack? bash scripts/dev/dev-stack.sh stop)`);
    }
    const profile = profileOf(process.env['HCM_STACK_SEED']);
    const ticks = process.env['HCM_STACK_TICKS'] !== '0';
    mkdirSync(LOG_DIR, { recursive: true });
    const running: Running = { children: [], servers: [], timers: [] };
    running.children.push(
        child('mock-apis', process.execPath, ['--import', './scripts/site/register-ts.mjs', 'e2e/mock-apis/main.ts', 'mock']),
    );
    const only = ['--project', E2E_PROJECT_ID, '--only', ADMIN_EMULATORS.join(',')];
    // firebase-tools' CLI with the Functions workers capped (e2e/support/emulator-pool.ts), as the e2e tier runs it.
    const FIREBASE = ['--import', './scripts/site/register-ts.mjs', 'e2e/stack/firebase.ts'];
    running.children.push(
        child('emulators', process.execPath, [...FIREBASE, 'emulators:start', ...only], { ...process.env, ...EMULATOR_ENV }),
    );
    const stop = stopped(running.children);
    try {
        log.info('waiting for the mock APIs and the emulators (a minute or two)', { seed: profile });
        const first = await Promise.race([started().then(() => 'started'), stop]);
        const seed = first === 'started' ? await Promise.race([seedStack(profile), stop.then(() => undefined)]) : undefined;
        if (seed !== undefined) {
            void seed.settled.then(() => seed.close());
            // The servers open last: a browser opened as soon as a port answers (the Claude preview) finds the world ready.
            running.servers.push(await startStackAdmin({ startUp: profile === 'fresh' }), await startStackSite());
            if (ticks) {
                running.timers.push(
                    setInterval(() => void tick('imagery'), TICKS.imagery),
                    setInterval(() => void tick('ops'), TICKS.ops),
                );
            }
            banner(profile, ticks);
            log.info('stopping', { signal: await stop });
        }
    } finally {
        await shutDown(running);
        log.info('stopped: the emulators, the mock APIs and the servers are down');
    }
}

const command = process.argv[2] ?? 'serve';
if (command === 'serve') {
    await serve().catch((error: unknown) => {
        log.error(String(error instanceof Error ? error.message : error));
        process.exitCode = 1;
    });
} else if (command === 'tick') {
    await tick('imagery');
    await tick('ops');
} else {
    log.error('usage: main.ts serve|tick', { command });
    process.exitCode = 2;
}
