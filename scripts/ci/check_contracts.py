#!/usr/bin/env python3
"""Contract gate (stage `contract`, weekly in .github/workflows/contract.yml): the third-party pages
and API shapes the product depends on still look the way the code assumes.

1. Deep links. Every Setup Assistant link in packages/admin/src/setup/links.json, its `{name}`
   placeholders filled from its `sample`, must still resolve: HEAD (GET when the server refuses
   HEAD), redirects followed (a sign-in wall is fine), final status 2xx.
2. API drift probes (docs/research/design-review-testability.md §3.7), unauthenticated, no secrets:
   - USGS M2M: the password `login` stays removed (404 NOT_FOUND) and `login-token {}` answers
     500 INPUT_PARAMETER_REQUIRED, the error shapes the Setup Assistant and the pipeline parse;
   - USGS M2M sends no Access-Control-Allow-Origin to the GitHub Pages origin, so the browser
     cannot call it and the server-side path stays necessary;
   - the Mapbox GL JS CDN serves the version pinned as MAPBOX_GL_VERSION in packages/engine/src/index.ts, and
     the very bytes of that npm release (node_modules/mapbox-gl/dist): the city pages carry the npm files'
     Subresource Integrity (scripts/site/src/sri.ts), so a CDN file that differed would be refused by every
     browser and the map would not load (DECISIONS-for-review.md §12f);
   - Earth Search still publishes the sentinel-2-c1-l2a collection (the georeferencing reference);
   - EarthExplorer's scene page, the order card's deep link (M4, docs/research/M4-interfaces.md §1.6), still
     answers 200 for the scene verified on 2026-10-11 and still names it (a page that resolves without the
     scene would send every admin who buys a scan to the wrong place).

Only https is spoken, through scripts/ci/cihttp.py (http.client, no extra dependency). A network
error gets one retry so a blip does not open an issue. Usage: check_contracts.py [--root DIR]
[--links FILE]. Exit status: 0 every contract holds, 1 drift (CI opens or updates an issue), 2 the
links file, the engine version or the installed npm release of mapbox-gl cannot be read.
"""

import argparse
import base64
import hashlib
import json
import re
import sys
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from http import HTTPStatus
from pathlib import Path
from typing import TypeGuard
from urllib.parse import quote, urlsplit

from cihttp import NETWORK_ERRORS, Fetch, Request, Response, follow, https_fetch, is_success, with_retry
from cilog import get_logger

LOG = get_logger("contract")
ROOT = Path(__file__).resolve().parents[2]
LINKS_FILE = Path("packages", "admin", "src", "setup", "links.json")
ENGINE_INDEX = Path("packages", "engine", "src", "index.ts")
NPM_MAPBOX_GL = Path("node_modules", "mapbox-gl")
# The files every city page loads from the CDN with the integrity of the npm release.
CDN_FILES = ("mapbox-gl.js", "mapbox-gl.css")

M2M_API = "https://m2m.cr.usgs.gov/api/api/json/stable"
PAGES_ORIGIN = "https://ventura8.github.io"
EARTH_SEARCH = "https://earth-search.aws.element84.com/v1/collections"
REFERENCE_COLLECTION = "sentinel-2-c1-l2a"
# The order card's deep link (links.json `usgs.sceneMetadata`, `earthExplorerSceneUrl` of @hcm/shared) with the
# Corona scene opened on 2026-10-11 (design-review-onboarding.md §0.6: HTTP 200, "Full Display of DS009013039DV181").
EARTH_EXPLORER_SAMPLE_ENTITY = "DS009013039DV181"
EARTH_EXPLORER_SCENE = f"https://earthexplorer.usgs.gov/scene/metadata/full/5e839febdccb64b3/{EARTH_EXPLORER_SAMPLE_ENTITY}/"
# Servers that reject HEAD outright; the link is then checked with GET.
HEAD_REFUSED = frozenset({HTTPStatus.FORBIDDEN, HTTPStatus.METHOD_NOT_ALLOWED, HTTPStatus.NOT_IMPLEMENTED})
PLACEHOLDER = re.compile(r"\{([A-Za-z][A-Za-z0-9]*)\}")
MAPBOX_GL_VERSION = re.compile(r"MAPBOX_GL_VERSION\s*=\s*'(\d+\.\d+\.\d+)'")
JSON_BODY = (("Content-Type", "application/json"),)

EXIT_DRIFT = 1
EXIT_CONFIG = 2


class ConfigError(Exception):
    """The links file, the engine source or the npm release is not what this check expects (exit 2)."""


Expectation = Callable[[Response], str | None]


@dataclass(frozen=True)
class Link:
    id: str
    url: str


@dataclass(frozen=True)
class Probe:
    name: str
    request: Request
    expect: Expectation
    """None when the contract holds, else what drifted."""


# --- deep links ---------------------------------------------------------------------------------------


def _is_text(value: object) -> TypeGuard[str]:
    return isinstance(value, str) and bool(value)


def _text(entry: Mapping[str, object], key: str, where: str) -> str:
    value = entry.get(key)
    if not _is_text(value):
        raise ConfigError(f"{where}: `{key}` must be a non-empty string")
    return value


def _sample(entry: Mapping[str, object], where: str) -> dict[str, str]:
    sample = entry.get("sample", {})
    if not isinstance(sample, dict) or not all(_is_text(value) for value in sample.values()):
        raise ConfigError(f"{where}: `sample` must map each placeholder name to a non-empty string")
    return {str(name): str(value) for name, value in sample.items()}


def expand(template: str, sample: Mapping[str, str], where: str) -> str:
    """The URL with every `{name}` replaced by its (percent-encoded) sample value."""
    names = sorted(set(PLACEHOLDER.findall(template)))
    if names != sorted(sample):
        raise ConfigError(f"{where}: placeholders {names} need exactly these `sample` values, found {sorted(sample)}")
    return PLACEHOLDER.sub(lambda match: quote(sample[match.group(1)], safe=""), template)


def parse_link(entry: object, index: int) -> Link:
    where = f"links[{index}]"
    if not isinstance(entry, dict):
        raise ConfigError(f"{where}: expected an object")
    link_id = _text(entry, "id", where)
    url = expand(_text(entry, "url", where), _sample(entry, where), f"{where} ({link_id})")
    if urlsplit(url).scheme != "https":
        raise ConfigError(f"{where} ({link_id}): only https deep links are allowed: {url}")
    return Link(link_id, url)


def _entries(path: Path) -> list[object]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ConfigError(f"{path}: cannot read the links file ({error})") from error
    entries = document.get("links") if isinstance(document, dict) else None
    if not isinstance(entries, list) or not entries:
        raise ConfigError(f"{path}: expected a non-empty `links` array")
    return entries


def _duplicates(ids: Sequence[str]) -> list[str]:
    return sorted(link_id for link_id, count in Counter(ids).items() if count > 1)


def load_links(path: Path) -> list[Link]:
    """The deep links of the links file, placeholders expanded; ConfigError on any malformed entry."""
    links = [parse_link(entry, index) for index, entry in enumerate(_entries(path))]
    duplicated = _duplicates([link.id for link in links])
    if duplicated:
        raise ConfigError(f"{path}: duplicated link ids {duplicated}")
    return links


def check_link(link: Link, fetch: Fetch) -> str | None:
    try:
        response = follow(Request("HEAD", link.url), fetch)
        if response.status in HEAD_REFUSED:
            response = follow(Request("GET", link.url), fetch)
    except NETWORK_ERRORS as error:
        return f"link {link.id}: {link.url} is unreachable ({error})"
    if is_success(response.status):
        return None
    return f"link {link.id}: {link.url} answers HTTP {response.status}"


# --- API drift probes ---------------------------------------------------------------------------------


def m2m_error(status: HTTPStatus, code: str) -> Expectation:
    """The M2M JSON error envelope: this HTTP status with this `errorCode`."""

    def expect(response: Response) -> str | None:
        found = response.json_field("errorCode")
        if response.status == status and found == code:
            return None
        return f"expected HTTP {status.value} with errorCode {code}, got HTTP {response.status} with errorCode {found!r}"

    return expect


def no_cors_allowance(response: Response) -> str | None:
    allowed = response.headers.get("access-control-allow-origin")
    if allowed is None:
        return None
    return f"the API now allows the origin {allowed!r} (CORS): a browser could call it directly; revisit the server-side path"


def served_as(content_type: str) -> Expectation:
    """HTTP 200 with this content type (charset parameters ignored)."""

    def expect(response: Response) -> str | None:
        found = response.headers.get("content-type", "")
        if response.status == HTTPStatus.OK and found.startswith(content_type):
            return None
        return f"expected HTTP 200 {content_type}, got HTTP {response.status} {found!r}"

    return expect


def stac_collection(collection_id: str) -> Expectation:
    def expect(response: Response) -> str | None:
        found = response.json_field("id")
        if response.status == HTTPStatus.OK and found == collection_id:
            return None
        return f"expected the STAC collection {collection_id!r}, got HTTP {response.status} with id {found!r}"

    return expect


def page_names(text: str) -> Expectation:
    """HTTP 200 with a body that names `text` (a scene page that resolves but shows no scene is drift)."""

    def expect(response: Response) -> str | None:
        if response.status != HTTPStatus.OK:
            return f"expected HTTP 200, got HTTP {response.status}"
        if text.encode("ascii") in response.body:
            return None
        return f"the page no longer names {text}: the scene's deep link may have moved"

    return expect


def sri_digest(data: bytes) -> str:
    """The Subresource Integrity value of `data`, as scripts/site/src/sri.ts writes it into the page."""
    return "sha384-" + base64.b64encode(hashlib.sha384(data).digest()).decode("ascii")


def same_bytes_as(expected: str) -> Expectation:
    """HTTP 200 with a body whose integrity is `expected`, the npm release's (the page's `integrity` attribute)."""

    def expect(response: Response) -> str | None:
        if response.status != HTTPStatus.OK:
            return f"expected HTTP 200, got HTTP {response.status}"
        found = sri_digest(response.body)
        if found == expected:
            return None
        return f"the CDN file is not the npm release's ({found}, the page expects {expected}): browsers would refuse it"

    return expect


def build_probes(mapbox_version: str, npm_digests: Mapping[str, str]) -> list[Probe]:
    """Every API probe; `npm_digests` maps each of CDN_FILES to the integrity of the pinned npm release's copy."""
    cdn = f"https://api.mapbox.com/mapbox-gl-js/v{mapbox_version}"
    preflight = (("Origin", PAGES_ORIGIN), ("Access-Control-Request-Method", "POST"))
    return [
        Probe(
            "usgs.m2m.passwordLoginRemoved",
            Request("POST", f"{M2M_API}/login", b"{}", JSON_BODY),
            m2m_error(HTTPStatus.NOT_FOUND, "NOT_FOUND"),
        ),
        Probe(
            "usgs.m2m.loginTokenErrorShape",
            Request("POST", f"{M2M_API}/login-token", b"{}", JSON_BODY),
            m2m_error(HTTPStatus.INTERNAL_SERVER_ERROR, "INPUT_PARAMETER_REQUIRED"),
        ),
        Probe("usgs.m2m.noBrowserCors", Request("OPTIONS", f"{M2M_API}/login-token", None, preflight), no_cors_allowance),
        Probe("mapbox.glJs", Request("HEAD", f"{cdn}/mapbox-gl.js"), served_as("application/javascript")),
        Probe("mapbox.glCss", Request("HEAD", f"{cdn}/mapbox-gl.css"), served_as("text/css")),
        *(Probe(f"mapbox.integrity.{name}", Request("GET", f"{cdn}/{name}"), same_bytes_as(npm_digests[name])) for name in CDN_FILES),
        Probe(
            "earthSearch.referenceCollection",
            Request("GET", f"{EARTH_SEARCH}/{REFERENCE_COLLECTION}"),
            stac_collection(REFERENCE_COLLECTION),
        ),
        Probe("usgs.earthExplorerScene", Request("GET", EARTH_EXPLORER_SCENE), page_names(EARTH_EXPLORER_SAMPLE_ENTITY)),
    ]


def check_probe(probe: Probe, fetch: Fetch) -> str | None:
    try:
        response = fetch(probe.request)
    except NETWORK_ERRORS as error:
        return f"probe {probe.name}: {probe.request.method} {probe.request.url} failed ({error})"
    problem = probe.expect(response)
    return None if problem is None else f"probe {probe.name}: {problem}"


def mapbox_version(engine_index: Path) -> str:
    """MAPBOX_GL_VERSION of the engine: the one version every page loads from api.mapbox.com."""
    try:
        match = MAPBOX_GL_VERSION.search(engine_index.read_text(encoding="utf-8"))
    except OSError as error:
        raise ConfigError(f"{engine_index}: cannot read the engine source ({error})") from error
    if match is None:
        raise ConfigError(f"{engine_index}: no `MAPBOX_GL_VERSION = 'X.Y.Z'` constant")
    return match.group(1)


def _installed_version(package: Path) -> object:
    document = json.loads((package / "package.json").read_text(encoding="utf-8"))
    return document.get("version") if isinstance(document, dict) else None


def npm_release_digests(root: Path, version: str) -> dict[str, str]:
    """The integrity of each of CDN_FILES in the installed npm release, which must be exactly `version`."""
    package = root / NPM_MAPBOX_GL
    try:
        installed = _installed_version(package)
        digests = {name: sri_digest((package / "dist" / name).read_bytes()) for name in CDN_FILES}
    except (OSError, ValueError) as error:
        raise ConfigError(f"{package}: cannot read the npm release of mapbox-gl; run npm ci ({error})") from error
    if installed != version:
        raise ConfigError(f"{package}: mapbox-gl {installed} is installed, but the engine pins {version}")
    return digests


# --- run ----------------------------------------------------------------------------------------------


def check_all(links: Sequence[Link], probes: Sequence[Probe], fetch: Fetch) -> list[tuple[str, str | None]]:
    """(check name, problem or None) for every link, then every probe."""
    link_results = [(f"link {link.id}", check_link(link, fetch)) for link in links]
    return link_results + [(f"probe {probe.name}", check_probe(probe, fetch)) for probe in probes]


def verdict(problems: Sequence[str], total: int) -> int:
    if problems:
        LOG.error("[contract] %d of %d checks drifted:\n%s", len(problems), total, "\n".join(f"  - {problem}" for problem in problems))
        return EXIT_DRIFT
    LOG.info("[contract] OK: %d checks, every link resolves and every API keeps its shape", total)
    return 0


def report(results: Sequence[tuple[str, str | None]]) -> int:
    """One `ok`/`DRIFT` line per check, then the verdict (the drift list feeds the CI issue)."""
    for name, problem in results:
        LOG.info("  %s %s", "ok   " if problem is None else "DRIFT", name)
    return verdict([problem for _, problem in results if problem is not None], len(results))


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check third-party deep links and API shapes the product depends on.")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    parser.add_argument("--links", type=Path, default=LINKS_FILE, help="links file, relative to --root")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None, fetch: Fetch | None = None) -> int:
    args = parse_args(argv)
    try:
        links = load_links(args.root / args.links)
        version = mapbox_version(args.root / ENGINE_INDEX)
        probes = build_probes(version, npm_release_digests(args.root, version))
    except ConfigError as error:
        LOG.error("[contract] ERROR: %s", error)
        return EXIT_CONFIG
    return report(check_all(links, probes, fetch or with_retry(https_fetch)))


if __name__ == "__main__":
    sys.exit(main())
