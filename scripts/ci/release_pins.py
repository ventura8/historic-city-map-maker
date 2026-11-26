"""What the release gates read (docs/research/M5-interfaces.md §2.3, §3.2): the released engine in `cdn/engine/` with
its `release.json`, the starter kit's page and the pins it carries. Standard library only; `check_kit_pins.py`
(static) and `check_release.py` (release) share it.

A pin is a `<link rel="stylesheet">` or a `<script src>` of the kit's page: Mapbox GL JS from api.mapbox.com, and the
engine's stylesheet and IIFE between `<!-- hcm:engine -->` and `<!-- /hcm:engine -->`, from one pinned jsDelivr folder
`https://cdn.jsdelivr.net/gh/<owner>/<repo>@vX.Y.Z/cdn/engine/` (`engineCdnBase` of `@hcm/shared`), or for a
pre-release `@vX.Y.Z-beta.N` / `@vX.Y.Z-rc.N`: the full version, never a range.
"""

import base64
import hashlib
import json
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path

ENGINE_FOLDER = Path("cdn", "engine")
RELEASE_FILE = "release.json"
RELEASE_JSON = ENGINE_FOLDER / RELEASE_FILE
KIT_PAGE = Path("templates", "starter-kit", "index.html")
PAGE_FILES = {"stylesheet": "engine.css", "script": "engine.iife.js"}
MAPBOX_KINDS = ("stylesheet", "script")
MAPBOX_CDN = "https://api.mapbox.com/mapbox-gl-js/"
JSDELIVR = "https://cdn.jsdelivr.net/"
BLOCK_MARKERS = ["hcm:engine", "/hcm:engine"]
CSP_FOLDER_DIRECTIVES = ("script-src", "style-src", "connect-src", "font-src")
SEMVER = r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)"
# A release: MAJOR.MINOR.PATCH, or a pre-release of it, -beta.N or -rc.N (N without leading zeros); nothing else
# (RELEASE_TAG_PATTERN of @hcm/shared, docs/releases/README.md).
RELEASE_VERSION = rf"{SEMVER}(?:-(?:beta|rc)\.(?:0|[1-9][0-9]*))?"
BASE_RE = re.compile(rf"^https://cdn\.jsdelivr\.net/gh/[A-Za-z0-9-]{{1,39}}/[\w.-]{{1,100}}@v(?P<version>{RELEASE_VERSION})/cdn/engine/$")
MAPBOX_URL_RE = re.compile(rf"^https://api\.mapbox\.com/mapbox-gl-js/v{SEMVER}/mapbox-gl\.(?:js|css)$")
SRI_RE = re.compile(r"^sha384-[A-Za-z0-9+/]{64}$")


class PinError(Exception):
    """A release file or kit page that cannot be read."""


def sri(data: bytes) -> str:
    """The SHA-384 Subresource Integrity value of `data` (`sha384-` and the base64 digest)."""
    return "sha384-" + base64.b64encode(hashlib.sha384(data).digest()).decode("ascii")


def field_of(container: object, key: str) -> object:
    """`container[key]` when `container` is a JSON object, else None."""
    return container.get(key) if isinstance(container, dict) else None


def text_of(value: object) -> str:
    return value if isinstance(value, str) else ""


def read_json_object(path: Path) -> dict[str, object]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise PinError(f"{path}: cannot read it as JSON ({error})") from error
    if not isinstance(document, dict):
        raise PinError(f"{path}: expected a JSON object")
    return document


@dataclass(frozen=True)
class Pin:
    """One subresource of the page: where it comes from and how it is pinned."""

    kind: str
    url: str
    integrity: str
    crossorigin: str
    deferred: bool
    in_block: bool


@dataclass
class KitPage:
    """The pins of the kit's page, the engine block's markers in page order, and its meta CSP's directives."""

    pins: list[Pin] = field(default_factory=list)
    markers: list[str] = field(default_factory=list)
    csp: dict[str, list[str]] | None = None

    def mapbox(self, kind: str) -> list[Pin]:
        return [pin for pin in self.pins if pin.kind == kind and pin.url.startswith(MAPBOX_CDN)]

    def engine(self, kind: str) -> list[Pin]:
        return [pin for pin in self.pins if pin.kind == kind and pin.in_block]

    def pinned(self) -> list[Pin]:
        """Every Mapbox GL JS file and everything in the engine block, in page order."""
        return [pin for pin in self.pins if pin.url.startswith(MAPBOX_CDN) or pin.in_block]


def parse_csp(content: str) -> dict[str, list[str]]:
    """`default-src 'none'; script-src a b` -> {"default-src": ["'none'"], "script-src": ["a", "b"]}."""
    directives = [part.split() for part in content.split(";")]
    return {words[0].lower(): words[1:] for words in directives if words}


def subresource(tag: str, attributes: dict[str, str]) -> tuple[str, str]:
    """(kind, address) of a `<script src>` or `<link rel="stylesheet">`; ("", "") for any other tag."""
    if tag == "script":
        return "script", attributes.get("src", "")
    if attributes.get("rel", "").lower() == "stylesheet":
        return "stylesheet", attributes.get("href", "")
    return "", ""


class _PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.page = KitPage()

    def handle_comment(self, data: str) -> None:
        if data.strip() in BLOCK_MARKERS:
            self.page.markers.append(data.strip())

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {name: value or "" for name, value in attrs}
        if attributes.get("http-equiv", "").lower() == "content-security-policy":
            self.page.csp = parse_csp(attributes.get("content", ""))
        self._add_pin(tag, attributes)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)

    def _add_pin(self, tag: str, attributes: dict[str, str]) -> None:
        kind, url = subresource(tag, attributes)
        if url:
            in_block = self.page.markers[-1:] == BLOCK_MARKERS[:1]
            integrity, crossorigin = attributes.get("integrity", ""), attributes.get("crossorigin", "")
            self.page.pins.append(Pin(kind, url, integrity, crossorigin, "defer" in attributes, in_block))


def read_kit_page(path: Path) -> KitPage:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        raise PinError(f"{path}: cannot read it ({error})") from error
    parser = _PageParser()
    parser.feed(text)
    parser.close()
    return parser.page


def page_base(page: KitPage) -> str | None:
    """The pinned jsDelivr folder the engine block's one script comes from, or None."""
    scripts = page.engine("script")
    folder = scripts[0].url.rsplit("/", 1)[0] + "/" if len(scripts) == 1 else ""
    return folder if BASE_RE.match(folder) else None


def base_version(base: str | None) -> str | None:
    """`1.0.0` for a folder pinned `@v1.0.0`, else None."""
    match = BASE_RE.match(base or "")
    return match.group("version") if match else None


@dataclass(frozen=True)
class Expected:
    """What a page pins for a release: its jsDelivr folder, and the integrity of each pinned address."""

    base: str
    pins: dict[str, str]


def _entries(release: dict[str, object]) -> list[dict[str, object]]:
    files = release.get("files")
    return [entry for entry in files if isinstance(entry, dict)] if isinstance(files, list) else []


def release_integrity(release: dict[str, object], path: str) -> str:
    """The integrity `release.json` lists for `path`, or "" when it does not list it once."""
    found = [text_of(entry.get("integrity")) for entry in _entries(release) if entry.get("path") == path]
    return found[0] if len(found) == 1 else ""


def _mapbox_pair(release: dict[str, object], kind: str) -> tuple[str, str]:
    entry = field_of(field_of(release, "mapboxGl"), kind)
    return text_of(field_of(entry, "url")), text_of(field_of(entry, "integrity"))


def expected_pins(release: dict[str, object]) -> Expected:
    """The pins of `release.json`: Mapbox GL JS's two files and the engine's page files below its `base`."""
    base = text_of(release.get("base"))
    pairs = [_mapbox_pair(release, kind) for kind in MAPBOX_KINDS]
    pairs += [(base + name, release_integrity(release, name)) for name in PAGE_FILES.values()]
    return Expected(base, dict(pairs))
