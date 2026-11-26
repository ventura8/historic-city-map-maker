## Summary

<!-- What changes and why, in one or two sentences. Link the issue: "Closes #123". -->

## Verification

<!-- Paste the verdict line of the pipeline run on this commit, e.g. [SUCCESS] stage 'all' passed -->

## Checklist

- [ ] `PIPELINE_STAGE=all bash scripts/ci/run-all-checks.sh` printed `[SUCCESS] stage 'all' passed` on this commit (the pre-push hook checks `reports/pipeline/green-all.json` for `master` and tags)
- [ ] No inline suppressions (`eslint-disable`, `@ts-expect-error`, `# noqa`, coverage-ignore hints, `.skip`/`.only`, `NOSONAR`, ...); a rule is relaxed only in its tool's single config, with a why-comment
- [ ] Every measured file stays at 90 % or more line and branch coverage; no threshold lowered, no file excluded to pass
- [ ] Every new or changed user-visible behaviour has a happy and a bad row in `e2e/scenarios.json`, with tests that drive the app from outside
- [ ] Every new UI string exists in both `ro` and `en`
- [ ] `README.md`, `docs/`, `.agent/` and the skills are updated in this PR; `.agents/skills/` and `.claude/skills/` are byte-identical
- [ ] New dependencies, images and actions are pinned exactly (SHA with `# vX.Y.Z` for actions, `@sha256` for images); a hold is a `HELD` entry with its reason
- [ ] No secret, token or credential in the diff, the logs or the fixtures
- [ ] The PR title is a Conventional Commit: `type(scope): summary`
