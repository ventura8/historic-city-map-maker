// Refreshes functions/deploy-lock/ (DECISIONS-for-review.md §22b): the deploy artifact's package.json and the
// package-lock.json that pins its whole dependency tree, so two deploys of the same commit install the same code
// (Cloud Build runs `npm ci` when the source has a lockfile). build.mjs copies the lock into functions/dist/ after
// checking that it was made for exactly the package.json it writes; a stale lock fails the build.
//
// Resolving the tree needs the npm registry, which the quality image's offline cache cannot answer, so this runs in
// the digest-pinned Node image with the network, after every change to functions/package.json's dependencies or to
// the root overrides (docs/SETUP.md -> npm in a container):
//
//   docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/h -e npm_config_cache=/tmp/h/.npm -v "$PWD:$PWD" -w "$PWD" \
//     node:24-bookworm-slim@sha256:<digest of docs/SETUP.md> node functions/deploy-lock.mjs
//
// No install script runs (`--ignore-scripts`) and nothing is installed (`--package-lock-only`).
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';

import { deployManifest, manifestText } from './deploy-manifest.mjs';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const manifest = deployManifest(await readJson(here('package.json')), await readJson(here('../package.json')));
const lockDir = here('deploy-lock');
await mkdir(lockDir, { recursive: true });
await writeFile(here('deploy-lock/package.json'), manifestText(manifest));
// npm's own CLI next to this Node (the official image's layout), never whatever `npm` PATH names.
const npmCli = resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
execFileSync(
    process.execPath,
    [npmCli, 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', lockDir],
    {
        stdio: 'inherit',
    },
);
process.stdout.write(`functions/deploy-lock: locked ${Object.keys(manifest.dependencies).join(', ')}\n`);
