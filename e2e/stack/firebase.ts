/**
 * `firebase` for the e2e and dev-stack emulators, with the Functions emulator's workers capped (`e2e/support/emulator-pool.ts`):
 * firebase-tools' pool is wrapped in this process, then its own CLI runs here with the same arguments. Run with
 * `node --import ./scripts/site/register-ts.mjs e2e/stack/firebase.ts emulators:start …`. `HCM_EMULATOR_MAX_WORKERS` sets the
 * cap (default `DEFAULT_MAX_WORKERS`). The workers the emulator starts are plain `node` processes: nothing here reaches them.
 * `HCM_EMULATOR_LOG` names a file that keeps the functions' own log lines (the JSON lines with a `severity`) the emulator
 * relays on its output, and its own lines about trouble (`KEPT_EMULATOR_LINE`): an e2e failure decided on the server's side is read there (lesson 812); the rest of the output is not kept.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

import { capWorkerPool, maxWorkersOf, type PoolPrototype } from '../support/emulator-pool.js';

const require = createRequire(import.meta.url);
const pool = require('firebase-tools/lib/emulator/functionsRuntimeWorker.js') as { RuntimeWorkerPool: { prototype: PoolPrototype } };
capWorkerPool(pool.RuntimeWorkerPool.prototype, maxWorkersOf(process.env));

/** The emulator's own trouble (a worker that failed to start, a trigger it could not deliver), kept beside the functions' lines. */
const KEPT_EMULATOR_LINE = /\b(?:ERROR|WARN)\b|Failed|Error:|Exception|could not|unable to/;
const logFile = process.env['HCM_EMULATOR_LOG'] ?? '';
if (logFile !== '') {
    mkdirSync(dirname(logFile), { recursive: true });
    const write = process.stdout.write.bind(process.stdout);
    const keep = (chunk: string | Uint8Array): void => {
        const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
        if (text.includes('"severity"') || KEPT_EMULATOR_LINE.test(text)) {
            const line = text.endsWith('\n') ? text : `${text}\n`;
            appendFileSync(logFile, `${new Date().toISOString()} ${line}`);
        }
    };
    process.stdout.write = (chunk: string | Uint8Array, ...rest: never[]): boolean => {
        keep(chunk);
        return write(chunk, ...rest);
    };
}
require('firebase-tools/lib/bin/firebase.js');
