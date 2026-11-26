#!/usr/bin/env python3
"""The stamped e2e build: gate `e2e-build` of the `e2e` and `tour-matrix` stages.

Runs `npm run build:site:e2e` (the engine, the create-historic-city CLI the starter-kit specs run, the Cloud Functions
artifact the emulators load, the admin's e2e bundle, then the e2e sites, the admin's Hosting folder and, since M6, the e2e
Firebase Hosting tree in both variants: e2e/scripts/build-site.ts) unless its stamp shows that nothing the build reads
changed and nothing it wrote was touched since the last build on this machine. The stamp,
node_modules/.cache/hcm/e2e-build.json (so `npm ci` drops it), holds two digests:

* the inputs: git's blob id and path of every file of the working tree (tracked, and untracked but not ignored) that
  the build can read, plus `E2E_TIER` (before M6 the admin's Hosting folder was built only for a run with the admin
  tier; every run builds it now, as the e2e Hosting tree holds it). A file that `NOT_INPUTS` forgets only costs a rebuild;
* the outputs: the name, size and modification time of every file in the build's output folders, so another build
  that rewrites one (the `build` stage's production admin in packages/admin/dist) makes the next e2e build run again.

Usage: e2e_build.py [--root DIR]
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from collections.abc import Callable, Sequence
from pathlib import Path

from cilog import get_logger
from cirepo import GIT, ROOT

LOG = get_logger("e2e-build")

STAMP = Path("node_modules", ".cache", "hcm", "e2e-build.json")
# The build itself (package.json stays the one place of its steps).
BUILD = ("npm", "run", "--silent", "build:site:e2e")
OUTPUTS = (
    "dist/e2e-site",
    "dist/e2e-hosting",
    "dist/e2e-hosting-start-up",
    "dist/e2e-start",
    "dist/start-app",
    "packages/engine/dist",
    "packages/create-historic-city/dist",
    "functions/dist",
    "packages/admin/dist",
)
# Files the build never reads: documentation, CI and agent assets, the raster pipeline, the tests and the e2e specs,
# fixtures of the run and servers (they run from source when Playwright starts, not from the build), and the local stack
# for manual testing (e2e/stack/, run from source by scripts/dev/dev-stack.sh after this build).
NOT_INPUTS = re.compile(
    r"^(?:(?:docs|pipeline|docker|\.agents?|\.claude|\.github)/"
    r"|scripts/(?:ci|dev|git-hooks)/"
    r"|e2e/(?:specs|tour|a11y|setup|support|mock-apis|stack|admin/(?:specs|harness|setup|support))/"
    r"|e2e/(?:scenarios\.json|playwright\.config\.ts)$"
    r"|(?:firebase/rules-tests|functions/test|scripts/site/test)/"
    r"|packages/[^/]+/(?:scripts/)?test/"
    r"|[^/]+\.md$)"
)

Builder = Callable[[Path], int]


def git(root: Path, args: Sequence[str], stdin: str = "") -> str:
    return subprocess.run([GIT, *args], cwd=root, input=stdin, check=True, capture_output=True, text=True).stdout


def input_files(root: Path) -> list[str]:
    """The files of the working tree the build may read, sorted."""
    listed = git(root, ("ls-files", "-z", "--cached", "--others", "--exclude-standard")).split("\0")
    return sorted({name for name in listed if name and not NOT_INPUTS.match(name) and (root / name).is_file()})


def digest(lines: Sequence[str]) -> str:
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


def inputs_digest(root: Path, tier: str) -> str:
    files = input_files(root)
    blobs = git(root, ("hash-object", "--stdin-paths"), "".join(f"{name}\n" for name in files)).split()
    return digest([f"E2E_TIER={tier}", *(f"{blob} {name}" for name, blob in zip(files, blobs, strict=True))])


def outputs_digest(root: Path) -> str:
    files = sorted(path for folder in OUTPUTS for path in (root / folder).rglob("*") if path.is_file())
    return digest([f"{path.relative_to(root).as_posix()} {path.stat().st_size} {path.stat().st_mtime_ns}" for path in files])


def read_stamp(path: Path) -> dict[str, str]:
    """The stamp's digests, or nothing when it is missing or unreadable."""
    try:
        stamp = json.loads(path.read_text(encoding="utf-8"))
    except OSError, ValueError:
        return {}
    return stamp if isinstance(stamp, dict) else {}


def run_build(root: Path) -> int:
    return subprocess.run(BUILD, cwd=root, check=False).returncode


def is_current(root: Path, inputs: str) -> bool:
    stamp = read_stamp(root / STAMP)
    return stamp.get("inputs") == inputs and stamp.get("outputs") == outputs_digest(root)


def stamped_build(root: Path, tier: str, build: Builder) -> int:
    """Builds unless the stamp is current; a passing build writes a new stamp, a failing one leaves none."""
    inputs = inputs_digest(root, tier)
    stamp = root / STAMP
    if is_current(root, inputs):
        LOG.info("  e2e build current: no input changed and no output was touched since %s", STAMP.as_posix())
        return 0
    stamp.unlink(missing_ok=True)
    code = build(root)
    if code != 0:
        LOG.error("  e2e build failed: %s (exit %d)", " ".join(BUILD), code)
        return code
    stamp.parent.mkdir(parents=True, exist_ok=True)
    stamp.write_text(json.dumps({"inputs": inputs, "outputs": outputs_digest(root)}, indent=2) + "\n", encoding="utf-8")
    return 0


def main(argv: Sequence[str] | None = None, build: Builder = run_build) -> int:
    parser = argparse.ArgumentParser(description="Run the e2e build unless nothing it reads or writes changed.")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root")
    args = parser.parse_args(argv)
    return stamped_build(args.root.resolve(), os.environ.get("E2E_TIER", ""), build)


if __name__ == "__main__":
    sys.exit(main())
