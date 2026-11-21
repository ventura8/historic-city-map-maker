"""The box between the worker and the sidecar (M10): what is valid in an answer, and that nothing in a file can run."""

import ast
import builtins
import json
from pathlib import Path
from typing import Final

import numpy
import pytest
from hcm_pipeline.matcher import box as box_module
from hcm_pipeline.matcher.box import (
    Answer,
    BadAnswerError,
    Found,
    Request,
    SidecarStatus,
    clear_request,
    parse_answer,
    pending,
    read_answer,
    read_request,
    read_status,
    request_id_of,
    starter_word,
    write_answer,
    write_failure,
    write_request,
    write_status,
)

MATCHER: Final = Path(box_module.__file__).parent
SIMILAR: Final = [[1.0, 0.0, 10.0], [0.0, 1.0, -20.0], [0.0, 0.0, 1.0]]
PROPOSAL: Final = {"matrix": SIMILAR, "pairs": 3, "points": 46}
GOOD: Final = {
    "proposals": [{"matrix": SIMILAR, "pairs": 3, "points": 46}],
    "device": "gpu",
    "deviceName": "RTX",
    "seconds": 2.5,
    "fallback": None,
}


def request() -> Request:
    grid = numpy.eye(3)
    return Request(numpy.ones((4, 5), numpy.uint8), numpy.ones((2, 3), numpy.uint8), grid, grid, 0.71)


def test_happy_path_an_answer_round_trips_through_the_box(tmp_path: Path) -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    answer = Answer((Found(numpy.array(SIMILAR), 3, 46),), "gpu", "RTX", 2.5)
    write_answer(tmp_path, "r001", answer)

    found = read_answer(tmp_path / "r001.answer.json")

    assert (found.device, found.device_name, found.seconds, found.fallback) == ("gpu", "RTX", 2.5, None)
    assert found.found[0].matrix.tolist() == SIMILAR
    assert (found.found[0].pairs, found.found[0].points) == (3, 46)


def test_happy_path_a_request_round_trips_and_its_files_go_with_it(tmp_path: Path) -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    path = write_request(tmp_path, "r001", request())

    assert request_id_of(path) == "r001"
    assert pending(tmp_path) == [path]
    read = read_request(path)
    assert read.film.shape == (4, 5)
    assert read.ground == pytest.approx(0.71)

    write_failure(tmp_path, "r001", "tampered")
    assert pending(tmp_path) == []
    with pytest.raises(BadAnswerError, match="tampered"):
        read_answer(tmp_path / "r001.answer.json")

    clear_request(tmp_path, "r001")
    assert list(tmp_path.iterdir()) == []


def test_bad_path_a_request_id_that_could_leave_the_box_is_refused(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-NO-ANSWER"""
    with pytest.raises(ValueError, match="not a request id"):
        write_request(tmp_path, "../r", request())


def test_bad_path_a_request_holding_a_pickle_does_not_run(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-NO-ANSWER"""
    numpy.savez(tmp_path / "x.request.npz", film=numpy.array([{"a": 1}], dtype=object))

    with pytest.raises(ValueError, match="pickle"):
        read_request(tmp_path / "x.request.npz")


@pytest.mark.parametrize(
    "changes",
    [
        {"device": "tpu"},
        {"device": []},
        {"device": {}},
        {"device": None},
        {"fallback": "because"},
        {"fallback": {}},
        {"fallback": []},
        {"seconds": 10**400},
        {"seconds": float("nan")},
        {"seconds": True},
        {"proposals": "three"},
        {"proposals": [PROPOSAL] * 4},
        {"proposals": ["no object"]},
        {"proposals": [{"matrix": "abc", "pairs": 3, "points": 4}]},
        {"proposals": [{"matrix": [[1.0, 0.0], [0.0, 1.0]], "pairs": 3, "points": 4}]},
        {"proposals": [{"matrix": [[float("inf"), 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]], "pairs": 3, "points": 4}]},
        {"proposals": [{"matrix": [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.1, 0.0, 1.0]], "pairs": 3, "points": 4}]},
        {"proposals": [{"matrix": [[2.0, 0.0, 0.0], [0.0, 2.0, 0.0], [0.0, 0.0, 1.0]], "pairs": 3, "points": 4}]},
        {"proposals": [{"matrix": [[10**400, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]], "pairs": 3, "points": 4}]},
        {"proposals": [{"matrix": SIMILAR, "pairs": -1, "points": 4}]},
        {"proposals": [{"matrix": SIMILAR, "pairs": 1.5, "points": 4}]},
    ],
)
def test_bad_path_a_garbage_answer_is_refused(changes: dict[str, object]) -> None:
    """Scenarios: S-P07-BAD-NO-ANSWER"""
    with pytest.raises(BadAnswerError):
        parse_answer({**GOOD, **changes})


def test_bad_path_an_unreadable_answer_is_refused(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-NO-ANSWER"""
    (tmp_path / "broken.json").write_text("[1, 2", encoding="utf-8")
    (tmp_path / "list.json").write_text("[1, 2]", encoding="utf-8")

    for name in ("broken.json", "list.json", "absent.json"):
        with pytest.raises(BadAnswerError):
            read_answer(tmp_path / name)


def test_happy_path_the_sidecars_status_and_the_starters_word_are_read(tmp_path: Path) -> None:
    """Scenarios: S-P07-HAPPY-CPU-FALLBACK"""
    assert read_status(tmp_path) is None
    assert starter_word(tmp_path) is None

    write_status(tmp_path, SidecarStatus("cpu", None, "no-gpu", 3))
    (tmp_path / "starter.json").write_text(json.dumps({"why": "disk"}), encoding="utf-8")

    assert read_status(tmp_path) == SidecarStatus("cpu", None, "no-gpu", 3)
    assert starter_word(tmp_path) == "disk"


@pytest.mark.parametrize(
    "value",
    [{"device": "tpu", "beat": 1}, {"device": "gpu", "beat": "x"}, {"device": "gpu"}, {"device": [], "beat": 1}, {"device": {}, "beat": 1}],
)
def test_bad_path_a_status_of_no_known_device_says_nothing(tmp_path: Path, value: dict[str, object]) -> None:
    """Scenarios: S-P07-BAD-NO-ANSWER"""
    (tmp_path / "sidecar.json").write_text(json.dumps(value), encoding="utf-8")

    assert read_status(tmp_path) is None


def _function_annotations(node: ast.FunctionDef) -> list[ast.expr]:
    found = [each.annotation for each in ast.walk(node.args) if isinstance(each, ast.arg) and each.annotation is not None]
    return [*found, node.returns] if node.returns is not None else found


def _annotations(node: ast.AST) -> list[ast.expr]:
    if isinstance(node, ast.FunctionDef):
        return _function_annotations(node)
    return [node.annotation] if isinstance(node, ast.AnnAssign) else []


def _annotation_names(node: ast.AST) -> set[str]:
    """Names an annotation evaluates when its definition runs, as Python 3.12 does."""
    return {each.id for annotation in _annotations(node) for each in ast.walk(annotation) if isinstance(each, ast.Name)}


def _names_stored(node: ast.stmt) -> set[str]:
    return {each.id for each in ast.walk(node) if isinstance(each, ast.Name) and isinstance(each.ctx, ast.Store)}


def _names_bound_by(node: ast.stmt) -> set[str]:
    if isinstance(node, ast.Import | ast.ImportFrom):
        return {(alias.asname or alias.name).split(".")[0] for alias in node.names}
    return {node.name} if isinstance(node, ast.FunctionDef | ast.ClassDef) else _names_stored(node)


def _modules_from(source: ast.Module) -> set[str]:
    return {node.module or "" for node in ast.walk(source) if isinstance(node, ast.ImportFrom) and node.level == 0}


def _modules_imported(source: ast.Module) -> set[str]:
    """What the file imports by an absolute name; its docstring may say what it does not import."""
    return {alias.name for node in ast.walk(source) if isinstance(node, ast.Import) for alias in node.names} | _modules_from(source)


def _undefined_when_defined(source: ast.Module) -> set[str]:
    """Names an annotation uses before the module has bound them: fine for ruff's Python 3.14, a NameError under the sidecar's 3.12."""
    known = set(dir(builtins))
    missing: set[str] = set()
    for statement in source.body:
        inner = statement.body if isinstance(statement, ast.ClassDef) else [statement]
        for node in inner:
            missing |= _annotation_names(node) - known
        known |= _names_bound_by(statement)
    return missing


@pytest.mark.parametrize("path", sorted(MATCHER.glob("*.py")), ids=lambda path: path.name)
def test_happy_path_the_sidecars_code_runs_under_its_python_3_12_with_no_project_module(path: Path) -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    text = path.read_text(encoding="utf-8")

    # A grammar ruff's 3.14 target may write (`except A, B:`) is a SyntaxError there: the rehearsal on the real image found it.
    source = ast.parse(text, feature_version=(3, 12))

    assert _undefined_when_defined(source) == set()
    assert not any(name.startswith("hcm_pipeline") for name in _modules_imported(source))


def test_bad_path_an_answer_nested_past_the_parsers_limit_is_unreadable_not_a_crash(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-NO-ANSWER"""
    path = tmp_path / "r001.answer.json"
    path.write_text("[" * 200_000, encoding="utf-8")

    with pytest.raises(BadAnswerError):
        read_answer(path)


def test_bad_path_a_failed_answer_says_tampered_only_of_altered_weights(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-TAMPERED-FILE"""
    path = tmp_path / "r001.answer.json"
    for said, word in (("tampered", "tampered"), ("exit 139", "garbage"), (["tampered"], "garbage")):
        path.write_text(json.dumps({"failed": said}), encoding="utf-8")
        with pytest.raises(BadAnswerError) as raised:
            read_answer(path)
        assert raised.value.word == word
