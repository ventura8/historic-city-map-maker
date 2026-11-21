"""Helpers the release gates' tests share: a released engine in cdn/engine/ with its release.json, and a kit page.

Every byte is a generated stand-in (never the real engine or Mapbox GL JS): the gates compare digests, so what the
files hold does not matter, only that the release file and the page agree with them.
"""

import json
from pathlib import Path

from release_pins import ENGINE_FOLDER, KIT_PAGE, RELEASE_JSON, sri

REPOSITORY = "ventura8/historic-city-map-maker"
MAPBOX_JS_URL = "https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.js"
MAPBOX_CSS_URL = "https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.css"
MAPBOX_JS_SRI = sri(b"mapbox-gl test script\n")
MAPBOX_CSS_SRI = sri(b".mapboxgl-map{}\n")
ENGINE_FILES = {
    "engine.iife.js": b"var HistoricCityMap=(function(){return {}})();\n",
    "engine.css": b".hcm-engine-root{display:block}\n",
    "fonts/roboto-flex-latin-wght.woff2": bytes([0x77, 0x4F, 0x46, 0x32, 0x00, 0x0A]),
}


def base_of(version: str, repository: str = REPOSITORY) -> str:
    return f"https://cdn.jsdelivr.net/gh/{repository}@v{version}/cdn/engine/"


def release_document(version: str = "1.0.0", files: dict[str, bytes] | None = None) -> dict[str, object]:
    """The release.json of `files` (default ENGINE_FILES) at `version`."""
    contents = ENGINE_FILES if files is None else files
    return {
        "version": version,
        "repository": REPOSITORY,
        "base": base_of(version),
        "mapboxGl": {
            "version": "3.34.1",
            "script": {"url": MAPBOX_JS_URL, "integrity": MAPBOX_JS_SRI},
            "stylesheet": {"url": MAPBOX_CSS_URL, "integrity": MAPBOX_CSS_SRI},
        },
        "files": [{"path": path, "bytes": len(data), "integrity": sri(data)} for path, data in sorted(contents.items())],
    }


def write_release_folder(root: Path, version: str = "1.0.0") -> dict[str, object]:
    """cdn/engine/ with ENGINE_FILES and the release.json that describes them; returns that document."""
    for path, data in ENGINE_FILES.items():
        target = root / ENGINE_FOLDER / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    document = release_document(version)
    write_release_json(root, document)
    return document


def write_release_json(root: Path, document: object) -> None:
    (root / RELEASE_JSON).parent.mkdir(parents=True, exist_ok=True)
    (root / RELEASE_JSON).write_text(json.dumps(document, indent=4) + "\n", encoding="utf-8")


def engine_tags(base: str, css_sri: str, js_sri: str) -> str:
    return (
        f'<link rel="stylesheet" href="{base}engine.css" integrity="{css_sri}" crossorigin="anonymous" />\n'
        f'<script src="{base}engine.iife.js" integrity="{js_sri}" crossorigin="anonymous" defer></script>\n'
    )


def kit_page(
    version: str = "1.0.0",
    *,
    engine: str | None = None,
    head: str = "",
    csp: str | None = None,
    integrity: tuple[str, str] = (sri(ENGINE_FILES["engine.css"]), sri(ENGINE_FILES["engine.iife.js"])),
) -> str:
    """The kit's page pinned to `version`: `engine` replaces the block's content, `head` adds tags, `csp` the policy,
    `integrity` is the engine's (stylesheet, script)."""
    base = base_of(version)
    policy = (
        csp
        if csp is not None
        else f"default-src 'none'; script-src {base} {MAPBOX_JS_URL}; style-src {base}; connect-src 'self' {base}; font-src {base}"
    )
    block = engine if engine is not None else engine_tags(base, *integrity)
    return (
        '<!doctype html>\n<html lang="ro">\n<head>\n'
        f'<meta http-equiv="Content-Security-Policy" content="{policy}" />\n'
        f'<link rel="stylesheet" href="{MAPBOX_CSS_URL}" integrity="{MAPBOX_CSS_SRI}" crossorigin="anonymous" />\n'
        f'<script src="{MAPBOX_JS_URL}" integrity="{MAPBOX_JS_SRI}" crossorigin="anonymous" defer></script>\n'
        f"{head}<!-- hcm:engine -->\n{block}<!-- /hcm:engine -->\n"
        '</head>\n<body><main><hcm-map-viewer manifest-url="city.json"></hcm-map-viewer></main></body>\n</html>\n'
    )


def write_kit_page(root: Path, text: str) -> None:
    (root / KIT_PAGE).parent.mkdir(parents=True, exist_ok=True)
    (root / KIT_PAGE).write_text(text, encoding="utf-8")
