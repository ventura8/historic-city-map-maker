# Release Notes

Every release tag `vX.Y.Z` (or pre-release tag `vX.Y.Z-beta.N` / `vX.Y.Z-rc.N`) has **two files** in this folder, written before the tag is pushed:

| File | Purpose |
| --- | --- |
| `vX.Y.Z.md` | The full release notes: highlights, features, fixes, security, breaking changes and migration steps for city owners, verification results. |
| `vX.Y.Z_github_description.md` | The body of the GitHub Release. Its single H1 becomes the release title (for example `# Release v1.2.0 - Swipe compare`). Between the lines `<!-- hcm:sri -->` and `<!-- /hcm:sri -->` it carries the pinned jsDelivr addresses with their integrity and the tags to paste, written by `npm run release:notes -- --write docs/releases/vX.Y.Z_github_description.md` from `cdn/engine/release.json`. |

## Rules

- The tag matches `^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-(beta|rc)\.(0|[1-9][0-9]*))?$` (a release, or a pre-release `-beta.N` / `-rc.N` with N free of leading zeros; no other suffix); the root and every workspace `package.json`, every dependency of a workspace on another workspace, the engine's `ENGINE_VERSION`, `cdn/engine/release.json` and the starter kit's pinned folder carry the same version (`npm run release:bump -- X.Y.Z` writes the versions).
- The release commit holds the built engine in `cdn/engine/` (every file of `packages/engine/dist` but the source maps) with `release.json`, the size and SHA-384 integrity of every file: jsDelivr serves the tag's folder at `https://cdn.jsdelivr.net/gh/ventura8/historic-city-map-maker@vX.Y.Z/cdn/engine/`, and the starter kit (`templates/starter-kit/index.html`) pins it with Subresource Integrity (`npm run release:cdn`, then `npm run release:pin-kit`).
- Semantic versioning of the engine's public surface ([../ENGINE_API.md](../ENGINE_API.md) → *Versioning and compatibility*): the `HistoricCityMap` global and the module build's exports, `<hcm-map-viewer>` and its events, `config.js`, the URL hash and the City Manifest. A breaking change is a major version and documents the migration.
- Notes describe what shipped, checked against the code. No test counts: they live only in the generated scenario document.
- Both files pass markdownlint like every other document.
- The release workflow (`.github/workflows/release.yml`) refuses a tag whose versions, released engine, kit pins, notes files or description's pinned addresses disagree, or whose `cdn/engine/` is not byte for byte a fresh build of the tagged sources; it then creates the GitHub Release from the description file. The SonarQube gate of the same commit is a proposal waiting for the user ([../research/DECISIONS-for-review.md](../research/DECISIONS-for-review.md) §58c).

How to prepare a release: [.agent/skills/quality/prepare_release_skill.md](../../.agent/skills/quality/prepare_release_skill.md).

## Pre-releases

A tag `vX.Y.Z-beta.N` or `vX.Y.Z-rc.N` is a pre-release (SemVer order: every beta, then every rc, then `vX.Y.Z`). The release workflow publishes it as a GitHub pre-release that is never marked latest; jsDelivr serves it only at its full version (`@vX.Y.Z-beta.N`), and the notes' block offers no major line (`@1` never resolves to a pre-release, and nothing purges it); `create-historic-city` goes to npm under the dist-tag `beta` or `rc`, never `latest` (`npm publish … --tag beta`).

## Releases

- **v1.0.0-beta.1** (prepared, not tagged): the first beta of Historic City Map Maker, the engine rewrite with the viewer, the admin and its Setup Assistant with no-terminal install, the backend, the USGS and Landsat imagery pipeline, the georeferencer and joins, the import of local archives, the start page, stories, roles and review, many cities, the static export and the local worker: [v1.0.0-beta.1.md](v1.0.0-beta.1.md), [v1.0.0-beta.1_github_description.md](v1.0.0-beta.1_github_description.md). Every version is 1.0.0-beta.1; `cdn/engine/`, the kit's pins and the description's pinned addresses name it; the tag waits for the user ([../research/DECISIONS-for-review.md](../research/DECISIONS-for-review.md) §160, §161).
- **v1.0.0** (prepared, not tagged, after the betas): the v1 baseline of the engine's contract: [v1.0.0.md](v1.0.0.md), [v1.0.0_github_description.md](v1.0.0_github_description.md). Its notes are written; its versions, `cdn/engine/` and the description's block are written again by `npm run release:bump -- 1.0.0`, `release:cdn`, `release:pin-kit` and `release:notes` when it is released.
