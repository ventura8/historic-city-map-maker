"""W5, household computers (docs/research/M7-local-worker.md, *Household computers*): what a worker says of its computer."""

import httpx
from hcm_pipeline.worker.household import Removal, host_on_hello, last_word, removable, share_of
from hcm_pipeline.worker.loop import Pass

from tests.unit.test_worker_loop import IDS, Runtime, Server, loop_with


class RemovalServer(Server):
    """The server of the loop's tests, whose first claim is answered with Remove this computer."""

    def _claim(self) -> httpx.Response:
        if self.claims and self.claims[0] == "remove":
            self.claims.pop(0)
            return httpx.Response(200, json={"result": {"job": None, "remove": {"docker": True, "keep": False}}})
        return super()._claim()


def test_happy_path_hello_names_the_computer_and_its_starter() -> None:
    """Scenarios: S-A143-HAPPY-LIST"""
    said = host_on_hello({"HCM_HOST_NAME": "nuc", "HCM_HOST_OS": "linux", "HCM_STARTER": "0123456789ab"})
    assert said == {"name": "nuc", "os": "linux", "starter": "0123456789ab"}


def test_bad_path_a_name_or_version_out_of_shape_is_left_out() -> None:
    assert host_on_hello({"HCM_HOST_NAME": "-bad name;", "HCM_HOST_OS": "beos", "HCM_STARTER": "2"}) == {}
    assert host_on_hello({}) == {}


def test_happy_path_the_share_is_read_from_the_governors_record() -> None:
    """Scenarios: S-A143-HAPPY-GOVERNOR"""
    machine = {
        "cpu": {"cores": 8},
        "memory": {"totalMb": 16000, "availableMb": 9000},
        "profile": {"chosen": "auto", "active": "quiet", "why": "user-active"},
        "budget": {"threads": 2, "memoryMb": 4096, "gpuFraction": 0.2},
    }
    assert share_of(machine) == {"profile": "quiet", "why": "user-active", "cores": 8, "threads": 2, "memoryMb": 4096}


def test_bad_path_no_record_or_a_partial_one_says_no_share() -> None:
    assert share_of(None) is None
    assert share_of({"cpu": "?", "memory": {"totalMb": 1000}, "profile": None}) is None
    whole = {"cpu": {"cores": 2}, "memory": {"totalMb": 1000}, "profile": {"active": "full", "why": "idle"}, "budget": {"threads": 1}}
    assert share_of(whole) == {"profile": "full", "why": "idle", "cores": 2, "threads": 1, "memoryMb": 1000}


def test_happy_path_the_removal_order_becomes_the_supervisors_exit_code() -> None:
    """Scenarios: S-A143-HAPPY-REMOVE"""
    assert Removal.of({"job": None}) is None
    assert Removal.of({"remove": {"docker": False, "keep": False}}) == Removal(docker=False, keep=False)
    assert int(Removal(docker=False, keep=False).exit_code) == 76
    assert Removal.of({"remove": {"docker": True, "keep": True}}) == Removal(docker=True, keep=True)
    assert int(Removal(docker=True, keep=False).exit_code) == 77
    assert int(Removal(docker=False, keep=True).exit_code) == 78
    assert int(Removal(docker=True, keep=True).exit_code) == 79


def test_bad_path_only_a_starter_that_cleans_up_is_removable_and_only_its_last_run_says_done() -> None:
    """Scenarios: S-A143-BAD-REMOVE-NO-STARTER"""
    assert (removable({"HCM_REMOVABLE": "1"}), removable({}), removable({"HCM_REMOVABLE": "yes"})) == (True, False, False)
    assert last_word({}) is None
    assert last_word({"HCM_REMOVAL": "maybe"}) is None
    assert last_word({"HCM_REMOVAL": "done"}) == {"step": "done"}
    assert last_word({"HCM_REMOVAL": "done", "HCM_REMOVAL_DOCKER_LEFT": "true"}) == {"step": "done", "dockerLeft": True}


def test_happy_path_a_claim_says_the_governors_share() -> None:
    """Scenarios: S-A143-HAPPY-GOVERNOR"""
    server = Server(None)
    loop, _state, _session = loop_with(server, Runtime())
    share = {"profile": "quiet", "why": "user-active", "cores": 8, "threads": 2, "memoryMb": 4096}
    loop.share = lambda: share

    assert loop.run_once() is Pass.IDLE
    assert server.calls[0][1]["share"] == share


def test_happy_path_remove_this_computer_is_accepted_and_ends_the_loop() -> None:
    """Scenarios: S-A143-HAPPY-REMOVE"""
    server = RemovalServer("remove", None)
    loop, _state, _session = loop_with(server, Runtime())
    loop.removable = True

    assert loop.run_once() is Pass.IDLE
    assert loop.stopping.is_set()
    assert loop.removal is not None
    assert int(loop.removal.exit_code) == 77
    assert server.calls[1] == ("worker-claim", {**IDS, "removal": {"step": "accepted"}})


def test_bad_path_a_worker_without_a_cleaning_starter_says_it_cannot() -> None:
    """Scenarios: S-A143-BAD-REMOVE-NO-STARTER"""
    server = RemovalServer("remove", None)
    loop, _state, _session = loop_with(server, Runtime())

    assert loop.run_once() is Pass.IDLE
    assert (loop.stopping.is_set(), loop.removal) == (False, None)
    assert server.calls[1] == ("worker-claim", {**IDS, "removal": {"step": "failed", "why": "no-starter"}})


def test_bad_path_the_removals_word_needs_a_session_and_a_server_that_takes_it() -> None:
    server = Server("apiError.worker.revoked")
    loop, _state, _session = loop_with(server, Runtime(), signed_in=False)
    assert loop.say_removal({"step": "done"}) is False
    assert server.calls == []

    signed, _state, _session = loop_with(server, Runtime())
    assert signed.say_removal({"step": "done"}) is False
    assert server.calls == [("worker-claim", {**IDS, "removal": {"step": "done"}})]


def test_happy_path_a_claim_without_a_share_says_none() -> None:
    server = Server(None)
    loop, _state, _session = loop_with(server, Runtime())

    assert loop.run_once() is Pass.IDLE
    assert "share" not in server.calls[0][1]
