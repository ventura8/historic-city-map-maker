// Pins the starter kit's page to the engine release in cdn/engine/release.json (npm run release:pin-kit).
// The logic and its documentation are in src/cli.ts and src/pin-kit.ts; this entry only wires Node to it.
import process from 'node:process';

import { createLogger } from '@hcm/shared';

import { runPinKit } from './src/cli.js';
import { nodeReleaseFiles } from './src/files.js';

process.exitCode = runPinKit(process.argv.slice(2), { files: nodeReleaseFiles(process.cwd()), log: createLogger('release-pin-kit') });
