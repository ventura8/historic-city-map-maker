"""check_bundle_budget.py: gzip size of the shipped bundles against their budgets."""

import os
import runpy
import sys
from pathlib import Path

import check_bundle_budget as bundles
import pytest
from treeutil import write

SCRIPT = Path(bundles.__file__)

ADMIN = bundles.ADMIN_DIR


def bundle(root: Path, relative: str, data: bytes) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def default_bundles(root: Path) -> None:
    for name in bundles.BUDGETS:
        bundle(root, name, b"(function(){})();\n" * 100)


def admin_build(root: Path) -> None:
    """An entry that imports a core chunk statically, which imports another; two lazy area chunks."""
    bundle(root, f"{ADMIN}/admin.mjs", b'import"./admin-core-Ab3_x9Yz.js";')
    bundle(root, f"{ADMIN}/admin-core-Ab3_x9Yz.js", b'import{a}from"./text-Q1w2E3r4.js";const p=()=>import("./photos-Zz9_8Yy7.js");')
    bundle(root, f"{ADMIN}/text-Q1w2E3r4.js", b"export const a=1;")
    bundle(root, f"{ADMIN}/photos-Zz9_8Yy7.js", b'import{a}from"./admin-core-Ab3_x9Yz.js";export const p=a;')
    bundle(root, f"{ADMIN}/terra-draw-Ab-cdEfG.js", b"export const t=1;")
    bundle(root, f"{ADMIN}/admin.css", b"")
    bundle(root, f"{ADMIN}/photos-Zz9_8Yy7.js.map", b"{}")


def test_happy_path_small_bundles_pass(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    default_bundles(tmp_path)
    admin_build(tmp_path)

    assert bundles.main(["--root", str(tmp_path)]) == 0
    lines = caplog.messages[0].splitlines()
    assert lines[0] == "[bundle-budget] OK:"
    # The rows by path: the start page's module (M14) sorts before the engine's two builds.
    assert lines[1:4] == [
        "  dist/start-app/start.mjs: 0.1 KB gzip (budget 72 KB)",
        "  packages/engine/dist/engine.iife.js: 0.1 KB gzip (budget 150 KB)",
        "  packages/engine/dist/engine.mjs: 0.1 KB gzip (budget 120 KB)",
    ]
    # The entry counts what it imports statically, transitively; the lazy chunks each against their own budget.
    assert lines[4].startswith(f"  {ADMIN}/admin.mjs with 2 static chunk(s): 0.")
    assert lines[4].endswith(" KB gzip (budget 450 KB)")
    assert lines[5].startswith(f"  {ADMIN}/photos-Zz9_8Yy7.js: 0.")
    assert lines[5].endswith("(budget 25 KB)")
    assert lines[6].endswith("(budget 58 KB)")
    assert lines[7].startswith(f"  {ADMIN} in all: 0.")
    assert lines[7].endswith(f"(budget {bundles.ADMIN_TOTAL_KB} KB)")


def test_bad_path_oversized_and_missing_bundles_fail(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    bundle(tmp_path, "packages/engine/dist/engine.iife.js", os.urandom(3000))

    assert bundles.main(["--root", str(tmp_path), "--budget", "packages/engine/dist/engine.iife.js=2"]) == 1
    output = caplog.messages[0]
    assert output.startswith("[bundle-budget] FAILED:\n")
    assert "  - packages/engine/dist/engine.iife.js: 3.0 KB gzip (budget 2 KB)" in output
    # The ES module build is what the city pages load: it has its own budget, so a missing one fails too.
    assert "  - packages/engine/dist/engine.mjs: missing (run the build stage first)" in output
    assert f"  - {ADMIN}/admin.mjs: missing (run the build stage first)" in output


def test_bad_path_a_chunk_without_a_budget_fails_with_its_name(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    default_bundles(tmp_path)
    admin_build(tmp_path)
    bundle(tmp_path, f"{ADMIN}/georeferencer-Ab3_x9Yz.js", b"export const g=1;")

    assert bundles.main(["--root", str(tmp_path)]) == 1
    assert "a chunk without a budget (add `georeferencer` to ADMIN_CHUNK_BUDGETS)" in caplog.messages[0]


def test_bad_path_the_entry_a_chunk_and_the_whole_over_their_budgets_fail(tmp_path: Path) -> None:
    admin_build(tmp_path)
    bundle(tmp_path, f"{ADMIN}/text-Q1w2E3r4.js", os.urandom(3000))
    bundle(tmp_path, f"{ADMIN}/photos-Zz9_8Yy7.js", os.urandom(2000))
    budgets = bundles.AdminBudgets(entry_kb=2, chunks={"photos": 1, "terra-draw": 1}, total_kb=4)

    problems, lines = bundles.check_admin(tmp_path, budgets)

    assert [problem.split(":")[0] for problem in problems] == [
        f"{ADMIN}/admin.mjs with 2 static chunk(s)",
        f"{ADMIN}/photos-Zz9_8Yy7.js",
        f"{ADMIN} in all",
    ]
    assert len(lines) == 4


def test_happy_path_entry_files_follow_static_imports_once() -> None:
    assert bundles.chunk_name("photos-Zz9_8Yy7.js") == "photos"
    assert bundles.chunk_name("editor-shared-CT0VS8VD.js") == "editor-shared"
    assert bundles.chunk_name("admin.mjs") == "admin.mjs"


def test_bad_path_an_import_of_a_missing_chunk_is_left_out(tmp_path: Path) -> None:
    write(tmp_path, "admin.mjs", 'import"./a-12345678.js";export{x}from"./gone-12345678.js";')
    write(tmp_path, "a-12345678.js", 'import"./admin.mjs";')

    assert bundles.entry_files(tmp_path, "admin.mjs") == ["admin.mjs", "a-12345678.js", "gone-12345678.js"]


def test_happy_path_gzip_size_is_reproducible() -> None:
    data = b"hello " * 1000

    assert bundles.gzip_size(data) == bundles.gzip_size(data)
    assert bundles.gzip_size(data) < len(data)


@pytest.mark.parametrize("value", ["engine.js", "=3", "engine.js=", "engine.js=0", "engine.js=1.5"])
def test_bad_path_malformed_budget_is_a_usage_error(value: str) -> None:
    with pytest.raises(SystemExit) as exit_info:
        bundles.main(["--budget", value])

    assert exit_info.value.code == 2


def test_happy_path_script_entry_point_exits_with_main_status(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    default_bundles(tmp_path)
    admin_build(tmp_path)
    write(tmp_path, "packages/engine/dist/engine.css", "")
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--root", str(tmp_path)])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(SCRIPT), run_name="__main__")

    assert exit_info.value.code == 0


def test_happy_path_the_engines_lazy_chunks_have_their_own_budgets(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    default_bundles(tmp_path)
    admin_build(tmp_path)
    bundle(tmp_path, "packages/engine/dist/compare-D8pm_j3P.js", b'import{a}from"./engine.mjs";export const c=a;')
    bundle(tmp_path, "packages/engine/dist/firebase-sdk-B_TOjIQg.js", b"export const f=1;")
    bundle(tmp_path, "packages/engine/dist/engine.mjs.map", b"{}")

    assert bundles.main(["--root", str(tmp_path)]) == 0
    lines = caplog.messages[0].splitlines()
    assert lines[4].startswith("  packages/engine/dist/compare-D8pm_j3P.js: 0.")
    assert lines[4].endswith("(budget 5 KB)")
    assert lines[5].endswith("(budget 16 KB)")


def test_bad_path_an_engine_chunk_without_a_budget_or_over_it_fails(tmp_path: Path) -> None:
    bundle(tmp_path, "packages/engine/dist/engine.iife.js", b"x")
    bundle(tmp_path, "packages/engine/dist/compare-D8pm_j3P.js", os.urandom(3000))
    bundle(tmp_path, "packages/engine/dist/map-sync-COl7ap_a.js", b"export const m=1;")

    problems, lines = bundles.check_engine_chunks(tmp_path, {"compare": 2})

    assert problems == [
        "packages/engine/dist/compare-D8pm_j3P.js: 3.0 KB gzip (budget 2 KB)",
        "packages/engine/dist/map-sync-COl7ap_a.js: 0.0 KB gzip, a chunk without a budget (add `map-sync` to ENGINE_CHUNK_BUDGETS)",
    ]
    assert len(lines) == 2


def install_bundle(root: Path, slug: str, sizes: dict[str, int]) -> None:
    for name, size in sizes.items():
        bundle(root, f"{bundles.INSTALL_DIR}/{slug}/{name}", b"x" * size)


def test_happy_path_the_install_bundle_is_measured_as_served(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    install_bundle(tmp_path, "1-0-0-abc1234", {"server.tgz": 2000, "pipeline.tgz": 1500, "hosting.tgz": 5000, "legacy.tgz": 4000})

    assert bundles.main(["--root", str(tmp_path), "--install"]) == 0
    lines = caplog.messages[0].splitlines()
    assert lines[0] == "[bundle-budget] OK:"
    assert lines[1:] == [
        f"  {bundles.INSTALL_DIR}/1-0-0-abc1234/hosting.tgz: 5.0 KB as served (budget 12000 KB)",
        f"  {bundles.INSTALL_DIR}/1-0-0-abc1234/legacy.tgz: 4.0 KB as served (budget 60000 KB)",
        f"  {bundles.INSTALL_DIR}/1-0-0-abc1234/pipeline.tgz: 1.5 KB as served (budget 1000 KB)",
        f"  {bundles.INSTALL_DIR}/1-0-0-abc1234/server.tgz: 2.0 KB as served (budget 8000 KB)",
    ]


def test_bad_path_an_install_bundle_missing_a_file_over_budget_or_absent_fails(tmp_path: Path) -> None:
    assert bundles.check_install(tmp_path) == ([f"{bundles.INSTALL_DIR}: no install bundle (run build:install first)"], [])

    install_bundle(tmp_path, "1-0-0-abc1234", {"server.tgz": 3000, "hosting.tgz": 10})
    problems, lines = bundles.check_install(tmp_path, {"server.tgz": 2, "pipeline.tgz": 1, "hosting.tgz": 1})

    assert problems == [
        f"{bundles.INSTALL_DIR}/1-0-0-abc1234/pipeline.tgz: missing (run build:install first)",
        f"{bundles.INSTALL_DIR}/1-0-0-abc1234/server.tgz: 3.0 KB as served (budget 2 KB)",
    ]
    assert len(lines) == 2
    assert bundles.main(["--root", str(tmp_path), "--install"]) == 1
