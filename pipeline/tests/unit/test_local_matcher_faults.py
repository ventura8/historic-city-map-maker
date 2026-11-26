"""What a fault no port named does to the local matcher (M10): the frame goes to the admin's points, never a failed job; a request lost
costs that request, not the proposals already in hand; and the sidecar is not asked for by a run that has stopped."""

import errno
from pathlib import Path
from typing import Final

import cv2
import pytest
from hcm_pipeline.jobs import CancelledRunError, LeaseLostError
from hcm_pipeline.matcher import box as box_module
from hcm_pipeline.matcher.box import Answer, Found, Request, write_answer, write_failure, write_request
from hcm_pipeline.worker import local_matcher
from hcm_pipeline.worker.ai_files import AiFilesError
from hcm_pipeline.worker.ai_state import AiState, initial_state, never_here, why_of_fault
from hcm_pipeline.worker.local_matcher import FIRST_USE_WAIT_S, RETRY_WAIT_S, LocalMatcher, Patience, Ports

from tests.unit.test_local_matcher import MOVE, STARTER, Files, Rig, Sidecar, film_reader, request_of, rig, right

ENOSPC: Final = OSError(errno.ENOSPC, "No space left on device")
EACCES: Final = PermissionError(errno.EACCES, "Permission denied")


def said_lines() -> list[str]:
    return []


class FailingFiles(Files):
    """`ensure` raising what a real disk raises, not `AiFilesError`."""

    error: Exception = ENOSPC

    def ensure(self) -> None:
        raise self.error


@pytest.mark.parametrize(("error", "why"), [(ENOSPC, "disk"), (EACCES, "no-answer"), (OSError(errno.EIO, "I/O"), "no-answer")])
def test_bad_path_a_files_volume_that_fails_goes_to_the_points_and_the_panel_says_why(tmp_path: Path, error: Exception, why: str) -> None:
    """Scenarios: S-P07-BAD-LOCAL-FAULT"""
    made = rig(tmp_path)
    files = FailingFiles()
    files.error = error
    reports: list[AiState] = []
    matcher = LocalMatcher(Ports(made.box, files, reports.append, STARTER, made.sidecar.clock, made.sidecar.sleep, "x86_64"))
    said = said_lines()

    assert matcher.propose(request_of(film_reader(), 1, said)) == ()

    assert reports[-1].as_record() == {"state": "unavailable", "why": why}
    assert reports[-1].wanted is False
    assert any(f"local AI unavailable ({why})" in line for line in said)


def test_bad_path_a_request_that_does_not_fit_in_the_box_goes_to_the_points(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P07-BAD-LOCAL-FAULT"""
    made = rig(tmp_path)

    def full(*_arguments: object) -> None:
        raise ENOSPC

    monkeypatch.setattr(local_matcher, "write_request", full)

    assert made.matcher.propose(request_of(film_reader(), 2)) == ()

    assert made.reports[-1].why == "disk"
    assert made.sidecar.seen == []


def test_bad_path_a_warp_that_fails_goes_to_the_points(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P07-BAD-LOCAL-FAULT"""
    made = rig(tmp_path)

    def bad_warp(*_arguments: object) -> None:
        raise cv2.error("warpPerspective: too large")

    monkeypatch.setattr(local_matcher, "warp_start", bad_warp)

    assert made.matcher.propose(request_of(film_reader(), 1)) == ()

    assert made.reports[-1].why == "no-answer"


def test_bad_path_a_box_that_cannot_be_cleared_goes_to_the_points(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P07-BAD-LOCAL-FAULT"""
    made = rig(tmp_path)

    def refused(_self: LocalMatcher) -> None:
        raise EACCES

    monkeypatch.setattr(LocalMatcher, "_clean", refused)

    assert made.matcher.propose(request_of(film_reader(), 1)) == ()

    assert made.reports[-1].why == "no-answer"


def test_bad_path_a_disk_too_full_for_the_cancel_still_stops_the_job(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P07-BAD-LOCAL-FAULT"""
    made = rig(tmp_path, reply=lambda _sidecar, _id: None)

    def tick() -> None:
        if made.sidecar.seen:
            raise CancelledRunError

    def no_room(_self: Path, *_arguments: object, **_named: object) -> None:
        raise ENOSPC

    monkeypatch.setattr(Path, "touch", no_room)

    with pytest.raises(CancelledRunError):
        made.matcher.propose(request_of(film_reader(), 1, None, tick))


def test_bad_path_files_that_cannot_be_cleared_after_an_answer_cost_nothing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P07-BAD-LOCAL-FAULT"""
    made = rig(tmp_path)
    real = Path.unlink

    def refuses_the_answer(path: Path, missing_ok: bool = False) -> None:
        if path.name.endswith(".answer.json"):
            raise EACCES
        real(path, missing_ok=missing_ok)

    monkeypatch.setattr(Path, "unlink", refuses_the_answer)

    assert len(made.matcher.propose(request_of(film_reader(), 1))) == 2


def answer_then(sidecar: Sidecar, request_id: str, failure: str | None) -> None:
    """The first request proposes; each later one fails with `failure`, or never answers."""
    if len(sidecar.seen) == 1:
        right(sidecar, request_id)
    elif failure is not None:
        write_failure(sidecar.box, request_id, failure)


def test_bad_path_a_request_that_fails_after_a_proposal_keeps_the_proposal_and_asks_the_rest(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-LOST-REQUEST"""
    made = rig(tmp_path, reply=lambda sidecar, request_id: answer_then(sidecar, request_id, "exit 137"))
    said = said_lines()

    proposals = made.matcher.propose(request_of(film_reader(), 4, said))

    assert len(proposals) == 2
    assert len(made.sidecar.seen) == 4
    assert sum("a request was lost (garbage)" in line for line in said) == 3
    assert made.reports[-1].state == "ready"
    assert made.reports[-1].wanted is False


def test_bad_path_a_sidecar_gone_after_a_proposal_keeps_the_proposal_and_stops_asking(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-LOST-REQUEST"""
    made = rig(tmp_path, reply=lambda sidecar, request_id: answer_then(sidecar, request_id, None))
    said = said_lines()

    proposals = made.matcher.propose(request_of(film_reader(), 4, said))

    assert len(proposals) == 2
    assert len(made.sidecar.seen) == 2
    assert any("a request was lost (no-answer)" in line for line in said)


def test_bad_path_a_fault_of_the_box_after_a_proposal_keeps_the_proposal(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P07-BAD-LOST-REQUEST"""
    made = rig(tmp_path)
    wrote: list[str] = []

    def full_on_the_second(box: Path, request_id: str, request: Request) -> Path:
        wrote.append(request_id)
        if len(wrote) > 1:
            raise ENOSPC
        return write_request(box, request_id, request)

    monkeypatch.setattr(local_matcher, "write_request", full_on_the_second)

    assert len(made.matcher.propose(request_of(film_reader(), 3))) == 2
    assert len(wrote) == 2


def test_bad_path_every_request_failing_stands_aside_with_the_reason(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-LOST-REQUEST"""
    made = rig(tmp_path, reply=lambda sidecar, request_id: write_failure(sidecar.box, request_id, "exit 139"))

    assert made.matcher.propose(request_of(film_reader(), 3)) == ()

    assert len(made.sidecar.seen) == 3
    assert made.reports[-1].why == "garbage"


def test_bad_path_a_lost_request_with_only_empty_answers_stands_aside(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-LOST-REQUEST"""

    def nothing_then_failure(sidecar: Sidecar, request_id: str) -> None:
        if len(sidecar.seen) == 1:
            write_answer(sidecar.box, request_id, Answer((), "gpu", "NVIDIA RTX 3080", 1.0))
        else:
            write_failure(sidecar.box, request_id, "exit 139")

    made = rig(tmp_path, reply=nothing_then_failure)

    assert made.matcher.propose(request_of(film_reader(), 2)) == ()

    assert made.reports[-1].why == "garbage"


def test_bad_path_weights_refused_at_load_say_so_and_stop_asking(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-TAMPERED-FILE"""
    made = rig(tmp_path, reply=lambda sidecar, request_id: write_failure(sidecar.box, request_id, "tampered"))

    assert made.matcher.propose(request_of(film_reader(), 4)) == ()

    assert made.reports[-1].why == "tampered"
    assert len(made.sidecar.seen) == 1


def test_happy_path_a_finished_run_stops_wanting_the_sidecar_and_keeps_saying_its_device(tmp_path: Path) -> None:
    """Scenarios: S-P07-HAPPY-SIDECAR-WHILE-WANTED"""
    made = rig(tmp_path)

    made.matcher.propose(request_of(film_reader(), 1))

    assert [each.wanted for each in made.reports] == [True, True, True, False]
    assert made.reports[-1].as_record() == {"state": "ready", "device": "gpu", "deviceName": "NVIDIA RTX 3080"}
    assert made.reports[-1].on_state()["wanted"] is False


@pytest.mark.parametrize("stop", [CancelledRunError, LeaseLostError])
def test_bad_path_a_stopped_run_leaves_no_ai_wanted(tmp_path: Path, stop: type[Exception]) -> None:
    """Scenarios: S-P07-BAD-SIDECAR-HUNG"""
    made = rig(tmp_path)
    made.sidecar.lives = False

    def tick() -> None:
        raise stop

    with pytest.raises(stop):
        made.matcher.propose(request_of(film_reader(), 1, None, tick))

    assert made.reports[0].wanted
    assert made.reports[-1] == AiState()


def waits_for(made: Rig, patience: Patience) -> float:
    """How long one run waits for a dead sidecar (each run has its own `LocalMatcher`, as `runtime.services` builds it)."""
    started = made.sidecar.now
    ports = Ports(made.box, made.files, made.reports.append, STARTER, made.sidecar.clock, made.sidecar.sleep, "x86_64", patience)
    assert LocalMatcher(ports).propose(request_of(film_reader(), 1)) == ()
    return made.sidecar.now - started


def test_bad_path_a_sidecar_that_never_came_costs_later_frames_minutes_not_half_an_hour_each(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-SIDECAR-HUNG"""
    made = rig(tmp_path)
    made.sidecar.lives = False
    patience = Patience()

    first = [waits_for(made, patience) for _ in range(3)]

    assert first[0] >= FIRST_USE_WAIT_S
    assert all(RETRY_WAIT_S <= each < RETRY_WAIT_S + 5 for each in first[1:])
    assert made.reports[-1].why == "no-answer"
    assert made.reports[-1].wanted is False


def test_happy_path_a_sidecar_back_again_ends_the_shorter_wait(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-SIDECAR-HUNG"""
    made = rig(tmp_path)
    made.sidecar.lives = False
    patience = Patience()
    waits_for(made, patience)
    assert patience.wait_s() == RETRY_WAIT_S

    made.sidecar.lives = True
    ports = Ports(made.box, made.files, made.reports.append, STARTER, made.sidecar.clock, made.sidecar.sleep, "x86_64", patience)

    assert len(LocalMatcher(ports).propose(request_of(film_reader(), 1))) == 2
    assert patience.wait_s() == FIRST_USE_WAIT_S


def test_bad_path_a_sidecar_lost_midway_also_shortens_the_next_wait(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-SIDECAR-HUNG"""

    def dies(sidecar: Sidecar, _id: str) -> None:
        sidecar.lives = False

    made = rig(tmp_path, reply=dies)
    patience = Patience()
    ports = Ports(made.box, made.files, made.reports.append, STARTER, made.sidecar.clock, made.sidecar.sleep, "x86_64", patience)

    assert LocalMatcher(ports).propose(request_of(film_reader(), 1)) == ()

    assert patience.wait_s() == RETRY_WAIT_S


def test_bad_path_a_new_run_never_reads_an_earlier_runs_answer(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-STALE-ANSWER"""
    first = rig(tmp_path)
    first.matcher.propose(request_of(film_reader(), 1))
    second = rig(tmp_path)
    second.matcher.propose(request_of(film_reader(), 1))

    assert first.sidecar.seen != second.sidecar.seen
    # What an old child would still write under its own id is nobody's answer.
    old = first.sidecar.seen[0]
    assert old not in second.sidecar.seen
    assert box_module.REQUEST_ID.fullmatch(second.sidecar.seen[0])


def test_bad_path_an_old_childs_late_answer_is_not_taken_for_the_new_request(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-STALE-ANSWER"""
    box = tmp_path / "box"
    box.mkdir()
    stale = Found(MOVE, 9, 999)
    old_run = "rdead0000-001"
    write_answer(box, old_run, Answer((stale,), "gpu", "old", 1.0))

    def answers_late(sidecar: Sidecar, request_id: str) -> None:
        write_answer(sidecar.box, old_run, Answer((stale,), "gpu", "old", 1.0))
        right(sidecar, request_id)

    sidecar = Sidecar(box, reply=answers_late)
    reports: list[AiState] = []
    matcher = LocalMatcher(Ports(box, Files(), reports.append, STARTER, sidecar.clock, sidecar.sleep, "x86_64"))

    proposals = matcher.propose(request_of(film_reader(), 1))

    assert [each.support for each in proposals] == [46, 20]


@pytest.mark.parametrize("arch", ["arm64", "aarch64", "ARM64"])
def test_bad_path_an_emulated_image_on_an_arm_computer_says_arm64_though_it_reads_x86_64(tmp_path: Path, arch: str) -> None:
    """Scenarios: S-P07-BAD-ARM-HOST"""
    environment = {**STARTER, "HCM_DOCKER_ARCH": arch}
    box = tmp_path / "box"
    box.mkdir()
    sidecar = Sidecar(box)
    files = Files()
    reports: list[AiState] = []
    matcher = LocalMatcher(Ports(box, files, reports.append, environment, sidecar.clock, sidecar.sleep, "x86_64"))

    assert never_here(environment, "x86_64") == "arm64"
    assert initial_state(environment, "x86_64").as_record() == {"state": "unavailable", "why": "arm64"}
    assert matcher.propose(request_of(film_reader(), 1)) == ()
    assert files.ensured == 0
    assert all(not each.wanted for each in reports)
    assert sidecar.now == 1000.0


@pytest.mark.parametrize("arch", ["amd64", "", "x86_64"])
def test_happy_path_an_amd64_docker_is_served(arch: str) -> None:
    """Scenarios: S-P07-HAPPY-GPU"""
    assert never_here({**STARTER, "HCM_DOCKER_ARCH": arch}, "x86_64") is None


def test_happy_path_a_fault_reads_as_the_disk_only_when_it_is_the_disk() -> None:
    """Scenarios: S-P07-BAD-LOCAL-FAULT"""
    assert why_of_fault(ENOSPC) == "disk"
    assert why_of_fault(OSError(errno.EDQUOT, "quota")) == "disk"
    assert why_of_fault(EACCES) == "no-answer"
    assert why_of_fault(ValueError("x")) == "no-answer"


def test_happy_path_a_named_failure_of_the_files_keeps_its_word(tmp_path: Path) -> None:
    """Scenarios: S-P07-BAD-TAMPERED-FILE"""
    made = rig(tmp_path, fails=AiFilesError("unreachable", "w.pth could not be fetched"))

    assert made.matcher.propose(request_of(film_reader(), 1)) == ()

    assert made.reports[-1].why == "unreachable"
