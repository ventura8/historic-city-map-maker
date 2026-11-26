"""check_release.py: the tag, every package version (workspace dependencies included), ENGINE_VERSION, the
released engine, the starter kit's pins and the release notes agree.

Repositories are built under tmp_path; the tag lookup gets a fake `git` answer except in the tests
that run the real git (the default capture) in a throwaway repository.
"""

import json
import logging
import os
import runpy
import subprocess
import sys
from collections.abc import Callable, Sequence
from pathlib import Path

import check_release
import pytest
from release_pins import expected_pins
from releaseutil import MAPBOX_CSS_URL, base_of, kit_page, release_document, write_kit_page, write_release_folder, write_release_json

RELEASE_PY = Path(check_release.__file__)
GIT_ENV = {
    **os.environ,
    "GIT_AUTHOR_NAME": "Release Test",
    "GIT_AUTHOR_EMAIL": "release@example.invalid",
    "GIT_COMMITTER_NAME": "Release Test",
    "GIT_COMMITTER_EMAIL": "release@example.invalid",
}


def write_json(path: Path, document: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document), encoding="utf-8")


def sri_rows(version: str) -> str:
    """The description's table of pinned addresses for `version`, as `npm run release:notes` writes it."""
    pins = expected_pins(release_document(version)).pins
    return "".join(f"| File | `{url}` | `{integrity}` |\n" for url, integrity in pins.items())


def write_release(root: Path, version: str = "1.2.3", *, notes: bool = True) -> None:
    """A consistent repository for `version`: root + two workspaces (one on the other), engine constant, the
    released engine, the kit's page and both notes files."""
    write_json(root / "package.json", {"name": "historic-city-map", "version": version, "workspaces": ["packages/*", "functions"]})
    write_json(root / "packages" / "engine" / "package.json", {"name": "@hcm/engine", "version": version, "dependencies": {"zod": "4"}})
    functions = {"name": "@hcm/functions", "version": version, "devDependencies": {"@hcm/engine": version}, "dependencies": []}
    write_json(root / "functions" / "package.json", functions)
    (root / "packages" / "notes-only").mkdir(parents=True)
    engine = root / check_release.ENGINE_INDEX
    engine.parent.mkdir(parents=True, exist_ok=True)
    engine.write_text(f"export const ENGINE_VERSION = '{version}';\n", encoding="utf-8")
    write_release_folder(root, version)
    write_kit_page(root, kit_page(version))
    if notes:
        (root / "docs" / "releases").mkdir(parents=True)
        (root / "docs" / "releases" / f"v{version}.md").write_text("# v1.2.3\n\nNotes.\n", encoding="utf-8")
        description = f"# Release v{version} - Title\n\n<!-- hcm:sri -->\n\n{sri_rows(version)}\n<!-- /hcm:sri -->\n"
        (root / "docs" / "releases" / f"v{version}_github_description.md").write_text(description, encoding="utf-8")


def tags(*names: str) -> check_release.Capture:
    def capture(argv: Sequence[str]) -> str:
        assert list(argv) == ["tag", "--points-at", "HEAD", "--list", "v*"]
        return "".join(f"{name}\n" for name in names)

    return capture


@pytest.fixture
def log(caplog: pytest.LogCaptureFixture) -> pytest.LogCaptureFixture:
    caplog.set_level(logging.INFO, logger="hcm")
    return caplog


def test_happy_path_consistent_release_passes(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    write_release(tmp_path)

    assert check_release.main(["--root", str(tmp_path)], tags("v1.2.3")) == 0
    assert (
        "[release] OK: v1.2.3 matches every version, ENGINE_VERSION, the released engine, the kit's pins and both notes files" in log.text
    )


def test_happy_path_explicit_tag_checks_before_tagging(tmp_path: Path) -> None:
    write_release(tmp_path)

    assert check_release.main(["--root", str(tmp_path), "--tag", "v1.2.3"], tags()) == 0


def test_bad_path_every_disagreement_is_listed(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    write_release(tmp_path, "1.2.2", notes=False)
    write_json(tmp_path / "packages" / "engine" / "package.json", {"name": "@hcm/engine", "version": "1.2.3"})

    assert check_release.main(["--root", str(tmp_path)], tags("v1.2.3")) == 1
    assert "[release] FAILED for v1.2.3:" in log.text
    assert "  - package.json: version '1.2.2', the tag says '1.2.3'" in log.text
    assert "  - functions/package.json: version '1.2.2', the tag says '1.2.3'" in log.text
    assert "packages/engine/package.json" not in log.text
    assert "  - packages/engine/src/index.ts: ENGINE_VERSION '1.2.2', the tag says '1.2.3'" in log.text
    assert "  - docs/releases/v1.2.3.md is missing or empty (docs/releases/README.md)" in log.text
    assert "  - docs/releases/v1.2.3_github_description.md is missing or empty" in log.text


def test_bad_path_empty_notes_and_missing_engine_constant_fail(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    write_release(tmp_path)
    (tmp_path / "docs" / "releases" / "v1.2.3_github_description.md").write_text("  \n", encoding="utf-8")
    (tmp_path / check_release.ENGINE_INDEX).unlink()

    assert check_release.main(["--root", str(tmp_path)], tags("v1.2.3")) == 1
    assert "ENGINE_VERSION None, the tag says '1.2.3'" in log.text
    assert "docs/releases/v1.2.3_github_description.md is missing or empty" in log.text


@pytest.mark.parametrize("version", ["1.2.3-beta.1", "1.2.3-rc.0", "1.2.3-rc.12", "0.1.0-beta.0"])
def test_happy_path_prerelease_tags_are_released(tmp_path: Path, log: pytest.LogCaptureFixture, version: str) -> None:
    write_release(tmp_path, version)
    readme = tmp_path / "README.md"
    readme.write_text(f"Run `npx create-historic-city@{version} self-host`.\n", encoding="utf-8")

    assert check_release.main(["--root", str(tmp_path), "--tag", f"v{version}"], tags()) == 0
    assert f"[release] OK: v{version} matches every version" in log.text


def test_bad_path_prerelease_guide_pin_of_another_version_is_named(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    write_release(tmp_path, "1.2.3-beta.2")
    (tmp_path / "README.md").write_text("Run `npx create-historic-city@1.2.3-beta.1 self-host`.\n", encoding="utf-8")

    assert check_release.main(["--root", str(tmp_path), "--tag", "v1.2.3-beta.2"], tags()) == 1
    assert "README.md: names create-historic-city@1.2.3-beta.1, the tag says '1.2.3-beta.2'" in log.text


@pytest.mark.parametrize(
    "tag",
    [
        "v1.2",
        "v01.2.3",
        "1.2.3",
        "v1.2.3+build",
        "v1.2.3-alpha.1",
        "v1.2.3-beta",
        "v1.2.3-beta.01",
        "v1.2.3-rc.1.2",
        "v1.2.3-RC.1",
        "v1.2.3-beta1",
        "v1.2.3-beta.1+build",
        "v1.2.3-preview.1",
    ],
)
def test_bad_path_tag_must_be_plain_semver(tmp_path: Path, log: pytest.LogCaptureFixture, tag: str) -> None:
    write_release(tmp_path)

    assert check_release.main(["--root", str(tmp_path), "--tag", tag]) == 1
    assert f"tag {tag!r} is not vMAJOR.MINOR.PATCH" in log.text


def test_bad_path_no_tag_at_head(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    write_release(tmp_path)

    assert check_release.main(["--root", str(tmp_path)], tags()) == 1
    assert "[release] FAILED for HEAD:" in log.text
    assert "no v* tag points at HEAD" in log.text


def test_bad_path_several_tags_at_head(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    write_release(tmp_path)

    assert check_release.main(["--root", str(tmp_path)], tags("v1.2.4", "v1.2.3")) == 1
    assert "several v* tags point at HEAD (v1.2.3, v1.2.4): a commit is released once" in log.text


@pytest.mark.parametrize(
    ("root_manifest", "message"),
    [
        ("{broken", "package.json: cannot read it as JSON"),
        ("[]", "package.json: expected a JSON object"),
        ('{"version": "1.2.3", "workspaces": {"packages": ["packages/*"]}}', "`workspaces` must be an array of globs"),
    ],
)
def test_bad_path_unreadable_root_manifest(tmp_path: Path, log: pytest.LogCaptureFixture, root_manifest: str, message: str) -> None:
    write_release(tmp_path)
    (tmp_path / "package.json").write_text(root_manifest, encoding="utf-8")

    assert check_release.main(["--root", str(tmp_path)], tags("v1.2.3")) == 1
    assert message in log.text


def test_happy_path_real_git_finds_the_annotated_tag(tmp_path: Path) -> None:
    write_release(tmp_path)
    for argv in (
        ["init", "-q", "-b", "master"],
        ["add", "-A"],
        ["commit", "-q", "-m", "chore: release"],
        ["tag", "-a", "v1.2.3", "-m", "x"],
    ):
        subprocess.run(["git", "-C", str(tmp_path), *argv], env=GIT_ENV, check=True)

    assert check_release.head_tags(check_release.git_capture(tmp_path)) == ["v1.2.3"]


def test_bad_path_outside_a_repository_no_tag_is_found(tmp_path: Path) -> None:
    assert check_release.head_tags(check_release.git_capture(tmp_path)) == []


def test_bad_path_script_entry_point_exits_with_main_status(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(sys, "argv", [str(RELEASE_PY), "--root", str(tmp_path), "--tag", "v1"])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(RELEASE_PY), run_name="__main__")

    assert exit_info.value.code == 1


def test_bad_path_a_workspace_dependency_on_another_version_fails(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    write_release(tmp_path)
    write_json(
        tmp_path / "functions" / "package.json",
        {"name": "@hcm/functions", "version": "1.2.3", "peerDependencies": {"@hcm/engine": "1.2.2"}},
    )

    assert check_release.main(["--root", str(tmp_path), "--tag", "v1.2.3"]) == 1
    assert "  - functions/package.json: depends on @hcm/engine '1.2.2', the tag says '1.2.3'" in log.text


def test_bad_path_without_the_released_engine_and_the_kit_page_the_tag_fails(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    write_release(tmp_path)
    (tmp_path / "cdn" / "engine" / "release.json").unlink()
    (tmp_path / "templates" / "starter-kit" / "index.html").unlink()

    assert check_release.main(["--root", str(tmp_path), "--tag", "v1.2.3"]) == 1
    assert "cdn/engine/release.json is missing: npm run release:cdn on the release commit" in log.text
    assert "templates/starter-kit/index.html is missing: a release pins the starter kit's page" in log.text


def test_bad_path_a_released_engine_and_a_kit_of_another_version_fail(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    write_release(tmp_path)
    write_release_json(tmp_path, release_document("1.2.2"))
    write_kit_page(tmp_path, kit_page("1.2.2"))

    assert check_release.main(["--root", str(tmp_path), "--tag", "v1.2.3"]) == 1
    assert "cdn/engine/release.json: version '1.2.2', the tag says '1.2.3'" in log.text
    assert "templates/starter-kit/index.html: pins engine '1.2.2', the tag says '1.2.3'" in log.text


@pytest.mark.parametrize(
    "change",
    [
        lambda text: text.replace(f"| File | `{MAPBOX_CSS_URL}`", "| File | `https://example.invalid/x.css`"),
        lambda text: text + "\n" + 'integrity="sha384-' + "B" * 64 + '"\n',
        lambda text: text.replace(f"{base_of('1.2.3')}engine.css", f"{base_of('1.2.2')}engine.css"),
    ],
)
def test_bad_path_a_description_whose_pins_are_not_the_release_files_fails(
    tmp_path: Path, log: pytest.LogCaptureFixture, change: Callable[[str], str]
) -> None:
    write_release(tmp_path)
    description = tmp_path / "docs" / "releases" / "v1.2.3_github_description.md"
    description.write_text(change(description.read_text(encoding="utf-8")), encoding="utf-8")

    assert check_release.main(["--root", str(tmp_path), "--tag", "v1.2.3"]) == 1
    expected = "docs/releases/v1.2.3_github_description.md: its pinned addresses and integrity are not cdn/engine/release.json's"
    assert expected in log.text
    assert "npm run release:notes -- --write docs/releases/v1.2.3_github_description.md" in log.text


def test_bad_path_an_unreadable_release_file_is_reported(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    write_release(tmp_path)
    (tmp_path / "cdn" / "engine" / "release.json").write_text("{broken", encoding="utf-8")

    assert check_release.main(["--root", str(tmp_path), "--tag", "v1.2.3"]) == 1
    assert "cdn/engine/release.json: cannot read it as JSON" in log.text


def test_bad_path_a_guide_naming_another_release_of_the_cli_fails(tmp_path: Path, log: pytest.LogCaptureFixture) -> None:
    # docs/LESSONS.md 238: a guide's `npx create-historic-city@1` runs whatever the name resolves to on the day it is read.
    write_release(tmp_path)
    guide = "`npx create-historic-city@1.2.3 x`, `npm create historic-city@1.0.0`\n"
    (tmp_path / "docs" / "SELF_HOST.md").write_text(guide, encoding="utf-8")
    (tmp_path / "README.md").write_text("`npx create-historic-city@1.2.3 my-city` and `@<version>`\n", encoding="utf-8")

    assert check_release.main(["--root", str(tmp_path), "--tag", "v1.2.3"], capture=tags()) == 1
    expected = "docs/SELF_HOST.md: names create-historic-city@1.0.0, the tag says '1.2.3'"
    assert check_release.doc_pin_problems(tmp_path, "1.2.3") == [expected]
    assert "docs/SELF_HOST.md: names create-historic-city@1.0.0" in log.text


def test_happy_path_the_pinned_guides_are_the_bumps_list() -> None:
    versions = (RELEASE_PY.parents[2] / "scripts" / "release" / "src" / "versions.ts").read_text(encoding="utf-8")
    block = versions.split("export const PINNED_DOCS = [", 1)[1].split("]", 1)[0]

    assert tuple(line.strip().strip("',") for line in block.strip().splitlines()) == check_release.PINNED_DOCS
    for name in check_release.PINNED_DOCS:
        assert (RELEASE_PY.parents[2] / name).is_file(), name
