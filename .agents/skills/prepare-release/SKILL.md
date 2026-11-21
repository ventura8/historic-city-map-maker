---
name: prepare-release
description: Prepare a Historic City Map Maker release vX.Y.Z or a pre-release vX.Y.Z-beta.N / -rc.N - pick the semantic version of the engine surface, align every package.json version and ENGINE_VERSION, write the two release-note files in docs/releases, sync docs, run the full pipeline to a green all, then ask before pushing and tagging; CI builds the GitHub Release and the jsDelivr engine. Use whenever the user asks for a release, a tag, release notes or a version bump.
---

# Prepare Release Skill

Working notes: `.agent/skills/quality/prepare_release_skill.md`; file rules: `docs/releases/README.md`; contract: `docs/research/M5-interfaces.md` §2. The first release is the pre-release v1.0.0-beta.1 (`docs/research/DECISIONS-for-review.md` §160, §161): `cdn/engine/` is committed with no EditorConfig exception, since the release transform writes lit-html's whitespace class with escapes (§59c is answered that way).

## Steps

1. Version `X.Y.Z` or a pre-release `X.Y.Z-beta.N` / `X.Y.Z-rc.N` (tag `v<version>`, must match `^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-(beta|rc)\.(0|[1-9][0-9]*))?$`; no other suffix). A pre-release becomes a GitHub pre-release never marked latest, is pinned on jsDelivr only at its full version (no `@1` line, no purge), and goes to npm under the dist-tag `beta` or `rc`, never `latest` (`releaseDistTag` of `@hcm/shared`); a breaking change of the manifest, `config.js`, the element or the `HistoricCityMap` global is a major version.
2. In the quality image, in order:

   ```bash
   npm run release:bump -- X.Y.Z                        # every package.json, workspace dependency, lockfile entry, deploy lock, ENGINE_VERSION,
                                                        # and the guides' `npx create-historic-city@X.Y.Z` (PINNED_DOCS: never `@1`)
   npm run build --workspace @hcm/engine && npm run release:cdn   # cdn/engine/ and release.json (SHA-384 of every file)
   npm run release:pin-kit                              # templates/starter-kit/index.html pinned to that release
   npm run build:landing                                # sites/landing/ (GitHub Pages) names the CLI at that release
   ```

3. Write `docs/releases/vX.Y.Z.md` (full notes) and `docs/releases/vX.Y.Z_github_description.md` (the GitHub Release body; its single H1 is the release title; it keeps the lines `<!-- hcm:sri -->` and `<!-- /hcm:sri -->`), then `npm run release:notes -- --write docs/releases/vX.Y.Z_github_description.md`, and list the version under *Releases* in `docs/releases/README.md`.
4. Review the whole diff since the previous tag against `README.md`, `docs/*.md`, the admin guide and the agent assets.
5. Run the checks and read the verdicts: `python3 scripts/ci/check_release.py --tag vX.Y.Z` and `npm run release:cdn -- --check` in the image, then the full pipeline split with the NUC:

   ```bash
   mkdir -p reports/pipeline
   bash scripts/ci/e2e-split.sh > reports/pipeline/run.log 2>&1; echo "EXIT=$?"
   grep -E '^\[(SUCCESS|FAILURE)\]' reports/pipeline/run.log
   ```

   It must print `[SUCCESS] stage 'all' passed`. A NUC whose build cache was evicted rebuilds its image from the registries (a download: ask first), else run `bash scripts/ci/run-all-checks.sh` here only.
6. Ask before each of, one at a time: `git push origin feat/engine-rewrite`; the pull request to `master` and its merge; `git tag -a vX.Y.Z -m "vX.Y.Z"` on the merged commit; `git push origin vX.Y.Z`. CI (`.github/workflows/release.yml`) runs `PIPELINE_STAGE=release` in a read-only job (the tag, every version, `release.json`, the kit's pins, the notes and their pinned addresses, a byte-for-byte rebuild of `cdn/engine/`, the bundles, the CLI's package) and shows the pinned addresses in its summary; a second job that runs no repository code creates the GitHub Release titled by the description's H1, with the engine and admin bundles attached. jsDelivr serves the tag's `cdn/engine/` from then on. The template repository, the npm publish of `create-historic-city`, the Sonar check of the same commit and the `@1` purge wait for the user (`docs/research/DECISIONS-for-review.md` §58, §59). The npm name is checked and published (or reserved) before the merge makes the guides that name it public, from the package CI packed (`self-host-bundle`, then `release-pack`), with `--provenance` once a workflow publishes it (§65e).

No test counts in release notes; they live only in the generated `docs/E2E_SCENARIOS.md`.
