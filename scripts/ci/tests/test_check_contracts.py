"""check_contracts.py: deep links and API drift probes against a scripted web, never the real one.

`FakeWeb` answers each (method, URL) with a programmed response or error and records the calls;
an unprogrammed request fails the test loudly (the transport itself is tested in test_cihttp.py).
The real links file is parsed too, so a malformed edit fails here.
"""

import http.client
import json
import logging
import runpy
import sys
from collections.abc import Mapping
from pathlib import Path

import check_contracts
import cihttp
import pytest
from check_contracts import Link, Probe
from cihttp import Request, Response

CONTRACTS_PY = Path(check_contracts.__file__)
M2M = check_contracts.M2M_API
CDN = "https://api.mapbox.com/mapbox-gl-js/v3.34.1"
COLLECTION_URL = f"{check_contracts.EARTH_SEARCH}/{check_contracts.REFERENCE_COLLECTION}"
LINK_URL = "https://console.example.org/billing"
# Stand-ins for the npm release's files; the probes compare the CDN's bytes with them.
NPM_FILES = {"mapbox-gl.js": b"/* mapbox-gl 3.34.1 */", "mapbox-gl.css": b".mapboxgl-map{overflow:hidden}"}
DIGESTS = {name: check_contracts.sri_digest(data) for name, data in NPM_FILES.items()}

Answer = Response | Exception


class FakeWeb:
    """Programmed answers per (method, url); a list of answers is served in order, the last one repeats."""

    def __init__(self, answers: Mapping[tuple[str, str], Answer | list[Answer]]) -> None:
        self.answers = {key: value if isinstance(value, list) else [value] for key, value in answers.items()}
        self.calls: list[Request] = []

    def __call__(self, request: Request) -> Response:
        self.calls.append(request)
        queue = self.answers[(request.method, request.url)]
        answer = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(answer, Exception):
            raise answer
        return answer


def m2m_body(code: str) -> bytes:
    return json.dumps({"data": None, "errorCode": code, "errorMessage": "x"}).encode()


def healthy_probe_answers() -> dict[tuple[str, str], Answer | list[Answer]]:
    return {
        ("POST", f"{M2M}/login"): Response(404, {}, m2m_body("NOT_FOUND")),
        ("POST", f"{M2M}/login-token"): Response(500, {}, m2m_body("INPUT_PARAMETER_REQUIRED")),
        ("OPTIONS", f"{M2M}/login-token"): Response(204, {"access-control-allow-methods": "GET, POST"}),
        ("HEAD", f"{CDN}/mapbox-gl.js"): Response(200, {"content-type": "application/javascript; charset=utf-8"}),
        ("HEAD", f"{CDN}/mapbox-gl.css"): Response(200, {"content-type": "text/css; charset=utf-8"}),
        ("GET", f"{CDN}/mapbox-gl.js"): Response(200, {}, NPM_FILES["mapbox-gl.js"]),
        ("GET", f"{CDN}/mapbox-gl.css"): Response(200, {}, NPM_FILES["mapbox-gl.css"]),
        ("GET", COLLECTION_URL): Response(200, {"content-type": "application/json"}, b'{"type": "Collection", "id": "sentinel-2-c1-l2a"}'),
        ("GET", check_contracts.EARTH_EXPLORER_SCENE): Response(200, {}, b"<title>Full Display of DS009013039DV181</title>"),
    }


def write_repo(
    root: Path, links: object, engine: str = "export const MAPBOX_GL_VERSION = '3.34.1';\n", npm_version: str = "3.34.1"
) -> None:
    links_file = root / check_contracts.LINKS_FILE
    links_file.parent.mkdir(parents=True, exist_ok=True)
    links_file.write_text(json.dumps(links), encoding="utf-8")
    engine_file = root / check_contracts.ENGINE_INDEX
    engine_file.parent.mkdir(parents=True, exist_ok=True)
    engine_file.write_text(engine, encoding="utf-8")
    package = root / check_contracts.NPM_MAPBOX_GL
    (package / "dist").mkdir(parents=True, exist_ok=True)
    (package / "package.json").write_text(json.dumps({"name": "mapbox-gl", "version": npm_version}), encoding="utf-8")
    for name, data in NPM_FILES.items():
        (package / "dist" / name).write_bytes(data)


def links_doc(*entries: object) -> dict[str, object]:
    return {"links": list(entries)}


@pytest.fixture
def log(caplog: pytest.LogCaptureFixture) -> pytest.LogCaptureFixture:
    caplog.set_level(logging.INFO, logger="hcm")
    return caplog


# --- the whole run ------------------------------------------------------------------------------------


def test_happy_path_every_contract_holds(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    write_repo(tmp_path, links_doc({"id": "gcp.billing", "url": LINK_URL}))
    web = FakeWeb({**healthy_probe_answers(), ("HEAD", LINK_URL): Response(200)})

    assert check_contracts.main(["--root", str(tmp_path)], web) == 0
    assert "[contract] OK: 10 checks, every link resolves and every API keeps its shape" in log.text
    assert "  ok    link gcp.billing" in log.text


def test_bad_path_drift_is_listed_and_exits_1(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    write_repo(tmp_path, links_doc({"id": "gcp.billing", "url": LINK_URL}))
    answers = healthy_probe_answers()
    answers[("POST", f"{M2M}/login")] = Response(200, {}, b'{"data": "api-key", "errorCode": null}')
    web = FakeWeb({**answers, ("HEAD", LINK_URL): Response(404)})

    assert check_contracts.main(["--root", str(tmp_path)], web) == check_contracts.EXIT_DRIFT
    assert "[contract] 2 of 10 checks drifted:" in log.text
    assert f"  - link gcp.billing: {LINK_URL} answers HTTP 404" in log.text
    assert (
        "  - probe usgs.m2m.passwordLoginRemoved: expected HTTP 404 with errorCode NOT_FOUND, got HTTP 200 with errorCode None" in log.text
    )
    assert "  DRIFT link gcp.billing" in log.text


def test_happy_path_probes_follow_the_engine_mapbox_version(tmp_path: Path) -> None:
    write_repo(
        tmp_path, links_doc({"id": "a", "url": LINK_URL}), engine="export const MAPBOX_GL_VERSION = '3.40.1';\n", npm_version="3.40.1"
    )
    answers = healthy_probe_answers()
    for method in ("HEAD", "GET"):
        for name in check_contracts.CDN_FILES:
            answers[(method, f"https://api.mapbox.com/mapbox-gl-js/v3.40.1/{name}")] = answers.pop((method, f"{CDN}/{name}"))

    assert check_contracts.main(["--root", str(tmp_path)], FakeWeb({**answers, ("HEAD", LINK_URL): Response(200)})) == 0


def test_happy_path_real_links_file_is_valid() -> None:
    links = check_contracts.load_links(check_contracts.ROOT / check_contracts.LINKS_FILE)

    assert len(links) == len({link.id for link in links}) >= 10
    assert all(link.url.startswith("https://") and "{" not in link.url for link in links)
    assert Link("gcp.blazeUpgrade", "https://console.firebase.google.com/project/demo-hcm/usage/details") in links


def test_happy_path_real_engine_pins_a_mapbox_version() -> None:
    assert check_contracts.mapbox_version(check_contracts.ROOT / check_contracts.ENGINE_INDEX).count(".") == 2


# --- deep links ---------------------------------------------------------------------------------------


def test_happy_path_redirects_are_followed_to_a_sign_in_page() -> None:
    web = FakeWeb(
        {
            ("HEAD", LINK_URL): Response(302, {"location": "/login?next=billing"}),
            ("HEAD", "https://console.example.org/login?next=billing"): Response(301, {"location": "https://accounts.example.org/"}),
            ("HEAD", "https://accounts.example.org/"): Response(200),
        }
    )

    assert check_contracts.check_link(Link("a", LINK_URL), web) is None
    assert len(web.calls) == 3


def test_happy_path_head_refused_falls_back_to_get() -> None:
    web = FakeWeb({("HEAD", LINK_URL): Response(405), ("GET", LINK_URL): Response(200)})

    assert check_contracts.check_link(Link("a", LINK_URL), web) is None


def test_bad_path_get_fallback_still_failing_is_drift() -> None:
    web = FakeWeb({("HEAD", LINK_URL): Response(403), ("GET", LINK_URL): Response(410)})

    assert check_contracts.check_link(Link("a", LINK_URL), web) == f"link a: {LINK_URL} answers HTTP 410"


def test_bad_path_redirect_without_location_is_judged_as_is() -> None:
    web = FakeWeb({("HEAD", LINK_URL): Response(302)})

    assert check_contracts.check_link(Link("a", LINK_URL), web) == f"link a: {LINK_URL} answers HTTP 302"


def test_bad_path_redirect_loop_is_unreachable() -> None:
    web = FakeWeb({("HEAD", LINK_URL): Response(307, {"location": LINK_URL})})

    problem = check_contracts.check_link(Link("a", LINK_URL), web)

    assert problem == f"link a: {LINK_URL} is unreachable (more than 10 redirects from {LINK_URL})"
    assert len(web.calls) == cihttp.MAX_REDIRECTS + 1


def test_bad_path_network_error_is_unreachable() -> None:
    web = FakeWeb({("HEAD", LINK_URL): ConnectionRefusedError("refused")})

    assert check_contracts.check_link(Link("a", LINK_URL), web) == f"link a: {LINK_URL} is unreachable (refused)"


# --- probes -------------------------------------------------------------------------------------------


def probe_named(name: str) -> Probe:
    return next(probe for probe in check_contracts.build_probes("3.34.1", DIGESTS) if probe.name == name)


@pytest.mark.parametrize(
    ("name", "response", "problem"),
    [
        (
            "usgs.m2m.loginTokenErrorShape",
            Response(500, {}, b"<html>Application Offline</html>"),
            "expected HTTP 500 with errorCode INPUT_PARAMETER_REQUIRED, got HTTP 500 with errorCode None",
        ),
        (
            "usgs.m2m.loginTokenErrorShape",
            Response(500, {}, b"[1, 2]"),
            "expected HTTP 500 with errorCode INPUT_PARAMETER_REQUIRED, got HTTP 500 with errorCode None",
        ),
        (
            "usgs.m2m.noBrowserCors",
            Response(204, {"access-control-allow-origin": "*"}),
            "the API now allows the origin '*' (CORS): a browser could call it directly; revisit the server-side path",
        ),
        ("mapbox.glJs", Response(404, {"content-type": "text/html"}), "expected HTTP 200 application/javascript, got HTTP 404 'text/html'"),
        ("mapbox.glCss", Response(200), "expected HTTP 200 text/css, got HTTP 200 ''"),
        ("mapbox.integrity.mapbox-gl.css", Response(403), "expected HTTP 200, got HTTP 403"),
        (
            "mapbox.integrity.mapbox-gl.js",
            Response(200, {}, b"/* rebuilt */"),
            f"the CDN file is not the npm release's ({check_contracts.sri_digest(b'/* rebuilt */')}, the page expects "
            f"{DIGESTS['mapbox-gl.js']}): browsers would refuse it",
        ),
        (
            "earthSearch.referenceCollection",
            Response(200, {}, b'{"id": "sentinel-2-l2a"}'),
            "expected the STAC collection 'sentinel-2-c1-l2a', got HTTP 200 with id 'sentinel-2-l2a'",
        ),
        ("usgs.earthExplorerScene", Response(404, {}, b"Not Found"), "expected HTTP 200, got HTTP 404"),
        (
            "usgs.earthExplorerScene",
            Response(200, {}, b"<title>EarthExplorer</title>"),
            "the page no longer names DS009013039DV181: the scene's deep link may have moved",
        ),
    ],
)
def test_bad_path_probe_reports_the_drift(name: str, response: Response, problem: str) -> None:
    probe = probe_named(name)
    web = FakeWeb({(probe.request.method, probe.request.url): response})

    assert check_contracts.check_probe(probe, web) == f"probe {name}: {problem}"


def test_happy_path_probes_send_the_documented_requests() -> None:
    probes = {probe.name: probe.request for probe in check_contracts.build_probes("3.34.1", DIGESTS)}

    assert probes["usgs.m2m.passwordLoginRemoved"] == Request("POST", f"{M2M}/login", b"{}", (("Content-Type", "application/json"),))
    assert probes["usgs.m2m.noBrowserCors"].headers == (("Origin", "https://ventura8.github.io"), ("Access-Control-Request-Method", "POST"))


def test_bad_path_probe_network_error_is_drift() -> None:
    probe = probe_named("mapbox.glJs")
    web = FakeWeb({("HEAD", f"{CDN}/mapbox-gl.js"): http.client.RemoteDisconnected("closed")})

    assert check_contracts.check_probe(probe, web) == f"probe mapbox.glJs: HEAD {CDN}/mapbox-gl.js failed (closed)"


# --- configuration errors -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("links", "message"),
    [
        ([], "expected a non-empty `links` array"),
        ({"links": []}, "expected a non-empty `links` array"),
        (links_doc("https://x.org"), "links[0]: expected an object"),
        (links_doc({"url": LINK_URL}), "links[0]: `id` must be a non-empty string"),
        (links_doc({"id": "a", "url": ""}), "links[0]: `url` must be a non-empty string"),
        (links_doc({"id": "a", "url": "https://x.org/{p}", "sample": []}), "links[0]: `sample` must map each placeholder"),
        (links_doc({"id": "a", "url": "https://x.org/{p}", "sample": {"p": 1}}), "links[0]: `sample` must map each placeholder"),
        (
            links_doc({"id": "a", "url": "https://x.org/{p}"}),
            "links[0] (a): placeholders ['p'] need exactly these `sample` values, found []",
        ),
        (links_doc({"id": "a", "url": LINK_URL, "sample": {"p": "x"}}), "placeholders [] need exactly these `sample` values, found ['p']"),
        (links_doc({"id": "a", "url": "http://x.org/"}), "links[0] (a): only https deep links are allowed: http://x.org/"),
        (links_doc({"id": "a", "url": LINK_URL}, {"id": "a", "url": LINK_URL}), "duplicated link ids ['a']"),
    ],
)
def test_bad_path_malformed_links_file_exits_2(tmp_path: Path, log: pytest.LogCaptureFixture, links: object, message: str) -> None:
    write_repo(tmp_path, links)

    assert check_contracts.main(["--root", str(tmp_path)], FakeWeb({})) == check_contracts.EXIT_CONFIG
    assert message in log.text


def test_happy_path_placeholders_are_percent_encoded() -> None:
    url = check_contracts.expand("https://x.org/scene/{entityId}/", {"entityId": "a b/c"}, "here")

    assert url == "https://x.org/scene/a%20b%2Fc/"


def test_bad_path_unreadable_or_invalid_json_exits_2(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    write_repo(tmp_path, {})
    (tmp_path / check_contracts.LINKS_FILE).write_text("{not json", encoding="utf-8")

    assert check_contracts.main(["--root", str(tmp_path)], FakeWeb({})) == check_contracts.EXIT_CONFIG
    assert "cannot read the links file" in log.text


@pytest.mark.parametrize(
    ("engine", "message"),
    [
        ("export const ENGINE_VERSION = '1.0.0';\n", "no `MAPBOX_GL_VERSION = 'X.Y.Z'` constant"),
        (None, "cannot read the engine source"),
    ],
)
def test_bad_path_engine_without_mapbox_version_exits_2(
    tmp_path: Path, log: pytest.LogCaptureFixture, engine: str | None, message: str
) -> None:
    write_repo(tmp_path, links_doc({"id": "a", "url": LINK_URL}), engine=engine or "")
    if engine is None:
        (tmp_path / check_contracts.ENGINE_INDEX).unlink()

    assert check_contracts.main(["--root", str(tmp_path)], FakeWeb({})) == check_contracts.EXIT_CONFIG
    assert message in log.text


def test_bad_path_script_entry_point_exits_with_main_status(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(sys, "argv", [str(CONTRACTS_PY), "--root", str(tmp_path), "--links", "missing.json"])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(CONTRACTS_PY), run_name="__main__")

    assert exit_info.value.code == check_contracts.EXIT_CONFIG


@pytest.mark.parametrize(
    ("relative", "content", "message"),
    [
        ("package.json", None, "cannot read the npm release of mapbox-gl; run npm ci"),
        ("dist/mapbox-gl.css", None, "cannot read the npm release of mapbox-gl; run npm ci"),
        ("package.json", "{", "cannot read the npm release of mapbox-gl; run npm ci"),
        ("package.json", "[]", "mapbox-gl None is installed, but the engine pins 3.34.1"),
        ("package.json", '{"version": "3.31.0"}', "mapbox-gl 3.31.0 is installed, but the engine pins 3.34.1"),
    ],
)
def test_bad_path_npm_release_unreadable_or_not_the_pinned_one_exits_2(
    tmp_path: Path, log: pytest.LogCaptureFixture, relative: str, content: str | None, message: str
) -> None:
    write_repo(tmp_path, links_doc({"id": "a", "url": LINK_URL}))
    target = tmp_path / check_contracts.NPM_MAPBOX_GL / relative
    if content is None:
        target.unlink()
    else:
        target.write_text(content, encoding="utf-8")

    assert check_contracts.main(["--root", str(tmp_path)], FakeWeb({})) == check_contracts.EXIT_CONFIG
    assert message in log.text


def test_happy_path_installed_npm_release_is_the_pinned_one() -> None:
    version = check_contracts.mapbox_version(check_contracts.ROOT / check_contracts.ENGINE_INDEX)

    assert sorted(check_contracts.npm_release_digests(check_contracts.ROOT, version)) == sorted(check_contracts.CDN_FILES)


def test_happy_path_digest_is_the_one_the_site_build_writes() -> None:
    # scripts/site/src/sri.ts: `sha384-` and the base64 of the SHA-384 digest (the SRI spec's example input).
    assert (
        check_contracts.sri_digest(b"alert('Hello, world.');") == "sha384-H8BRh8j48O9oYatfu5AZzq6A9RINhZO5H16dQZngK7T62em8MUt1FLm52t+eX6xO"
    )
