# SonarQube Skill

**Historic City Map Maker** is analysed by SonarQube Cloud: organisation `ventura8`, project key `ventura8_bucurestiuldisparut.github.io`. The repository is public, so analysis runs both in CI (free) and locally in the `sonar` stage, which is part of `all` (`quality/pipeline_skill.md` → *Stages*). Status today: `sonar-project.properties`, `scripts/ci/sonar_scan.sh`, `scripts/ci/sonar_report.py`, the CI job `sonarqube` and the `sonar` gate of the pipeline (`Gate("sonar", ("bash", "scripts/ci/sonar_scan.sh"))`, the scanner copied into `docker/Dockerfile.quality` from the pinned scanner image) exist; `scripts/ci/sonar_setup.py` is planned. Without a token the stage skips with a notice and passes.

## Scope (`sonar-project.properties`)

- `sonar.sources`: `packages/{shared,ui,engine,admin}/src`, `functions/src`, `pipeline/src`, `scripts/ci`, `scripts/site/src` (the static site build, measured by Vitest's `tools` project), `scripts/git-hooks`, `docker`, `.github/workflows` and `.github/actions`. Every listed folder must exist (the scanner refuses to start otherwise), so the starter kit joins with M5. Workflows, composite actions and Dockerfiles are in sources because Sonar's GitHub Actions and Docker security rules find real issues there.
- `sonar.tests`: every package's `test/` tree, `packages/test-support/src`, `functions/test`, `firebase/rules-tests/test`, `pipeline/tests`, `scripts/ci/tests` (also excluded from sources), `scripts/site/test`, the CLIs' tests (`scripts/seed/test`, `packages/ui/scripts/test`) and `e2e`. Sources and tests stay disjoint, so no file is indexed twice.
- Reports: `reports/coverage/ts/lcov.info` (Vitest), `reports/coverage/scripts.xml` (pytest for `scripts/ci`) and `reports/coverage/pipeline.xml` (the raster pipeline), `reports/junit/pytest.xml` and `reports/junit/pipeline.xml`.
- `sonar.coverage.exclusions` is **empty**: every measured file must reach 90 %. The `coverage` gate (`scripts/ci/check_coverage.py`) reads the same file, so its scope equals Sonar's.
- No `sonar.projectVersion` in the file: the scanner invocation passes the `package.json` version.

## The verdict (`scripts/ci/sonar_report.py`)

After the upload it waits for the server's compute task (5 s polls, 600 s timeout) and exits 1 unless **all** hold: quality gate OK, 0 open issues, 0 security hotspots to review, 0 duplicated blocks, coverage at least 90 % as the server reports it. It exits 2 when Sonar is not configured or the server fails (`sonar_scan.sh` never calls it without a token: that is its skip). `--check-reports` needs neither token nor network: exit 2 unless every coverage and test report named in `sonar-project.properties` exists and is not empty; `sonar_scan.sh` runs it before scanning, so an analysis without coverage is never uploaded.

## CI job (`sonarqube` in `.github/workflows/ci.yml`)

- Needs the `tests` job; downloads its `coverage` artifact, loads the quality image and runs `scripts/ci/sonar_report.py --check-reports` in it, so every report `sonar-project.properties` names (the raster pipeline's included) is checked from the one list.
- Runs for pushes to `master` and for pull requests from this repository only: fork PRs get no secrets, and a tag or another branch would be a non-default-branch analysis, which returns 403 on the free plan. A tag will be gated by looking up the default-branch analysis of the same commit (M5).
- `SONAR_TOKEN` is the only repository secret. A first step checks for it and for `sonar-project.properties`; without either, every later step is skipped and the job ends with a notice instead of failing.
- Scan and quality-gate actions pinned by full SHA with a `# vX.Y.Z` comment; then `sonar_report.py --min-coverage 90` inside the quality image (Python 3.14), the token passed through the environment.

## Local `sonar` stage

The pipeline's `sonar` gate runs `scripts/ci/sonar_scan.sh` inside the quality image (`PIPELINE_STAGE=sonar`, or as the last part of `all`): there the SonarScanner CLI 8.4.0.16527 is copied from `sonarsource/sonar-scanner-cli:12.4.0.4321_8.4.0`, pinned by digest (never `:latest`), runs on the image's JDK 21 (`-Dsonar.scanner.skipJreProvisioning=true`, no JRE download) and keeps its plugin cache in `reports/.cache/sonar` (`SONAR_USER_HOME`). Run on the host, the script uses the scanner image itself, with the repository mounted at the same path, then `sonar_report.py` in the quality image. `--check-token` only validates the token. The token comes from `SONAR_TOKEN` (`scripts/ci/run-all-checks.sh` forwards it into the container by name) or the git-ignored `.sonar-token`, which is refused unless its mode is 0600 (`chmod 600 .sonar-token`); it reaches the scanner as an environment variable and is validated through `curl -K -` with the token on stdin, never in argv. Without a token the script prints `[sonar] [SKIP] ...` and exits 0. With one it then requires the `tests` reports (`--check-reports`), scans and reports.

## Credentials (human-only)

1. The user signs in to SonarCloud and creates the token.
2. The user runs `python3 scripts/ci/sonar_setup.py` (hidden prompt, writes `.sonar-token`) and `gh secret set SONAR_TOKEN` (stdin) in their own terminal.
3. An agent never reads, prints or pastes the token; it is sent only as a `Bearer` header over HTTPS.

## Pitfalls inherited from the sibling repositories

- **Automatic Analysis must be OFF** (SonarCloud → Administration → Analysis Method). With it on, the scanner is refused; the stage prints a skip message.
- A token minted while Automatic Analysis was on may lack analysis rights: create a fresh one.
- Coverage 0 % usually means stale or missing reports: run the `tests` stage first, and keep the repository mounted at the same absolute path (paths in lcov and Cobertura must match the scanner's).
- Including `.github` and `docker` in sources is deliberate.

## Rules

- Fix every finding in code. Never `NOSONAR`, never `sonar.issue.ignore.*`, never "Accepted" or "False positive" in the UI. A rule that is wrong for the whole project is changed in the quality profile, with the user's yes.
- Common rules to respect while writing: never drop a promise (`void fn()` or `.catch`), use `.at(-1)`, shared globals on `globalThis`; Python `monkeypatch.setattr`, single-call `pytest.raises`, split composite asserts, `math.isclose`; Bash `[[ ]]`, errors to stderr, a `*)` case branch, explicit `return`.
