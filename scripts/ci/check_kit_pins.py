#!/usr/bin/env python3
"""Static gate `kit-pins` (also in the `release` stage): the released engine and the starter kit's pins agree
(docs/research/M5-interfaces.md §2.3, §3.2).

- `cdn/engine/release.json` is a valid release file (the shape of `engineReleaseSchema` in `@hcm/shared`): its `base`
  is the pinned jsDelivr folder of its version, and it lists every file of `cdn/engine/` but itself, each with the
  size and SHA-384 integrity of the committed file.
- `templates/starter-kit/index.html` pins Mapbox GL JS (stylesheet and deferred script from api.mapbox.com) and, between
  `<!-- hcm:engine -->` and `<!-- /hcm:engine -->`, the engine's `engine.css` and deferred `engine.iife.js` from one
  pinned jsDelivr folder, each with `integrity` and `crossorigin="anonymous"`; its meta CSP's `script-src`, `style-src`
  and `font-src` name that folder; nothing else is loaded from jsDelivr.
- With a release file, the page names exactly its folder (so its version) and the integrity of its page files and of
  Mapbox GL JS. Before the first release (no `cdn/engine/`) only the page's shape is checked, and with neither file
  there is nothing to check yet.

Usage: check_kit_pins.py [--root DIR]. Exit status: 0 consistent, 1 problems found, 2 usage (argparse).
"""

import argparse
import re
import sys
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import TypeIs

from cilog import bullets, get_logger
from release_pins import (
    BLOCK_MARKERS,
    CSP_FOLDER_DIRECTIVES,
    ENGINE_FOLDER,
    JSDELIVR,
    KIT_PAGE,
    MAPBOX_KINDS,
    MAPBOX_URL_RE,
    PAGE_FILES,
    RELEASE_FILE,
    RELEASE_JSON,
    RELEASE_VERSION,
    SEMVER,
    SRI_RE,
    Expected,
    KitPage,
    Pin,
    PinError,
    expected_pins,
    field_of,
    page_base,
    read_json_object,
    read_kit_page,
    sri,
)

LOG = get_logger("kit-pins")
ROOT = Path(__file__).resolve().parents[2]
RELEASE_KEYS = {"version", "repository", "base", "mapboxGl", "files"}
FILE_KEYS = {"path", "bytes", "integrity"}
MIN_FILES = 2
MAX_FILES = 100
PATH_RE = r"[A-Za-z0-9_-][\w.-]*(?:/[A-Za-z0-9_-][\w.-]*)*"
REPOSITORY_RE = r"[A-Za-z0-9-]{1,39}/[\w.-]{1,100}"
FIX = "npm run release:cdn on the release commit (quality/prepare_release_skill.md)"

Entry = dict[str, object]


def matches(pattern: str, value: object) -> bool:
    return isinstance(value, str) and re.fullmatch(pattern, value) is not None


def release_shape_problems(release: Entry) -> list[str]:
    """The top level of `release.json`: its keys, version, repository and the folder they make."""
    if set(release) != RELEASE_KEYS:
        return [f"{RELEASE_JSON}: keys {sorted(release)}, expected {sorted(RELEASE_KEYS)}"]
    version, repository = release["version"], release["repository"]
    if not (matches(RELEASE_VERSION, version) and matches(REPOSITORY_RE, repository)):
        return [f"{RELEASE_JSON}: version {version!r} or repository {repository!r} is malformed"]
    base = f"https://cdn.jsdelivr.net/gh/{repository}@v{version}/cdn/engine/"
    return [] if release["base"] == base else [f"{RELEASE_JSON}: base {release['base']!r}, expected {base!r}"]


def subresource_valid(entry: object) -> bool:
    return matches(MAPBOX_URL_RE.pattern, field_of(entry, "url")) and matches(SRI_RE.pattern, field_of(entry, "integrity"))


def mapbox_problems(mapbox: object) -> list[str]:
    """`mapboxGl`: a version and, for its script and stylesheet, an api.mapbox.com address with an SRI value."""
    valid = matches(SEMVER, field_of(mapbox, "version")) and all(subresource_valid(field_of(mapbox, kind)) for kind in MAPBOX_KINDS)
    return [] if valid else [f"{RELEASE_JSON}: mapboxGl must name a version and its script and stylesheet with their integrity"]


def positive_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 1


def file_entry_valid(entry: object) -> TypeIs[Entry]:
    valid_values = positive_int(field_of(entry, "bytes")) and matches(PATH_RE, field_of(entry, "path"))
    return isinstance(entry, dict) and set(entry) == FILE_KEYS and valid_values and matches(SRI_RE.pattern, entry["integrity"])


def valid_entries(files: object) -> list[Entry]:
    """The valid entries of `files` (none when it is not a list)."""
    return [entry for entry in files if file_entry_valid(entry)] if isinstance(files, list) else []


def file_list(files: object) -> list[Entry] | None:
    """`files` when it is 2 to 100 valid entries, else None."""
    entries = valid_entries(files)
    complete = isinstance(files, list) and len(entries) == len(files)
    return entries if complete and MIN_FILES <= len(entries) <= MAX_FILES else None


def duplicates(paths: Sequence[str]) -> list[str]:
    return sorted({path for path in paths if paths.count(path) > 1})


def missing(names: Iterable[str], paths: Sequence[str]) -> list[str]:
    return [name for name in names if name not in paths]


def file_list_problems(entries: list[Entry]) -> list[str]:
    """Each path once, the page files among them and never the release file itself."""
    paths = [str(entry["path"]) for entry in entries]
    problems = [f"{RELEASE_JSON}: {path} is listed twice" for path in duplicates(paths)]
    problems += [f"{RELEASE_JSON}: the page file {name} is not listed" for name in missing(PAGE_FILES.values(), paths)]
    if RELEASE_FILE in paths:
        problems.append(f"{RELEASE_JSON}: lists itself")
    return problems


def committed_files(root: Path) -> list[str]:
    """Every file of `cdn/engine/` but `release.json`, relative to it."""
    folder = root / ENGINE_FOLDER
    files = (path for path in folder.rglob("*") if path.is_file())
    return sorted(path.relative_to(folder).as_posix() for path in files if path.name != RELEASE_FILE)


def entry_problem(root: Path, entry: Entry, committed: Sequence[str]) -> str | None:
    """A listed file that is not committed, or whose size or integrity differs from the committed bytes."""
    path = str(entry["path"])
    if path not in committed:
        return f"{ENGINE_FOLDER}/{path}: listed in {RELEASE_FILE} but not committed ({FIX})"
    data = (root / ENGINE_FOLDER / path).read_bytes()
    same = len(data) == entry["bytes"] and sri(data) == entry["integrity"]
    return None if same else f"{ENGINE_FOLDER}/{path}: its size or integrity is not the one {RELEASE_FILE} lists ({FIX})"


def unlisted(committed: Sequence[str], entries: list[Entry]) -> list[str]:
    listed = {str(entry["path"]) for entry in entries}
    return [path for path in committed if path not in listed]


def digest_problems(root: Path, entries: list[Entry]) -> list[str]:
    """Each listed file is committed with its size and integrity; each committed file is listed."""
    committed = committed_files(root)
    problems = [f"{ENGINE_FOLDER}/{path}: committed but not listed in {RELEASE_FILE} ({FIX})" for path in unlisted(committed, entries)]
    found = (entry_problem(root, entry, committed) for entry in entries)
    return problems + [problem for problem in found if problem]


def release_file_problems(root: Path, release: Entry) -> list[str]:
    """`release.json` is valid and describes the committed `cdn/engine/` byte for byte."""
    problems = release_shape_problems(release) or mapbox_problems(release["mapboxGl"])
    if problems:
        return problems
    entries = file_list(release["files"])
    if entries is None:
        return [f"{RELEASE_JSON}: files must be {MIN_FILES} to {MAX_FILES} entries of path, bytes (>= 1) and integrity"]
    return file_list_problems(entries) or digest_problems(root, entries)


def pin_problems(name: str, pin: Pin) -> list[str]:
    """One pin: an SRI value, `crossorigin="anonymous"`, a deferred script."""
    checks = (
        (SRI_RE.match(pin.integrity) is not None, "has no sha384 integrity"),
        (pin.crossorigin == "anonymous", 'needs crossorigin="anonymous"'),
        (pin.kind != "script" or pin.deferred, "must be deferred"),
    )
    return [f"{KIT_PAGE}: {name} {message}" for passed, message in checks if not passed]


def one_pin(pins: list[Pin], name: str) -> tuple[Pin | None, list[str]]:
    if len(pins) == 1:
        return pins[0], []
    return None, [f"{KIT_PAGE}: expected one {name}, found {len(pins)}"]


def address_problems(name: str, pin: Pin | None, wanted: re.Pattern[str] | str) -> list[str]:
    """A found pin's own checks, and its address: matching `wanted` (a pattern), or equal to it (a string)."""
    if pin is None:
        return []
    good = wanted.match(pin.url) is not None if isinstance(wanted, re.Pattern) else pin.url == wanted
    return pin_problems(name, pin) + ([] if good else [f"{KIT_PAGE}: {name} comes from {pin.url}"])


def mapbox_pin_problems(page: KitPage) -> list[str]:
    """One Mapbox GL JS stylesheet and one script, each a release on api.mapbox.com, pinned."""
    problems: list[str] = []
    for kind in MAPBOX_KINDS:
        pin, found = one_pin(page.mapbox(kind), f"Mapbox GL JS {kind}")
        problems += found + address_problems(f"Mapbox GL JS {kind}", pin, MAPBOX_URL_RE)
    return problems


def engine_pin_problems(page: KitPage) -> list[str]:
    """In the block: the engine's stylesheet and script, both from the one pinned folder, pinned."""
    base = page_base(page)
    problems = [] if base else [f"{KIT_PAGE}: the engine script must come from a pinned folder (jsDelivr, @vX.Y.Z, cdn/engine/)"]
    for kind, name in PAGE_FILES.items():
        pin, found = one_pin(page.engine(kind), f"engine {kind} in the engine block")
        problems += found + address_problems(f"engine {kind}", pin, f"{base}{name}")
    return problems


def csp_problems(page: KitPage) -> list[str]:
    """The meta CSP lets the pinned folder serve the engine's script, stylesheet, languages and fonts."""
    base = page_base(page)
    if base is None:
        return []
    if page.csp is None:
        return [f"{KIT_PAGE}: no meta Content-Security-Policy"]
    directives = page.csp
    return [f"{KIT_PAGE}: the CSP's {name} does not name {base}" for name in CSP_FOLDER_DIRECTIVES if base not in directives.get(name, [])]


def stray_urls(page: KitPage) -> list[str]:
    """What the page loads from jsDelivr outside the engine block."""
    return [pin.url for pin in page.pins if pin.url.startswith(JSDELIVR) and not pin.in_block]


def block_problems(page: KitPage) -> list[str]:
    """One engine block, and nothing from jsDelivr outside it."""
    problems = [] if page.markers == BLOCK_MARKERS else [f"{KIT_PAGE}: expected one <!-- hcm:engine --> ... <!-- /hcm:engine --> block"]
    return problems + [f"{KIT_PAGE}: {url} is loaded outside the engine block" for url in stray_urls(page)]


def page_shape_problems(page: KitPage) -> list[str]:
    """The page's pins, whatever release they name (the only check before the first release)."""
    return block_problems(page) + mapbox_pin_problems(page) + engine_pin_problems(page) + csp_problems(page)


def page_release_problems(page: KitPage, expected: Expected) -> list[str]:
    """With a release: the folder and every pinned integrity are exactly the release file's."""
    base = page_base(page)
    problems = [] if base == expected.base else [f"{KIT_PAGE}: pins {base}, {RELEASE_JSON} says {expected.base}"]
    stale = [pin for pin in page.pinned() if expected.pins.get(pin.url) != pin.integrity]
    return problems + [f"{KIT_PAGE}: {pin.url} is pinned to {pin.integrity}, not to {RELEASE_JSON}'s integrity" for pin in stale]


def page_problems(root: Path, release: Entry | None) -> list[str]:
    if not (root / KIT_PAGE).is_file():
        return [] if release is None else [f"{KIT_PAGE} is missing: a release pins the starter kit's page"]
    page = read_kit_page(root / KIT_PAGE)
    problems = page_shape_problems(page)
    return problems if problems or release is None else page_release_problems(page, expected_pins(release))


def kit_pins_problems(root: Path) -> list[str]:
    """Every disagreement between the release file, the committed engine and the kit's page (empty when consistent)."""
    release = read_json_object(root / RELEASE_JSON) if (root / RELEASE_JSON).is_file() else None
    problems = [] if release is None else release_file_problems(root, release)
    return problems + page_problems(root, None if problems else release)


def verdict(root: Path, problems: Sequence[str]) -> int:
    if problems:
        LOG.error("[kit-pins] FAILED:\n%s", bullets(problems))
        return 1
    if (root / RELEASE_JSON).is_file():
        LOG.info("[kit-pins] OK: %s pins exactly the engine release in %s", KIT_PAGE, ENGINE_FOLDER)
    elif (root / KIT_PAGE).is_file():
        LOG.info("[kit-pins] OK: %s is pinned in shape (no engine release in %s yet)", KIT_PAGE, ENGINE_FOLDER)
    else:
        LOG.info("[kit-pins] OK: no starter-kit page and no engine release yet; nothing is pinned")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check that the released engine and the starter kit's pins agree.")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    root: Path = parser.parse_args(argv).root
    try:
        problems = kit_pins_problems(root)
    except PinError as error:
        problems = [str(error)]
    return verdict(root, problems)


if __name__ == "__main__":
    sys.exit(main())
