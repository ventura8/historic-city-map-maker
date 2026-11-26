// Completes the admin's Hosting folder (packages/admin/dist) after its Vite build: index.html, runtime.json and the legacy
// Bucharest import bundle. The logic and its documentation are in src/admin/cli.ts and src/admin/build.ts; this entry only wires
// Node to them.
import process from 'node:process';

import { createLogger } from '@hcm/shared';

import { runAdminCli } from './src/admin/cli.js';
import { nodeFileSystem } from './src/files.js';

process.exitCode = runAdminCli(process.argv.slice(2), {
    files: nodeFileSystem(process.cwd()),
    log: createLogger('admin-build'),
    env: process.env,
});
