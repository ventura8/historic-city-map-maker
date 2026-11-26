"""check_dependency_updates.py: pins read from a fake repository, registries answered by fakes, never the network.

`FakeRun` stands in for npm and pip (programmed per command), `FakeWeb` for Docker Hub, ghcr.io and the GitHub
API (programmed per URL; an unprogrammed request fails the test loudly). One test reads the real repository's
pins offline, so a HELD entry that drifts from its pin fails here before the weekly run.
"""

import json
import logging
import runpy
import subprocess
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path

import check_dependency_updates as deps
import pytest
from check_dependency_updates import Held, Lookup, Pin, Ports
from cihttp import Request, Response
from cirepo import ROOT
from treeutil import write

DEPS_PY = Path(deps.__file__)
DIGEST = "a" * 64
HUB = deps.DOCKER_HUB
GH = deps.GITHUB_API
NODE_TAGS = f"{HUB}/library/repositories/node/tags?page_size=100&name=bookworm-slim"
GDAL_TOKEN = f"{deps.GHCR}/token?scope=repository:osgeo/gdal:pull"
GDAL_TAGS = f"{deps.GHCR}/v2/osgeo/gdal/tags/list?n=1000"
SCANNER_TAGS = f"{HUB}/sonarsource/repositories/sonar-scanner-cli/tags?page_size=100"
CHECKOUT_REFS = f"{GH}/actions/checkout/git/matching-refs/tags/v"
CODEQL_REFS = f"{GH}/github/codeql-action/git/matching-refs/tags/v"
HOLDS = {"npm:typescript": Held("6.0.3", "a peer range"), "docker:node": Held("24-bookworm-slim", "the runtime line")}

Answer = Response | Exception


class FakeRun:
    """npm outdated answers per command; pip index versions answers per package (latest, or None for a failure)."""

    def __init__(self, outdated: Sequence[str] = ("{}", "{}"), pip: Mapping[str, str | None] | None = None) -> None:
        self.outdated = dict(zip(deps.NPM_OUTDATED, outdated, strict=True))
        self.pip = dict(pip or {})
        self.calls: list[tuple[str, ...]] = []

    def __call__(self, argv: Sequence[str]) -> subprocess.CompletedProcess[str]:
        command = tuple(argv)
        self.calls.append(command)
        if command in self.outdated:
            return subprocess.CompletedProcess(command, 1, self.outdated[command], "")
        latest = self.pip.get(command[-1])
        if latest is None:
            return subprocess.CompletedProcess(command, 1, "", "ERROR: No matching distribution found\n")
        return subprocess.CompletedProcess(command, 0, json.dumps({"name": command[-1], "latest": latest}), "")


class FakeWeb:
    """Programmed answers per URL; records every request."""

    def __init__(self, answers: Mapping[str, Answer]) -> None:
        self.answers = dict(answers)
        self.calls: list[Request] = []

    def __call__(self, request: Request) -> Response:
        self.calls.append(request)
        answer = self.answers[request.url]
        if isinstance(answer, Exception):
            raise answer
        return answer


def json_response(document: object, headers: Mapping[str, str] | None = None) -> Response:
    return Response(200, dict(headers or {}), json.dumps(document).encode())


def hub_tags(*names: str) -> Response:
    return json_response({"count": len(names), "next": None, "results": [{"name": name} for name in names]})


def refs(*tags: str) -> Response:
    return json_response([{"ref": f"refs/tags/{tag}"} for tag in tags])


def current_web() -> dict[str, Answer]:
    """Every registry answer for the fake repository, with nothing newer than its pins (node aside: held)."""
    return {
        NODE_TAGS: hub_tags("26-bookworm-slim", "24-bookworm-slim", "24.21.0-bookworm-slim", "lts-bookworm-slim"),
        f"{HUB}/docker/repositories/dockerfile/tags?page_size=100": hub_tags("1.27.1", "1.27.1-labs", "1", "latest"),
        GDAL_TOKEN: json_response({"token": "anonymous"}),
        GDAL_TAGS: json_response(
            {"name": "osgeo/gdal", "tags": ["ubuntu-small-3.13.3", "ubuntu-small-3.13.3-arm64", "alpine-small-3.14.0"]}
        ),
        SCANNER_TAGS: hub_tags("latest", "12.2.0.4256_8.1.0", "12.2", "12.1.0.3233_8.0.1"),
        CHECKOUT_REFS: refs("v6.0.0", "v7.0.1", "v7", "v8.0.0-beta"),
        CODEQL_REFS: refs("v3.29.0", "v4.38.3"),
    }


CURRENT_PIP = {"ruff": "0.17.0", "pytest": "9.1.1", "poetry": "2.5.1", "numpy": "2.5.4", "poetry-core": "2.5.0"}
TYPESCRIPT_OUTDATED = json.dumps({"typescript": {"current": "6.0.3", "wanted": "6.0.3", "latest": "7.0.2", "dependent": "root"}})


def make_repo(root: Path) -> Path:
    """A repository with every kind of pin the gate reads."""
    root_manifest = {
        "name": "root",
        "workspaces": ["packages/*"],
        "devDependencies": {"typescript": "6.0.3", "eslint": "10.12.0", "braces": "$braces"},
        "overrides": {"katex": "0.19.0"},
    }
    write(root, "package.json", json.dumps(root_manifest))
    write(root, "packages/a/package.json", json.dumps({"name": "@hcm/a", "dependencies": {"lit": "3.3.3", "@hcm/b": "0.0.0"}}))
    write(root, "packages/b/package.json", json.dumps({"name": "@hcm/b", "devDependencies": {"eslint": "10.12.0"}}))
    write(root, "scripts/ci/requirements.txt", "# CI tools\nruff==0.17.0\npytest==9.1.1  # tests\n\nnot a pin\n")
    write(root, "pipeline/requirements-poetry.txt", "poetry==2.5.1")
    pyproject = '[project]\ndependencies = ["numpy==2.5.4"]\n\n[tool.poetry.group.dev.dependencies]\npytest = "9.1.1"\n'
    write(root, "pipeline/pyproject.toml", pyproject + '\n[build-system]\nrequires = ["poetry-core==2.5.0"]')
    dockerfile = [
        f"# syntax=docker/dockerfile:1.27.1@sha256:{DIGEST}",
        "# node:24-bookworm-slim (Node 24)",
        f"FROM node@sha256:{DIGEST} AS node",
        "# a comment that names no image",
        "# ghcr.io/osgeo/gdal:ubuntu-small-3.13.3 (GDAL)",
        f"FROM ghcr.io/osgeo/gdal@sha256:{DIGEST} AS quality",
    ]
    write(root, "docker/Dockerfile.quality", "\n".join(dockerfile))
    write(root, "pipeline/Dockerfile", f"# syntax=docker/dockerfile:1.27.1@sha256:{DIGEST}\nFROM scratch")
    write(root, "scripts/ci/scan.sh", f'IMAGE="sonarsource/sonar-scanner-cli:12.2.0.4256_8.1.0@sha256:{DIGEST}"')
    workflow = [
        "jobs:",
        "    a:",
        "        steps:",
        f"            - uses: actions/checkout@{'1' * 40} # v7.0.1",
        f"            - uses: github/codeql-action/init@{'2' * 40} # v4.38.3",
        f"            - uses: github/codeql-action/analyze@{'2' * 40} # v4.38.3",
        "            - uses: ./.github/actions/local",
        f"            - uses: docker://alpine@sha256:{DIGEST}",
    ]
    write(root, ".github/workflows/ci.yml", "\n".join(workflow))
    return root


@pytest.fixture
def repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(deps, "HELD", dict(HOLDS))
    return make_repo(tmp_path / "repo")


@pytest.fixture
def log(caplog: pytest.LogCaptureFixture) -> pytest.LogCaptureFixture:
    caplog.set_level(logging.INFO, logger="hcm")
    return caplog


def run_gate(root: Path, run: FakeRun, web: Mapping[str, Answer]) -> int:
    return deps.main(["--root", str(root)], Ports(run=run, fetch=FakeWeb(web)))


def details(log: pytest.LogCaptureFixture) -> list[str]:
    return [message for message in log.messages if message.startswith("  ")]


# --- the whole run ------------------------------------------------------------------------------------


def test_happy_path_every_pin_current_and_holds_reported(repo: Path, log: pytest.LogCaptureFixture) -> None:
    run = FakeRun((TYPESCRIPT_OUTDATED, ""), CURRENT_PIP)

    assert run_gate(repo, run, current_web()) == 0
    assert log.messages[0] == "[deps] checking 3 npm, 5 pypi, 4 docker, 2 actions pins"
    assert details(log) == [
        "  held: npm typescript 6.0.3 (latest 7.0.2): a peer range",
        "  held: docker node 24-bookworm-slim (latest 26-bookworm-slim): the runtime line",
    ]
    assert log.messages[-1] == "[deps] OK: 14 pins on their latest stable release (2 held)"
    assert run.calls[:2] == list(deps.NPM_OUTDATED)
    assert sorted(call[-1] for call in run.calls[2:]) == sorted(CURRENT_PIP)


def test_bad_path_pins_behind_are_listed_and_exit_1(repo: Path, log: pytest.LogCaptureFixture) -> None:
    eslint = {"eslint": [{"current": "10.12.0", "latest": "10.13.0", "dependent": "root"}, {"latest": "10.13.0", "dependent": "@hcm/b"}]}
    web = {
        **current_web(),
        GDAL_TAGS: json_response({"tags": ["ubuntu-small-3.13.3", "ubuntu-small-3.14.0"]}),
        CHECKOUT_REFS: refs("v7.0.1", "v7.1.0"),
    }
    run = FakeRun((TYPESCRIPT_OUTDATED, json.dumps(eslint)), {**CURRENT_PIP, "pytest": "9.2.0"})

    assert run_gate(repo, run, web) == deps.EXIT_BEHIND
    assert [line for line in details(log) if line.startswith("  - ")] == [
        "  - npm eslint 10.12.0 -> 10.13.0 (package.json, packages/b/package.json)",
        "  - pypi pytest 9.1.1 -> 9.2.0 (pipeline/pyproject.toml, scripts/ci/requirements.txt)",
        "  - docker ghcr.io/osgeo/gdal ubuntu-small-3.13.3 -> ubuntu-small-3.14.0 (docker/Dockerfile.quality)",
        "  - actions actions/checkout v7.0.1 -> v7.1.0 (.github/workflows/ci.yml)",
    ]
    assert log.messages[-1] == "[deps] 4 of 14 pins are behind their latest stable release or held without need"


def test_bad_path_unreadable_registries_exit_2(repo: Path, log: pytest.LogCaptureFixture) -> None:
    npm_error = json.dumps({"error": {"code": "ENOTFOUND", "summary": "registry unreachable"}})
    web = {**current_web(), CODEQL_REFS: Response(403, {}, b'{"message": "API rate limit exceeded"}')}
    run = FakeRun((npm_error, "{}"), {**CURRENT_PIP, "numpy": None})

    assert run_gate(repo, run, web) == deps.EXIT_UNCHECKED
    lines = details(log)
    assert "  - npm eslint 10.12.0 not checked: `npm outdated --json` failed: registry unreachable" in lines
    assert "  - pypi numpy 2.5.4 not checked: pip index versions numpy: ERROR: No matching distribution found" in lines
    assert f"  - actions github/codeql-action v4.38.3 not checked: {CODEQL_REFS} answered HTTP 403" in lines
    assert log.messages[-1] == "[deps] ERROR: 5 of 14 pins could not be checked (0 behind or stale)"


def test_happy_path_unreachable_docker_registry_is_only_a_warning(repo: Path, log: pytest.LogCaptureFixture) -> None:
    web = {**current_web(), SCANNER_TAGS: TimeoutError("timed out"), GDAL_TOKEN: json_response({"no": "token"})}

    assert run_gate(repo, FakeRun((TYPESCRIPT_OUTDATED, "{}"), CURRENT_PIP), web) == 0
    assert "  warning: docker sonarsource/sonar-scanner-cli 12.2.0.4256_8.1.0 not checked: timed out" in details(log)
    assert "  warning: docker ghcr.io/osgeo/gdal ubuntu-small-3.13.3 not checked: ghcr.io gave no anonymous pull token for osgeo/gdal" in (
        details(log)
    )


@pytest.mark.parametrize(
    ("holds", "message"),
    [
        (
            {"npm:typescript": Held("5.9.0", "old")},
            "  - HELD npm:typescript names 5.9.0 but the pin is 6.0.3: update or remove the hold",
        ),
        ({"npm:lit": Held("3.3.3", "no longer needed")}, "  - HELD npm:lit 3.3.3 is already the latest stable release: remove the hold"),
        ({"npm:left-pad": Held("1.3.0", "gone")}, "  - HELD npm:left-pad names a pin that does not exist: remove the hold"),
    ],
)
def test_bad_path_stale_hold_fails(
    repo: Path, log: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch, holds: dict[str, Held], message: str
) -> None:
    monkeypatch.setattr(deps, "HELD", {**HOLDS, **holds})

    assert run_gate(repo, FakeRun((TYPESCRIPT_OUTDATED, "{}"), CURRENT_PIP), current_web()) == deps.EXIT_BEHIND
    assert message in details(log)


# --- pin files ----------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("relative", "text", "message"),
    [
        ("package.json", "{", "package.json is not valid JSON"),
        ("package.json", "[]", "package.json is not a JSON object"),
        ("pipeline/pyproject.toml", "[project", "pipeline/pyproject.toml is not valid TOML"),
    ],
)
def test_bad_path_malformed_pin_file_exits_2(repo: Path, log: pytest.LogCaptureFixture, relative: str, text: str, message: str) -> None:
    write(repo, relative, text)

    assert deps.main(["--root", str(repo)], Ports(run=FakeRun(), fetch=FakeWeb({}))) == deps.EXIT_UNCHECKED
    assert message in log.messages[-1]


def test_bad_path_missing_requirements_file_exits_2(repo: Path, log: pytest.LogCaptureFixture) -> None:
    (repo / "pipeline/requirements-poetry.txt").unlink()

    assert deps.main(["--root", str(repo)]) == deps.EXIT_UNCHECKED
    assert log.messages[-1].startswith(f"[deps] ERROR: cannot read {repo}/pipeline/requirements-poetry.txt")


def test_happy_path_pins_are_merged_per_version_with_their_files(repo: Path) -> None:
    pins = deps.collect_pins(repo)

    assert [pin.label() for pin in pins["npm"]] == ["npm eslint 10.12.0", "npm lit 3.3.3", "npm typescript 6.0.3"]
    assert pins["pypi"][-1] == Pin("pypi", "ruff", "0.17.0", ("scripts/ci/requirements.txt",))
    assert pins["docker"][0] == Pin("docker", "docker/dockerfile", "1.27.1", ("docker/Dockerfile.quality", "pipeline/Dockerfile"))
    assert [pin.label() for pin in pins["actions"]] == ["actions actions/checkout v7.0.1", "actions github/codeql-action v4.38.3"]


def test_happy_path_real_repository_pins_match_every_hold() -> None:
    pins = deps.collect_pins(ROOT)
    versions = {pin.key: pin.version for group in pins.values() for pin in group}

    assert all(pins.values())
    assert {key: versions.get(key) for key in deps.HELD} == {key: hold.version for key, hold in deps.HELD.items()}


# --- registries ---------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("image", "expected"),
    [
        ("node", ("docker.io", "library/node")),
        ("rhysd/actionlint", ("docker.io", "rhysd/actionlint")),
        ("ghcr.io/osgeo/gdal", ("ghcr.io", "osgeo/gdal")),
        ("localhost:5000/tool", ("localhost:5000", "tool")),
    ],
)
def test_happy_path_registry_of_an_image(image: str, expected: tuple[str, str]) -> None:
    assert deps.registry_of(image) == expected


def test_bad_path_unsupported_registry_is_not_checked() -> None:
    pin = Pin("docker", "quay.io/org/tool", "1.0.0", ("Dockerfile",))

    assert deps.docker_lookup(pin, FakeWeb({})) == Lookup(problem="registry quay.io is not supported")


@pytest.mark.parametrize(
    ("tag", "matching", "other"),
    [
        ("v2.15.1-debian", "v2.16.0-debian", "v2.16.0"),
        ("24-bookworm-slim", "26-bookworm-slim", "26.1.0-bookworm-slim"),
        ("12.2.0.4256_8.1.0", "12.3.0.5000_8.2.0", "12.3"),
    ],
)
def test_happy_path_tag_shape_keeps_the_numbers_free(tag: str, matching: str, other: str) -> None:
    shape = deps.tag_shape(tag)

    assert (bool(shape.match(tag)), bool(shape.match(matching)), bool(shape.match(other))) == (True, True, False)


@pytest.mark.parametrize(("tag", "word"), [("24-bookworm-slim", "bookworm-slim"), ("v0.11.0", ""), ("1.7.12", "")])
def test_happy_path_docker_hub_name_filter(tag: str, word: str) -> None:
    assert deps.name_filter(tag) == word


def test_happy_path_ghcr_tags_follow_the_next_link() -> None:
    second = f"{deps.GHCR}/v2/osgeo/gdal/tags/list?last=b&n=1000"
    web = FakeWeb(
        {
            GDAL_TOKEN: json_response({"token": "anonymous"}),
            GDAL_TAGS: json_response({"tags": ["a", "b"]}, {"link": '</v2/osgeo/gdal/tags/list?last=b&n=1000>; rel="next"'}),
            second: json_response({"tags": ["c"]}),
        }
    )

    assert deps.ghcr_tags("osgeo/gdal", "x", web) == ["a", "b", "c"]
    assert web.calls[1].headers == (("Authorization", "Bearer anonymous"),)


def test_bad_path_ghcr_without_a_tag_list_reads_no_tags() -> None:
    web = FakeWeb({GDAL_TOKEN: json_response({"token": "anonymous"}), GDAL_TAGS: json_response({"errors": [{"code": "DENIED"}]})})

    assert deps.ghcr_tags("osgeo/gdal", "x", web) == []


GCR_TAGS = f"{deps.GCR}/v2/cloud-builders/docker/tags/list"
BUILDER = Pin("docker", "gcr.io/cloud-builders/docker", "29", ("packages/shared/src/schemas/install.ts",))


def gcr_answer(*manifests: object) -> Response:
    """gcr.io's tag list: one manifest per list of tags (the numeric build tags and old lines carry Google's markers)."""
    return json_response({"manifest": {f"sha256:{index}": {"tag": tags} for index, tags in enumerate(manifests)}, "tags": []})


def test_happy_path_the_install_bundles_docker_builder_is_a_tracked_pin(repo: Path) -> None:
    pin = f"export const DOCKER_BUILDER_PIN = 'gcr.io/cloud-builders/docker:29@sha256:{DIGEST}';"
    write(repo, "packages/shared/src/schemas/install.ts", pin)

    assert BUILDER in deps.collect_pins(repo)["docker"]
    assert any(pin.name == BUILDER.name for pin in deps.collect_pins(ROOT)["docker"])


def test_happy_path_gcr_tags_leave_out_every_image_google_retired() -> None:
    web = FakeWeb(
        {
            GCR_TAGS: gcr_answer(
                ["29"],
                ["20.10.24", "latest", "no-new-use-public-image-1"],
                ["129228440", "deprecated-public-image-2"],
                ["linux-amd64"],
                "not a list",
            )
        }
    )

    assert deps.gcr_tags("cloud-builders/docker", "29", web) == ["29", "linux-amd64"]
    assert deps.docker_lookup(BUILDER, web) == Lookup(latest="29")


def test_bad_path_a_newer_builder_line_is_reported_and_an_answer_without_manifests_reads_no_tags() -> None:
    newer = FakeWeb({GCR_TAGS: gcr_answer(["29"], ["30"])})
    empty = FakeWeb({GCR_TAGS: json_response({"tags": ["29"]})})

    assert deps.docker_lookup(BUILDER, newer) == Lookup(latest="30")
    assert deps.gcr_tags("cloud-builders/docker", "29", empty) == []
    assert deps.current_tags("not a manifest") == []


def test_bad_path_docker_hub_answer_that_is_not_an_object_is_unusable() -> None:
    pin = Pin("docker", "rhysd/actionlint", "1.7.12", ("Dockerfile",))
    url = f"{HUB}/rhysd/repositories/actionlint/tags?page_size=100"

    assert deps.docker_lookup(pin, FakeWeb({url: json_response(["1.7.12"])})) == Lookup(problem=f"{url} did not answer a JSON object")
    assert deps.docker_lookup(pin, FakeWeb({url: json_response({"results": "none"})})) == Lookup(latest="1.7.12")


def test_happy_path_action_without_v_prefix_reads_every_stable_tag() -> None:
    pin = Pin("actions", "owner/tool", "1.2.0", (".github/workflows/ci.yml",))
    web = FakeWeb(
        {f"{GH}/owner/tool/git/matching-refs/tags/": json_response([{"ref": "refs/tags/1.10.0"}, {"ref": "refs/tags/2.0-rc"}, "x"])}
    )

    assert deps.action_lookup(pin, web) == Lookup(latest="1.10.0")
    assert deps.action_lookup(pin, FakeWeb({web.calls[0].url: json_response({"message": "Not Found"})})) == Lookup(latest="1.2.0")


def test_bad_path_action_registry_network_error_is_reported() -> None:
    pin = Pin("actions", "owner/tool", "v1.0.0", (".github/workflows/ci.yml",))

    assert deps.action_lookup(pin, FakeWeb({f"{GH}/owner/tool/git/matching-refs/tags/v": OSError("reset")})) == Lookup(problem="reset")


@pytest.mark.parametrize(
    ("entry", "latest"),
    [({"latest": "2.0.0"}, "2.0.0"), ([{"latest": "3.0.0"}, {"latest": "3.0.0"}], "3.0.0"), ([], ""), ("broken", "")],
)
def test_happy_path_npm_outdated_entry_shapes(entry: object, latest: str) -> None:
    assert deps.outdated_latest(entry) == latest


def test_bad_path_npm_outdated_without_json_is_unusable() -> None:
    result = subprocess.CompletedProcess(("npm", "outdated", "--json"), 1, "npm ERR! oops", "npm ERR! code E500\n")

    with pytest.raises(deps.LookupFailedError, match="`npm outdated --json` failed: npm ERR! code E500"):
        deps.npm_document(result)


def test_bad_path_pip_answer_without_latest_is_unusable() -> None:
    def run(argv: Sequence[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(tuple(argv), 0, "[]", "")

    assert deps.pip_latest("ruff", run) == Lookup(problem="pip index versions ruff: no output")


@pytest.mark.parametrize(("latest", "pinned", "newer"), [("10.13.0", "10.12.0", True), ("1.9.0", "1.10.0", False), (None, "1.0.0", False)])
def test_happy_path_versions_compare_by_their_numbers(latest: str | None, pinned: str, newer: bool) -> None:
    assert deps.is_newer(latest, pinned) is newer


# --- commands and the entry point ---------------------------------------------------------------------


def test_happy_path_run_command_captures_the_output(tmp_path: Path) -> None:
    result = deps.run_command([sys.executable, "-c", "import os, sys; sys.stdout.write(os.getcwd()); sys.exit(1)"], tmp_path)

    assert (result.returncode, result.stdout) == (1, str(tmp_path))


def test_bad_path_missing_command_answers_127(tmp_path: Path) -> None:
    result = deps.run_command(["hcm-no-such-tool", "--json"], tmp_path)

    assert (result.returncode, result.stderr) == (deps.COMMAND_NOT_FOUND, "command not found: hcm-no-such-tool")


def test_happy_path_default_ports_run_in_the_root(tmp_path: Path) -> None:
    ports = deps.default_ports(tmp_path)

    assert ports.run([sys.executable, "-c", "import os, sys; sys.stdout.write(os.getcwd())"]).stdout == str(tmp_path)


def test_bad_path_script_entry_point_exits_with_main_status(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(sys, "argv", [str(DEPS_PY), "--root", str(tmp_path)])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(DEPS_PY), run_name="__main__")

    assert exit_info.value.code == deps.EXIT_UNCHECKED
