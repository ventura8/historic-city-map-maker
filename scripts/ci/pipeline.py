#!/usr/bin/env python3
"""Quality pipeline: the single definition of every stage and gate.

Runs only inside the pinned quality image (docker/Dockerfile.quality sets HCM_TEST_IMAGE=1);
scripts/ci/run-all-checks.sh starts the container and scripts/ci/in-container.sh calls

    python3 scripts/ci/pipeline.py --stage <static|tests|e2e|tour-matrix|build|sonar|deps|release|contract|quality|all>

The gates of a stage run from the repository root, several at once (scripts/ci/gate_runner.py: at most
PIPELINE_JOBS, default what the CPUs and the free memory allow, scripts/ci/parallel.py; a gate waits for the gates
in its `needs`, and an `exclusive` gate runs
alone). Their output is printed gate by gate in registry order, each block announced as `static 3/51 eslint` and
closed by `  eslint passed in 27.0s`, so the log reads like a serial run. Every gate runs even after a failure, so
one run lists every problem. A gate that already ran in an earlier stage of the same run (`pytest` and `e2e-matrix`
in `quality`, also `e2e-build` in `all`) is not run again: its outcome is reused. The run ends with
`[SUCCESS] stage 'static' passed` (exit 0, and reports/pipeline/green-static.json records HEAD and a hash of
`git status`) or `[FAILURE] stage 'static' failed: ...` (exit 1), with the failures in registry order.

Extending the pipeline (docs/research/M0-handoff.md): add a `Gate` to `GATES`, then its name to
a stage in `STAGES`. `validate_registry()` (run first, and by the tests) rejects unknown names and
needs that do not come earlier in a stage.
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from functools import partial
from pathlib import Path

from cilog import get_logger
from gate_runner import Console, Outcome, Output, Task, Work, run_tasks
from parallel import this_machine, tool_variables, workers

LOG = get_logger("pipeline")
ROOT = Path(__file__).resolve().parents[2]

IMAGE_MARKER = "HCM_TEST_IMAGE"
JOBS_VARIABLE = "PIPELINE_JOBS"
COMMAND_NOT_FOUND = 127
EXIT_USAGE = 2


@dataclass(frozen=True)
class Gate:
    """A quality gate: `command` runs from the repository root and passes when it exits 0.

    With `files` (git pathspecs), the tracked and untracked-but-not-ignored files matching them
    are appended to the command; when nothing matches, the gate is skipped and counts as passed.
    `needs` names the gates whose output it reads: when they are in the same stage, it starts after
    they finish. An `exclusive` gate runs alone (it saturates the machine or binds fixed ports).
    """

    name: str
    command: tuple[str, ...]
    files: tuple[str, ...] = ()
    needs: tuple[str, ...] = ()
    exclusive: bool = False


NPM_RUN = ("npm", "run", "--silent")
SHELL_FILES = ("*.sh", "scripts/git-hooks/*")
DOCKERFILES = (":(glob)**/Dockerfile", ":(glob)**/Dockerfile.*")
GITLEAKS_REPORT = ("--report-format", "json", "--report-path", "reports/gitleaks.json")
GITLEAKS = ("gitleaks", "dir", "--redact", "--no-banner", "--config", ".gitleaks.toml", *GITLEAKS_REPORT, ".")
# History mode over the commits a CI run introduces (GITLEAKS_LOG_OPTS, computed by .github/workflows/ci.yml): a secret
# added and deleted again inside a push is in history although no longer in the tree. Locally the variable is unset
# (the pre-commit hook scans every staged change instead), and the gate says so and passes. Its own config,
# .gitleaks-history.toml, has no path allowlist (every committed path is scanned); .gitleaksignore names the reviewed
# false positives by fingerprint.
GITLEAKS_HISTORY = (
    'if [[ -z "${GITLEAKS_LOG_OPTS:-}" ]]; then echo "  gitleaks-history: GITLEAKS_LOG_OPTS unset (set by CI); nothing to scan";'
    " exit 0; fi;"
    ' exec gitleaks git --redact --no-banner --config .gitleaks-history.toml --log-opts="$GITLEAKS_LOG_OPTS"'
    " --report-format json --report-path reports/gitleaks-history.json ."
)
WORKFLOWS = (".github/workflows/*.yml", ".github/workflows/*.yaml")
COMPOSITE_ACTIONS = (".github/actions/*/action.yml", ".github/actions/*/action.yaml")
# AGENTS.md workflow rules the GitHub schemas do not cover (no pull_request_target, top-level permissions,
# persist-credentials: false, no ${{ }} inside run: scripts), as a JSON Schema over workflows and composite actions.
WORKFLOW_POLICY = ("check-jsonschema", "--schemafile", "scripts/ci/workflow-policy.schema.json")
ISSUE_FORMS = (".github/ISSUE_TEMPLATE/*.yml", ":(exclude).github/ISSUE_TEMPLATE/config.yml")
SCHEMA = ("check-jsonschema", "--builtin-schema")
FIREBASE_SCHEMA = ("check-jsonschema", "--schemafile", "node_modules/firebase-tools/schema/firebase-config.json")
COVERAGE_GATE = ("scripts/ci/check_coverage.py", "--min", "90", "--summary", "reports/coverage/summary.md", "--badge-dir", ".github/badges")
# Raster pipeline (pipeline/): Poetry and its venv are baked into the quality image (docker/Dockerfile.quality);
# every pipeline command runs from the repository root (pipeline/pyproject.toml holds the pytest, coverage and
# mypy settings). Radon lists only what grades B or worse, so any output fails (Auto-Sub convention); like the
# CI tooling below it covers the tests too, with --no-assert (a test's assert is a check, not a branch).
PIPELINE_VENV = "/opt/hcm/pipeline-venv"
PIPELINE_PYTHON = f"{PIPELINE_VENV}/bin/python"
POETRY = ("env", f"VIRTUAL_ENV={PIPELINE_VENV}", "/opt/hcm/poetry/bin/poetry", "--directory", "pipeline")
PIPELINE_LOCK = (*POETRY, "check", "--lock", "--strict")
PIPELINE_MYPY = ("mypy", "--config-file", "pipeline/pyproject.toml", "--python-executable", PIPELINE_PYTHON)
PIPELINE_RADON = (
    "! radon cc --no-assert --min B --show-complexity pipeline/src pipeline/tests | grep ."
    " && ! radon mi --min B --show pipeline/src pipeline/tests | grep ."
)
PIPELINE_AUDIT = (
    f"pip-audit --progress-spinner off --path {PIPELINE_VENV}/lib/python3.14/site-packages"
    " && pip-audit --no-deps --disable-pip --progress-spinner off -r pipeline/requirements-poetry.txt"
)
PIPELINE_PYTEST = (PIPELINE_PYTHON, "-m", "pytest", "-c", "pipeline/pyproject.toml", "--rootdir", ".")
# CI tooling (scripts/ci, its tests included): Radon grade A, the same bar as ruff C90 and ESLint `complexity` 5.
# --no-assert: ruff S101 already bans assert outside tests, and a test's assert is a check, not a branch.
RADON = "! radon cc --no-assert --min B --show-complexity scripts/ci | grep . && ! radon mi --min B --show scripts/ci | grep ."
# Bandit at medium severity and above over the CI scripts. Its low-severity findings here are the subprocess
# audit markers B404/B603 (the same marker ruff's S603 relaxation in ruff.toml explains: these scripts exist to
# run linters with argument lists from constant tables) and B405 (an xml.etree type import; parsing goes
# through defusedxml). The tests are left out like pipeline-bandit leaves out pipeline/tests.
BANDIT = ("bandit", "-q", "-r", "scripts/ci", "-x", "scripts/ci/tests", "--severity-level", "medium")
# Conventional Commits over the commits a CI run introduces (COMMIT_RANGE, else the GITLEAKS_LOG_OPTS range ci.yml
# computes); a local run has neither and passes with a notice, because scripts/git-hooks/commit-msg checks each commit.
COMMITS = ("python3", "scripts/ci/check_commits.py")
# SonarQube Cloud: the scanner (copied into the image from its pinned image), then the strict verdict of
# sonar_report.py. Without SONAR_TOKEN or .sonar-token the script prints a [SKIP] notice and passes (user convention:
# skipped, not failed); with one, missing coverage reports stop it before any upload.
SONAR = ("bash", "scripts/ci/sonar_scan.sh")
# Latest stable of every npm, PyPI, Docker and GitHub Actions pin (HELD entries aside); network-bound, so only in
# the weekly `deps` stage, never in `quality` or `all`.
DEPENDENCY_UPDATES = ("python3", "scripts/ci/check_dependency_updates.py")
# The release stage's outputs (docs/research/M5-interfaces.md §2.5, §4.6): the pinned addresses with their integrity, and
# the create-historic-city package the user publishes from their own terminal. Nothing here publishes anything.
RELEASE_ADDRESSES = "reports/release/engine-addresses.md"
RELEASE_PACK = "mkdir -p reports/release && npm pack --workspace create-historic-city --pack-destination reports/release"
SELF_HOST_BUNDLE = ("node", "--import", "./scripts/site/register-ts.mjs", "packages/create-historic-city/build-self-host.ts")
# M6: the Firebase Hosting tree from the build stage's own builds (`npm run build:hosting` would build the admin and the
# engine again): dist/hosting-public and dist/hosting (docs/research/M6-interfaces.md §2.1, §2.5)
HOSTING_TREE = ("node", "--import", "./scripts/site/register-ts.mjs", "scripts/site/build-hosting.ts")
# M6: the in-app installer's bundle (docs/research/M6-interfaces.md §1.3) into dist/hosting/admin/install/<slug>/, from the
# stage's own builds (`npm run build:install` would build the functions again), then its tarballs against their budgets
INSTALL_BUNDLE = ("node", "--import", "./scripts/site/register-ts.mjs", "scripts/site/build-install.ts")

GATES: dict[str, Gate] = {
    gate.name: gate
    for gate in (
        # static: cheapest first, network-bound audits last.
        Gate("suppressions", ("python3", "scripts/ci/check_no_inline_suppressions.py")),
        Gate("skill-mirrors", ("python3", "scripts/ci/check_skill_mirrors.py")),
        # docs/ARCHITECTURE.md names only paths that exist, links only files that exist, and has well-formed Mermaid diagrams.
        Gate("architecture", ("python3", "scripts/ci/check_architecture.py")),
        Gate("agent-assets", ("python3", "scripts/ci/check_agent_assets.py")),
        Gate("data-files", ("python3", "scripts/ci/check_data_files.py")),
        # The released engine (cdn/engine/ and its release.json: every file's size and SHA-384) and the starter kit's page
        # (templates/starter-kit/index.html) pin each other exactly; before the first release, the page's pins in shape.
        Gate("kit-pins", ("python3", "scripts/ci/check_kit_pins.py")),
        # The landing page GitHub Pages publishes (sites/landing/, DECISIONS-for-review.md §162) is exactly what
        # `npm run build:landing` writes: both languages complete, the terminal road pinned to this release.
        Gate("landing", (*NPM_RUN, "build:landing", "--", "--check")),
        Gate("firebase-schema", FIREBASE_SCHEMA, files=(":(glob)**/firebase.json",)),
        Gate("editorconfig", ("python3", "scripts/ci/check_editorconfig.py")),
        Gate("e2e-matrix", ("python3", "scripts/ci/check_e2e_matrix.py", "check")),
        Gate("i18n", ("python3", "scripts/ci/check_i18n.py")),
        # Production copy: no test, build or milestone words in any catalogue or user-facing source (check_copy.toml).
        Gate("copy", ("python3", "scripts/ci/check_copy.py")),
        Gate("plain-messages", ("python3", "scripts/ci/check_plain_messages.py")),
        # The kit's self-hosted fonts (packages/ui/fonts) are rebuilt in memory and must match byte for byte; every
        # icon name in packages/ui/src/icons.ts must shape to one glyph of the committed subset (M1 CR-14).
        Gate("fonts", (*NPM_RUN, "fonts:check", "--workspace", "@hcm/ui")),
        Gate("prettier", (*NPM_RUN, "format:check")),
        Gate("tsc", (*NPM_RUN, "typecheck")),
        Gate("eslint", (*NPM_RUN, "lint")),
        Gate("stylelint", (*NPM_RUN, "lint:css")),
        Gate("htmlhint", (*NPM_RUN, "lint:html", "--"), files=("*.html",)),
        Gate("html-validate", (*NPM_RUN, "lint:html:validate", "--"), files=("*.html",)),
        Gate("markdownlint", (*NPM_RUN, "lint:md")),
        Gate("knip", (*NPM_RUN, "lint:knip")),
        Gate("dependency-cruiser", (*NPM_RUN, "lint:deps")),
        Gate("yamllint", ("yamllint", "--strict", ".")),
        Gate("taplo-fmt", ("taplo", "fmt", "--check")),
        Gate("taplo-lint", ("taplo", "lint")),
        Gate("ruff-check", ("ruff", "check", ".")),
        Gate("ruff-format", ("ruff", "format", "--check", ".")),
        Gate("mypy", ("mypy",)),
        Gate("radon", ("bash", "-c", RADON)),
        Gate("bandit", BANDIT),
        Gate("pipeline-lock", PIPELINE_LOCK),
        Gate("pipeline-mypy", PIPELINE_MYPY),
        Gate("pipeline-radon", ("bash", "-c", PIPELINE_RADON)),
        Gate("pipeline-bandit", ("bandit", "-q", "-r", "pipeline/src")),
        Gate("shellcheck", ("shellcheck", "-x", "--severity=style"), files=SHELL_FILES),
        Gate("shfmt", ("shfmt", "-d"), files=SHELL_FILES),
        Gate("hadolint", ("hadolint", "--failure-threshold", "warning", "--disable-ignore-pragma"), files=DOCKERFILES),
        Gate("actionlint", ("actionlint",), files=WORKFLOWS),
        Gate("workflow-schema", ("check-jsonschema", "--builtin-schema", "vendor.github-workflows"), files=WORKFLOWS),
        Gate("workflow-timeouts", (*SCHEMA, "custom.github-workflows-require-timeout"), files=WORKFLOWS),
        Gate("action-schema", (*SCHEMA, "vendor.github-actions"), files=(".github/actions/*/action.yml",)),
        Gate("issue-forms-schema", (*SCHEMA, "vendor.github-issue-forms"), files=ISSUE_FORMS),
        Gate("issue-config-schema", (*SCHEMA, "vendor.github-issue-config"), files=(".github/ISSUE_TEMPLATE/config.yml",)),
        Gate("action-pins", ("python3", "scripts/ci/check_action_pins.py")),
        Gate("workflow-policy", WORKFLOW_POLICY, files=(*WORKFLOWS, *COMPOSITE_ACTIONS)),
        Gate("repo-policy", ("python3", "scripts/ci/check_repo_policy.py")),
        Gate("repo-budget", ("python3", "scripts/ci/check_repo_budget.py")),
        Gate("gitleaks", GITLEAKS),
        Gate("gitleaks-history", ("bash", "-c", GITLEAKS_HISTORY)),
        Gate("commits", COMMITS),
        Gate("npm-audit", ("npm", "audit", "--audit-level=low")),
        # The Cloud Functions deploy artifact's own locked tree (functions/deploy-lock, copied into functions/dist by
        # functions/build.mjs): what Cloud Build installs is audited like the workspace (DECISIONS-for-review.md §22b).
        Gate("deploy-lock-audit", ("npm", "audit", "--audit-level=low", "--prefix", "functions/deploy-lock")),
        Gate("pip-audit", ("pip-audit", "--no-deps", "--disable-pip", "--progress-spinner", "off", "-r", "scripts/ci/requirements.txt")),
        Gate("pipeline-pip-audit", ("bash", "-c", PIPELINE_AUDIT)),
        # tests
        # `npm test` runs every Vitest project under `firebase emulators:exec` (scripts/ci/run-emulated-tests.sh)
        # and saves the Firestore rule-coverage report that `rules-coverage` then checks.
        Gate("vitest", (*NPM_RUN, "test")),
        Gate("rules-coverage", ("python3", "scripts/ci/check_rules_coverage.py", "check"), needs=("vitest",)),
        Gate("pytest", ("python3", "-m", "pytest")),
        Gate("pipeline-pytest", PIPELINE_PYTEST),
        Gate("coverage", ("python3", *COVERAGE_GATE), needs=("vitest", "pytest", "pipeline-pytest")),
        # e2e: the engine and the e2e sites (dist/e2e-site, the fixture manifest; `npm run build:site:e2e`, skipped while
        # its stamp shows no input changed and no output was touched), then Playwright (e2e/playwright.config.ts; E2E_TIER
        # picks the tiers, unset is every push's) in the image's Chromium, behind the firewall fixture
        Gate("e2e-build", ("python3", "scripts/ci/e2e_build.py")),
        # Eight browser workers saturate the machine, and its servers and emulators bind fixed ports: it runs alone.
        Gate("playwright", (*NPM_RUN, "test:e2e"), needs=("e2e-build",), exclusive=True),
        # tour-matrix (in `all`, and nightly): the tour's other 35 viewport, theme and language projects
        Gate("playwright-tour-matrix", ("env", "E2E_TIER=tour-matrix", *NPM_RUN, "test:e2e"), needs=("e2e-build",), exclusive=True),
        # build
        Gate("vite-build", (*NPM_RUN, "build")),
        Gate("bundle-budget", ("python3", "scripts/ci/check_bundle_budget.py"), needs=("vite-build",)),
        # Each build's THIRD_PARTY_NOTICES.txt against its source maps: every bundled package (and the fonts' packages)
        # with its licence text, nothing else, permissive licences only (DECISIONS-for-review.md §52d)
        Gate("notices", ("python3", "scripts/ci/check_notices.py"), needs=("vite-build",)),
        # The static city sites for GitHub Pages (dist/site/bucharest, dist/site/starter-kit) from the engine build
        Gate("site-build", (*NPM_RUN, "build:site"), needs=("vite-build",)),
        # The Firebase Hosting tree (M6): the public map at the root, the other cities and the generic city page, the admin
        # under /admin/, release.json and 404.html, in its public variant (a deploy's HCM_ADMIN_START_UP=1 never reaches
        # the image, so dist/hosting is the public variant too)
        Gate("hosting-build", HOSTING_TREE, needs=("vite-build",)),
        # The in-app installer's bundle (M6) in the Hosting tree: server.tgz, pipeline.tgz, hosting.tgz and manifest.json,
        # deterministic, then each tarball within its budget (DECISIONS-for-review.md §71)
        Gate("install-build", INSTALL_BUNDLE, needs=("hosting-build",)),
        Gate("install-budget", ("python3", "scripts/ci/check_bundle_budget.py", "--install"), needs=("install-build",)),
        # The start site (M14, docs/research/M14-start-your-map.md): the page and a release that names no project, from the
        # same public tree and functions: refuses a tree it cannot make generic
        Gate("start-build", (*NPM_RUN, "build:start"), needs=("hosting-build",)),
        # release: the tag agrees with every version (workspace dependencies and ENGINE_VERSION included), the released
        # engine's release.json, the kit's pinned folder, both release-notes files and the description's pinned addresses
        Gate("release-check", ("python3", "scripts/ci/check_release.py")),
        # cdn/engine/ is byte for byte the release folder of the fresh engine build (docs/research/M5-interfaces.md §2.3);
        # the check also writes the pinned addresses and their integrity, which release.yml shows in its job summary
        Gate("release-cdn", (*NPM_RUN, "release:cdn", "--", "--check", "--summary", RELEASE_ADDRESSES), needs=("vite-build",)),
        # create-historic-city's self-host bundle (dist/self-host/) from that production build: the vite build of the CLI
        # empties its dist/, and the admin's e2e build writes the same folder, which the bundle refuses (docs/LESSONS.md 247).
        # Its hosting folder is the start site's release tree: without its install bundle and city page a self-hosted
        # project could not publish its map (M14)
        Gate("self-host-bundle", SELF_HOST_BUNDLE, needs=("vite-build", "start-build")),
        # create-historic-city's package from that build, its self-host bundle in it, for the publish (M5-interfaces §4.6)
        Gate("release-pack", ("bash", "-c", RELEASE_PACK), needs=("vite-build", "self-host-bundle")),
        # contract (weekly, network): Setup Assistant deep links and third-party API shapes
        Gate("contracts", ("python3", "scripts/ci/check_contracts.py")),
        # sonar (part of `all`): SonarQube Cloud analysis and the strict verdict; skipped without a token
        Gate("sonar", SONAR),
        # deps (weekly, network): every pin on its latest stable release
        Gate("dependency-updates", DEPENDENCY_UPDATES),
    )
}

STAGES: dict[str, tuple[str, ...]] = {
    "static": (
        "suppressions",
        "skill-mirrors",
        "architecture",
        "agent-assets",
        "data-files",
        "kit-pins",
        "landing",
        "firebase-schema",
        "editorconfig",
        "e2e-matrix",
        "i18n",
        "fonts",
        "copy",
        "plain-messages",
        "prettier",
        "tsc",
        "eslint",
        "stylelint",
        "htmlhint",
        "html-validate",
        "markdownlint",
        "knip",
        "dependency-cruiser",
        "yamllint",
        "taplo-fmt",
        "taplo-lint",
        "ruff-check",
        "ruff-format",
        "mypy",
        "radon",
        "bandit",
        "pipeline-lock",
        "pipeline-mypy",
        "pipeline-radon",
        "pipeline-bandit",
        "shellcheck",
        "shfmt",
        "hadolint",
        "actionlint",
        "workflow-schema",
        "workflow-timeouts",
        "action-schema",
        "issue-forms-schema",
        "issue-config-schema",
        "action-pins",
        "workflow-policy",
        "repo-policy",
        "repo-budget",
        "gitleaks",
        "gitleaks-history",
        "commits",
        # The CI tooling's own tests (scripts/ci/tests), so a tooling-only change is gated by `static`
        # (quality-conventions.md §4 gate 24); `tests` lists them too (its coverage gate reads their report),
        # and a run of `quality` or `all` reuses this outcome there instead of running them twice.
        "pytest",
        "npm-audit",
        "deploy-lock-audit",
        "pip-audit",
        "pipeline-pip-audit",
    ),
    # The per-file coverage gate reads the reports the test runners just wrote.
    "tests": ("vitest", "rules-coverage", "pytest", "pipeline-pytest", "coverage"),
    # The registry check first (the scenario ids the specs carry), then the sites the specs open, then the specs.
    "e2e": ("e2e-matrix", "e2e-build", "playwright"),
    # The rest of the tour matrix (e2e/projects.ts, tier `tour-matrix`): every scenario row already ran in `e2e`; these
    # projects repeat the tour at the other viewport, theme and language combinations before a push to master or a tag.
    "tour-matrix": ("e2e-matrix", "e2e-build", "playwright-tour-matrix"),
    "build": ("vite-build", "bundle-budget", "notices", "site-build", "hosting-build", "install-build", "install-budget", "start-build"),
    # Needs the reports of `tests` (`all` runs it last). A stage left empty would FAIL:
    # it must never report green for work that does not exist yet.
    "sonar": ("sonar",),
    # Weekly drift (.github/workflows/deps.yml); like contract, never part of quality or all.
    "deps": ("dependency-updates",),
    "release": (
        "release-check",
        "kit-pins",
        "vite-build",
        "release-cdn",
        "bundle-budget",
        "notices",
        "hosting-build",
        "start-build",
        "self-host-bundle",
        "release-pack",
    ),
    # Weekly third-party drift (.github/workflows/contract.yml); like deps, never part of quality or all.
    "contract": ("contracts",),
}

COMPOSITE_STAGES: dict[str, tuple[str, ...]] = {
    "quality": ("static", "tests", "e2e", "build"),
    # quality's stages with the rest of the tour matrix after e2e (its e2e build is still current there, and `build`'s
    # production output stays what the run leaves behind), then sonar.
    "all": ("static", "tests", "e2e", "tour-matrix", "build", "sonar"),
}

NPM_CI = ("npm", "ci", "--prefer-offline", "--no-audit", "--no-fund")
INSTALL_STAMP = Path("node_modules", ".hcm-install-stamp")

Runner = Callable[[Sequence[str], Output], int]
Capture = Callable[[Sequence[str]], str]


def write_stdout(text: str) -> None:
    """Prints gate output on the stream the log lines use, flushed, so the two stay in order."""
    sys.stdout.write(text)
    sys.stdout.flush()


@dataclass(frozen=True)
class Context:
    """Where and how commands run; tests pass fakes instead of subprocess-backed callables.

    `run(argv, out)` runs a command, hands its merged stdout and stderr to `out` and returns its exit status;
    `write` prints (gate output, the install's output); `jobs` is how many gates may run at once.
    """

    root: Path
    run: Runner
    capture: Capture
    write: Output = write_stdout
    jobs: int = 1


def run_command(argv: Sequence[str], out: Output, cwd: Path) -> int:
    """Runs `argv` in `cwd` without stdin, handing each line of its stdout and stderr to `out`; a missing executable exits 127."""
    try:
        with subprocess.Popen(list(argv), cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT) as process:
            for line in process.stdout or ():
                out(line.decode("utf-8", "replace"))
            return process.wait()
    except FileNotFoundError:
        out(f"  command not found: {argv[0]}\n")
        return COMMAND_NOT_FOUND


def capture_output(argv: Sequence[str], cwd: Path) -> str:
    """Runs `argv` in `cwd` and returns its stdout; raises CalledProcessError on a non-zero exit."""
    return subprocess.run(list(argv), cwd=cwd, check=True, capture_output=True, text=True).stdout


def default_jobs(environ: Mapping[str, str] = os.environ) -> int:
    """PIPELINE_JOBS when it is a positive integer (1 runs the gates one at a time), else what the CPUs and the free memory allow
    (`parallel.py`: a gate per CPU and per 2 GiB available; `HCM_MAX_PARALLEL` caps it, `HCM_LOW_MEM=1` runs one at a time)."""
    value = environ.get(JOBS_VARIABLE, "").strip()
    if value.isdecimal() and int(value) > 0:
        return int(value)
    return workers("gates", environ, this_machine())


def default_context(root: Path = ROOT, jobs: int = 0) -> Context:
    run = partial(run_command, cwd=root)
    return Context(root=root, run=run, capture=partial(capture_output, cwd=root), jobs=jobs or default_jobs())


def all_stage_names() -> list[str]:
    return sorted([*STAGES, *COMPOSITE_STAGES])


def _unknown_gates() -> list[str]:
    return [f"stage '{stage}' uses unknown gate '{gate}'" for stage, gates in STAGES.items() for gate in gates if gate not in GATES]


def _duplicated_gates() -> list[str]:
    return [f"stage '{stage}' lists gate '{gate}' twice" for stage, gates in STAGES.items() for gate in set(gates) if gates.count(gate) > 1]


def _composite_problems() -> list[str]:
    known = set(STAGES) | set(COMPOSITE_STAGES)
    clashes = [f"stage name '{name}' is both simple and composite" for name in sorted(set(STAGES) & set(COMPOSITE_STAGES))]
    unknown = [
        f"composite '{name}' uses unknown stage '{part}'" for name, parts in COMPOSITE_STAGES.items() for part in parts if part not in known
    ]
    return clashes + unknown


def _unknown_needs() -> list[str]:
    return [f"gate '{gate.name}' needs unknown gate '{need}'" for gate in GATES.values() for need in gate.needs if need not in GATES]


def _needs_of(gates: Sequence[str]) -> list[tuple[str, str]]:
    return [(name, need) for name in gates if name in GATES for need in GATES[name].needs]


def _late_needs_in(stage: str, gates: Sequence[str]) -> list[str]:
    first = {name: index for index, name in reversed(list(enumerate(gates)))}
    late = [(name, need) for name, need in _needs_of(gates) if first.get(need, -1) > first[name]]
    return [f"stage '{stage}' lists gate '{need}' after '{name}', which needs it" for name, need in late]


def _late_needs() -> list[str]:
    """A gate's needs run first: in every stage that lists both, the needed gate must come before it."""
    return [problem for stage, gates in STAGES.items() for problem in _late_needs_in(stage, gates)]


def validate_registry() -> list[str]:
    """Problems in GATES/STAGES/COMPOSITE_STAGES: unknown or duplicated names, misplaced needs (empty when consistent)."""
    return [*_unknown_gates(), *_duplicated_gates(), *_composite_problems(), *_unknown_needs(), *_late_needs()]


def expand_stage(name: str) -> list[str]:
    """The simple stages a stage name stands for, in run order (`all` -> static, tests, e2e, build, sonar)."""
    if name in STAGES:
        return [name]
    return [simple for part in COMPOSITE_STAGES[name] for simple in expand_stage(part)]


def list_files(pathspecs: Sequence[str], ctx: Context) -> list[str]:
    """Existing files matching `pathspecs`: tracked ones plus untracked ones that are not ignored."""
    output = ctx.capture(("git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", *pathspecs))
    names = sorted({name for name in output.split("\0") if name})
    return [name for name in names if (ctx.root / name).is_file()]


@dataclass(frozen=True)
class Ran:
    """A gate that already ran in this run: the stage that ran it and its outcome."""

    stage: str
    outcome: Outcome


@dataclass(frozen=True)
class Step:
    """A gate as a stage runs it: its command with the matched files, or why it does not run here.

    `skipped`: a file gate that matched no file (a pass). `ran`: an earlier stage of the same run already ran it.
    """

    gate: Gate
    argv: tuple[str, ...]
    skipped: bool = False
    ran: Ran | None = None


def plan_step(gate: Gate, ctx: Context, ran: Mapping[str, Ran]) -> Step:
    if gate.name in ran:
        return Step(gate, gate.command, ran=ran[gate.name])
    if not gate.files:
        return Step(gate, gate.command)
    files = list_files(gate.files, ctx)
    return Step(gate, (*gate.command, *files), skipped=not files)


def _known_result(code: int, _out: Output) -> int:
    return code


def step_work(step: Step, ctx: Context) -> Work:
    """What a step's task does: run its command, or report the result already known without running anything."""
    if step.ran is not None:
        return partial(_known_result, step.ran.outcome.code)
    if step.skipped:
        return partial(_known_result, 0)
    return partial(ctx.run, step.argv)


def _result(code: int) -> str:
    return "passed" if code == 0 else f"FAILED (exit {code})"


def closing_line(step: Step, outcome: Outcome) -> str:
    """The line under a gate's output: skipped, reused from an earlier stage, or passed/FAILED with its own run time."""
    name = step.gate.name
    if step.skipped:
        return f"  {name} skipped: no files match {' '.join(step.gate.files)}"
    if step.ran is not None:
        return f"  {name} {_result(outcome.code)} in stage '{step.ran.stage}' of this run ({step.ran.outcome.seconds:.1f}s); not run again"
    return f"  {name} {_result(outcome.code)} in {outcome.seconds:.1f}s"


def _task(step: Step, ctx: Context, names: Sequence[str]) -> Task:
    needs = tuple(need for need in step.gate.needs if need in names)
    return Task(step.gate.name, step_work(step, ctx), needs=needs, exclusive=step.gate.exclusive)


def _console(stage: str, steps: Sequence[Step], ctx: Context) -> Console:
    def opened(index: int) -> None:
        LOG.info("%s %d/%d %s", stage, index + 1, len(steps), steps[index].gate.name)

    def closed(index: int, outcome: Outcome) -> None:
        LOG.info("%s", closing_line(steps[index], outcome))

    return Console(write=ctx.write, opened=opened, closed=closed)


def _summary(stage: str, outcomes: Sequence[Outcome], started: float, ctx: Context) -> None:
    wall_clock = time.monotonic() - started
    gate_time = sum(outcome.seconds for outcome in outcomes)
    LOG.info("%s finished in %.1fs (gate time %.1fs, %d gates, up to %d at once)", stage, wall_clock, gate_time, len(outcomes), ctx.jobs)


def _run_gates(stage: str, names: Sequence[str], ctx: Context, ran: dict[str, Ran]) -> list[Outcome]:
    steps = [plan_step(GATES[name], ctx, ran) for name in names]
    started = time.monotonic()
    outcomes = run_tasks([_task(step, ctx, names) for step in steps], ctx.jobs, _console(stage, steps, ctx))
    _summary(stage, outcomes, started, ctx)
    ran.update({outcome.name: Ran(stage, outcome) for outcome in outcomes if outcome.name not in ran})
    return outcomes


def run_stage(stage: str, ctx: Context, ran: dict[str, Ran] | None = None) -> list[str]:
    """Runs every gate of a simple stage; returns the failed `stage/gate` names in registry order.

    `ran` maps the gates earlier stages of this run ran to their outcome; this stage reuses those and adds its own.
    """
    names = STAGES[stage]
    if not names:
        LOG.error("%s: no gates registered yet (docs/research/M0-handoff.md)", stage)
        return [f"{stage} (no gates registered)"]
    outcomes = _run_gates(stage, names, ctx, {} if ran is None else ran)
    return [f"{stage}/{outcome.name}" for outcome in outcomes if outcome.code != 0]


def ensure_node_modules(ctx: Context) -> bool:
    """`npm ci` when node_modules was not installed from the current package-lock.json by this pipeline.

    The image bakes the npm cache, so the install is offline and fast; the stamp makes repeated
    runs free. Delete node_modules/.hcm-install-stamp to force a reinstall.
    """
    lockfile = ctx.root / "package-lock.json"
    if not lockfile.is_file():
        return True
    digest = hashlib.sha256(lockfile.read_bytes()).hexdigest()
    stamp = ctx.root / INSTALL_STAMP
    if stamp.is_file() and stamp.read_text(encoding="utf-8").strip() == digest:
        return True
    LOG.info("setup: npm ci (node_modules missing or older than package-lock.json)")
    if ctx.run(NPM_CI, ctx.write) != 0:
        return False
    stamp.write_text(digest + "\n", encoding="utf-8")
    return True


def git_head(ctx: Context) -> str:
    try:
        return ctx.capture(("git", "rev-parse", "HEAD")).strip()
    except subprocess.CalledProcessError:
        return "unborn"


def write_green_marker(stage: str, ctx: Context) -> Path:
    """reports/pipeline/green-<stage>.json: HEAD plus a hash of `git status`, read by the pre-push hook."""
    status = ctx.capture(("git", "status", "--porcelain=v1", "--untracked-files=all"))
    marker = ctx.root / "reports" / "pipeline" / f"green-{stage}.json"
    marker.parent.mkdir(parents=True, exist_ok=True)
    payload = {"stage": stage, "head": git_head(ctx), "status_sha256": hashlib.sha256(status.encode("utf-8")).hexdigest()}
    marker.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return marker


def verdict(stage: str, failures: Sequence[str], ctx: Context) -> int:
    """Logs the final verdict line; a pass also writes the green marker."""
    if failures:
        LOG.error("[FAILURE] stage '%s' failed: %s", stage, ", ".join(failures))
        return 1
    marker = write_green_marker(stage, ctx)
    LOG.info("[SUCCESS] stage '%s' passed (%s)", stage, marker.relative_to(ctx.root))
    return 0


def run_pipeline(stage: str, ctx: Context) -> int:
    if not ensure_node_modules(ctx):
        return verdict(stage, ["setup/npm-ci"], ctx)
    ran: dict[str, Ran] = {}
    return verdict(stage, [failure for simple in expand_stage(stage) for failure in run_stage(simple, ctx, ran)], ctx)


def describe_registry() -> None:
    for stage in all_stage_names():
        parts = COMPOSITE_STAGES.get(stage) or STAGES[stage] or ("(no gates yet)",)
        LOG.info("%-8s %s", stage, " ".join(parts))


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run one quality-pipeline stage inside the quality image.")
    parser.add_argument("--stage", choices=all_stage_names(), help="stage to run")
    parser.add_argument("--list", action="store_true", help="print every stage with its gates and exit")
    return parser.parse_args(argv)


def report_registry(problems: Sequence[str]) -> int:
    """`--list` output, also printed when the registry is inconsistent (then exit 2)."""
    for problem in problems:
        LOG.error("[ERROR] pipeline registry: %s", problem)
    describe_registry()
    return EXIT_USAGE if problems else 0


def can_run(stage: str | None) -> bool:
    """Gates run only inside the quality image, which is the only place with the pinned toolchain."""
    return stage is not None and os.environ.get(IMAGE_MARKER) == "1"


def main(argv: Sequence[str] | None = None, ctx: Context | None = None) -> int:
    args = parse_args(argv)
    problems = validate_registry()
    if problems or args.list:
        return report_registry(problems)
    if not can_run(args.stage):
        LOG.error("[ERROR] run `PIPELINE_STAGE=<stage> bash scripts/ci/run-all-checks.sh` (needs --stage, inside the quality image)")
        return EXIT_USAGE
    # The tools' own parallelism (ESLint, Vitest, Playwright) follows the free memory too, unless the caller set it.
    os.environ.update(tool_variables(os.environ, this_machine()))
    return run_pipeline(args.stage, ctx or default_context())


if __name__ == "__main__":
    sys.exit(main())
