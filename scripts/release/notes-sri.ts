// Writes the pinned addresses and their integrity into a release's GitHub description (npm run release:notes).
// The logic and its documentation are in src/cli.ts; this entry only wires Node to it.
import process from 'node:process';

import { createLogger } from '@hcm/shared';

import { runNotes } from './src/cli.js';
import { nodeReleaseFiles } from './src/files.js';

process.exitCode = runNotes(process.argv.slice(2), { files: nodeReleaseFiles(process.cwd()), log: createLogger('release-notes') });
