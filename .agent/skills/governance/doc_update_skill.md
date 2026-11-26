# Documentation Update Skill

Every task updates the documentation that describes it, in the same task: application code, UI, functions, rules, the raster pipeline, CI, dependency bumps, lint configuration and tooling alike. This skill says which file owns which fact, so a fact is written once and linked everywhere else.

## Ownership map

| File | Owns |
| --- | --- |
| `README.md` | What the project is (in English only, short), badges, the one-command quick start, links to every doc. No counts, no tool versions. |
| `AGENTS.md` | Commands, boundaries, global rules, project hard constraints (budget 24,000 bytes). |
| `docs/ARCHITECTURE.md` | Components, data model, buckets, functions, the raster pipeline, the viewer and admin, security and cost guards, analytics and crashes. The *why* of each shape. |
| `docs/CI_PIPELINE.md` | The file-type to gates table, CI workflows, tool versions, held dependencies. Stages are summarised and link to `.agent/skills/quality/pipeline_skill.md` → *Stages*. |
| `docs/TESTING.md` | Test tiers, fakes and seams, emulators, the scenario registry, the coverage gate, how to run each tier. |
| `docs/SETUP.md` | Developer setup: Docker, the quality image, npm in a container, git hooks, `.env.local`, the Sonar token, emulators, what the user does once. |
| `docs/LESSONS.md` | Defects a test, analyser or crash report found, and the lesson each one taught. |
| `docs/ADMIN_GUIDE.en.md` | The city admin's guide: the Setup Assistant and the daily flows. English only (see *Language*). |
| `docs/E2E_SCENARIOS.md` (generated) | The rendered scenario registry and the **only** test counts (`## Counts`). Never edited by hand: `python3 scripts/ci/check_e2e_matrix.py write` regenerates it. |
| `docs/releases/` | Two files per tag (`docs/releases/README.md`). |
| `docs/research/` | The verbatim research and the approved plan: append dated addenda, never rewrite; `M0-handoff.md` records what was actually built. |
| `.github/badges/coverage.svg`, `.github/badges/branches.svg` | Written by `scripts/ci/check_coverage.py` (the `coverage` gate of the `tests` stage); committed with the change that moved them. |

## Rules

- **Describe what exists**, mark what is planned. A planned path is listed under *Planned paths* in `docs/research/M0-handoff.md` until it exists.
- **No counts outside the generated scenario doc**: write "the suite", "every static gate". Fixed decisions (90 % per file, complexity 5) may be repeated.
- **No secret, token, email or Firebase web config** in any document, even as an example. Use placeholders that cannot be mistaken for a credential (`<your-token>` in prose, never a realistic prefix plus random characters).
- **Language**: every Markdown file is in English only (the owner, 2026-11-10; DECISIONS §157): docs, READMEs, skills, the starter kit's and the CLI's READMEs and the Markdown a generator writes (the static export's `README.md` and `RIGHTS.md`). No `*.ro.md`, no Romanian section. A Romanian UI label is quoted where a document names it (with its English gloss), an i18n table keeps its `ro` column, and the photos' own titles are data. The app's texts (the i18n catalogues) stay in every language.
- **Links**: relative Markdown links between documents (for example from `docs/TESTING.md` to the setup guide as a link whose target is `SETUP.md` relative to it), back-ticked repository paths in agent assets. The `agent-assets` gate resolves both.

## Markdown style (markdownlint-cli2 with `.markdownlint-cli2.jsonc`)

The `markdownlint` static gate fails on any finding; prose line length is free (`MD013` off), inline HTML is allowed (`MD033` off).

- One `#` heading per file; headings increase one level at a time and have a blank line before and after; no trailing punctuation in a heading.
- A blank line before and after every list, table and fenced block; every fence names a language (`bash`, `text`, `json`, `ts`).
- Unordered lists use `-`, nested by two spaces; ordered lists are `1.`, `2.`, `3.`.
- Tables: a header separator row, the same number of cells in every row, a blank line around the table.
- No bare URLs: write `<https://example.org>` or a link with descriptive text.
- No hard tabs in Markdown (also not inside shell examples).
- Never a live markdownlint or prettier HTML comment directive: the suppression gate rejects it.
- `docs/research/*.md` is linted too: an appended addendum needs the same blank lines around headings and lists.

Check a change before the pipeline run:

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npx markdownlint-cli2'
```

Then run `PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh` and quote its verdict.
