// Writes the in-app installer's bundle (docs/research/M6-interfaces.md §1.3) into the Hosting tree after build:hosting and
// the functions' build. The logic and its documentation are in src/install/cli.ts and src/install/bundle.ts; this entry
// only wires Node to them.
import process from 'node:process';

import { createLogger } from '@hcm/shared';

import { nodeFileSystem } from './src/files.js';
import { runInstallCli } from './src/install/cli.js';
import { bundleSteps } from './src/install/steps-bundle.js';

process.exitCode = await runInstallCli(process.argv.slice(2), {
    files: nodeFileSystem(process.cwd()),
    log: createLogger('install-build'),
    env: process.env,
    steps: () => bundleSteps(process.cwd()),
});
