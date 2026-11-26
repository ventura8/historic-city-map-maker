"""workflow-policy.schema.json: the `workflow-policy` gate rejects each banned workflow pattern.

The gate is `check-jsonschema --schemafile scripts/ci/workflow-policy.schema.json` over the workflows
and composite actions (scripts/ci/pipeline.py), so these tests drive that exact command.
"""

import subprocess
from pathlib import Path

import pytest
from treeutil import write

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = ROOT / "scripts" / "ci" / "workflow-policy.schema.json"
CHECKOUT = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1"
HEADER = "on: push\npermissions:\n    contents: read\n"
SAFE_JOB = f"""jobs:
    build:
        runs-on: ubuntu-24.04
        permissions:
            contents: read
        steps:
            - uses: {CHECKOUT}
              with:
                  persist-credentials: false
            - env:
                  TITLE: ${{{{ github.event.pull_request.title }}}}
              run: echo "$TITLE"
"""


def check(*paths: Path) -> subprocess.CompletedProcess[str]:
    command = ["check-jsonschema", "--schemafile", str(SCHEMA), *map(str, paths)]
    return subprocess.run(command, capture_output=True, text=True, check=False)


def test_happy_path_the_repository_workflows_and_actions_follow_the_policy() -> None:
    files = sorted([*ROOT.glob(".github/workflows/*.yml"), *ROOT.glob(".github/actions/*/action.yml")])

    result = check(*files)

    assert result.returncode == 0, result.stdout
    assert "ok -- validation done" in result.stdout


def test_happy_path_least_privilege_workflow_passes(tmp_path: Path) -> None:
    workflow = write(tmp_path, "ci.yml", f"on:\n    pull_request:\npermissions:\n    contents: read\n{SAFE_JOB}")

    assert check(workflow).returncode == 0


@pytest.mark.parametrize(
    ("trigger", "shown"),
    [
        ("on: pull_request_target", "'pull_request_target' should not be valid"),
        ("on: [push, pull_request_target]", "['push', 'pull_request_target'] should not be valid"),
        (
            "on:\n    pull_request_target:\n        branches: [master]",
            "{'pull_request_target': {'branches': ['master']}} should not be valid",
        ),
    ],
)
def test_bad_path_pull_request_target_is_refused_in_every_form(tmp_path: Path, trigger: str, shown: str) -> None:
    workflow = write(tmp_path, "pr.yml", f"{trigger}\npermissions:\n    contents: read\n{SAFE_JOB}")

    result = check(workflow)

    assert result.returncode == 1
    assert f"pr.yml::$.on: {shown}" in result.stdout


def test_bad_path_missing_top_level_permissions_is_refused(tmp_path: Path) -> None:
    workflow = write(tmp_path, "ci.yml", f"on: push\n{SAFE_JOB}")

    result = check(workflow)

    assert result.returncode == 1
    assert "ci.yml::$: 'permissions' is a required property" in result.stdout


@pytest.mark.parametrize("grant", ["write-all", "read-all"])
def test_bad_path_blanket_permissions_are_refused_for_workflow_and_job(tmp_path: Path, grant: str) -> None:
    job = SAFE_JOB.replace("permissions:\n            contents: read", f"permissions: {grant}")
    workflow = write(tmp_path, "ci.yml", f"on: push\npermissions: {grant}\n{job}")

    result = check(workflow)

    assert result.returncode == 1
    assert f"ci.yml::$.permissions: '{grant}' should not be valid" in result.stdout
    assert f"ci.yml::$.jobs.build.permissions: '{grant}' should not be valid" in result.stdout


@pytest.mark.parametrize(
    ("with_block", "shown"),
    [
        ("", "steps[0]: 'with' is a required property"),
        ("              with:\n                  fetch-depth: 0\n", "steps[0].with: 'persist-credentials' is a required property"),
        ("              with:\n                  persist-credentials: true\n", "steps[0].with['persist-credentials']: False was expected"),
    ],
)
def test_bad_path_checkout_that_keeps_the_token_is_refused(tmp_path: Path, with_block: str, shown: str) -> None:
    steps = f"            - uses: {CHECKOUT}\n{with_block}"
    workflow = write(tmp_path, "ci.yml", f"{HEADER}jobs:\n    a:\n        runs-on: ubuntu-24.04\n        steps:\n{steps}")

    result = check(workflow)

    assert result.returncode == 1
    assert f"ci.yml::$.jobs.a.{shown}" in result.stdout


def test_bad_path_expression_inside_a_composite_action_script_is_refused(tmp_path: Path) -> None:
    action = write(
        tmp_path,
        "action.yml",
        "name: x\ndescription: x\nruns:\n    using: composite\n    steps:\n"
        "        - shell: bash\n          run: gh issue create --title '${{ inputs.title }}'\n",
    )

    result = check(action)

    assert result.returncode == 1
    assert "action.yml::$.runs.steps[0].run: \"gh issue create --title '${{ inputs.title }}'\" should not be valid" in result.stdout
