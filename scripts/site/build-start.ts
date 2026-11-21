// Builds the start site (`npm run build:start`, docs/research/M14-start-your-map.md §5, §6). The logic and its documentation are
// in src/start/build.ts; this entry only wires Node to it.
import process from 'node:process';

import { createLogger } from '@hcm/shared';

import { nodeFileSystem } from './src/files.js';
import { bundleSteps } from './src/install/steps-bundle.js';
import { runStartCli } from './src/start/build.js';

process.exitCode = await runStartCli(process.argv.slice(2), {
    files: nodeFileSystem(process.cwd()),
    log: createLogger('start-build'),
    env: process.env,
    steps: () => bundleSteps(process.cwd()),
});
