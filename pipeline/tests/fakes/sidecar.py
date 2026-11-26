"""The sidecar with no PyTorch (M10): the real search over a fake network of real keypoints, and a matcher that knows the answer."""

from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

import cv2
import numpy
from hcm_pipeline.calibrate.ports import Proposal, ProposalRequest, Proposer
from hcm_pipeline.geo import FloatArray
from hcm_pipeline.images import UInt8Array
from hcm_pipeline.matcher.box import Answer, SidecarStatus, read_request, request_id_of, write_answer, write_status
from hcm_pipeline.matcher.search import search

from tests.synthetic.scenes import Truth, true_mercator

ON_GPU = Proposer("aliked-lightglue", "gpu", 31.0, 46, "NVIDIA RTX 3080")


class OrbBackend:
    """Features of the tile's own pixels, matched both ways: real keypoints with no network."""

    def __init__(self) -> None:
        self.detector = cv2.ORB.create(1500)
        self.matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)

    def extract(self, tile: UInt8Array) -> object:
        return self.detector.detectAndCompute(tile, None)

    def match(self, features: tuple[object, object], sizes: tuple[tuple[int, int], tuple[int, int]]) -> tuple[numpy.ndarray, numpy.ndarray]:
        del sizes
        (points0, descriptors0), (points1, descriptors1) = cast(tuple[tuple[Any, Any], tuple[Any, Any]], features)
        if descriptors0 is None or descriptors1 is None:
            return numpy.zeros((0, 2)), numpy.zeros((0, 2))
        pairs = self.matcher.match(descriptors0, descriptors1)
        first = numpy.array([points0[each.queryIdx].pt for each in pairs], numpy.float64).reshape(-1, 2)
        second = numpy.array([points1[each.trainIdx].pt for each in pairs], numpy.float64).reshape(-1, 2)
        return first, second


def _no_tick() -> None:
    """The fake answers at once."""


@dataclass
class BoxSidecar:
    """Called where the worker sleeps: each pass it beats and answers what waits in the box with the real search."""

    box: Path
    backend: OrbBackend = field(default_factory=OrbBackend)
    answered: list[str] = field(default_factory=list)
    beat: int = 0

    def __call__(self, _seconds: float) -> None:
        self.beat += 1
        write_status(self.box, SidecarStatus("gpu", "NVIDIA RTX 3080", None, self.beat))
        for path in sorted(self.box.glob("*.request.npz")):
            request_id = request_id_of(path)
            if request_id not in self.answered:
                self.answered.append(request_id)
                found = search(read_request(path), self.backend, _no_tick)
                write_answer(self.box, request_id, Answer(found, "gpu", "NVIDIA RTX 3080", 1.5))


def truth_matrix(truth: Truth) -> FloatArray:
    """The frame's true map as one homography (film pixels to EPSG:3857 metres), the panoramic term averaged in."""
    u, v = numpy.meshgrid(numpy.linspace(0, truth.width, 15), numpy.linspace(0, truth.height, 11))
    film = numpy.column_stack((u.ravel(), v.ravel()))
    x, y = true_mercator(truth, film[:, 0], film[:, 1])
    matrix, _ = cv2.findHomography(film, numpy.column_stack((x, y)))
    return numpy.asarray(matrix, numpy.float64)


class TrueProposer:
    """A matcher that knows the answer."""

    name = "aliked-lightglue"

    def __init__(self, matrix: FloatArray, proposer: Proposer = ON_GPU) -> None:
        self.matrix = matrix
        self.proposer = proposer
        self.calls = 0

    def propose(self, request: ProposalRequest) -> Sequence[Proposal]:
        self.calls += 1
        request.say("local AI (aliked-lightglue, gpu, NVIDIA RTX 3080): 1 proposals in 31 s")
        return [Proposal(self.matrix, 46, self.proposer)]
