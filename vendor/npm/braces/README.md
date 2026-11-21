# braces 3.0.3, depth-limited

Vendored copy of [braces](https://github.com/micromatch/braces) 3.0.3 (MIT, see `LICENSE`),
unchanged except `lib/parse.js`. That file refuses nesting deeper than 64 braces or parentheses
(`options.maxDepth` can lower the limit), which closes GHSA-vfj7-8cjw-p6xm: stack exhaustion through
deeply nested patterns. Every published braces version is affected, and none is patched.

The patch is the one the sibling repository Whisper-Pro-ASR already carries. It is reached only by
dev tooling (`micromatch` under `markdownlint-cli2` and `stylelint`, `chokidar` under `firebase-tools`)
and is wired in through `overrides` in the root `package.json`, so `npm audit --audit-level=low` passes
without an allowlist. Delete this directory and the override once upstream publishes a fixed release.
