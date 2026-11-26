"""check_repo_policy.py: secret files, exact pins, pinned images and the banned account.

The banned account's name is assembled from two pieces, as in the gate, so this file does not
itself trip the check it tests.
"""

import runpy
import sys
from pathlib import Path

import check_repo_policy as policy
import pytest
from treeutil import git, init_repo, write

SCRIPT = Path(policy.__file__)
ACCOUNT = "fostul" + "bucuresti"
DIGEST = "@sha256:" + "a" * 64

CLEAN_PACKAGE = """{
    "name": "x",
    "dependencies": {"lit": "3.3.3", "@hcm/shared": "0.0.0"},
    "devDependencies": {"braces": "file:vendor/npm/braces", "vite": "8.3.4-beta.1"},
    "overrides": {"braces": "$braces", "gaxios@6.7.1": {"uuid": "11.1.1"}}
}"""
CLEAN_PYPROJECT = """[project]
dependencies = ["numpy==2.5.4", "httpx[http2] == 0.28.1 ; python_version >= '3.14'"]
[build-system]
requires = ["poetry-core==2.5.0"]
[tool.poetry.dependencies]
python = ">=3.14,<3.15"
[tool.poetry.group.dev.dependencies]
pytest = "9.1.1"
respx = { version = "0.23.1", optional = true }
"""
CLEAN_DOCKERFILE = f"""# syntax=docker/dockerfile:1.27.1{DIGEST}
FROM node:24-bookworm-slim{DIGEST} AS node
FROM --platform=linux/amd64 ghcr.io/osgeo/gdal:ubuntu-small-3.13.3{DIGEST} AS base
FROM base AS test
FROM scratch
COPY --from=node /usr/local/bin/node /node
"""


def clean_tree(root: Path) -> Path:
    write(root, "package.json", CLEAN_PACKAGE)
    write(root, "scripts/ci/requirements.txt", "# tools\n\nruff==0.17.0\ndefusedxml[extra]==0.7.1\n")
    write(root, "pipeline/pyproject.toml", CLEAN_PYPROJECT)
    write(root, "docker/Dockerfile.quality", CLEAN_DOCKERFILE)
    write(root, "compose.yaml", f"services:\n    db:\n        image: postgres:17{DIGEST}\n")
    write(root, ".env.example", "MAPBOX_TOKEN=")
    write(root, "AGENTS.md", f"Never use a {ACCOUNT} resource.")
    write(root, "docs/research/notes.json", f'{{"note": "the old site used {ACCOUNT} tiles"}}')
    write(root, ".coderabbit.yaml", f"reviews:\n    instructions: flag any {ACCOUNT} reference\n")
    (root / "photo.webp").write_bytes(b"RIFF\xff\xfe\x00WEBP")
    (root / "dangling.ts").symlink_to(root / "missing.ts")
    return root


def problems_of(root: Path) -> list[str]:
    return policy.check_tree(root)


def test_happy_path_clean_tree_passes(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    clean_tree(tmp_path)

    assert policy.main(["--root", str(tmp_path)]) == 0
    assert caplog.messages == ["[repo-policy] OK: no secret file, every dependency and image pinned exactly, no banned account"]


def test_bad_path_force_added_secret_file_is_reported_and_ignored_one_is_not(tmp_path: Path) -> None:
    root = init_repo(clean_tree(tmp_path / "repo"))
    write(root, ".gitignore", ".env*\n!.env.example\n")
    write(root, ".env.local", "MAPBOX_TOKEN=sk.fake")
    write(root, "functions/.env.demo-hcm", "X=1")
    write(root, "keys/deploy-service-account.json", "{}")
    git(root, "add", "--force", "functions/.env.demo-hcm")

    assert problems_of(root) == [
        "functions/.env.demo-hcm: holds secrets and is never committed (AGENTS.md -> Secrets): git rm --cached -- functions/.env.demo-hcm",
        "keys/deploy-service-account.json: holds secrets and is never committed (AGENTS.md -> Secrets): "
        "git rm --cached -- keys/deploy-service-account.json",
    ]


@pytest.mark.parametrize("name", [".sonar-token", "a/.secret.local", "b/ci.secret.local", "c/signing.p12", ".env"])
def test_bad_path_every_secret_file_name_is_reported(tmp_path: Path, name: str) -> None:
    write(tmp_path, name, "x")

    assert problems_of(tmp_path) == [f"{name}: holds secrets and is never committed (AGENTS.md -> Secrets): git rm --cached -- {name}"]


def test_bad_path_npm_ranges_are_reported(tmp_path: Path) -> None:
    write(
        tmp_path,
        "packages/ui/package.json",
        '{"dependencies": {"lit": "^3.3.3"}, "devDependencies": {"vite": "~8.3.4"}, "optionalDependencies": {"x": "latest"},'
        ' "overrides": {"gaxios@6.7.1": {"uuid": ">=11"}}}',
    )

    assert problems_of(tmp_path) == [
        "packages/ui/package.json: lit '^3.3.3' is not an exact version",
        "packages/ui/package.json: vite '~8.3.4' is not an exact version",
        "packages/ui/package.json: x 'latest' is not an exact version",
        "packages/ui/package.json: overrides '>=11' is not an exact version",
    ]


def test_happy_path_package_json_without_dependency_objects_passes(tmp_path: Path) -> None:
    write(tmp_path, "a/package.json", "[]")
    write(tmp_path, "b/package.json", '{"dependencies": "none"}')

    assert problems_of(tmp_path) == []


def test_bad_path_loose_requirements_are_reported(tmp_path: Path) -> None:
    write(tmp_path, "pipeline/requirements-poetry.txt", "poetry>=2.5\nbuild\n  # indented comment\n-r other.txt\n")

    assert problems_of(tmp_path) == [
        "pipeline/requirements-poetry.txt: 'poetry>=2.5' is not pinned with ==",
        "pipeline/requirements-poetry.txt: 'build' is not pinned with ==",
        "pipeline/requirements-poetry.txt: '-r other.txt' is not pinned with ==",
    ]


def test_bad_path_loose_pyproject_dependencies_are_reported(tmp_path: Path) -> None:
    write(
        tmp_path,
        "pipeline/pyproject.toml",
        '[project]\ndependencies = ["numpy>=2"]\n[build-system]\nrequires = ["poetry-core"]\n'
        '[tool.poetry.group.dev.dependencies]\npytest = "^9.1"\nrespx = { version = "~0.23" }\n'
        '[tool.poetry.group.broken]\ndependencies = "not a table"\n',
    )

    assert problems_of(tmp_path) == [
        "pipeline/pyproject.toml: 'numpy>=2' is not pinned with ==",
        "pipeline/pyproject.toml: 'poetry-core' is not pinned with ==",
        "pipeline/pyproject.toml: Poetry dependency pytest '^9.1' is not an exact version",
        "pipeline/pyproject.toml: Poetry dependency respx '~0.23' is not an exact version",
    ]


def test_happy_path_pyproject_without_dependencies_passes(tmp_path: Path) -> None:
    write(tmp_path, "pyproject.toml", '[project]\nname = "x"\ndependencies = "none"\n[tool]\npoetry = 1\n')

    assert problems_of(tmp_path) == []


def test_bad_path_unpinned_images_and_latest_tags_are_reported(tmp_path: Path) -> None:
    write(tmp_path, "pipeline/Dockerfile", "# syntax=docker/dockerfile:1\nFROM python:3.14-slim AS base\nFROM base\nFROM alpine:latest\n")
    write(tmp_path, ".github/workflows/ci.yml", "jobs:\n    a:\n        services:\n            db:\n                image: 'postgres:17'\n")
    write(tmp_path, "scripts/ci/scan.sh", "docker run sonarsource/sonar-scanner-cli:latest\n")
    write(tmp_path, "scripts/git-hooks/pre-push", "docker pull hcm/tool:latest\n")

    assert problems_of(tmp_path) == [
        ".github/workflows/ci.yml:5: image postgres:17 has no @sha256: digest",
        "pipeline/Dockerfile:1: # syntax=docker/dockerfile:1 has no @sha256: digest",
        "pipeline/Dockerfile:2: FROM python:3.14-slim has no @sha256: digest",
        "pipeline/Dockerfile:4: FROM alpine:latest has no @sha256: digest",
        "pipeline/Dockerfile:4: alpine:latest is a moving tag: pin a version and its digest",
        "scripts/ci/scan.sh:1: sonarsource/sonar-scanner-cli:latest is a moving tag: pin a version and its digest",
        "scripts/git-hooks/pre-push:1: hcm/tool:latest is a moving tag: pin a version and its digest",
    ]


def test_bad_path_a_stage_name_cannot_vouch_for_itself(tmp_path: Path) -> None:
    write(tmp_path, "Dockerfile", "FROM tools AS tools\n")

    assert problems_of(tmp_path) == ["Dockerfile:1: FROM tools has no @sha256: digest"]


@pytest.mark.parametrize(
    "relative",
    ["packages/engine/src/style.ts", "sites/bucharest/config.json", "firebase.json", ".github/workflows/deploy.yml"],
)
def test_bad_path_banned_account_outside_the_docs_is_reported(tmp_path: Path, relative: str) -> None:
    write(tmp_path, relative, f"const style = 'mapbox://styles/{ACCOUNT.capitalize()}/old';")

    assert problems_of(tmp_path) == [f"{relative}: references the {ACCOUNT} account, whose resources are never used (AGENTS.md)"]


def test_happy_path_excluded_trees_are_not_read(tmp_path: Path) -> None:
    write(tmp_path, "seed/bucharest/photos.legacy.geojson", f'{{"source": "{ACCOUNT}"}}')
    write(tmp_path, "vendor/npm/braces/package.json", '{"devDependencies": {"mocha": "^10.0.0"}}')
    write(tmp_path, "node_modules/x/Dockerfile", "FROM alpine:latest")

    assert problems_of(tmp_path) == []


def test_bad_path_unparsable_manifest_is_reported(tmp_path: Path) -> None:
    write(tmp_path, "package.json", '{"dependencies": ')
    write(tmp_path, "pyproject.toml", "[project\n")

    found = problems_of(tmp_path)

    assert [problem.split(" (")[0] for problem in found] == [
        "package.json: cannot be read as data",
        "pyproject.toml: cannot be read as data",
    ]
    assert all(problem.endswith("; the data-files gate shows the details") for problem in found)


def test_bad_path_main_lists_every_problem_and_exits_1(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    write(tmp_path, ".sonar-token", "x")
    write(tmp_path, "package.json", '{"devDependencies": {"vite": "^8"}}')

    assert policy.main(["--root", str(tmp_path)]) == 1
    assert caplog.messages == [
        "[repo-policy] FAILED:\n"
        "  - .sonar-token: holds secrets and is never committed (AGENTS.md -> Secrets): git rm --cached -- .sonar-token\n"
        "  - package.json: vite '^8' is not an exact version"
    ]


def test_happy_path_the_repository_follows_the_policy() -> None:
    assert problems_of(SCRIPT.resolve().parents[2]) == []


def test_happy_path_script_entry_point_exits_with_main_status(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    write(tmp_path, "Dockerfile", "FROM alpine:3.22")
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--root", str(tmp_path)])

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(SCRIPT), run_name="__main__")

    assert exit_info.value.code == 1
