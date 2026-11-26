// Builds the static city sites into dist/site/ and their GitHub Pages tree into dist/pages/ (`npm run build:site`, the
// `site-build` gate of the build stage).
// The logic and its documentation are in src/cli.ts and src/build.ts; this entry only wires Node to them.
import process from 'node:process';

import { createLogger } from '@hcm/shared';

import { runCli } from './src/cli.js';
import { nodeFileSystem } from './src/files.js';

process.exitCode = runCli(process.argv.slice(2), {
    env: process.env,
    files: nodeFileSystem(process.cwd()),
    log: createLogger('site-build'),
});
