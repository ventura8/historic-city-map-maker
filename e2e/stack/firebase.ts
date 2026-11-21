/**
 * `firebase` for the e2e and dev-stack emulators, with the Functions emulator's workers capped (`e2e/support/emulator-pool.ts`):
 * firebase-tools' pool is wrapped in this process, then its own CLI runs here with the same arguments. Run with
 * `node --import ./scripts/site/register-ts.mjs e2e/stack/firebase.ts emulators:start …`. `HCM_EMULATOR_MAX_WORKERS` sets the
 * cap (default `DEFAULT_MAX_WORKERS`). The workers the emulator starts are plain `node` processes: nothing here reaches them.
 */
import { createRequire } from 'node:module';

import { capWorkerPool, maxWorkersOf, type PoolPrototype } from '../support/emulator-pool.js';

const require = createRequire(import.meta.url);
const pool = require('firebase-tools/lib/emulator/functionsRuntimeWorker.js') as { RuntimeWorkerPool: { prototype: PoolPrototype } };
capWorkerPool(pool.RuntimeWorkerPool.prototype, maxWorkersOf(process.env));
require('firebase-tools/lib/bin/firebase.js');
