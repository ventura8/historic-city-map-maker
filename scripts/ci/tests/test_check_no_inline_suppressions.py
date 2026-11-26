"""check_no_inline_suppressions.py: every banned directive is caught, prose and code samples are not.

The directives below are assembled from pieces (`d("es", "lint-dis", "able")`) so that this test file
does not itself contain the strings the scanner bans.
"""

import runpy
import sys
from pathlib import Path

import check_no_inline_suppressions as scanner
import pytest

SCANNER_PY = Path(scanner.__file__)


def d(*parts: str) -> str:
    return "".join(parts)


def write(root: Path, relative: str, text: str) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text + "\n", encoding="utf-8")


@pytest.mark.parametrize(
    ("relative", "line", "label"),
    [
        ("packages/a/src/x.ts", d("// es", "lint-dis", "able-next-line no-console"), "eslint-disable/enable directive"),
        ("x.mjs", d("/* es", "lint no-console: off */"), "inline ESLint configuration comment"),
        ("x.ts", d("// @ts-", "expect-error"), "TypeScript suppression"),
        ("x.ts", d("/* v8 ", "ignore next */"), "coverage ignore hint"),
        ("x.cts", d("// prettier", "-ignore"), "prettier-ignore"),
        ("x.test.ts", d("describe.", "only('suite', () => {});"), "focused/skipped/conditional test"),
        ("x.test.ts", d("it.", "skipIf(ci)('x', () => {});"), "focused/skipped/conditional test"),
        ("x.spec.ts", d("f", "it('x', () => {});"), "focused/skipped test alias"),
        ("x.test.ts", d("it.concurrent.", "only('x', async () => {});"), "focused/skipped/conditional test"),
        ("e2e/specs/x.spec.ts", d("test.describe.serial.", "skip('suite', () => {});"), "focused/skipped/conditional test"),
        ("e2e/specs/x.spec.ts", d("test.", "fail('known bug', async () => {});"), "focused/skipped/conditional test"),
        ("e2e/specs/x.spec.ts", d("test", "Info.fixme(true, 'flaky');"), "runtime skip/fixme/fail"),
        ("e2e/specs/x.spec.ts", d("test.info().", "skip();"), "runtime skip/fixme/fail"),
        ("x.tsx", d("// @ts-", "nocheck"), "TypeScript suppression"),
        ("x.ts", d("// knip", "-ignore"), "tool ignore marker"),
        ("x.css", d("/* style", "lint-disable */"), "stylelint directive"),
        ("x.html", d("<!-- html-validate", "-disable-next -->"), "html-validate directive"),
        ("x.html", d("<!-- html", "hint attr-lowercase: false -->"), "htmlhint inline configuration"),
        ("x.py", d("import os  # no", "qa: F401"), "noqa comment"),
        ("x.py", d("x = f()  # type: ", "ignore[misc]"), "type-ignore comment"),
        ("x.py", d("# py", "lint: disable=C0103"), "inline linter directive"),
        ("x.py", d("run(cmd)  # no", "sec"), "nosec comment"),
        ("x.py", d("if debug:  # pragma: no ", "cover"), "coverage pragma"),
        ("x.py", d("@pytest.mark.", "xfail"), "skip/xfail marker"),
        ("x.py", d("pytest.", "skip('later')"), "runtime skip/xfail"),
        ("x.py", d("table = [1, 2]  # fmt: ", "skip"), "formatter/import-sort directive"),
        ("x.py", d("# isort: ", "skip_file"), "formatter/import-sort directive"),
        ("x.py", d("@unittest.", "skip('later')"), "unittest skip/expected failure"),
        ("x.py", d("self.skip", "Test('later')"), "unittest skip/expected failure"),
        ("x.py", d("x = f()  # py", "right: ignore"), "inline linter directive"),
        ("pipeline/typings/osgeo/gdal.pyi", d("def Open(path: str) -> Dataset: ...  # type: ", "ignore"), "type-ignore comment"),
        ("x.sh", d("# shell", "check disable=SC2086"), "shellcheck directive"),
        ("scripts/git-hooks/pre-commit", d("# shell", "check source=x.sh"), "shellcheck directive"),
        ("docker/Dockerfile.quality", d("# hado", "lint ignore=DL3008"), "hadolint ignore pragma"),
        ("pipeline/Dockerfile", d("# hado", "lint global ignore=DL3008"), "hadolint ignore pragma"),
        ("docker/Dockerfile.quality", d("# check=", "skip=JSONArgsRecommended"), "BuildKit check skip directive"),
        (".github/workflows/ci.yml", d("# yam", "llint disable-line"), "yamllint directive"),
        (".github/workflows/ci.yml", d("# shell", "check disable=SC2086"), "shellcheck directive"),
        (".github/actions/x/action.yml", d("# prettier", "-ignore"), "prettier-ignore"),
        (".github/workflows/ci.yaml", d("# ziz", "mor: ignore[artipacked]"), "zizmor ignore"),
        ("docs/x.md", d("<!-- markdown", "lint-disable MD013 -->"), "markdownlint directive"),
        ("firestore.rules", d("allow read; // NO", "SONAR"), d("NO", "SONAR marker")),
        ("x.ts", d("const key = 'k'; // gitleaks", ":allow"), d("gitleaks", ":allow marker")),
    ],
)
def test_bad_path_directive_is_reported(tmp_path: Path, relative: str, line: str, label: str) -> None:
    write(tmp_path, relative, line)

    assert scanner.scan(tmp_path) == [f"  {relative}:1: forbidden {label} -> {line}"]


@pytest.mark.parametrize(
    ("relative", "text"),
    [
        ("docs/a.md", d("```html\n<!-- markdown", "lint-disable -->\n```")),
        ("docs/b.md", d("~~~\n<!-- markdown", "lint-disable -->\n~~~")),
        ("docs/c.md", d("Never write `<!-- markdown", "lint-disable -->` in a page.")),
        ("docs/d.md", d("Inline `es", "lint-dis", "able` comments are banned; this prose may say so.")),
        ("x.ts", "map.fitBounds(bounds); camera.fit(box);"),
        ("x.ts", "const isOnly = list.only;"),
        ("x.ts", "const tests = suiteOf(test.info().title); await expect(locator).toBeVisible();"),
        ("x.py", "# fmt is the output format; isort sorts imports (ruff I rules)."),
        ("Dockerfile", "# check the build with hadolint; nothing is skipped"),
        ("notes.txt", d("# no", "qa is not checked in plain text")),
        ("package.json", d('{"description": "es', "lint-dis", 'able is banned"}')),
        ("docs/e.md", d("Sonar markers such as NO", "SONAR are banned in source files.")),
    ],
)
def test_happy_path_prose_and_unrelated_code_are_clean(tmp_path: Path, relative: str, text: str) -> None:
    write(tmp_path, relative, text)

    assert scanner.scan(tmp_path) == []


@pytest.mark.parametrize(
    "relative",
    [
        "node_modules/pkg/index.js",
        "packages/ui/node_modules/pkg/index.js",
        "packages/engine/dist/engine.mjs",
        "reports/coverage/x.js",
        "seed/bucharest/x.py",
        "vendor/npm/braces/index.js",
        ".claude/worktrees/feature/x.ts",
        ".docker-build-cache.new/x.ts",
    ],
)
def test_happy_path_excluded_trees_are_not_scanned(tmp_path: Path, relative: str) -> None:
    write(tmp_path, relative, d("// es", "lint-dis", "able"))

    assert scanner.scan(tmp_path) == []
    assert scanner.scan(tmp_path, [relative]) == []


def test_happy_path_scanner_does_not_scan_itself(tmp_path: Path) -> None:
    write(tmp_path, "scripts/ci/check_no_inline_suppressions.py", d("# no", "qa"))

    assert scanner.scan(tmp_path) == []


def test_happy_path_undecodable_file_is_skipped(tmp_path: Path) -> None:
    (tmp_path / "x.ts").write_bytes(b"\xff\xfe\x00 binary")

    assert scanner.scan(tmp_path) == []


def test_happy_path_unreadable_file_is_skipped(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    write(tmp_path, "x.ts", d("// es", "lint-dis", "able"))

    def unreadable(_path: Path, encoding: str) -> str:
        raise PermissionError(encoding)

    monkeypatch.setattr(Path, "read_text", unreadable)

    assert scanner.scan(tmp_path) == []


def test_happy_path_named_files_only_are_scanned(tmp_path: Path) -> None:
    write(tmp_path, "a.ts", d("// @ts-", "ignore"))
    write(tmp_path, "b.ts", d("// @ts-", "ignore"))

    assert scanner.scan(tmp_path, ["a.ts", "missing.ts"]) == [f"  a.ts:1: forbidden TypeScript suppression -> {d('// @ts-', 'ignore')}"]


def test_happy_path_multiple_findings_keep_file_and_line_order(tmp_path: Path) -> None:
    write(tmp_path, "a.py", d("ok = 1\nbad = 2  # no", "qa\n# no", "sec"))

    assert [violation.split(" forbidden")[0] for violation in scanner.scan(tmp_path)] == ["  a.py:2:", "  a.py:3:"]


# --- CLI ------------------------------------------------------------------------------------------


def test_bad_path_main_fails_on_a_violation(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    write(tmp_path, "x.ts", d("// es", "lint-dis", "able"))

    assert scanner.main(["--root", str(tmp_path)]) == 1
    assert "Inline suppressions are banned" in caplog.text


def test_happy_path_main_passes_on_a_clean_tree(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    write(tmp_path, "x.ts", "export const ok = true;")

    assert scanner.main(["--root", str(tmp_path), "x.ts"]) == 0
    assert caplog.messages[-1] == "[CI] no inline suppressions found"


def test_bad_path_root_flag_needs_a_directory(caplog: pytest.LogCaptureFixture) -> None:
    assert scanner.main(["--root"]) == 2
    assert caplog.messages == ["[ERROR] --root needs a directory"]


def test_happy_path_default_root_is_the_repository() -> None:
    assert scanner.parse_args(["a.ts"]) == (SCANNER_PY.resolve().parents[2], ["a.ts"])


def test_happy_path_main_reads_sys_argv(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "argv", ["check", "--root", str(tmp_path)])

    assert scanner.main() == 0


def test_happy_path_script_entry_point_exits_with_main_status(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    write(tmp_path, "x.py", d("# type: ", "ignore"))
    monkeypatch.setattr(sys, "argv", [str(SCANNER_PY), "--root", str(tmp_path)])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(SCANNER_PY), run_name="__main__")

    assert exit_info.value.code == 1
