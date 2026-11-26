"""The port a local matcher plugs into (docs/research/M9-calibration.md §3, docs/research/M10-local-ai.md).

Only a proposal comes out of it: the proof decides as it does for the votes, and its gates do not soften. A local matcher runs on the
worker alone, in a sidecar with no network, never reaching a remote model (`worker/local_matcher.py`); Cloud Run keeps
`NullProposalMatcher`. What a matcher counts is for display only: it never reaches a gate.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Final, Protocol

from hcm_pipeline.calibrate.dense import FilmReader
from hcm_pipeline.geo import FloatArray, Grid
from hcm_pipeline.images import UInt8Array

NO_LOCAL_AI: Final = "no local AI in Google Cloud: the frame waits for the admin's points"


def _ignored() -> None:
    """A tick nobody listens to."""


def _unheard(_line: str) -> None:
    """A log nobody reads."""


@dataclass(frozen=True)
class ProposalRequest:
    """What a matcher may look at: the frame's preview and film, the Sentinel-2 window and OpenStreetMap's lines on its grid, the camera,
    where each orientation starts (film pixels to EPSG:3857 metres, best votes first, `starts_each` of them an orientation, one a scale)
    and how far around it the frame may lie."""

    preview: UInt8Array
    preview_factor: float
    reference: UInt8Array
    osm_lines: UInt8Array | None
    grid: Grid
    sensor: str
    starts: tuple[FloatArray, ...] = ()
    read: FilmReader | None = None
    limits: tuple[int, int, int] = (0, 0, 0)
    margin_m: float = 0.0
    tick: Callable[[], None] = _ignored
    say: Callable[[str], None] = _unheard
    starts_each: int = 1


@dataclass(frozen=True)
class Proposer:
    """Who proposed, on what: shown to the admin, read by no gate."""

    name: str
    device: str
    seconds: float
    support: int
    device_name: str | None = None
    fallback: str | None = None

    def as_record(self) -> dict[str, object]:
        """`calibration.proposer` (`calibrationSchema`)."""
        named = {"deviceName": self.device_name} if self.device_name else {}
        fell = {"fallback": self.fallback} if self.fallback else {}
        return {"name": self.name, "device": self.device, "seconds": self.seconds, "support": self.support, **named, **fell}


@dataclass(frozen=True)
class Proposal:
    """Where a matcher puts the frame: film pixels to EPSG:3857 metres, how many of its own tests support that, and who said so."""

    matrix: FloatArray
    support: int
    proposer: Proposer | None = field(default=None)


class ProposalMatcher(Protocol):
    name: str

    def propose(self, request: ProposalRequest) -> Sequence[Proposal]: ...


class NullProposalMatcher:
    """No local matcher (Cloud Run, every run without a worker): a frame the votes do not find waits for the admin's points."""

    name = "none"

    def propose(self, request: ProposalRequest) -> Sequence[Proposal]:
        request.say(NO_LOCAL_AI)
        return ()
