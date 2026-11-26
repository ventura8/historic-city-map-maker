"""check_notices.py: each build's THIRD_PARTY_NOTICES.txt against its source maps and the installed packages."""

import json
import runpy
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path

import check_notices as notices
import pytest
from treeutil import write

SCRIPT = Path(notices.__file__)

ENGINE = "packages/engine/dist"
ADMIN = "packages/admin/dist"
CLI = "packages/create-historic-city/dist"
MIT_TEXT = "MIT License\n\nPermission is hereby granted, free of charge, ..."


def install(root: Path, folder: str, name: str, version: str, licence: str = "MIT") -> None:
    """A package folder under root/<folder> (`node_modules/x` or `node_modules/a/node_modules/x`) with its package.json."""
    write(root, f"{folder}/package.json", json.dumps({"name": name, "version": version, "license": licence}))


def source_map(root: Path, build: str, name: str, sources: Sequence[str], source_root: str | None = None) -> None:
    """A source map of the build whose sources are relative to the map's folder, as Rolldown writes them."""
    data: dict[str, object] = {"version": 3, "sources": list(sources), "mappings": ""}
    if source_root is not None:
        data["sourceRoot"] = source_root
    write(root, f"{build}/{name}", json.dumps(data))


def entry(name: str, version: str, licence: str = "MIT", *, files: Sequence[str] = (), text: str = MIT_TEXT) -> str:
    header = [notices.RULE, f"Package: {name}", f"Version: {version}", f"Licence: {licence}", *(f"File: {file}" for file in files)]
    return "\n".join([*header, "Licence text: LICENSE of the package", notices.DIVIDER, "", text, ""])


def notices_file(root: Path, build: str, entries: Sequence[str]) -> None:
    intro = "Third-party notices for a test build\n\nPackages: " + str(len(entries)) + "\n"
    write(root, f"{build}/{notices.NOTICES}", "\n".join([intro, *entries]))


def engine_build(root: Path) -> None:
    """lit-html and a scoped package bundled, one font copied from an installed font package; the notices complete."""
    install(root, "node_modules/lit-html", "lit-html", "3.3.3", "BSD-3-Clause")
    install(root, "node_modules/@lit/reactive-element", "@lit/reactive-element", "2.1.2", "BSD-3-Clause")
    install(root, "node_modules/material-symbols", "material-symbols", "0.48.0", "Apache-2.0")
    source_map(
        root,
        ENGINE,
        "engine.mjs.map",
        [
            "../../../node_modules/lit-html/lit-html.js",
            "../../../node_modules/@lit/reactive-element/css-tag.js",
            "../../ui/src/index.ts",
            "\u0000rolldown/runtime.js",
        ],
    )
    write(root, f"{ENGINE}/fonts/material-symbols-rounded.woff2", "font")
    notices_file(
        root,
        ENGINE,
        [
            entry("@lit/reactive-element", "2.1.2", "BSD-3-Clause"),
            entry("lit-html", "3.3.3", "BSD-3-Clause"),
            entry("material-symbols", "0.48.0", "Apache-2.0", files=["fonts/material-symbols-rounded.woff2"]),
        ],
    )


def admin_build(root: Path) -> None:
    """A package nested under another's node_modules, named through the map's `sourceRoot`, in a lazy chunk's map."""
    install(root, "node_modules/firebase/node_modules/idb", "idb", "7.1.1", "ISC")
    source_map(root, ADMIN, "admin-core-Ab3_x9Yz.js.map", ["src/index.ts"], source_root="../")
    source_map(root, ADMIN, "photos-Zz9_8Yy7.js.map", ["node_modules/firebase/node_modules/idb/build/index.js"], source_root="../../../")
    notices_file(root, ADMIN, [entry("idb", "7.1.1", "ISC")])


def cli_build(root: Path) -> None:
    """The create-historic-city CLI: zod bundled into dist/cli.mjs (M5), its notices complete."""
    install(root, "node_modules/zod", "zod", "4.6.6", "MIT")
    source_map(root, CLI, "cli.mjs.map", ["../../../node_modules/zod/v4/core/core.js", "../src/main.ts"])
    notices_file(root, CLI, [entry("zod", "4.6.6", "MIT")])


def problems_of(root: Path) -> list[str]:
    problems, _ = notices.check(root)
    return problems


def test_happy_path_complete_notices_pass_with_one_line_per_build(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    engine_build(tmp_path)
    admin_build(tmp_path)
    cli_build(tmp_path)

    assert notices.main(["--root", str(tmp_path)]) == 0
    assert caplog.messages == [
        "[notices] OK:\n"
        f"  {ENGINE}/{notices.NOTICES}: 2 bundled package(s) and 1 for copied files, each with its licence\n"
        f"  {ADMIN}/{notices.NOTICES}: 1 bundled package(s) and 0 for copied files, each with its licence\n"
        f"  {CLI}/{notices.NOTICES}: 1 bundled package(s) and 0 for copied files, each with its licence"
    ]


def test_bad_path_a_missing_notices_file_fails_the_build_it_belongs_to(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    engine_build(tmp_path)
    cli_build(tmp_path)

    assert notices.main(["--root", str(tmp_path)]) == 1
    assert caplog.messages == [f"[notices] FAILED:\n  - {ADMIN}/{notices.NOTICES}: missing (run the build stage first)"]


def test_bad_path_a_bundled_package_without_its_entry_fails(tmp_path: Path) -> None:
    engine_build(tmp_path)
    install(tmp_path, "node_modules/zod", "zod", "4.6.6")
    source_map(tmp_path, ENGINE, "firebase-sdk-Q1w2E3r4.js.map", ["../../../node_modules/zod/index.js"])

    assert problems_of(tmp_path)[0] == f"{ENGINE}: zod@4.6.6: bundled (MIT) but not in {notices.NOTICES}"


def test_bad_path_an_entry_that_disagrees_with_its_package_fails(tmp_path: Path) -> None:
    # The wrong licence id, a licence nobody reviewed, and an entry without its text.
    install(tmp_path, "node_modules/lit-html", "lit-html", "3.3.3", "BSD-3-Clause")
    install(tmp_path, "node_modules/gpl-thing", "gpl-thing", "1.0.0", "GPL-3.0-only")
    install(tmp_path, "node_modules/silent", "silent", "2.0.0", "MIT")
    sources = [f"../../../node_modules/{name}/index.js" for name in ("lit-html", "gpl-thing", "silent")]
    source_map(tmp_path, ENGINE, "engine.mjs.map", sources)
    notices_file(
        tmp_path,
        ENGINE,
        [entry("gpl-thing", "1.0.0", "GPL-3.0-only"), entry("lit-html", "3.3.3", "MIT"), entry("silent", "2.0.0", text="  ")],
    )

    problems, _ = notices.check(tmp_path, [ENGINE])

    assert problems == [
        f"{ENGINE}: gpl-thing@1.0.0: GPL-3.0-only is not an allowed licence (review it, then add it to ALLOWED_LICENCES)",
        f"{ENGINE}: lit-html@3.3.3: the entry says MIT, the package declares BSD-3-Clause",
        f"{ENGINE}: silent@2.0.0: the entry has no licence text",
    ]


def test_bad_path_an_entry_for_nothing_the_build_carries_fails(tmp_path: Path) -> None:
    engine_build(tmp_path)
    text = (tmp_path / ENGINE / notices.NOTICES).read_text(encoding="utf-8")
    write(tmp_path, f"{ENGINE}/{notices.NOTICES}", text + entry("left-over", "1.0.0"))

    problems, _ = notices.check(tmp_path, [ENGINE])

    assert problems == [f"{ENGINE}: left-over@1.0.0: in {notices.NOTICES} but no module of it is bundled"]


def test_bad_path_malformed_and_repeated_entries_fail(tmp_path: Path) -> None:
    engine_build(tmp_path)
    text = (tmp_path / ENGINE / notices.NOTICES).read_text(encoding="utf-8")
    no_version = "\n".join([notices.RULE, "Package: half", "Licence: MIT", notices.DIVIDER, "", "text", ""])
    no_divider = "\n".join([notices.RULE, "Package: open", "Version: 1.0.0", "Licence: MIT", "", "text", ""])
    repeated = entry("lit-html", "3.3.3", "BSD-3-Clause")
    write(tmp_path, f"{ENGINE}/{notices.NOTICES}", text + no_version + no_divider + repeated)

    problems, _ = notices.check(tmp_path, [ENGINE])

    assert problems == [
        f"{ENGINE}: an entry without one each of Package, Version, Licence and a `-` rule: 'Package: half\\nLicence: MIT'",
        f"{ENGINE}: an entry without one each of Package, Version, Licence and a `-` rule: "
        "'Package: open\\nVersion: 1.0.0\\nLicence: MIT\\n\\ntext'",
        f"{ENGINE}: lit-html@3.3.3: two entries",
    ]


def test_bad_path_copied_files_must_ship_be_named_and_come_from_the_installed_package(tmp_path: Path) -> None:
    engine_build(tmp_path)
    write(tmp_path, f"{ENGINE}/fonts/roboto-flex-latin-wght.woff2", "font")
    install(tmp_path, "node_modules/@fontsource-variable/roboto-flex", "@fontsource-variable/roboto-flex", "5.3.0", "OFL-1.1")
    text = (tmp_path / ENGINE / notices.NOTICES).read_text(encoding="utf-8")
    stale = entry("@fontsource-variable/roboto-flex", "5.2.0", "OFL-1.1", files=["fonts/roboto-flex-latin-wght.woff2"])
    absent = entry("not-installed", "1.0.0", files=["fonts/gone.woff2"])
    write(tmp_path, f"{ENGINE}/{notices.NOTICES}", text + stale + absent)

    problems, _ = notices.check(tmp_path, [ENGINE])

    assert problems == [
        f"{ENGINE}: @fontsource-variable/roboto-flex@5.2.0: names copied files, "
        "but @fontsource-variable/roboto-flex@5.2.0 is not the installed package",
        f"{ENGINE}: not-installed@1.0.0: names fonts/gone.woff2, which the build does not ship",
        f"{ENGINE}: not-installed@1.0.0: names copied files, but not-installed@1.0.0 is not the installed package",
    ]


def test_bad_path_a_shipped_font_without_an_entry_fails(tmp_path: Path) -> None:
    engine_build(tmp_path)
    write(tmp_path, f"{ENGINE}/fonts/extra.woff2", "font")

    problems, _ = notices.check(tmp_path, [ENGINE])

    assert problems == [f"{ENGINE}: fonts/extra.woff2: shipped without an entry naming it"]


def test_bad_path_a_build_without_source_maps_fails(tmp_path: Path) -> None:
    notices_file(tmp_path, ENGINE, [])

    problems, _ = notices.check(tmp_path, [ENGINE])

    assert problems == [f"{ENGINE}: no source map (both Vite configs set `sourcemap: true`: the gate reads the module graph from them)"]


@pytest.mark.parametrize(
    "manifest",
    [
        None,
        "not json",
        json.dumps(["a", "list"]),
        json.dumps({"name": "anonymous", "version": "1.0.0"}),
        json.dumps({"name": "anonymous", "version": "1.0.0", "license": {"type": "MIT"}}),
        json.dumps({"name": "", "version": "1.0.0", "license": "MIT"}),
    ],
)
def test_bad_path_a_bundled_package_that_does_not_describe_itself_fails(tmp_path: Path, manifest: str | None) -> None:
    if manifest is not None:
        write(tmp_path, "node_modules/anonymous/package.json", manifest)
    source_map(tmp_path, ENGINE, "engine.mjs.map", ["../../../node_modules/anonymous/index.js"])
    notices_file(tmp_path, ENGINE, [])

    problems, _ = notices.check(tmp_path, [ENGINE])

    assert problems == [
        f"{ENGINE}: {tmp_path}/node_modules/anonymous: bundled, but its package.json names no package, version or licence id"
    ]


@pytest.mark.parametrize("content", ["not json", json.dumps([1, 2]), json.dumps({"version": 3}), json.dumps({"sources": "x.js"})])
def test_bad_path_a_map_that_names_no_sources_adds_nothing(tmp_path: Path, content: str) -> None:
    engine_build(tmp_path)
    write(tmp_path, f"{ENGINE}/odd.js.map", content)

    assert notices.check(tmp_path, [ENGINE])[0] == []
    assert notices.map_sources(tmp_path / ENGINE / "odd.js.map") == []


def test_happy_path_sources_that_are_not_strings_are_skipped(tmp_path: Path) -> None:
    write(tmp_path, "dist/a.js.map", json.dumps({"sources": [1, None, "../node_modules/x/y.js"]}))

    assert notices.map_sources(tmp_path / "dist" / "a.js.map") == [f"{tmp_path}/node_modules/x/y.js"]


@pytest.mark.parametrize(
    ("source", "root"),
    [
        ("/r/node_modules/lit-html/lit-html.js", "/r/node_modules/lit-html"),
        ("/r/node_modules/@lit/reactive-element/css-tag.js", "/r/node_modules/@lit/reactive-element"),
        ("/r/node_modules/a/node_modules/@s/b/x.js", "/r/node_modules/a/node_modules/@s/b"),
        ("C:\\r\\node_modules\\idb\\build\\index.js", "C:/r/node_modules/idb"),
        ("/r/packages/ui/src/index.ts", None),
    ],
)
def test_happy_path_the_package_is_the_folder_under_the_last_node_modules(source: str, root: str | None) -> None:
    assert notices.package_root(source) == root


def test_happy_path_header_lines_may_repeat_and_values_are_trimmed() -> None:
    fields: Mapping[str, list[str]] = notices.header_fields(["File: a.woff2", "File:  b.woff2 ", "Notice: Copyright 2019 Google LLC"])

    assert fields == {"File": ["a.woff2", "b.woff2"], "Notice": ["Copyright 2019 Google LLC"]}


def test_happy_path_script_entry_point_exits_with_main_status(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    engine_build(tmp_path)
    admin_build(tmp_path)
    cli_build(tmp_path)
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--root", str(tmp_path)])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(SCRIPT), run_name="__main__")

    assert exit_info.value.code == 0
