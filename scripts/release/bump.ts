// Rewrites every version of the repository to one release (npm run release:bump -- X.Y.Z).
// The logic and its documentation are in src/cli.ts; this entry only wires Node to it.
import process from 'node:process';

import { createLogger } from '@hcm/shared';

import { runBump } from './src/cli.js';
import { nodeReleaseFiles } from './src/files.js';

process.exitCode = runBump(process.argv.slice(2), { files: nodeReleaseFiles(process.cwd()), log: createLogger('release-bump') });
