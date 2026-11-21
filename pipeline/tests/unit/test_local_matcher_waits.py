"""How the wait for the sidecar ends when it does not answer (M10): each ends at the admin's points, or at the job's cancel."""

import json
from collections.abc import Callable
from pathlib import Path

import pytest
from hcm_pipeline.jobs import CancelledRunError
from hcm_pipeline.matcher.box import Answer, Found, write_answer, write_failure
from hcm_pipeline.worker.local_matcher import BEAT_LOST_S, CPU_TIMEOUT_S, GPU_TIMEOUT_S, Ports

from tests.unit.test_local_matcher import MOVE, STARTER, Sidecar, film_reader, request_of, rig


def test_bad_path_a_sidecar_that_beats_and_never_answers_times_out(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-NO-ANSWER"""
    made = rig(tmp_path, reply=lambda _sidecar, _id: None)

    assert made.matcher.propose(request_of(film_reader(), 1)) == ()

    assert made.reports[-1].why == "no-answer"
    assert GPU_TIMEOUT_S <= made.sidecar.now - 1000.0 < GPU_TIMEOUT_S + 30


def test_bad_path_a_processor_has_the_processors_time(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-NO-ANSWER"""
    made = rig(tmp_path, reply=lambda _sidecar, _id: None, device="cpu")

    assert made.matcher.propose(request_of(film_reader(), 1)) == ()

    assert made.sidecar.now - 1000.0 >= CPU_TIMEOUT_S


def test_bad_path_a_sidecar_that_stops_beating_is_given_up_within_two_minutes(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-NO-ANSWER"""

    def dies(sidecar: Sidecar, _id: str) -> None:
        sidecar.lives = False

    made = rig(tmp_path, reply=dies)

    assert made.matcher.propose(request_of(film_reader(), 1)) == ()

    assert made.reports[-1].why == "no-answer"
    assert made.sidecar.now - 1000.0 <= BEAT_LOST_S + 10


@pytest.mark.parametrize(
    "garbage",
    [
        lambda path: path.write_text("{", encoding="utf-8"),
        lambda path: path.write_text(json.dumps({"device": "gpu", "proposals": [{"matrix": [[9.0]]}], "seconds": 1}), encoding="utf-8"),
    ],
)
def test_bad_path_a_garbage_answer_stands_the_matcher_aside(tmp_path: Path, garbage: Callable[[Path], object]) -> None:
    """Scenarios: S-P07-BAD-NO-ANSWER"""
    made = rig(tmp_path, reply=lambda sidecar, request_id: garbage(sidecar.box / f"{request_id}.answer.json"))

    assert made.matcher.propose(request_of(film_reader(), 1)) == ()

    assert made.reports[-1].why == "garbage"
    assert not list(made.box.glob("*.request.npz"))


def test_bad_path_a_sidecars_failure_stands_the_matcher_aside(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-NO-ANSWER"""
    made = rig(tmp_path, reply=lambda sidecar, request_id: write_failure(sidecar.box, request_id, "exit 139"))

    assert made.matcher.propose(request_of(film_reader(), 1)) == ()

    assert made.reports[-1].why == "garbage"


def test_bad_path_out_of_memory_keeps_the_wait_open_and_the_answer_says_the_rerun(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-OUT-OF-MEMORY"""
    steps = {"left": GPU_TIMEOUT_S + 60}
    made = rig(tmp_path, reply=lambda sidecar, request_id: (sidecar.box / f"{request_id}.rerun").touch())
    original = made.sidecar.sleep

    def later(seconds: float) -> None:
        original(seconds)
        steps["left"] -= 1
        if steps["left"] <= 0 and made.sidecar.seen:
            answer = Answer((Found(MOVE, 2, 30),), "cpu", None, 700.0, "out-of-memory")
            write_answer(made.box, made.sidecar.seen[0], answer)

    made.matcher._ports = Ports(made.box, made.files, made.reports.append, STARTER, made.sidecar.clock, later, "x86_64")

    proposals = made.matcher.propose(request_of(film_reader(), 1))

    assert proposals[0].proposer is not None
    assert proposals[0].proposer.as_record()["fallback"] == "out-of-memory"
    assert proposals[0].proposer.device == "cpu"
    assert list(made.box.glob("*.rerun")) == []


def test_bad_path_a_cancelled_job_stops_the_wait_and_leaves_a_cancel_file(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-NO-ANSWER"""

    made = rig(tmp_path, reply=lambda _sidecar, _id: None)
    ticks = {"count": 0}

    def tick() -> None:
        ticks["count"] += 1
        if made.sidecar.seen:
            raise CancelledRunError

    with pytest.raises(CancelledRunError):
        made.matcher.propose(request_of(film_reader(), 1, None, tick))

    assert made.files.tick is tick
    assert (made.box / f"{made.sidecar.seen[0]}.cancel").exists()
    assert not (made.box / f"{made.sidecar.seen[0]}.request.npz").exists()
