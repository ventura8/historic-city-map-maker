#!/usr/bin/env python3
"""Deps gate (stage `deps`, weekly in .github/workflows/deps.yml): every pin is on its latest stable release.

AGENTS.md -> Latest stable dependencies. Each source is read from the repository, then checked against its
registry (this is the only network-bound gate besides `contract`, and it is never part of `quality` or `all`):

1. npm: the exact versions of the root package.json and of every workspace (dependencies, devDependencies,
   optionalDependencies; the internal `@hcm/*` packages are skipped), against `npm outdated --json` at the root
   and with `--workspaces` (`latest` is the registry's `latest` dist-tag, the latest stable). The `overrides`
   pin transitive packages for advisories; `npm audit` watches those.
2. PyPI: every `name==version` line of scripts/ci/requirements.txt and pipeline/requirements-poetry.txt, and the
   exact pins of pipeline/pyproject.toml (project dependencies, Poetry groups, build-system requires), against
   `pip index versions --json` (stable releases installable on the image's Python 3.14).
3. Docker, best effort: every image pinned by tag and digest (a Dockerfile's `# image:tag` comment above a
   digest-only `FROM`, `# syntax=` lines, `image:tag@sha256:` in shell scripts, YAML and the install bundle's
   Docker builder in packages/shared/src/schemas/install.ts), against the tags of the same shape (`24-bookworm-slim` ->
   `<n>-bookworm-slim`) on Docker Hub, ghcr.io or gcr.io (Google's builders; an image Google marks retired is no
   candidate). A registry that cannot be read is a warning, not a failure.
4. GitHub Actions: every `uses: owner/repo@<sha> # vX.Y.Z`, against the newest `vX.Y.Z` tag of owner/repo
   (git matching-refs: some repositories publish other things as their "latest release").

`HELD` lists the deliberate holds with their reason (docs/CI_PIPELINE.md -> Held dependencies repeats them). A
held pin that is behind is reported and passes; a hold that no longer matches its pin, names a pin that does not
exist, or is no longer needed fails, so a bump also removes its hold.

Usage: check_dependency_updates.py [--root DIR]. Output: one `  - ` line per pin that is behind (the weekly
issue quotes them), then the verdict. Exit status: 0 every pin is current (holds aside), 1 a pin is behind or a
hold is stale, 2 a registry or a pin file could not be read.
"""

import argparse
import json
import re
import subprocess
import sys
import tomllib
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import partial
from itertools import pairwise
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urljoin

from cihttp import NETWORK_ERRORS, Fetch, Request, https_fetch, is_success, with_retry
from cilog import get_logger
from cirepo import ROOT, repository_files

LOG = get_logger("deps")

EXIT_BEHIND = 1
EXIT_UNCHECKED = 2
COMMAND_NOT_FOUND = 127
COMMAND_TIMEOUT_S = 300
PIP_WORKERS = 8
MAX_TAG_PAGES = 10

NPM_SECTIONS = ("dependencies", "devDependencies", "optionalDependencies")
NPM_OUTDATED = (("npm", "outdated", "--json"), ("npm", "outdated", "--json", "--workspaces"))
EXACT_NPM_VERSION = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")
REQUIREMENT_FILES = ("scripts/ci/requirements.txt", "pipeline/requirements-poetry.txt")
PYPROJECT_FILES = ("pipeline/pyproject.toml",)
REQUIREMENT = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*==\s*([^\s;#,]+)")

IMAGE = r"(?P<image>[a-z0-9][a-z0-9._/-]*)"
TAG = r"(?P<tag>[A-Za-z0-9_][A-Za-z0-9._-]*)"
INLINE_IMAGE = re.compile(rf"{IMAGE}:{TAG}@sha256:[0-9a-f]{{64}}")
TAG_COMMENT = re.compile(rf"^#\s+{IMAGE}:{TAG}")
DIGEST_FROM = re.compile(rf"^FROM\s+(?:--platform=\S+\s+)?{IMAGE}@sha256:", re.IGNORECASE)
DOCKERFILE = re.compile(r"(?:^|/)Dockerfile(?:\.[\w.-]+)?$")
IMAGE_FILE = re.compile(r"(?:\.sh|\.ya?ml|^scripts/git-hooks/[^/]+|^packages/shared/src/schemas/install\.ts)$")
DOCKER_HUB = "https://hub.docker.com/v2/namespaces"
GHCR = "https://ghcr.io"
GCR = "https://gcr.io"
# Google's markers of a builder image no longer to use: a tag of either beside a version retires that version.
GCR_RETIRED = re.compile(r"^(?:deprecated-public-image|no-new-use-public-image)-")
NAME_FILTER = re.compile(r"[A-Za-z][A-Za-z-]*[A-Za-z]")
NEXT_LINK = re.compile(r'<([^>]+)>;\s*rel="next"')

ACTION_FILE = re.compile(r"^\.github/(?:workflows/[^/]+|actions/[^/]+/action)\.ya?ml$")
USES = re.compile(r"uses:\s*(?P<repo>[\w.-]+/[\w.-]+)(?:/[^@\s]*)?@[0-9a-f]{40}\s+#\s*(?P<version>v?\d[\w.-]*)")
GITHUB_API = "https://api.github.com/repos"
GITHUB_HEADERS = (("Accept", "application/vnd.github+json"), ("X-GitHub-Api-Version", "2022-11-28"))
STABLE_TAG = re.compile(r"^v?\d+(?:\.\d+)*$")
DIGITS = re.compile(r"\d+")


@dataclass(frozen=True)
class Held:
    version: str
    reason: str


# Deliberate holds: "<ecosystem>:<name>" -> the pinned version that stays, and why (keep docs/CI_PIPELINE.md ->
# Held dependencies in step).
HELD: dict[str, Held] = {
    "npm:typescript": Held("6.0.3", "typescript-eslint@8.72.2 peers typescript >=4.8.4 <6.1.0"),
    "npm:@types/node": Held("24.19.2", "follows the Node 24 runtime (engines >=24.12.0), not the newest Node line"),
    "npm:@axe-core/playwright": Held(
        "4.13.0",
        "4.14.0 brings axe-core 4.14.0, whose element grid leaves slotted content of a scrolling shadow-root pane unclipped: "
        "false target-size and color-contrast violations (docs/LESSONS.md 294)",
    ),
    "npm:mapbox-gl": Held(
        "3.34.1",
        "the released engine (cdn/engine/release.json) and the starter kit pin Mapbox GL JS 3.34.1 with its SRI, which "
        "the kit tests read from this package; it moves with the next engine release",
    ),
    "docker:node": Held("24-bookworm-slim", "Node 24 is the runtime line (engines >=24.12.0); it moves together with engines"),
    "pypi:mando": Held("0.7.1", "radon 6.0.1 (the latest radon) requires mando >=0.6,<0.8"),
    "pypi:findpython": Held("0.8.0", "poetry 2.5.1 (the latest Poetry) requires findpython >=0.6.2,<0.9.0"),
    "pypi:pkginfo": Held("1.13.3", "poetry 2.5.1 (the latest Poetry) requires pkginfo >=1.12,<2.0"),
}


class SourceError(Exception):
    """A pin file is missing or unreadable (exit 2)."""


class LookupFailedError(Exception):
    """A registry answered something this check cannot use."""


@dataclass(frozen=True)
class Pin:
    ecosystem: str
    name: str
    version: str
    where: tuple[str, ...]

    @property
    def key(self) -> str:
        return f"{self.ecosystem}:{self.name}"

    def label(self) -> str:
        return f"{self.ecosystem} {self.name} {self.version}"


@dataclass(frozen=True)
class Lookup:
    """The newest stable version of a pin's package, or why it could not be found."""

    latest: str | None = None
    problem: str | None = None


Run = Callable[[Sequence[str]], subprocess.CompletedProcess[str]]


@dataclass(frozen=True)
class Ports:
    """The outside world: commands (npm, pip) and HTTPS requests; the tests pass fakes."""

    run: Run
    fetch: Fetch


Found = tuple[str, str, str]
"""(name, version, file) of one pin as a source file states it."""


# --- versions -----------------------------------------------------------------------------------------


def version_key(version: str) -> tuple[int, ...]:
    """The numbers of a version or tag, in order: `v4.38.3` -> (4, 38, 3), `24-bookworm-slim` -> (24,)."""
    return tuple(int(number) for number in DIGITS.findall(version))


def is_newer(latest: str | None, pinned: str) -> bool:
    return latest is not None and version_key(latest) > version_key(pinned)


def newest(candidates: Iterable[str], pinned: str) -> str:
    return max(candidates, key=version_key, default=pinned)


# --- reading the pins ---------------------------------------------------------------------------------


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError as error:
        raise SourceError(f"cannot read {path} ({error})") from error


def read_json_object(path: Path) -> dict[str, Any]:
    try:
        document = json.loads(read_text(path))
    except ValueError as error:
        raise SourceError(f"{path} is not valid JSON ({error})") from error
    if not isinstance(document, dict):
        raise SourceError(f"{path} is not a JSON object")
    return document


def npm_manifests(root: Path) -> list[Path]:
    """The root package.json and the package.json of every workspace it declares."""
    patterns = read_json_object(root / "package.json").get("workspaces", [])
    return [root / "package.json", *sorted(path for pattern in patterns for path in root.glob(f"{pattern}/package.json"))]


def npm_dependencies(manifest: Mapping[str, Any]) -> list[tuple[str, str]]:
    sections = [manifest.get(section) or {} for section in NPM_SECTIONS]
    return [(name, str(spec)) for section in sections for name, spec in section.items()]


def exact_external(dependencies: Iterable[tuple[str, str]], internal: set[object]) -> list[tuple[str, str]]:
    """The dependencies pinned to one exact version, without the workspaces' own packages."""
    return [(name, spec) for name, spec in dependencies if name not in internal and EXACT_NPM_VERSION.match(spec)]


def npm_found(root: Path) -> list[Found]:
    manifests = {path: read_json_object(path) for path in npm_manifests(root)}
    internal = {manifest.get("name") for manifest in manifests.values()}
    return [
        (name, spec, path.relative_to(root).as_posix())
        for path, manifest in manifests.items()
        for name, spec in exact_external(npm_dependencies(manifest), internal)
    ]


def requirement_pins(text: str) -> list[tuple[str, str]]:
    return [(match.group(1), match.group(2)) for match in map(REQUIREMENT.match, text.splitlines()) if match]


def pyproject_requirements(document: Mapping[str, Any]) -> list[str]:
    """`name==version` strings of the project dependencies, the Poetry groups and the build-system requires."""
    groups = document.get("tool", {}).get("poetry", {}).get("group", {})
    poetry = [f"{name}=={spec}" for group in groups.values() for name, spec in group.get("dependencies", {}).items()]
    return [*document.get("project", {}).get("dependencies", []), *poetry, *document.get("build-system", {}).get("requires", [])]


def read_toml(path: Path) -> dict[str, Any]:
    try:
        return tomllib.loads(read_text(path))
    except tomllib.TOMLDecodeError as error:
        raise SourceError(f"{path} is not valid TOML ({error})") from error


def pypi_found(root: Path) -> list[Found]:
    texts = {name: read_text(root / name) for name in REQUIREMENT_FILES}
    texts.update({name: "\n".join(pyproject_requirements(read_toml(root / name))) for name in PYPROJECT_FILES})
    return [(name, version, file) for file, text in texts.items() for name, version in requirement_pins(text)]


def tagged_from_lines(lines: Sequence[str]) -> list[tuple[str, str]]:
    """(image, tag) of each digest-only FROM whose comment line right above names its tag."""
    pairs: list[tuple[str, str]] = []
    for above, line in pairwise(lines):
        comment, base = TAG_COMMENT.match(above), DIGEST_FROM.match(line)
        if comment and base and comment.group("image") == base.group("image"):
            pairs.append((comment.group("image"), comment.group("tag")))
    return pairs


def image_references(relative: str, text: str) -> list[tuple[str, str]]:
    inline = [(match.group("image"), match.group("tag")) for match in INLINE_IMAGE.finditer(text)]
    return inline + tagged_from_lines(text.splitlines()) if DOCKERFILE.search(relative) else inline


def is_image_file(relative: str) -> bool:
    return bool(DOCKERFILE.search(relative) or IMAGE_FILE.search(relative))


def docker_found(root: Path) -> list[Found]:
    files = [name for name in repository_files(root) if is_image_file(name)]
    return [(image, tag, name) for name in files for image, tag in image_references(name, read_text(root / name))]


def actions_found(root: Path) -> list[Found]:
    files = [name for name in repository_files(root) if ACTION_FILE.match(name)]
    return [(match.group("repo"), match.group("version"), name) for name in files for match in USES.finditer(read_text(root / name))]


def merge(ecosystem: str, found: Iterable[Found]) -> list[Pin]:
    """One pin per (name, version), with every file that states it."""
    files: dict[tuple[str, str], list[str]] = defaultdict(list)
    for name, version, file in found:
        files[(name, version)].append(file)
    return [Pin(ecosystem, name, version, tuple(sorted(set(where)))) for (name, version), where in sorted(files.items())]


SOURCES: dict[str, Callable[[Path], list[Found]]] = {
    "npm": npm_found,
    "pypi": pypi_found,
    "docker": docker_found,
    "actions": actions_found,
}


def collect_pins(root: Path) -> dict[str, list[Pin]]:
    return {ecosystem: merge(ecosystem, source(root)) for ecosystem, source in SOURCES.items()}


# --- registries: npm and PyPI through their own clients -----------------------------------------------


def last_line(text: str) -> str:
    lines = text.strip().splitlines()
    return lines[-1] if lines else "no output"


def json_object(text: str) -> dict[str, Any] | None:
    """The JSON object in a command's output ({} for no output); None when it is something else."""
    try:
        document = json.loads(text) if text.strip() else {}
    except ValueError:
        return None
    return document if isinstance(document, dict) else None


def npm_failure(result: subprocess.CompletedProcess[str], document: Mapping[str, Any] | None) -> str:
    """npm's own `error.summary` when it printed one as JSON, else the last line it printed."""
    error = document.get("error") if document else None
    summary = error.get("summary") if isinstance(error, dict) else None
    return str(summary or last_line(result.stderr or result.stdout))


def npm_document(result: subprocess.CompletedProcess[str]) -> dict[str, Any]:
    """`npm outdated --json` exits 1 whenever something is outdated, so its JSON, not its status, decides."""
    document = json_object(result.stdout)
    if document is None or "error" in document:
        raise LookupFailedError(f"`{' '.join(result.args)}` failed: {npm_failure(result, document)}")
    return document


def outdated_latest(entry: object) -> str:
    """`latest` of one `npm outdated` entry (a list when several workspaces depend on the package)."""
    first = entry[0] if isinstance(entry, list) and entry else entry
    return str(first.get("latest", "")) if isinstance(first, dict) else ""


def npm_outdated(run: Run) -> dict[str, str]:
    latest: dict[str, str] = {}
    for command in NPM_OUTDATED:
        latest.update({name: outdated_latest(entry) for name, entry in npm_document(run(command)).items()})
    return latest


def npm_lookups(pins: Sequence[Pin], ports: Ports) -> list[Lookup]:
    try:
        outdated = npm_outdated(ports.run)
    except LookupFailedError as error:
        return [Lookup(problem=str(error)) for _ in pins]
    return [Lookup(latest=outdated.get(pin.name) or pin.version) for pin in pins]


def pip_document(result: subprocess.CompletedProcess[str]) -> dict[str, Any]:
    return (json_object(result.stdout) or {}) if result.returncode == 0 else {}


def pip_latest(name: str, run: Run) -> Lookup:
    result = run((sys.executable, "-m", "pip", "index", "versions", "--json", name))
    latest = pip_document(result).get("latest")
    if isinstance(latest, str) and latest:
        return Lookup(latest=latest)
    return Lookup(problem=f"pip index versions {name}: {last_line(result.stderr)}")


def pypi_lookups(pins: Sequence[Pin], ports: Ports) -> list[Lookup]:
    with ThreadPoolExecutor(max_workers=PIP_WORKERS) as pool:
        return list(pool.map(partial(pip_latest, run=ports.run), [pin.name for pin in pins]))


# --- registries over HTTPS: Docker Hub, ghcr.io, GitHub -----------------------------------------------


def get_json(request: Request, fetch: Fetch) -> object:
    response = fetch(request)
    if not is_success(response.status):
        raise LookupFailedError(f"{request.url} answered HTTP {response.status}")
    return response.json_document()


def get_object(request: Request, fetch: Fetch) -> dict[str, Any]:
    document = get_json(request, fetch)
    if not isinstance(document, dict):
        raise LookupFailedError(f"{request.url} did not answer a JSON object")
    return document


def registry_of(image: str) -> tuple[str, str]:
    """(registry host, repository path): `node` -> ("docker.io", "library/node"), `ghcr.io/a/b` -> ("ghcr.io", "a/b")."""
    first, _, rest = image.partition("/")
    if rest and ("." in first or ":" in first):
        return first, rest
    return "docker.io", image if rest else f"library/{image}"


def name_filter(tag: str) -> str:
    """The longest word of a tag (`24-bookworm-slim` -> `bookworm-slim`): Docker Hub's substring filter."""
    return max(NAME_FILTER.findall(tag), key=len, default="")


def names_of(items: object) -> list[str]:
    return [str(item.get("name")) for item in items if isinstance(item, dict)] if isinstance(items, list) else []


def docker_hub_tags(path: str, tag: str, fetch: Fetch) -> list[str]:
    """The 100 most recently pushed tags (filtered by the tag's word, if any); best effort by design."""
    namespace, _, repository = path.partition("/")
    query = {"page_size": "100", **({"name": name_filter(tag)} if name_filter(tag) else {})}
    url = f"{DOCKER_HUB}/{namespace}/repositories/{repository}/tags?{urlencode(query)}"
    return names_of(get_object(Request("GET", url), fetch).get("results"))


def next_page(link: str | None, current: str) -> str | None:
    match = NEXT_LINK.search(link or "")
    return urljoin(current, match.group(1)) if match else None


def ghcr_tags(path: str, _tag: str, fetch: Fetch) -> list[str]:
    """Every tag through the OCI distribution API, with ghcr.io's anonymous pull token (never logged)."""
    token = get_object(Request("GET", f"{GHCR}/token?scope=repository:{path}:pull"), fetch).get("token")
    if not isinstance(token, str):
        raise LookupFailedError(f"ghcr.io gave no anonymous pull token for {path}")
    headers = (("Authorization", f"Bearer {token}"),)
    tags: list[str] = []
    url: str | None = f"{GHCR}/v2/{path}/tags/list?n=1000"
    pages = 0
    while url is not None and pages < MAX_TAG_PAGES:
        response = fetch(Request("GET", url, None, headers))
        tags.extend(str(name) for name in tag_list(response.json_field("tags")))
        url, pages = next_page(response.headers.get("link"), url), pages + 1
    return tags


def tag_list(value: object) -> list[object]:
    return value if isinstance(value, list) else []


def current_tags(entry: object) -> list[str]:
    """The tags of one gcr.io manifest, none when Google marks the image retired."""
    names = [str(name) for name in tag_list(entry.get("tag") if isinstance(entry, dict) else None)]
    return [] if any(GCR_RETIRED.match(name) for name in names) else names


def gcr_tags(path: str, _tag: str, fetch: Fetch) -> list[str]:
    """gcr.io's anonymous tag list, per manifest: the old numeric build tags and retired lines carry Google's markers."""
    manifests = get_object(Request("GET", f"{GCR}/v2/{path}/tags/list"), fetch).get("manifest")
    entries = list(manifests.values()) if isinstance(manifests, dict) else []
    return [name for entry in entries for name in current_tags(entry)]


TAG_READERS: dict[str, Callable[[str, str, Fetch], list[str]]] = {"docker.io": docker_hub_tags, "ghcr.io": ghcr_tags, "gcr.io": gcr_tags}


def tag_shape(tag: str) -> re.Pattern[str]:
    """Tags shaped like `tag`, numbers free: `v2.15.1-debian` -> ^v\\d+\\.\\d+\\.\\d+\\-debian$."""
    return re.compile("^" + DIGITS.sub(r"\\d+", re.escape(tag)) + "$")


def docker_lookup(pin: Pin, fetch: Fetch) -> Lookup:
    host, path = registry_of(pin.name)
    reader = TAG_READERS.get(host)
    if reader is None:
        return Lookup(problem=f"registry {host} is not supported")
    try:
        tags = reader(path, pin.version, fetch)
    except (LookupFailedError, *NETWORK_ERRORS) as error:
        return Lookup(problem=str(error))
    return Lookup(latest=newest(filter(tag_shape(pin.version).match, tags), pin.version))


def docker_lookups(pins: Sequence[Pin], ports: Ports) -> list[Lookup]:
    return [docker_lookup(pin, ports.fetch) for pin in pins]


def ref_names(refs: object) -> list[str]:
    """Tag names of a git matching-refs answer (`refs/tags/v1.2.3` -> `v1.2.3`)."""
    items = refs if isinstance(refs, list) else []
    return [str(ref.get("ref", "")).removeprefix("refs/tags/") for ref in items if isinstance(ref, dict)]


def tag_names(refs: object) -> list[str]:
    return [name for name in ref_names(refs) if STABLE_TAG.match(name)]


def action_lookup(pin: Pin, fetch: Fetch) -> Lookup:
    prefix = "v" if pin.version.startswith("v") else ""
    request = Request("GET", f"{GITHUB_API}/{pin.name}/git/matching-refs/tags/{prefix}", None, GITHUB_HEADERS)
    try:
        refs = get_json(request, fetch)
    except (LookupFailedError, *NETWORK_ERRORS) as error:
        return Lookup(problem=str(error))
    return Lookup(latest=newest(tag_names(refs), pin.version))


def actions_lookups(pins: Sequence[Pin], ports: Ports) -> list[Lookup]:
    return [action_lookup(pin, ports.fetch) for pin in pins]


LOOKUPS: dict[str, Callable[[Sequence[Pin], Ports], list[Lookup]]] = {
    "npm": npm_lookups,
    "pypi": pypi_lookups,
    "docker": docker_lookups,
    "actions": actions_lookups,
}


# --- verdict ------------------------------------------------------------------------------------------


def judge_hold(pin: Pin, hold: Held, latest: str | None) -> tuple[str, str]:
    if hold.version != pin.version:
        return "stale", f"HELD {pin.key} names {hold.version} but the pin is {pin.version}: update or remove the hold"
    if not is_newer(latest, pin.version):
        return "stale", f"HELD {pin.key} {pin.version} is already the latest stable release: remove the hold"
    return "held", f"{pin.label()} (latest {latest}): {hold.reason}"


def classify(pin: Pin, lookup: Lookup) -> tuple[str, str]:
    """(kind, line): ok, behind, held, stale, unchecked, or warning (a Docker registry is best effort)."""
    if lookup.problem is not None:
        return "warning" if pin.ecosystem == "docker" else "unchecked", f"{pin.label()} not checked: {lookup.problem}"
    hold = HELD.get(pin.key)
    if hold is not None:
        return judge_hold(pin, hold, lookup.latest)
    if is_newer(lookup.latest, pin.version):
        return "behind", f"{pin.label()} -> {lookup.latest} ({', '.join(pin.where)})"
    return "ok", pin.label()


def orphan_holds(pins: Iterable[Pin]) -> list[str]:
    keys = {pin.key for pin in pins}
    return [f"HELD {key} names a pin that does not exist: remove the hold" for key in HELD if key not in keys]


def check(pins: Mapping[str, Sequence[Pin]], ports: Ports) -> dict[str, list[str]]:
    """Every pin's lines, by kind."""
    kinds: dict[str, list[str]] = defaultdict(list)
    for ecosystem, group in pins.items():
        for pin, lookup in zip(group, LOOKUPS[ecosystem](group, ports), strict=True):
            kind, line = classify(pin, lookup)
            kinds[kind].append(line)
    kinds["stale"].extend(orphan_holds(pin for group in pins.values() for pin in group))
    return kinds


def log_details(kinds: Mapping[str, Sequence[str]]) -> None:
    for prefix, kind in (("  held: ", "held"), ("  warning: ", "warning"), ("  - ", "behind"), ("  - ", "stale"), ("  - ", "unchecked")):
        for line in kinds.get(kind, ()):
            LOG.info("%s%s", prefix, line)


def verdict(kinds: Mapping[str, Sequence[str]], total: int) -> int:
    failing = len(kinds.get("behind", ())) + len(kinds.get("stale", ()))
    if kinds.get("unchecked"):
        LOG.error("[deps] ERROR: %d of %d pins could not be checked (%d behind or stale)", len(kinds["unchecked"]), total, failing)
        return EXIT_UNCHECKED
    if failing:
        LOG.error("[deps] %d of %d pins are behind their latest stable release or held without need", failing, total)
        return EXIT_BEHIND
    LOG.info("[deps] OK: %d pins on their latest stable release (%d held)", total, len(kinds.get("held", ())))
    return 0


def summary(pins: Mapping[str, Sequence[Pin]]) -> str:
    return ", ".join(f"{len(group)} {ecosystem}" for ecosystem, group in pins.items())


# --- run ----------------------------------------------------------------------------------------------


def run_command(argv: Sequence[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    """Runs `argv` in `cwd` and captures its output; a missing executable answers 127 like a shell."""
    try:
        return subprocess.run(list(argv), cwd=cwd, capture_output=True, text=True, check=False, timeout=COMMAND_TIMEOUT_S)
    except FileNotFoundError:
        return subprocess.CompletedProcess(list(argv), COMMAND_NOT_FOUND, "", f"command not found: {argv[0]}")


def default_ports(root: Path) -> Ports:
    return Ports(run=partial(run_command, cwd=root), fetch=with_retry(https_fetch))


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check that every pinned dependency is on its latest stable release.")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None, ports: Ports | None = None) -> int:
    args = parse_args(argv)
    try:
        pins = collect_pins(args.root)
    except SourceError as error:
        LOG.error("[deps] ERROR: %s", error)
        return EXIT_UNCHECKED
    LOG.info("[deps] checking %s pins", summary(pins))
    kinds = check(pins, ports or default_ports(args.root))
    log_details(kinds)
    return verdict(kinds, sum(map(len, pins.values())))


if __name__ == "__main__":
    sys.exit(main())
