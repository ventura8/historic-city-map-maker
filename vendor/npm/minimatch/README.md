# minimatch 11.0.3, callable from CommonJS

Vendored copy of [minimatch](https://github.com/isaacs/minimatch) 11.0.3 (Blue Oak Model License 1.0.0, see
`LICENSE.md`) that every `minimatch` of the tree resolves to, through `"minimatch": "$minimatch"` in the root
`overrides` and the root dependency `"minimatch": "file:vendor/npm/minimatch"` (as `vendor/npm/braces`).

## Why

GHSA-g3hv-75wg-m249 (moderate, published 2026-10-30): pattern amplification in `firstPhasePreProcess` at
`optimizationLevel` 2 or more. The advisory flags every `minimatch` below 11.0.1, and no release of the older lines
fixes it. The tree held 10.2.6 (`eslint`, `@eslint/config-array`, `@typescript-eslint/typescript-estree`,
`eslint-plugin-sonarjs`), 3.1.5 (`firebase-tools`), 5.1.9 (`readdir-glob` under `archiver`) and 6.2.3 (`superstatic`).
A plain `overrides` to 11 breaks the last three: 11's CommonJS entry exports an object, and `firebase-tools`
(`lib/fsAsync.js`) and `superstatic` (`lib/utils/patterns.js`) call the module itself, `require('minimatch')(path, glob)`.

## What is in it

- `commonjs/` and `esm/`: upstream's `dist/commonjs/` and `dist/esm/`, byte for byte, without the source maps (the
  folders are renamed because `dist/` is build output to `.gitignore` and the repository's checkers).
- `index.cjs`, the CommonJS entry: 11's own `minimatch` function with every named export of 11 set on it (`minimatch`,
  `Minimatch`, `filter`, `match`, `braceExpand`, `escape`, `unescape`, `defaults`, `sep`, `GLOBSTAR`) and
  `default`. So `require('minimatch')(...)`, `require('minimatch').minimatch(...)`,
  `const { Minimatch } = require('minimatch')` and TypeScript's `__importDefault` all reach 11's code.
- `index.mjs`, the ES module entry: 11's named exports, and its `minimatch` function as the default export.
- `package.json`: version `11.0.3-callable.1` (above 11.0.1, so `npm audit` does not flag it; the suffix marks the
  copy), the entries above in `exports`, 11's own dependencies.

Nothing of 11 is changed or re-implemented. 11 has no `makeRe` and no `regexp`; no dependant in the tree uses either
(checked with `grep` in each dependant on 2026-10-31).

## Source

`minimatch-11.0.3.tgz` from the npm registry, SHA-256
`175b2fd9c9d3611e06980341c1be226c7af72b1f414eefb424dca1be9cd9e8ae`, integrity
`sha512-iny/40PEGkNJQ5/Pv6z3nm6FbRAby32GeZRjCUJk2WnNDbgPSTcdI+DDvLqsgBdD4cD5sMtMheqPPnehCCa8Nw==` (the integrity the
lockfile held for `glob`'s own copy of 11.0.3).

## The install bundle

The admin's install bundle cuts `firebase-tools`' tree out of the root lockfile (`scripts/site/src/install/tools-lock.ts`),
so it carries this folder too, as `tools/vendor/npm/minimatch/`, with the same link and override in `tools/package.json`.

## Dropping it

Once `firebase-tools`, `superstatic` and `readdir-glob` depend on `minimatch` 11 or later (or the older lines ship a fix),
delete this folder, the root dependency, the `overrides` entry, its line in `docker/Dockerfile.quality`,
`.dockerignore` and `knip.json`, and refresh `package-lock.json` (`docs/SETUP.md` → *npm in a container*).
