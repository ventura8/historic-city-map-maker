// Builds the project's landing page for GitHub Pages (`npm run build:landing`, docs/research/DECISIONS-for-review.md §162).
// The logic and its documentation are in src/landing/build.ts; this entry only wires Node to it.
import process from 'node:process';

import { createLogger } from '@hcm/shared';

import { nodeFileSystem } from './src/files.js';
import { runLandingCli } from './src/landing/build.js';

process.exitCode = runLandingCli(process.argv.slice(2), { files: nodeFileSystem(process.cwd()), log: createLogger('landing-build') });
