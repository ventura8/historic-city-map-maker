"""check_kit_pins.py: the released engine in cdn/engine/, its release.json and the starter kit's pins agree.

Every repository is built under tmp_path from generated stand-ins (releaseutil); nothing reads the real tree.
"""

import json
import logging
import runpy
import sys
from pathlib import Path

import check_kit_pins
import pytest
import release_pins
from releaseutil import (
    ENGINE_FILES,
    MAPBOX_CSS_SRI,
    MAPBOX_JS_URL,
    base_of,
    engine_tags,
    kit_page,
    release_document,
    write_kit_page,
    write_release_folder,
    write_release_json,
)

KIT_PY = Path(check_kit_pins.__file__)
PAGE = "templates/starter-kit/index.html"
OTHER_SRI = "sha384-" + "A" * 64


@pytest.fixture
def log(caplog: pytest.LogCaptureFixture) -> pytest.LogCaptureFixture:
    caplog.set_level(logging.INFO, logger="hcm")
    return caplog


def problems_of(root: Path) -> list[str]:
    return check_kit_pins.kit_pins_problems(root)


def test_happy_path_nothing_is_pinned_before_the_kit_exists(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    assert check_kit_pins.main(["--root", str(tmp_path)]) == 0
    assert "[kit-pins] OK: no starter-kit page and no engine release yet; nothing is pinned" in log.text


def test_happy_path_before_the_first_release_the_page_is_checked_in_shape(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    write_kit_page(tmp_path, kit_page("1.0.0", integrity=(OTHER_SRI, OTHER_SRI)))

    assert check_kit_pins.main(["--root", str(tmp_path)]) == 0
    assert f"[kit-pins] OK: {PAGE} is pinned in shape (no engine release in cdn/engine yet)" in log.text


@pytest.mark.parametrize("version", ["1.0.0", "1.0.0-beta.1", "2.3.4-rc.0"])
def test_happy_path_the_page_pins_exactly_the_release(tmp_path: Path, log: pytest.LogCaptureFixture, version: str) -> None:
    write_release_folder(tmp_path, version)
    write_kit_page(tmp_path, kit_page(version))

    assert check_kit_pins.main(["--root", str(tmp_path)]) == 0
    assert f"[kit-pins] OK: {PAGE} pins exactly the engine release in cdn/engine" in log.text


@pytest.mark.parametrize(
    ("page", "problem"),
    [
        (kit_page().replace("<!-- /hcm:engine -->", ""), "expected one <!-- hcm:engine --> ... <!-- /hcm:engine --> block"),
        (kit_page(head=f'<script src="{base_of("1.0.0")}engine.iife.js" defer></script>\n'), "is loaded outside the engine block"),
        (kit_page().replace(f' integrity="{MAPBOX_CSS_SRI}"', ""), "Mapbox GL JS stylesheet has no sha384 integrity"),
        (
            kit_page().replace(' crossorigin="anonymous" defer></script>', " defer></script>", 1),
            'Mapbox GL JS script needs crossorigin="anonymous"',
        ),
        (kit_page().replace(" defer></script>", "></script>", 1), "Mapbox GL JS script must be deferred"),
        (kit_page(head=f'<script src="{MAPBOX_JS_URL}"></script>\n'), "expected one Mapbox GL JS script, found 2"),
        (
            kit_page().replace("v3.34.1/mapbox-gl.css", "latest/mapbox-gl.css"),
            "Mapbox GL JS stylesheet comes from https://api.mapbox.com/mapbox-gl-js/latest/",
        ),
        (kit_page(engine='<script src="engine/engine.iife.js" defer></script>\n'), "the engine script must come from a pinned folder"),
        (
            kit_page(engine=engine_tags(base_of("1.0.0").replace("@v1.0.0", "@1"), OTHER_SRI, OTHER_SRI)),
            "the engine script must come from a pinned folder",
        ),
        (
            kit_page(engine=engine_tags(base_of("1.0.0"), OTHER_SRI, OTHER_SRI).replace("/engine.css", "/other.css")),
            "engine stylesheet comes from",
        ),
        (
            kit_page(engine=engine_tags(base_of("1.0.0"), OTHER_SRI, OTHER_SRI) * 2),
            "expected one engine script in the engine block, found 2",
        ),
        (kit_page(engine=engine_tags(base_of("1.0.0"), OTHER_SRI, OTHER_SRI).replace(" defer>", ">")), "engine script must be deferred"),
        (
            kit_page(csp=f"default-src 'none'; script-src {base_of('1.0.0')}; style-src {base_of('1.0.0')}"),
            "the CSP's font-src does not name",
        ),
        (
            kit_page(csp=f"default-src 'none'; script-src {base_of('1.0.0')}; style-src {base_of('1.0.0')}; font-src {base_of('1.0.0')}"),
            "the CSP's connect-src does not name",
        ),
        (kit_page().replace('http-equiv="Content-Security-Policy"', 'name="csp"'), "no meta Content-Security-Policy"),
    ],
)
def test_bad_path_a_page_that_is_not_pinned_in_shape_fails(tmp_path: Path, log: pytest.LogCaptureFixture, page: str, problem: str) -> None:
    write_kit_page(tmp_path, page)

    assert check_kit_pins.main(["--root", str(tmp_path)]) == 1
    assert "[kit-pins] FAILED:" in log.text
    assert problem in log.text


def test_bad_path_a_page_of_another_release_or_with_stale_integrity_fails(tmp_path: Path) -> None:
    write_release_folder(tmp_path, "1.0.0")

    write_kit_page(tmp_path, kit_page("0.9.0"))
    assert problems_of(tmp_path)[0] == f"{PAGE}: pins {base_of('0.9.0')}, cdn/engine/release.json says {base_of('1.0.0')}"

    write_kit_page(tmp_path, kit_page("1.0.0", integrity=(OTHER_SRI, release_pins.sri(ENGINE_FILES["engine.iife.js"]))))
    assert problems_of(tmp_path) == [
        f"{PAGE}: {base_of('1.0.0')}engine.css is pinned to {OTHER_SRI}, not to cdn/engine/release.json's integrity"
    ]


def test_bad_path_a_release_without_the_kit_page_fails(tmp_path: Path) -> None:
    write_release_folder(tmp_path)

    assert problems_of(tmp_path) == [f"{PAGE} is missing: a release pins the starter kit's page"]


def test_bad_path_a_release_folder_that_drifted_fails_before_the_page_is_compared(tmp_path: Path) -> None:
    write_release_folder(tmp_path)
    write_kit_page(tmp_path, kit_page("1.0.0", integrity=(OTHER_SRI, OTHER_SRI)))
    (tmp_path / "cdn/engine/engine.css").write_bytes(b".edited{}\n")
    (tmp_path / "cdn/engine/fonts/roboto-flex-latin-wght.woff2").unlink()
    (tmp_path / "cdn/engine/extra.js").write_text("x\n", encoding="utf-8")

    fix = f"({check_kit_pins.FIX})"
    assert problems_of(tmp_path) == [
        f"cdn/engine/extra.js: committed but not listed in release.json {fix}",
        f"cdn/engine/engine.css: its size or integrity is not the one release.json lists {fix}",
        f"cdn/engine/fonts/roboto-flex-latin-wght.woff2: listed in release.json but not committed {fix}",
    ]


def broken(change: dict[str, object]) -> dict[str, object]:
    return {**release_document("1.0.0"), **change}


def entry(path: str, size: object = 3, integrity: str = OTHER_SRI) -> dict[str, object]:
    return {"path": path, "bytes": size, "integrity": integrity}


PAGE_ENTRIES = [entry("engine.css"), entry("engine.iife.js")]


@pytest.mark.parametrize(
    ("document", "problem"),
    [
        ({"version": "1.0.0"}, "cdn/engine/release.json: keys ['version'], expected"),
        (broken({"version": "v1.0.0"}), "version 'v1.0.0' or repository"),
        (broken({"version": "1.0.0-alpha.1"}), "version '1.0.0-alpha.1' or repository"),
        (broken({"version": "1.0.0-beta.01"}), "version '1.0.0-beta.01' or repository"),
        (broken({"repository": "no-slash"}), "or repository 'no-slash' is malformed"),
        (broken({"base": base_of("1.0.1")}), f"base '{base_of('1.0.1')}', expected '{base_of('1.0.0')}'"),
        (broken({"mapboxGl": {"version": "3.34.1"}}), "mapboxGl must name a version and its script and stylesheet"),
        (broken({"mapboxGl": "3.34.1"}), "mapboxGl must name a version"),
        (broken({"files": {}}), "files must be 2 to 100 entries"),
        (broken({"files": [entry("engine.css")]}), "files must be 2 to 100 entries"),
        (broken({"files": [entry("engine.css", 0), entry("engine.iife.js")]}), "files must be 2 to 100 entries"),
        (broken({"files": [entry("engine.css", True), entry("engine.iife.js")]}), "files must be 2 to 100 entries"),
        (broken({"files": [entry("../engine.css"), entry("engine.iife.js")]}), "files must be 2 to 100 entries"),
        (broken({"files": [{**entry("engine.css"), "extra": 1}, entry("engine.iife.js")]}), "files must be 2 to 100 entries"),
        (broken({"files": [entry("engine.css", integrity="sha256-x"), entry("engine.iife.js")]}), "files must be 2 to 100 entries"),
        (broken({"files": [*PAGE_ENTRIES, entry("engine.css")]}), "cdn/engine/release.json: engine.css is listed twice"),
        (broken({"files": [entry("engine.css"), entry("engine.mjs")]}), "the page file engine.iife.js is not listed"),
        (broken({"files": [*PAGE_ENTRIES, entry("release.json")]}), "cdn/engine/release.json: lists itself"),
    ],
)
def test_bad_path_an_invalid_release_file_fails(
    tmp_path: Path, log: pytest.LogCaptureFixture, document: dict[str, object], problem: str
) -> None:
    write_release_folder(tmp_path)
    write_release_json(tmp_path, document)
    write_kit_page(tmp_path, kit_page("1.0.0"))

    assert check_kit_pins.main(["--root", str(tmp_path)]) == 1
    assert problem in log.text


@pytest.mark.parametrize("text", ["{broken", "[]"])
def test_bad_path_an_unreadable_release_file_fails_with_its_reason(tmp_path: Path, log: pytest.LogCaptureFixture, text: str) -> None:
    write_release_folder(tmp_path)
    (tmp_path / "cdn/engine/release.json").write_text(text, encoding="utf-8")

    assert check_kit_pins.main(["--root", str(tmp_path)]) == 1
    assert "cdn/engine/release.json: " in log.text


def test_happy_path_the_page_parser_reads_pins_markers_and_policy(tmp_path: Path) -> None:
    write_kit_page(
        tmp_path, kit_page("1.2.3", head='<!-- a note -->\n<link rel="icon" href="data:," />\n<link rel="preload" href="x.woff2" />\n')
    )

    page = release_pins.read_kit_page(tmp_path / PAGE)

    assert page.markers == ["hcm:engine", "/hcm:engine"]
    assert [pin.kind for pin in page.pinned()] == ["stylesheet", "script", "stylesheet", "script"]
    assert release_pins.page_base(page) == base_of("1.2.3")
    assert release_pins.base_version(release_pins.page_base(page)) == "1.2.3"
    assert release_pins.base_version(None) is None
    assert release_pins.base_version(base_of("1.2.3-rc.4")) == "1.2.3-rc.4"
    assert release_pins.base_version(base_of("1.2.3-alpha.4")) is None
    assert release_pins.base_version(base_of("1").replace("@v1", "@1")) is None
    assert page.csp is not None
    assert page.csp["font-src"] == [base_of("1.2.3")]
    assert release_pins.parse_csp("Script-Src a b;; ;img-src") == {"script-src": ["a", "b"], "img-src": []}


def test_bad_path_a_missing_page_cannot_be_read(tmp_path: Path) -> None:
    with pytest.raises(release_pins.PinError, match="cannot read it"):
        release_pins.read_kit_page(tmp_path / PAGE)


def test_bad_path_the_release_integrity_of_an_odd_file_list_is_empty() -> None:
    assert release_pins.release_integrity({"files": "none"}, "engine.css") == ""
    assert release_pins.release_integrity({"files": [entry("engine.css"), entry("engine.css"), "x"]}, "engine.css") == ""
    assert release_pins.release_integrity({"files": [{"path": "engine.css", "integrity": 3}]}, "engine.css") == ""
    assert release_pins.expected_pins({"base": 3}).base == ""


def test_happy_path_the_expected_pins_of_a_release() -> None:
    document = release_document("2.0.0")

    expected = release_pins.expected_pins(document)

    assert expected.base == base_of("2.0.0")
    assert expected.pins[f"{base_of('2.0.0')}engine.iife.js"] == release_pins.sri(ENGINE_FILES["engine.iife.js"])
    assert expected.pins[MAPBOX_JS_URL] == json.loads(json.dumps(document))["mapboxGl"]["script"]["integrity"]
    assert len(expected.pins) == 4


def test_bad_path_script_entry_point_exits_with_main_status(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    write_kit_page(tmp_path, kit_page().replace("<!-- hcm:engine -->", ""))
    monkeypatch.setattr(sys, "argv", [str(KIT_PY), "--root", str(tmp_path)])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(KIT_PY), run_name="__main__")

    assert exit_info.value.code == 1
