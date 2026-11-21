"""What the worker says of its local AI (docs/research/M10-local-ai.md *What the admin sees*): `workerDocSchema.ai` for the panel, and
`/state`'s `ai` for the starter file, which polls `wanted`, `image` and `files`. Light on purpose: the page's state imports it."""

import errno
import platform
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

# The starter files' version of this release (scripts/site/src/admin/starter.ts: the SHA-256 of their content; a test holds it equal).
STARTER_VERSION: Final = "e0afe8c32568"
ENV_STARTER: Final = "HCM_STARTER"
# What the starter's last look for a newer one said (`WORKER_STARTER_UPDATES` of @hcm/shared).
ENV_STARTER_UPDATE: Final = "HCM_STARTER_UPDATE"
STARTER_WORD: Final = re.compile(r"[a-z0-9-]{1,40}")
# The machine Docker itself runs on, as the starter asks it: an amd64 image under Rosetta or QEMU reads x86_64 from inside.
ENV_DOCKER_ARCH: Final = "HCM_DOCKER_ARCH"
UNSUPPORTED_MACHINES: Final = frozenset({"aarch64", "arm64"})
# What the admin's panel says (`adminWorker.ai.why.*`).
WHY_OLD_STARTER: Final = "old-starter"
WHY_ARM64: Final = "arm64"
WHY_NO_ANSWER: Final = "no-answer"
WHY_DISK: Final = "disk"
FULL_DISK: Final = frozenset({errno.ENOSPC, errno.EDQUOT})


@dataclass(frozen=True)
class AiState:
    """What the panel shows of the AI (`workerDocSchema.ai`) and what `/state` tells the starter (`wanted`, `image`, `files`)."""

    state: str = "idle"
    device: str | None = None
    device_name: str | None = None
    why: str | None = None
    wanted: bool = False
    image: str | None = None
    files: bool = False

    def as_record(self) -> dict[str, object]:
        """The document's fields."""
        fields = {"device": self.device, "deviceName": self.device_name, "why": self.why}
        return {"state": self.state, **{key: value for key, value in fields.items() if value is not None}}

    def on_state(self) -> dict[str, object]:
        """`GET /state`'s `ai`: the same, and what the starter polls."""
        return {**self.as_record(), "wanted": self.wanted, "image": self.image, "files": self.files}


def initial_state(environment: Mapping[str, str], machine: str | None = None) -> AiState:
    """Before any frame: what this computer can never do says so at once, the rest comes when a frame needs it."""
    why = never_here(environment, machine or platform.machine())
    return AiState("unavailable", why=why) if why else AiState()


def never_here(environment: Mapping[str, str], machine: str) -> str | None:
    """Why this worker can never get its sidecar: an image the starter cannot serve, or a starter older than the AI."""
    if {machine.lower(), environment.get(ENV_DOCKER_ARCH, "").lower()} & UNSUPPORTED_MACHINES:
        return WHY_ARM64
    return None if environment.get(ENV_STARTER) == STARTER_VERSION else WHY_OLD_STARTER


def why_of_fault(error: BaseException) -> str:
    """What the panel says of a fault no port named: a full disk, in its words; else that the AI gave no answer (the log has it)."""
    return WHY_DISK if isinstance(error, OSError) and error.errno in FULL_DISK else WHY_NO_ANSWER


def _word(environment: Mapping[str, str], name: str) -> str | None:
    value = environment.get(name, "")
    return value if STARTER_WORD.fullmatch(value) else None


def starter_on_state(environment: Mapping[str, str]) -> dict[str, object]:
    """`GET /state`'s `starter`: the version of the starter that runs this worker (None: none, a worker started by a command), the
    version this release's starter has, and what the starter's last look for a newer one said (docs/research/M7-local-worker.md,
    *The starter updates itself*). The admin compares the version with its own release's."""
    return {
        "version": _word(environment, ENV_STARTER),
        "wanted": STARTER_VERSION,
        "update": _word(environment, ENV_STARTER_UPDATE),
    }


def starter_words(starter: Mapping[str, object]) -> str:
    """The log's line on the starter file (`starter_on_state`'s fields): current, out of date and why, or none."""
    version, update = starter.get("version"), starter.get("update") or "none"
    if version is None:
        return "starter file: none (this worker was started by a command)"
    if version == STARTER_VERSION:
        return f"starter file {version}: current (this release's)"
    return f"starter file {version}: OUT OF DATE, this release's is {STARTER_VERSION}; it updates itself (its last look said {update})"
