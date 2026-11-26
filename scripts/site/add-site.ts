// Writes a new city's public site into sites/<id>/ (`npm run site:add -- --city <id> --name-ro <name> --theme <#rrggbb>`).
// The logic and its documentation are in src/add-site.ts; this entry only wires Node to it.
import process from 'node:process';

import { createLogger } from '@hcm/shared';

import { runAddSite } from './src/add-site.js';
import { nodeFileSystem } from './src/files.js';

process.exitCode = runAddSite(process.argv.slice(2), { files: nodeFileSystem(process.cwd()), log: createLogger('site-add') });
