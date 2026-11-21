#!/usr/bin/env python3
"""Release gate (stage `release`, run by .github/workflows/release.yml on a v* tag): the tag being
released agrees with the repository before anything is published (docs/research/M5-interfaces.md §2.2).

- Exactly one tag `vMAJOR.MINOR.PATCH`, or a pre-release `vMAJOR.MINOR.PATCH-beta.N` / `-rc.N`, points at HEAD
  (or `--tag` names it, to check before tagging); no other pre-release and no build suffix.
- The root package.json, every workspace package.json and ENGINE_VERSION in
  packages/engine/src/index.ts carry that version, and so does every dependency of a workspace on
  another workspace (npm resolves a workspace only at its exact version).
- The released engine is in the tree for that version: cdn/engine/release.json names it (its files
  and integrity are the `kit-pins` gate's, the byte-equal rebuild the `release-cdn` gate's), and the
  starter kit's page (templates/starter-kit/index.html) pins the jsDelivr folder of that tag.
- The guides that tell a reader to run the CLI from npm name this release exactly
  (`npx create-historic-city@X.Y.Z`, never a major line such as `@1`: docs/LESSONS.md 238); `PINNED_DOCS` is the
  list scripts/release/src/versions.ts's bump rewrites.
- Both release-notes files exist and are not empty (docs/releases/README.md):
  docs/releases/vX.Y.Z.md and docs/releases/vX.Y.Z_github_description.md (the GitHub Release body),
  and the description's pinned addresses and their integrity are exactly release.json's
  (`npm run release:notes -- --write <file>` writes them).

Usage: check_release.py [--root DIR] [--tag vX.Y.Z]. Exit status: 0 consistent, 1 problems found,
2 usage (argparse).
"""

import argparse
import json
import re
import subprocess
import sys
from collections.abc import Callable, Sequence
from pathlib import Path

from cilog import get_logger
from cirepo import GIT
from release_pins import (
    KIT_PAGE,
    RELEASE_JSON,
    RELEASE_VERSION,
    PinError,
    base_version,
    expected_pins,
    page_base,
    read_json_object,
    read_kit_page,
)

LOG = get_logger("release")
ROOT = Path(__file__).resolve().parents[2]
ENGINE_INDEX = Path("packages", "engine", "src", "index.ts")
RELEASE_NOTES = Path("docs", "releases")
SEMVER_TAG = re.compile(rf"^v{RELEASE_VERSION}$")
ENGINE_VERSION = re.compile(r"ENGINE_VERSION\s*=\s*'([^']*)'")
DEPENDENCY_FIELDS = ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies")
SRI_TOKEN = re.compile(r"sha384-[A-Za-z0-9+/]{64}")
URL_TOKEN = re.compile(r"`(https://[^`\s]+)`")
WRITE_NOTES = "npm run release:notes -- --write"
# The same list as PINNED_DOCS of scripts/release/src/versions.ts (tests/test_check_release.py compares them).
PINNED_DOCS = (
    "README.md",
    "docs/ENGINE_API.md",
    "docs/MANUAL_TEST_PLAN.md",
    "docs/SELF_HOST.md",
    "packages/create-historic-city/README.md",
    "sites/landing/index.html",
    "sites/landing/ro.html",
    "starter-kit/README.md",
    "templates/starter-kit/README.md",
)
CLI_PIN = re.compile(r"(?<![\w-])(?:create-)?historic-city@(\d+\.\d+\.\d+(?:-(?:beta|rc)\.\d+)?)(?![\w.])")

Capture = Callable[[Sequence[str]], str]


class ReleaseError(Exception):
    """A manifest that cannot be read as a JSON object."""


def git_capture(root: Path) -> Capture:
    def capture(argv: Sequence[str]) -> str:
        return subprocess.run([GIT, "-C", str(root), *argv], check=True, capture_output=True, text=True).stdout

    return capture


def head_tags(capture: Capture) -> list[str]:
    """The v* tags that point at HEAD (annotated or lightweight); none outside a repository."""
    try:
        output = capture(("tag", "--points-at", "HEAD", "--list", "v*"))
    except OSError, subprocess.CalledProcessError:
        return []
    return sorted(line.strip() for line in output.splitlines() if line.strip())


def pick_tag(tags: Sequence[str]) -> tuple[str | None, list[str]]:
    """(the tag to release, problems): exactly one tag must point at HEAD."""
    if len(tags) == 1:
        return tags[0], []
    if not tags:
        return None, ["no v* tag points at HEAD: tag the release commit, or pass --tag vX.Y.Z to check before tagging"]
    return None, [f"several v* tags point at HEAD ({', '.join(tags)}): a commit is released once"]


def read_manifest(path: Path) -> dict[str, object]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ReleaseError(f"{path}: cannot read it as JSON ({error})") from error
    if not isinstance(document, dict):
        raise ReleaseError(f"{path}: expected a JSON object")
    return document


def workspace_dirs(root: Path, patterns: list[object]) -> set[Path]:
    """Every directory below root that one of the `workspaces` globs matches."""
    return {path for pattern in patterns for path in root.glob(str(pattern))}


def workspace_manifests(root: Path) -> list[Path]:
    """The root package.json, then the package.json of every directory its `workspaces` globs match."""
    patterns = read_manifest(root / "package.json").get("workspaces", [])
    if not isinstance(patterns, list):
        raise ReleaseError(f"{root / 'package.json'}: `workspaces` must be an array of globs")
    manifests = (directory / "package.json" for directory in workspace_dirs(root, patterns))
    return [root / "package.json", *sorted(manifest for manifest in manifests if manifest.is_file())]


def manifest_problems(root: Path, version: str) -> list[str]:
    versions = {manifest: read_manifest(manifest).get("version") for manifest in workspace_manifests(root)}
    return [
        f"{manifest.relative_to(root)}: version {found!r}, the tag says {version!r}"
        for manifest, found in versions.items()
        if found != version
    ]


def dependency_specs(manifest: dict[str, object]) -> dict[str, object]:
    """Every dependency a manifest declares, by name, with the version it asks for."""
    fields = [manifest.get(field) for field in DEPENDENCY_FIELDS]
    return {name: spec for found in fields if isinstance(found, dict) for name, spec in found.items()}


def only(specs: dict[str, object], names: set[str]) -> dict[str, object]:
    return {name: spec for name, spec in specs.items() if name in names}


def workspace_specs(root: Path) -> dict[Path, dict[str, object]]:
    """Every workspace manifest (relative to root) with its dependencies on the other workspaces."""
    manifests = {path: read_manifest(path) for path in workspace_manifests(root)[1:]}
    names = {str(manifest.get("name")) for manifest in manifests.values()}
    return {path.relative_to(root): only(dependency_specs(manifest), names) for path, manifest in manifests.items()}


def workspace_dependencies(root: Path) -> list[tuple[Path, str, object]]:
    """(workspace manifest, workspace it depends on, the version it asks for) for every such dependency."""
    return [(path, name, spec) for path, found in workspace_specs(root).items() for name, spec in found.items()]


def dependency_problems(root: Path, version: str) -> list[str]:
    """Every dependency of a workspace on another workspace asks for exactly `version`."""
    stale = [(path, name, spec) for path, name, spec in workspace_dependencies(root) if spec != version]
    return [f"{path}: depends on {name} {spec!r}, the tag says {version!r}" for path, name, spec in stale]


def cdn_problems(root: Path, version: str) -> list[str]:
    """The released engine of `version` is committed (its contents are checked by `kit-pins` and `release-cdn`)."""
    if not (root / RELEASE_JSON).is_file():
        return [f"{RELEASE_JSON} is missing: npm run release:cdn on the release commit (quality/prepare_release_skill.md)"]
    found = read_json_object(root / RELEASE_JSON).get("version")
    return [] if found == version else [f"{RELEASE_JSON}: version {found!r}, the tag says {version!r}"]


def kit_problems(root: Path, version: str) -> list[str]:
    """The starter kit's page pins the jsDelivr folder of this release."""
    if not (root / KIT_PAGE).is_file():
        return [f"{KIT_PAGE} is missing: a release pins the starter kit's page"]
    found = base_version(page_base(read_kit_page(root / KIT_PAGE)))
    return [] if found == version else [f"{KIT_PAGE}: pins engine {found!r}, the tag says {version!r}"]


def table_rows(text: str) -> list[str]:
    return [line for line in text.splitlines() if line.startswith("|")]


def described_pins(text: str) -> dict[str, str]:
    """The table rows of a description that pair an address with an integrity: {address: integrity}."""
    pairs = [(URL_TOKEN.search(row), SRI_TOKEN.search(row)) for row in table_rows(text)]
    return {url.group(1): integrity.group(0) for url, integrity in pairs if url and integrity}


def notes_sri_problems(root: Path, tag: str) -> list[str]:
    """The description's pinned addresses and every integrity it names are exactly release.json's."""
    path = RELEASE_NOTES / f"{tag}_github_description.md"
    if not ((root / path).is_file() and (root / RELEASE_JSON).is_file()):
        return []
    text = (root / path).read_text(encoding="utf-8")
    expected = expected_pins(read_json_object(root / RELEASE_JSON)).pins
    stale = set(SRI_TOKEN.findall(text)) - set(expected.values())
    if described_pins(text) == expected and not stale:
        return []
    return [f"{path}: its pinned addresses and integrity are not {RELEASE_JSON}'s: {WRITE_NOTES} {path}"]


def engine_problems(root: Path, version: str) -> list[str]:
    path = root / ENGINE_INDEX
    match = ENGINE_VERSION.search(path.read_text(encoding="utf-8")) if path.is_file() else None
    found = match.group(1) if match else None
    return [] if found == version else [f"{ENGINE_INDEX}: ENGINE_VERSION {found!r}, the tag says {version!r}"]


def doc_pin_problems(root: Path, version: str) -> list[str]:
    """Every pinned CLI command of the guides names `version` (`npm run release:bump` rewrites them)."""
    problems: list[str] = []
    for name in PINNED_DOCS:
        path = root / name
        found = set(CLI_PIN.findall(path.read_text(encoding="utf-8"))) if path.is_file() else set()
        problems.extend(f"{name}: names create-historic-city@{other}, the tag says {version!r}" for other in sorted(found - {version}))
    return problems


def _has_text(path: Path) -> bool:
    return path.is_file() and bool(path.read_text(encoding="utf-8").strip())


def notes_problems(root: Path, tag: str) -> list[str]:
    names = (f"{tag}.md", f"{tag}_github_description.md")
    return [
        f"{RELEASE_NOTES / name} is missing or empty (docs/releases/README.md)"
        for name in names
        if not _has_text(root / RELEASE_NOTES / name)
    ]


def release_problems(root: Path, tag: str) -> list[str]:
    """Everything that disagrees with releasing `tag` from `root` (empty when consistent)."""
    if not SEMVER_TAG.match(tag):
        return [f"tag {tag!r} is not vMAJOR.MINOR.PATCH or vMAJOR.MINOR.PATCH-beta.N / -rc.N (no other suffix)"]
    version = tag.removeprefix("v")
    try:
        versions = [*manifest_problems(root, version), *dependency_problems(root, version), *engine_problems(root, version)]
        released = [*cdn_problems(root, version), *kit_problems(root, version)]
        docs = [*doc_pin_problems(root, version), *notes_problems(root, tag), *notes_sri_problems(root, tag)]
        return [*versions, *released, *docs]
    except (ReleaseError, PinError) as error:
        return [str(error)]


def verdict(tag: str | None, problems: Sequence[str]) -> int:
    if problems:
        LOG.error("[release] FAILED for %s:\n%s", tag or "HEAD", "\n".join(f"  - {problem}" for problem in problems))
        return 1
    LOG.info("[release] OK: %s matches every version, ENGINE_VERSION, the released engine, the kit's pins and both notes files", tag)
    return 0


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check that a release tag agrees with the package versions and release notes.")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    parser.add_argument("--tag", help="the tag to check (default: the v* tag pointing at HEAD)")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None, capture: Capture | None = None) -> int:
    args = parse_args(argv)
    root: Path = args.root
    tag, problems = (args.tag, []) if args.tag else pick_tag(head_tags(capture or git_capture(root)))
    return verdict(tag, release_problems(root, tag) if tag else problems)


if __name__ == "__main__":
    sys.exit(main())
