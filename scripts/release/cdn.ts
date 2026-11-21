// Writes or checks the released engine in cdn/engine/ (npm run release:cdn [-- --check]).
// The logic and its documentation are in src/cli.ts; this entry only wires Node to it.
import process from 'node:process';

import { createLogger } from '@hcm/shared';

import { runCdn } from './src/cli.js';
import { nodeReleaseFiles } from './src/files.js';

process.exitCode = runCdn(process.argv.slice(2), { files: nodeReleaseFiles(process.cwd()), log: createLogger('release-cdn') });
