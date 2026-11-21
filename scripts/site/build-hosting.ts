// Builds the Firebase Hosting tree of the project's site (`npm run build:hosting`, Hosting's `predeploy`): the public map
// at the root, the other cities at their paths, the generic city page and the admin under /admin/ (docs/research/
// M6-interfaces.md §2). The logic and its documentation are in src/hosting/cli.ts and src/hosting/tree.ts; this entry
// only wires Node to them.
import process from 'node:process';

import { createLogger } from '@hcm/shared';

import { nodeFileSystem } from './src/files.js';
import { runHostingCli } from './src/hosting/cli.js';

process.exitCode = runHostingCli(process.argv.slice(2), {
    env: process.env,
    files: nodeFileSystem(process.cwd()),
    log: createLogger('hosting-build'),
});
