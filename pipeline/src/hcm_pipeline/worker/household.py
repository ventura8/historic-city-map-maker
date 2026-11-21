"""W5, household computers (docs/research/M7-local-worker.md, *Household computers*): what a worker says of its computer so the admin
can list the city's computers and the server can send each job to a calm one, and Remove this computer.

`worker.hello` carries `host`: the computer's own name (`HCM_HOST_NAME`, which the starter sets from `hostname` or
`%COMPUTERNAME%`: a container's own host name is its id), its system (`HCM_HOST_OS`) and the starter's version
(`HCM_STARTER`), each only when it has its shape. `worker.claim` carries `share`: the governor's profile in force and
why, the cores, and the threads and memory it allows (M26), so a computer whose person is at it leaves the job to
another one that is free.
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

from hcm_pipeline.exit_codes import ExitCode

ENV_HOST_NAME: Final = "HCM_HOST_NAME"
# A starter that cleans the computer up when the worker ends with `ExitCode.REMOVE` (older ones would only start it again).
ENV_REMOVABLE: Final = "HCM_REMOVABLE"
# Set by that starter for the worker's last run, after the cleanup: say `done` with the kept session, then end.
ENV_REMOVAL: Final = "HCM_REMOVAL"
ENV_REMOVAL_DOCKER_LEFT: Final = "HCM_REMOVAL_DOCKER_LEFT"
ENV_STARTER: Final = "HCM_STARTER"
ENV_HOST_OS: Final = "HCM_HOST_OS"
HOST_OS: Final = re.compile(r"linux|mac|windows")
HOST_NAME: Final = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,62}")
STARTER: Final = re.compile(r"[0-9a-f]{12}")


def host_on_hello(environment: Mapping[str, str]) -> dict[str, str]:
    """`worker.hello`'s `host`: the computer's name and the starter's version, each left out unless it has its shape."""
    said = {
        "name": (environment.get(ENV_HOST_NAME, ""), HOST_NAME),
        "os": (environment.get(ENV_HOST_OS, ""), HOST_OS),
        "starter": (environment.get(ENV_STARTER, ""), STARTER),
    }
    return {key: value for key, (value, shape) in said.items() if shape.fullmatch(value)}


def _record(value: object) -> Mapping[str, object]:
    return value if isinstance(value, dict) else {}


def share_of(machine: Mapping[str, object] | None) -> dict[str, object] | None:
    """`worker.claim`'s `share` from the governor's `machine` record (`record.py`); None before its first tick, or when a field is
    missing (the server would refuse a partial share, and the claim with it)."""
    if machine is None:
        return None
    profile, budget = _record(machine.get("profile")), _record(machine.get("budget"))
    memory = _record(machine.get("memory"))
    share = {
        "profile": profile.get("active"),
        "why": profile.get("why"),
        "cores": _record(machine.get("cpu")).get("cores"),
        "threads": budget.get("threads"),
        "memoryMb": budget.get("memoryMb", memory.get("totalMb")),
    }
    return None if None in share.values() else share


@dataclass(frozen=True)
class Removal:
    """Remove this computer as a claim gave it: Docker too (where the helper installed it), the scanned maps kept."""

    docker: bool
    keep: bool

    @classmethod
    def of(cls, answer: Mapping[str, object]) -> Removal | None:
        order = answer.get("remove")
        if not isinstance(order, dict):
            return None
        return cls(order.get("docker") is True, order.get("keep") is True)

    @property
    def exit_code(self) -> ExitCode:
        """What the supervisor reads: 76, plus 1 with Docker, plus 2 keeping the scanned maps."""
        return ExitCode(ExitCode.REMOVE + int(self.docker) + 2 * int(self.keep))


def removable(environment: Mapping[str, str]) -> bool:
    """True when the starter that runs this worker cleans the computer up."""
    return environment.get(ENV_REMOVABLE) == "1"


def last_word(environment: Mapping[str, str]) -> dict[str, object] | None:
    """The removal's `done` for the worker's last run, after the starter's cleanup; None on any other run."""
    if environment.get(ENV_REMOVAL) != "done":
        return None
    left = environment.get(ENV_REMOVAL_DOCKER_LEFT) == "true"
    return {"step": "done", **({"dockerLeft": True} if left else {})}
