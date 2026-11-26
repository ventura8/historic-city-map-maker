"""A frame joined to the city's other frames, which stay where they are (docs/research/M15-calibration-accuracy.md, *Joint solve*).

Two frames that overlap show the same streets: a film tie is a feature of this frame's film and the place a frame already published
shows it at. With that frame held still, a tie is a row like a Sentinel-2 tile, only less noisy (2.4 to 3.7 m a tile against 8.1 m),
so the frame's own model is fitted on its Sentinel-2 tiles and its ties together, a tie counting `TIE_WEIGHT` times. Nothing else moves:
a published layer is never rendered again by this. Every frame keeps its own Sentinel-2 tiles, so a tie never carries a frame's place
from another frame that had none (a chain of frames drifts: 12 m RMS after one hop, 93 m after ten, in the evidence).

A partner counts when its ties are many (`MIN_TIES`) and most of the tiles tried hold (`MIN_SHARE`): a wrong frame holds 1.3 % of them,
a real pair 51 % or more. A partner whose ties sit further than `DISAGREE_M` from the map the frame's own tiles and its other partners
give is left out and named: a frame published wrong must not pull the next one with it.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Final

import numpy

from hcm_pipeline.calibrate.poly import Mask, ground_scale_of
from hcm_pipeline.contract import ALIGNMENT_STATUSES
from hcm_pipeline.geo import FloatArray, to_lnglat_arrays

# Sentinel-2 tiles against film read 8.1 m of noise an axis, film ties 2.4 to 3.7 m: about nine times the weight (M15 step 4).
TIE_WEIGHT: Final = 9.0
MIN_TIES: Final = 100
MIN_SHARE: Final = 0.25
DISAGREE_M: Final = 6.0
OFFSET_DIGITS: Final = 2

USED, FEW, DISAGREES = ALIGNMENT_STATUSES

PlaceFn = Callable[[FloatArray], FloatArray]
# A model fitted on film pixels, EPSG:3857 places and each row's weight; None when it does not fit.
ModelFit = Callable[[FloatArray, FloatArray, FloatArray], PlaceFn | None]


@dataclass(frozen=True)
class PartnerTies:
    """The ties with one frame held still: this frame's film pixels, the places the partner shows them at, the tiles tried."""

    partner: str
    film: FloatArray
    places: FloatArray
    tried: int

    @property
    def share(self) -> float:
        return len(self.film) / self.tried if self.tried else 0.0

    def where(self, keep: Mask) -> PartnerTies:
        return PartnerTies(self.partner, self.film[keep], self.places[keep], self.tried)


@dataclass(frozen=True)
class Verdict:
    """What became of a partner: `used`, too `few` ties, or its ties `disagree` (`offset_m`, ground metres, from the rest)."""

    partner: str
    ties: int
    tried: int
    status: str
    offset_m: float | None = None

    def as_record(self) -> dict[str, object]:
        record: dict[str, object] = {"versionId": self.partner, "ties": self.ties, "tried": self.tried, "status": self.status}
        return record if self.offset_m is None else {**record, "offsetM": round(self.offset_m, OFFSET_DIGITS)}


@dataclass(frozen=True)
class Rows:
    """What a model is fitted on: film pixels, places and weights."""

    film: FloatArray
    places: FloatArray
    weights: FloatArray

    @classmethod
    def tiles(cls, film: FloatArray, places: FloatArray) -> Rows:
        return cls(film, places, numpy.ones(len(film)))

    def plus(self, partners: Sequence[PartnerTies]) -> Rows:
        """These rows and every partner's ties, each tie at `TIE_WEIGHT`."""
        film = [self.film, *(ties.film for ties in partners)]
        places = [self.places, *(ties.places for ties in partners)]
        weights = [self.weights, *(numpy.full(len(ties.film), TIE_WEIGHT) for ties in partners)]
        return Rows(numpy.vstack(film), numpy.vstack(places), numpy.concatenate(weights))

    def fitted(self, fit: ModelFit) -> PlaceFn | None:
        return fit(self.film, self.places, self.weights)


@dataclass(frozen=True)
class Joined:
    """The frame's map with its partners held still, and each partner's verdict."""

    to_places: PlaceFn
    verdicts: tuple[Verdict, ...]

    @property
    def used(self) -> tuple[str, ...]:
        return tuple(verdict.partner for verdict in self.verdicts if verdict.status == USED)


def counts(ties: PartnerTies) -> bool:
    """Enough ties, and enough of the tiles tried holding, to be a real overlap."""
    return len(ties.film) >= MIN_TIES and ties.share >= MIN_SHARE


def offset_m(to_places: PlaceFn, ties: PartnerTies) -> float:
    """How far the partner's ties sit from a map, ground metres: the size of their median offset."""
    _, lat = to_lnglat_arrays(ties.places[:, 0], ties.places[:, 1])
    shifts = (to_places(ties.film) - ties.places) * ground_scale_of(lat)[:, None]
    return float(numpy.hypot(*numpy.median(shifts, axis=0)))


def _left_out(fit: ModelFit, own: Rows, counted: Sequence[PartnerTies], index: int) -> float | None:
    """The partner's offset from the map of the frame's own tiles and every other partner; None when that map does not fit."""
    others = [ties for at, ties in enumerate(counted) if at != index]
    to_places = own.plus(others).fitted(fit)
    return None if to_places is None else offset_m(to_places, counted[index])


def _offsets(fit: ModelFit, own: Rows, kept: Sequence[PartnerTies]) -> dict[str, float | None]:
    return {ties.partner: _left_out(fit, own, kept, index) for index, ties in enumerate(kept)}


def _trimmed(fit: ModelFit, own: Rows, counted: Sequence[PartnerTies]) -> dict[str, float | None]:
    """Each partner's offset from the rest, the furthest beyond `DISAGREE_M` left out and the rest measured again until none is: one
    partner published wrong pulls the others' maps too, so it goes first and alone."""
    kept, found = list(counted), dict[str, float | None]()
    for _ in counted:
        offsets = _offsets(fit, own, kept)
        found |= offsets
        worst = max(kept, key=lambda ties: offsets[ties.partner] or 0.0)
        if (offsets[worst.partner] or 0.0) <= DISAGREE_M:
            break
        kept.remove(worst)
    return found


def _verdict(ties: PartnerTies, offset: float | None) -> Verdict:
    status = DISAGREES if offset is not None and offset > DISAGREE_M else USED
    return Verdict(ties.partner, len(ties.film), ties.tried, status, offset)


def verdicts(fit: ModelFit, own: Rows, partners: Sequence[PartnerTies]) -> tuple[Verdict, ...]:
    """Each partner's verdict, in the partners' order: too few ties, or its offset from the rest (`_trimmed`), left out over
    `DISAGREE_M`."""
    offsets = _trimmed(fit, own, [ties for ties in partners if counts(ties)])
    return tuple(
        _verdict(ties, offsets[ties.partner]) if ties.partner in offsets else Verdict(ties.partner, len(ties.film), ties.tried, FEW)
        for ties in partners
    )


def _used(partners: Sequence[PartnerTies], found: Sequence[Verdict]) -> list[PartnerTies]:
    used = {verdict.partner for verdict in found if verdict.status == USED}
    return [ties for ties in partners if ties.partner in used]


def joined(fit: ModelFit, own: Rows, partners: Sequence[PartnerTies]) -> Joined | None:
    """The frame's map on its own tiles and the ties of every partner that counts and agrees; None when it does not fit."""
    found = verdicts(fit, own, partners)
    to_places = own.plus(_used(partners, found)).fitted(fit)
    return None if to_places is None else Joined(to_places, found)
