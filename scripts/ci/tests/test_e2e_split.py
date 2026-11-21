"""scripts/ci/e2e-split.sh: a stage's Playwright runs split between this machine and a second one over ssh.

Each test copies the script into a throwaway tree whose scripts/ci/run-all-checks.sh is a stub (it records the stage,
E2E_SHARD, E2E_TIER and E2E_ADMIN_PART it was given, writes the blob report and green marker a run would, and exits as told), and puts
fake `ssh`, `rsync` and `docker` first on PATH: `ssh` answers the script's three remote steps (prepare and lock, run,
release) from what it reads on stdin, `rsync` copies the fake remote's reports back, `docker` records the report merge.
"""

import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import pytest

import pipeline

SCRIPT = Path(__file__).resolve().parents[1] / "e2e-split.sh"
SSH = "ssh -o BatchMode=yes -o ConnectTimeout=5 -o ServerAliveInterval=30"

STUB_RUN_ALL_CHECKS = """#!/usr/bin/env bash
printf 'local %s %s %s %s\\n' "$PIPELINE_STAGE" "${E2E_SHARD:-}" "${E2E_TIER:-}" "${E2E_ADMIN_PART:-}" >>"$SPLIT_LOG"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ -n "${E2E_SHARD:-}" ]]; then
    mkdir -p "$root/reports/blob/e2e"
    echo "${E2E_SHARD}" >"$root/reports/blob/e2e/report-${E2E_SHARD%%[-/]*}.zip"
fi
if [[ "${FAKE_LOCAL_RC:-0}" == 0 ]]; then
    mkdir -p "$root/reports/pipeline" && echo '{}' >"$root/reports/pipeline/green-$PIPELINE_STAGE.json"
fi
exit "${FAKE_LOCAL_RC:-0}"
"""

FAKE_SSH = """#!/usr/bin/env bash
script=$(cat)
printf 'ssh %s\\n' "$*" >>"$SPLIT_LOG"
case "$script" in
*"command -v docker"*) exit "${FAKE_PREPARE_RC:-0}" ;;
*run-all-checks.sh*)
    echo "remote line"
    mkdir -p "$FAKE_REMOTE/reports/blob/e2e" && echo remote >"$FAKE_REMOTE/reports/blob/e2e/report-1.zip"
    exit "${FAKE_RUN_RC:-0}"
    ;;
*) exit 0 ;;
esac
"""

FAKE_RSYNC = """#!/usr/bin/env bash
printf 'rsync %s\\n' "${*: -2}" >>"$SPLIT_LOG"
source=${*: -2:1}
if [[ "$source" == *:*/reports/ ]]; then
    cp -r "$FAKE_REMOTE/reports/." "${*: -1}"
fi
"""

FAKE_DOCKER = """#!/usr/bin/env bash
printf 'docker %s %s\\n' "${*: -2:1}" "${*: -1}" >>"$SPLIT_LOG"
ls "${*: -1}" >>"$SPLIT_LOG"
exit "${FAKE_DOCKER_RC:-0}"
"""


@dataclass
class Split:
    root: Path
    log: Path
    env: dict[str, str]

    def run(self, **env: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", str(self.root / "scripts/ci/e2e-split.sh")],
            env={**self.env, **env},
            capture_output=True,
            text=True,
            check=False,
            timeout=60,
        )

    def calls(self) -> list[str]:
        return self.log.read_text(encoding="utf-8").splitlines() if self.log.exists() else []


def executable(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    path.chmod(0o755)


@pytest.fixture
def split(tmp_path: Path) -> Split:
    root = tmp_path / "repo"
    (root / "scripts/ci").mkdir(parents=True)
    shutil.copy(SCRIPT, root / "scripts/ci/e2e-split.sh")
    executable(root / "scripts/ci/run-all-checks.sh", STUB_RUN_ALL_CHECKS)
    for name, text in (("ssh", FAKE_SSH), ("rsync", FAKE_RSYNC), ("docker", FAKE_DOCKER)):
        executable(tmp_path / "bin" / name, text)
    (tmp_path / "remote").mkdir()
    env = {
        "PATH": f"{tmp_path / 'bin'}{os.pathsep}{os.environ['PATH']}",
        "HOME": str(tmp_path),
        "SPLIT_LOG": str(tmp_path / "split.log"),
        "FAKE_REMOTE": str(tmp_path / "remote"),
    }
    return Split(root=root, log=tmp_path / "split.log", env=env)


def source_and_call(function: str, *args: str) -> str:
    command = f'source "{SCRIPT}" && {function} "$@"'
    return subprocess.run(["bash", "-c", command, "bash", *args], capture_output=True, text=True, check=True).stdout.strip()


@pytest.mark.parametrize("stage", pipeline.all_stage_names())
def test_happy_path_the_playwright_stages_follow_the_pipeline_registry(stage: str) -> None:
    expected = [simple for simple in pipeline.expand_stage(stage) if any(gate.startswith("playwright") for gate in pipeline.STAGES[simple])]

    assert source_and_call("playwright_stages", stage).split() == expected


@pytest.mark.parametrize(
    ("first", "last", "total", "expected"),
    [("1", "1", "3", "1/3"), ("2", "3", "3", "2-3/3"), ("1", "2", "6", "1-2/6"), ("5", "5", "5", "5/5")],
)
def test_happy_path_a_part_is_one_shard_or_a_range(first: str, last: str, total: str, expected: str) -> None:
    assert source_and_call("shard_range", first, last, total) == expected


def test_happy_path_the_split_runs_one_part_here_and_the_other_on_the_host(split: Split) -> None:
    result = split.run(PIPELINE_STAGE="e2e", E2E_TIER="fn,tour")

    assert result.returncode == 0, result.stdout + result.stderr
    lines = result.stdout.splitlines()
    verdict = "[SUCCESS] stage 'e2e' passed (reports/pipeline/green-e2e.json; Playwright split: 4-5/5 here, 1-3/5 on nuc,"
    assert lines[-1].startswith(verdict)
    assert "[nuc] remote line" in lines
    calls = split.calls()
    assert calls[0] == f"{SSH} nuc bash -s -- hcm-ci"
    assert calls[1] == f"rsync {split.root}/ nuc:hcm-ci/"
    assert "local e2e 4-5/5 fn,tour 3/3" in calls
    assert f"{SSH} nuc bash -s -- hcm-ci 1-3/5 1-2/3 tier=fn,tour e2e" in calls
    merge = calls.index(f"docker junit {split.root}/reports/split/merge/e2e")
    assert sorted(calls[merge + 1 : merge + 3]) == ["report-1.zip", "report-4.zip"]
    assert (split.root / "reports/pipeline/green-e2e.json").is_file()
    assert (split.root / "reports/split/nuc/blob/e2e/report-1.zip").is_file()
    assert calls[-1] == f"{SSH} nuc bash -s -- hcm-ci"


def test_happy_path_all_gives_the_host_two_of_three_parts_of_both_playwright_stages(split: Split) -> None:
    result = split.run(PIPELINE_STAGE="all", HCM_SPLIT_HOST="ci@nuc.lan", HCM_SPLIT_DIR="work/hcm")

    assert "[split] stage 'all': 3/3 here, 1-2/3 on ci@nuc.lan (e2e tour-matrix; admin part 3/3 here, 1-2/3 there)" in result.stdout
    assert "local all 3/3  3/3" in split.calls()
    assert f"{SSH} ci@nuc.lan bash -s -- work/hcm 1-2/3 1-2/3 tier= e2e tour-matrix" in split.calls()


@pytest.mark.parametrize(("stage", "parts"), [("e2e", "2:3"), ("tour-matrix", "2:3"), ("quality", "1:2"), ("all", "1:2")])
def test_happy_path_each_stage_splits_by_its_measured_default(stage: str, parts: str) -> None:
    assert source_and_call("default_parts", stage) == parts


def test_happy_path_the_parts_can_be_chosen(split: Split) -> None:
    result = split.run(PIPELINE_STAGE="tour-matrix", HCM_SPLIT_PARTS="1:1")

    assert "[split] stage 'tour-matrix': 2/2 here, 1/2 on nuc (tour-matrix; admin part 3/3 here, 1-2/3 there)" in result.stdout


@pytest.mark.parametrize(
    ("env", "reason"),
    [
        ({"PIPELINE_STAGE": "static"}, "no Playwright run in it"),
        ({"PIPELINE_STAGE": "e2e", "HCM_SPLIT_HOST": ""}, "HCM_SPLIT_HOST is empty"),
        (
            {"PIPELINE_STAGE": "e2e", "HCM_SPLIT_DIR": "a dir; rm -rf"},
            "HCM_SPLIT_HOST, HCM_SPLIT_DIR or E2E_TIER has characters this script does not pass on",
        ),
        ({"PIPELINE_STAGE": "e2e", "HCM_SPLIT_PARTS": "0:2"}, "HCM_SPLIT_PARTS must be <here>:<remote>, got '0:2'"),
        ({"PIPELINE_STAGE": "e2e", "FAKE_PREPARE_RC": "255"}, "nuc does not answer"),
        ({"PIPELINE_STAGE": "e2e", "FAKE_PREPARE_RC": "3"}, "nuc has no docker or no rsync"),
        ({"PIPELINE_STAGE": "e2e", "FAKE_PREPARE_RC": "4"}, "another split holds nuc (hcm-ci.split-lock)"),
        ({"PIPELINE_STAGE": "e2e", "FAKE_PREPARE_RC": "1"}, "nuc could not prepare hcm-ci (exit 1)"),
    ],
)
def test_bad_path_without_a_usable_host_the_whole_stage_runs_here(split: Split, env: dict[str, str], reason: str) -> None:
    result = split.run(**env)

    assert result.returncode == 0
    assert result.stdout.splitlines()[0] == f"[split] {reason}: stage '{env['PIPELINE_STAGE']}' runs here only"
    assert [call for call in split.calls() if call.startswith("local")] == [f"local {env['PIPELINE_STAGE']}   "]


def test_bad_path_a_failed_remote_part_fails_the_stage_and_drops_the_marker(split: Split) -> None:
    result = split.run(PIPELINE_STAGE="e2e", FAKE_RUN_RC="1")

    assert result.returncode == 1
    assert result.stdout.splitlines()[-1].startswith("[FAILURE] stage 'e2e' failed: here (exit 0), nuc (exit 1), report merge (exit 0)")
    assert "[split] nuc: exit 1 after" in result.stdout
    assert f"docker junit,html {split.root}/reports/split/merge/e2e" in split.calls()
    assert not (split.root / "reports/pipeline/green-e2e.json").exists()


def test_bad_path_a_failed_local_part_or_merge_fails_the_stage(split: Split) -> None:
    local = split.run(PIPELINE_STAGE="e2e", FAKE_LOCAL_RC="1")
    merge = split.run(PIPELINE_STAGE="e2e", FAKE_DOCKER_RC="1")

    assert local.stdout.splitlines()[-1].startswith("[FAILURE] stage 'e2e' failed: here (exit 1), nuc (exit 0), report merge (exit 0)")
    assert merge.stdout.splitlines()[-1].startswith("[FAILURE] stage 'e2e' failed: here (exit 0), nuc (exit 0), report merge (exit 1)")


def test_bad_path_a_dropped_connection_runs_the_remote_part_here(split: Split) -> None:
    result = split.run(PIPELINE_STAGE="e2e", FAKE_RUN_RC="255")

    assert result.returncode == 0, result.stdout
    assert "[split] the connection to nuc dropped: running its part (1-3/5) here" in result.stdout
    assert [call for call in split.calls() if call.startswith("local")] == ["local e2e 4-5/5  3/3", "local e2e 1-3/5  1-2/3"]
    merge = split.calls().index(f"docker junit {split.root}/reports/split/merge/e2e")
    assert sorted(split.calls()[merge + 1 : merge + 3]) == ["report-1.zip", "report-4.zip"]
