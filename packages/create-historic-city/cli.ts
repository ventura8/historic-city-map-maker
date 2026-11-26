// The bin of create-historic-city (`dist/cli.mjs` once built, `#!/usr/bin/env node`): wires Node to the CLI's commands
// (src/main.ts) and its real ports (src/node-ports.ts). The template and the self-host bundle sit next to the built file.
import { dirname } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runCli } from './src/main.js';
import { nodePorts } from './src/node-ports.js';

const { ports, terminal } = nodePorts(process, dirname(fileURLToPath(import.meta.url)));
process.exitCode = await runCli(process.argv.slice(2), ports);
terminal.close();
