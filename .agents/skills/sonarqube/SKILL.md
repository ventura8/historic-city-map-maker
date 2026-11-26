---
name: sonarqube
description: Run and act on the Historic City Map Maker SonarQube Cloud analysis (organisation ventura8, project ventura8_bucurestiuldisparut.github.io) - the CI job, the local sonar stage in all, the strict verdict of sonar_report.py (gate OK, zero issues, zero hotspots, zero duplications, coverage at least 90), the scope in sonar-project.properties shared with the per-file coverage gate, and the token rules. Use when the sonar stage or job skips or fails, when a SonarCloud finding has to be fixed, or when the Sonar wiring changes.
---

# SonarQube Skill

Working notes: `.agent/skills/quality/sonarqube_skill.md`. Status: `sonar-project.properties`, `scripts/ci/sonar_scan.sh`, `scripts/ci/sonar_report.py`, the CI job `sonarqube` and the pipeline's `sonar` gate (the SonarScanner CLI copied into the quality image) exist; `scripts/ci/sonar_setup.py` is planned. Without a token the stage skips with a notice and passes.

## Commands

```bash
PIPELINE_STAGE=sonar bash scripts/ci/run-all-checks.sh   # the gate: scanner in the quality image, then the verdict (skips without a token)
bash scripts/ci/sonar_scan.sh                            # the same from the host, with the scanner image pinned by digest
bash scripts/ci/sonar_scan.sh --check-token              # only validate the token (.sonar-token must be mode 0600)
python3 scripts/ci/sonar_report.py --check-reports       # in the image: every report the scan reads exists (no token)
python3 scripts/ci/sonar_setup.py                        # planned; the USER runs it: hidden prompt, writes .sonar-token
gh secret set SONAR_TOKEN                                # the USER runs it: token on stdin
```

## Verdict

`sonar_report.py` waits for the server's task and exits 1 unless the quality gate is OK, there are 0 open issues, 0 hotspots to review, 0 duplicated blocks and coverage is at least 90 %. Without a token `sonar_scan.sh` skips (exit 0) before any of it; with one, missing `tests` reports stop it before the upload (exit 2: run `tests` first, or `all`).

## Rules

- Fix every finding in code. Never `NOSONAR`, `sonar.issue.ignore.*`, "Accepted" or "False positive".
- `sonar.coverage.exclusions` stays empty; the per-file gate `scripts/ci/check_coverage.py` reads the same scope (TS lcov plus `reports/coverage/scripts.xml` and `reports/coverage/pipeline.xml`).
- Automatic Analysis must be OFF in SonarCloud; a token minted while it was on may lack rights.
- The token is never read, printed, pasted or passed in argv by an agent: environment variable or stdin only, `Bearer` header over HTTPS.
- CI analyses pull requests and the default branch only; fork PRs skip the job; a missing secret skips it.
