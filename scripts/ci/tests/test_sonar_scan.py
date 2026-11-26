"""sonar_scan.sh: token discovery and validation, the skips, the report precondition and the scanner/report hand-off inside the image.

The script runs from a copy in a temporary repository. `sonar-scanner` and `curl` are fakes on PATH
and `scripts/ci/sonar_report.py` is a fake that records its arguments, so nothing reaches SonarQube.
"""

import os
import shutil
import subprocess
from pathlib import Path

import pytest
from treeutil import init_repo, write

SCRIPT = Path(__file__).resolve().parents[1] / "sonar_scan.sh"
FAKE_TOKEN = "fake-token"
FAKE_SCANNER = """#!/usr/bin/env bash
printf '%s\\n' "$@" > "$FAKE_LOG/scanner-args"
printf '%s' "${SONAR_TOKEN:-}" > "$FAKE_LOG/scanner-token"
printf '%s' "${SONAR_USER_HOME:-}" > "$FAKE_LOG/scanner-home"
[[ -n "${FAKE_SCANNER_OUTPUT:-}" ]] && printf '%s\\n' "$FAKE_SCANNER_OUTPUT"
exit "${FAKE_SCANNER_EXIT:-0}"
"""
FAKE_CURL = """#!/usr/bin/env bash
printf '%s\\n' "$@" > "$FAKE_LOG/curl-args"
cat > "$FAKE_LOG/curl-stdin"
case "${FAKE_CURL:-valid}" in
valid) printf '{"valid":true}' ;;
invalid) printf '{"valid":false}' ;;
*) printf 'curl: (7) Failed to connect' >&2; exit 7 ;;
esac
"""
FAKE_REPORT = """import os, sys
from pathlib import Path
if sys.argv[1:] == ["--check-reports"]:
    Path(os.environ["FAKE_LOG"], "reports-checked").write_text("yes", encoding="utf-8")
    sys.exit(int(os.environ.get("FAKE_REPORTS_EXIT", "0")))
Path(os.environ["FAKE_LOG"], "report-args").write_text("\\n".join(sys.argv[1:]), encoding="utf-8")
sys.exit(int(os.environ.get("FAKE_REPORT_EXIT", "0")))
"""
SKIP_JRE = "-Dsonar.scanner.skipJreProvisioning=true"
SKIP_NO_TOKEN = "[sonar] [SKIP] no SONAR_TOKEN and no .sonar-token: analysis skipped (docs/SETUP.md explains the token step)\n"


@pytest.fixture
def checkout(tmp_path: Path) -> Path:
    """A repository holding the script, sonar-project.properties, package.json and the fake report; fakes in bin/."""
    root = init_repo(tmp_path / "repo")
    write(root, "scripts/ci/sonar_report.py", FAKE_REPORT)
    shutil.copy(SCRIPT, root / "scripts/ci/sonar_scan.sh")
    write(root, "package.json", '{\n    "name": "x",\n    "version": "1.2.3",\n    "private": true\n}')
    write(root, "sonar-project.properties", "sonar.projectKey=x\nsonar.host.url = https://sonar.example.invalid\n")
    write(tmp_path, "bin/sonar-scanner", FAKE_SCANNER).chmod(0o755)
    write(tmp_path, "bin/curl", FAKE_CURL).chmod(0o755)
    (tmp_path / "log").mkdir()
    return root


def token_file(root: Path, mode: int = 0o600) -> None:
    write(root, ".sonar-token", f"  {FAKE_TOKEN}  ").chmod(mode)


def path_without_scanner() -> str:
    """The PATH without the quality image's real sonar-scanner (docker/Dockerfile.quality installs one)."""
    return os.pathsep.join(entry for entry in os.environ["PATH"].split(os.pathsep) if not (Path(entry) / "sonar-scanner").exists())


def scan(root: Path, *args: str, scanner: bool = True, **env: str) -> subprocess.CompletedProcess[str]:
    bin_dir = root.parent / "bin"
    if not scanner:
        (bin_dir / "sonar-scanner").unlink()
    variables = {
        "PATH": f"{bin_dir}:{path_without_scanner()}",
        "HOME": str(root.parent),
        "HCM_TEST_IMAGE": "1",
        "FAKE_LOG": str(root.parent / "log"),
        **env,
    }
    command = ["bash", str(root / "scripts/ci/sonar_scan.sh"), *args]
    return subprocess.run(command, env=variables, capture_output=True, text=True, check=False)


def logged(root: Path, name: str) -> str:
    return (root.parent / "log" / name).read_text(encoding="utf-8")


# --- tokens --------------------------------------------------------------------------------------


def test_happy_path_no_token_skips_the_analysis(checkout: Path) -> None:
    result = scan(checkout)

    assert (result.returncode, result.stdout) == (0, SKIP_NO_TOKEN)
    assert not (checkout.parent / "log" / "curl-args").exists()


def test_bad_path_token_file_readable_by_others_is_refused(checkout: Path) -> None:
    token_file(checkout, 0o644)

    result = scan(checkout)

    assert (result.returncode, result.stderr) == (
        2,
        f"[sonar] {checkout}/.sonar-token is readable by other users: run chmod 600 .sonar-token\n",
    )


def test_happy_path_check_token_sends_it_on_stdin_only(checkout: Path) -> None:
    token_file(checkout)

    result = scan(checkout, "--check-token")

    assert (result.returncode, result.stdout) == (0, "[sonar] the token is valid\n")
    assert (FAKE_TOKEN in logged(checkout, "curl-args"), logged(checkout, "curl-stdin")) == (
        False,
        f'header = "Authorization: Bearer {FAKE_TOKEN}"\n',
    )
    assert not (checkout.parent / "log" / "scanner-args").exists()


@pytest.mark.parametrize(
    ("curl", "code", "message"),
    [
        ("invalid", 2, "the token is invalid or expired: create a new one at https://sonar.example.invalid/account/security"),
        (
            "down",
            0,
            "warning: could not reach https://sonar.example.invalid to validate the token (curl: (7) Failed to connect); continuing",
        ),
    ],
)
def test_bad_path_rejected_or_unverifiable_token(checkout: Path, curl: str, code: int, message: str) -> None:
    result = scan(checkout, "--check-token", SONAR_TOKEN=FAKE_TOKEN, FAKE_CURL=curl)

    assert (result.returncode, message in result.stdout + result.stderr) == (code, True)


def test_bad_path_plain_http_host_is_refused(checkout: Path) -> None:
    write(checkout, "sonar-project.properties", "sonar.host.url=http://sonar.example.invalid\n")

    result = scan(checkout, SONAR_TOKEN=FAKE_TOKEN)

    assert (result.returncode, result.stderr) == (2, "[sonar] sonar.host.url must be an https:// URL, got http://sonar.example.invalid\n")


def test_bad_path_unknown_option_is_a_usage_error(checkout: Path) -> None:
    result = scan(checkout, "--token=x")

    assert (result.returncode, result.stderr) == (2, "[sonar] usage: bash scripts/ci/sonar_scan.sh [--check-token]\n")


# --- scan and report -----------------------------------------------------------------------------


def test_happy_path_token_file_feeds_scanner_and_report(checkout: Path) -> None:
    token_file(checkout)

    result = scan(checkout)

    assert result.returncode == 0
    assert (logged(checkout, "scanner-args"), logged(checkout, "scanner-token")) == (
        f"{SKIP_JRE}\n-Dsonar.projectVersion=1.2.3\n-Dsonar.branch.name=master\n",
        FAKE_TOKEN,
    )
    assert logged(checkout, "scanner-home") == f"{checkout}/reports/.cache/sonar"
    assert (logged(checkout, "reports-checked"), logged(checkout, "report-args")) == (
        "yes",
        "--report-task\n.scannerwork/report-task.txt\n--branch\nmaster",
    )


def test_bad_path_missing_reports_stop_the_scan_before_any_upload(checkout: Path) -> None:
    result = scan(checkout, SONAR_TOKEN=FAKE_TOKEN, FAKE_REPORTS_EXIT="2")

    assert (result.returncode, result.stderr) == (
        2,
        "[sonar] the coverage and test reports are missing: run PIPELINE_STAGE=tests first (PIPELINE_STAGE=all runs both)\n",
    )
    assert not (checkout.parent / "log" / "scanner-args").exists()


def test_happy_path_an_explicit_sonar_user_home_is_kept(checkout: Path, tmp_path: Path) -> None:
    assert scan(checkout, SONAR_TOKEN=FAKE_TOKEN, SONAR_USER_HOME=str(tmp_path / "sonar-home")).returncode == 0
    assert logged(checkout, "scanner-home") == str(tmp_path / "sonar-home")


def test_bad_path_report_verdict_is_the_exit_status(checkout: Path) -> None:
    result = scan(checkout, SONAR_TOKEN=FAKE_TOKEN, FAKE_REPORT_EXIT="1")

    assert result.returncode == 1
    assert "[sonar] scanning master (log: reports/sonar/scanner.log)" in result.stdout


def test_bad_path_missing_scanner_in_the_image_exits_2(checkout: Path) -> None:
    result = scan(checkout, scanner=False, SONAR_TOKEN=FAKE_TOKEN)

    assert (result.returncode, result.stderr) == (
        2,
        "[sonar] sonar-scanner is not installed in the quality image (docker/Dockerfile.quality)\n",
    )


@pytest.mark.parametrize(
    ("output", "code", "message"),
    [
        ("ERROR: Automatic Analysis is enabled for this project", 0, "[SKIP] SonarCloud refused the scan: turn Automatic Analysis OFF"),
        ("ERROR: something else", 2, "the scanner failed; read reports/sonar/scanner.log"),
    ],
)
def test_bad_path_failed_scan_is_skipped_or_fails(checkout: Path, output: str, code: int, message: str) -> None:
    result = scan(checkout, SONAR_TOKEN=FAKE_TOKEN, FAKE_SCANNER_EXIT="3", FAKE_SCANNER_OUTPUT=output)

    assert (result.returncode, message in result.stdout + result.stderr) == (code, True)
    assert (checkout / "reports/sonar/scanner.log").read_text(encoding="utf-8") == output + "\n"


def test_happy_path_detached_head_sends_no_branch(checkout: Path) -> None:
    git = ["git", "-C", str(checkout), "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false"]
    subprocess.run([*git, "add", "."], check=True)
    subprocess.run([*git, "commit", "-qm", "x"], check=True)
    subprocess.run([*git, "checkout", "-q", "--detach"], check=True)

    assert scan(checkout, SONAR_TOKEN=FAKE_TOKEN).returncode == 0
    assert (logged(checkout, "scanner-args"), logged(checkout, "report-args")) == (
        f"{SKIP_JRE}\n-Dsonar.projectVersion=1.2.3\n",
        "--report-task\n.scannerwork/report-task.txt",
    )
