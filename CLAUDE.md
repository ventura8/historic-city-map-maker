# Claude Code Instructions

This repository is **Historic City Map Maker** (`ventura8/historic-city-map-maker`), a historical map engine and admin
for any city; București dispărut (`https://bucurestiul-disparut.web.app/`) is an example map made with it. The canonical agent rules for this repository live in `AGENTS.md`; this file only imports them so
Claude Code and every other agent read the same contract.

@AGENTS.md

## Quick orientation

- Reading order before any task: `AGENTS.md` → `.agent/instructions.md` →
  `.agent/skills/SKILLS_CATALOG.md` → the relevant skill and workflow files. The plan is
  `docs/research/PLAN.md`; what exists today and how to extend it is `docs/research/M0-handoff.md`;
  the engine contract is `docs/ENGINE_API.md`, the M1 interfaces `docs/research/M1-interfaces.md`, the M2
  backend contracts `docs/research/M2-interfaces.md`, the M2b admin contracts `docs/research/M2b-interfaces.md`, the
  M2c editor contracts `docs/research/M2c-interfaces.md`, the M3 imagery contracts `docs/research/M3-interfaces.md`,
  the M4 automation contracts `docs/research/M4-interfaces.md`, the M5 multi-city, release, starter-kit and export
  contracts `docs/research/M5-interfaces.md` and the M6 no-terminal Setup contracts `docs/research/M6-interfaces.md`,
  the M7 local worker and cheap cloud defaults `docs/research/M7-local-worker.md`, the M12 own tiles and approval view `docs/research/M12-own-tiles.md`, the M8 join of one date's frames
  `docs/research/M8-join-interfaces.md`, the M9 import and calibration for any place on Earth `docs/research/M9-calibration.md`,
  the M14 start page `docs/research/M14-start-your-map.md`, the M17 stories `docs/research/M17-stories.md`, the M20 import of local files `docs/research/M20-import-local.md`,
  the M25 Landsat source `docs/research/M25-landsat.md`, the M26 hardware governor `docs/research/M26-governor.md`, the M27 disappeared streets `docs/research/M27-lost-streets.md`, the M28 Platform and Sources steps `docs/research/M28-sources.md`, the M29 imagery census `docs/research/M29-imagery-census.md`.
- Run the pipeline before claiming anything is done: `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh`
  for docs and tooling, `tests` and `build` for code, the default `all` before a push. It builds
  and uses the quality image `hcm-quality:local`; every gate runs inside it, never on the host.
- Claude Code skills are in `.claude/skills/`, byte-identical to `.agents/skills/`: edit the
  `.agents/skills/` copy, then `cp` it over the mirror.
- Subagents for delegation are in `.claude/agents/`: `pipeline-runner` (runs one stage, returns the
  verdict), `e2e-matrix-auditor` (`e2e/scenarios.json` against the tests), `docs-sync-checker`
  (docs and agent assets a diff must touch) and `golden-reviewer` (Playwright screenshot diffs).
- Manual testing: `npm run dev:stack` starts the local stack (admin `http://127.0.0.1:4312`, viewer
  `http://127.0.0.1:4310`, the emulators and the fakes, a seeded Bucharest city and a second city, Bacău; `docs/SETUP.md` → *Local stack for
  manual testing*); `.claude/launch.json` opens it in the browser pane (`dev-stack`, `dev-stack-admin`,
  `dev-stack-viewer`). The checklist is `docs/MANUAL_TEST_PLAN.md`.
- Browser work (Mapbox, Google Cloud, USGS, SonarCloud consoles) happens in the user's own signed-in
  browser: never type a credential, and confirm every accept, submit, publish or payment with the
  user in chat first, one at a time.
