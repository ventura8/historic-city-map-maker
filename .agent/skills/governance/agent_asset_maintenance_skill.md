# Agent Asset Maintenance Skill

This skill governs the agent assets of **Historic City Map Maker**: `AGENTS.md` (imported by `CLAUDE.md`), `.agent/` (instructions, skills, workflows), `.agents/skills/`, its byte mirror `.claude/skills/`, the subagents in `.claude/agents/`, and `docs/LESSONS.md`.

## Purpose

The agent assets are the project's only memory. The next agent reads these files, not this conversation, a commit message or a session memory. When code, tooling or decisions drift without the matching asset update, agents act on stale or wrong guidance.

## When to use this skill

- At the end of **every** task, also one that only investigated: write down what it established (*Where a lesson goes*).
- When a package, element, function, rule, gate, stage, workflow, dependency pin or hold is added, renamed or removed.
- When a skill, workflow or subagent is added, renamed or its scope grows.
- When the user gives a rule (cost, pushing, secrets, consent, scope).

---

## Maintenance Rules

### 1. Check before writing

- Read the code you describe: package names, element names, script names, gate names in `scripts/ci/pipeline.py`. Never write a hypothetical as a fact.
- The M0 assets were written as a contract **before** most of the code existed. A rule about a module that is not in the tree yet is phrased as a rule, and its path is listed under *Planned paths* in `docs/research/M0-handoff.md`. When the code lands, replace the planned name with the real one (or change the code to match the contract) and remove the planned entry, in the same task.

### 2. Synchronisation checklist

1. **`AGENTS.md`**: a new global rule, boundary or hard constraint. Keep it within **24,000 bytes** (`wc -c AGENTS.md`); move detail into a skill and link it.
2. **`.agent/instructions.md`**: the reading order, fix order, cost/push/secrets discipline and execution rules.
3. **`.agent/skills/SKILLS_CATALOG.md`**: every skill, with its folder and a one-line scope; the task-type table.
4. **`.agent/skills/<folder>/*_skill.md`**: the detailed contract (architecture, patterns, gotchas). At most 500 lines each.
5. **`.agents/skills/<name>/SKILL.md`** and the mirror **`.claude/skills/<name>/SKILL.md`**:
   - YAML front matter with exactly `name` (equal to the folder, `^[a-z0-9-]{1,64}$`, never containing "claude" or "anthropic") and `description` (one line, at most 1,024 characters, no angle brackets, no colon followed by a space, which would break YAML; what it covers, then a "Use whenever / before ..." trigger).
   - A condensed, action-oriented digest that points to its canonical `.agent/skills/` file, with a *Commands* section in bash.
   - The two trees are **byte-identical**: edit `.agents/skills/<name>/SKILL.md`, then `cp .agents/skills/<name>/SKILL.md .claude/skills/<name>/SKILL.md`. Verify with `diff -r .agents/skills .claude/skills`; the `skill-mirrors` gate (`scripts/ci/check_skill_mirrors.py`) fails the pipeline on any difference.
6. **`.agent/workflows/*.md`**: front matter `description`; every command snippet works on the Linux developer machine through the quality image.
7. **`.claude/agents/*.md`**: front matter `name` (equal to the file name), `description`, `tools`, `model`, `maxTurns`; a subagent never writes, pushes or deploys unless its file says so.
8. **`e2e/scenarios.json`**: every behaviour change adds or changes its happy and bad rows (`quality/e2e_scenario_matrix_skill.md`).
9. **`.claude/settings.json`**: a new routine, read-only or pipeline command may be proposed for the allowlist; editing the file is **ask first**, and nothing that pushes, tags, deploys, publishes or deletes is ever allowlisted.

### 3. Cross-reference integrity

- Write repository paths in back-ticks, relative to the repository root (`packages/engine/src/index.ts`). Inside `.agent/skills/`, a sibling skill may be named relative to that folder (`quality/pipeline_skill.md`).
- Every back-ticked repository path exists, is git-ignored (`reports/`, `.env.local`, `.sonar-token`, and build output such as `functions/dist` that a fresh clone has not built yet: the checker also asks git about a missing path as a folder, since `dist/` matches only folders), or is listed under *Planned paths* in `docs/research/M0-handoff.md`. The `agent-assets` gate (`scripts/ci/check_agent_assets.py`) enforces this together with the byte and line budgets; `docs/research/` is not checked (it is the verbatim research record).
- Section references use the heading text: `docs/SETUP.md` → *npm in a container*. Renaming a heading means updating every reference to it.
- No orphan: every skill appears in `SKILLS_CATALOG.md`; every subagent appears in `CLAUDE.md`.

### 4. Drift the sibling repositories suffered, and the rule that prevents it here

| Drift | Rule here |
| --- | --- |
| **Count drift**: test and scenario counts repeated in many files disagreed within weeks. | Test counts appear **only** in the `## Counts` section of `docs/E2E_SCENARIOS.md`, generated from `e2e/scenarios.json` by `python3 scripts/ci/check_e2e_matrix.py write`. Everywhere else says "the suite". Fixed configuration facts (90 % per file, complexity 5, 11 tour viewports) may be repeated because they change by decision, not by growth. |
| **Stage drift**: `all` was defined differently in different files after a stage was added. | The stages and the definitions of `quality` and `all` live **only** in `quality/pipeline_skill.md` → *Stages*; every other file links there. |
| **Stale scratch trees**: an old assistant directory kept outdated instructions next to the real ones. | The agent assets are the files listed at the top of this skill, nothing else. A tool that insists on its own directory gets a pointer to `AGENTS.md`, never a copy. `.claude/worktrees/` is git-ignored and excluded from every linter. |
| **Duplicated process**: two copies of the same review process diverged. | A process lives in one place: the review-wave process in `.agents/skills/coderabbit-review-waves/SKILL.md`, thread closure in `.agents/skills/resolve-pr-comments/SKILL.md`. |

### 5. Where a lesson goes (every task, no exceptions)

Whatever a task established that these files do not already say is written down in the same task, in the file that owns the subject; skill mirrors follow.

| Learned | Goes to |
| --- | --- |
| A rule the user gave (cost, pushing, secrets, consent, scope) | `AGENTS.md` → *Boundaries* / *Global Rules* and `.agent/instructions.md` → *Cost, Push and Secrets Discipline* |
| A standing approval the user gave (a class of actions no longer ask-first) | `AGENTS.md` → *Boundaries* → *Pre-approved*, `.agent/instructions.md`, `workflow/human_steps_and_consent_skill.md`, `docs/research/DECISIONS-for-review.md` |
| A dependency bump or a deliberate hold, with its reason | `docs/CI_PIPELINE.md` → *Held dependencies* / *Tool versions*, `quality/pipeline_skill.md` → *Latest stable dependencies and holds*, `docs/research/M0-handoff.md` (append) |
| A stage, gate, tool pin or CI job change | `quality/pipeline_skill.md`, `quality/ci_quality_gates_skill.md`, `.agents/skills/quality-pipeline/SKILL.md` (+ mirror), `docs/CI_PIPELINE.md` |
| A quirk of the developer machine, Docker or the quality image | `quality/pipeline_skill.md` → *Local tooling quirks*, `docs/SETUP.md` |
| A Vitest, Playwright, Lit, msw or emulator gotcha | `quality/testing_strategy_skill.md`, `docs/TESTING.md` |
| A bug a test, an analyser or a crash report caught, and the scenario that pins it | `docs/LESSONS.md` → *Lessons from this repository*, the row in `e2e/scenarios.json` |
| A Mapbox GL, viewer or URL-state fact | `web/engine_viewer_skill.md` |
| A Setup Assistant, deep link or console fact (Google Cloud, Mapbox, USGS) | `web/admin_setup_assistant_skill.md`, `workflow/human_steps_and_consent_skill.md`, `.agents/skills/setup-assistant/SKILL.md` (+ mirror), `docs/ADMIN_GUIDE.en.md` |
| A Material 3, layout or accessibility finding | `web/ui_m3_adaptive_skill.md` |
| A translation gotcha | `web/i18n_skill.md` |
| A security finding (XSS sink, CSP, token scope, rules gap) | `web/web_security_skill.md`, `firebase/rules_and_emulators_skill.md` |
| A Cloud Functions, rules or emulator fact | `firebase/functions_skill.md`, `firebase/rules_and_emulators_skill.md`, `.agents/skills/firebase/SKILL.md` (+ mirror) |
| A GDAL, georeferencing, USGS or MTS fact | `pipeline/*_skill.md`, `.agents/skills/raster-pipeline/SKILL.md` (+ mirror) |
| A SonarQube fact | `quality/sonarqube_skill.md`, `.agents/skills/sonarqube/SKILL.md` (+ mirror) |
| A release fact | `quality/prepare_release_skill.md`, `.agents/skills/prepare-release/SKILL.md` (+ mirror), `docs/releases/README.md` |
| A design decision and its reason | `docs/ARCHITECTURE.md` and the skill that owns the component |
| A new or changed subagent | `.claude/agents/<name>.md`, `CLAUDE.md`, `SKILLS_CATALOG.md` |

A task is not closed while something it learned lives only in the conversation.
