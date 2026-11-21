"""The chain of `locate`: model, prior, votes, proof, then a local matcher (docs/research/M9-calibration.md §1).

Budgets are counts: `VOTE_TILE_BUDGET` matches shared over the warps, `VOTE_WARP_MIN_TILES` at least for each, `PROOF_MAX_PROPOSALS`
proofs. A strong proposal goes to the proof at once, and only its refusal resumes the votes; the weak ones, merged by place, go when
the votes are done. Nothing here looks at a clock or a landmark; the log reports seconds and the job's steps stay the only record of
them.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field, replace
from typing import Final

from hcm_pipeline.calibrate.dense import PROOF_SEARCH_GROUND_M, DenseGrid, FilmReader, dense_grid, nothing_measured, read_film
from hcm_pipeline.calibrate.poly import MatrixMap, PlaceMap
from hcm_pipeline.calibrate.ports import NO_LOCAL_AI, NullProposalMatcher, Proposal, ProposalMatcher, ProposalRequest, Proposer
from hcm_pipeline.calibrate.prior import MeasuredModel, measured_model, prior_margin_m
from hcm_pipeline.calibrate.proof import Proof, no_film, spread_over
from hcm_pipeline.calibrate.reach import reach_of
from hcm_pipeline.calibrate.rival import proved
from hcm_pipeline.calibrate.votes import Hypothesis, VoteGrid, VoteProposal, merged, scaled_about, tiles_per_warp, vote_grid, warp_votes
from hcm_pipeline.contract import SearchRange
from hcm_pipeline.geo import FloatArray, Grid, MercatorBox, ground_scale
from hcm_pipeline.georef.corners import Assignment, Frame
from hcm_pipeline.georef.panoramic import PanoramicCamera
from hcm_pipeline.images import UInt8Array

PROOF_MAX_PROPOSALS: Final = 3
# A matcher's proposal is proved over at least this much ground, under the same gates: a 6 by 4.8 km window reaches 35 tiles against the
# gate's 60 and 10 of 86 tiles pass from the truth itself, so a perfect proposal would be refused (Test C, M10). The crop stays the city's.
MATCHER_PROOF_SIDE_GROUND_M: Final = 30000.0
NOT_ASKED: Final = "local AI not asked: the votes spent every proof this frame may have; the frame waits for the admin's points"


@dataclass(frozen=True)
class FrameSearch:
    """What the chain looks at: the frame's preview and reader, its orientations, the reference and the camera."""

    frame: Frame
    orientations: tuple[Assignment, ...]
    reference: UInt8Array
    grid: Grid
    reader: FilmReader
    limits: tuple[int, int, int]
    search: SearchRange
    camera: PanoramicCamera | None
    sensor: str
    seed: int
    prior: MeasuredModel | None = None
    osm_lines: UInt8Array | None = None
    matcher: ProposalMatcher = field(default_factory=NullProposalMatcher)
    # The reference and its grid over a wider box, fetched only when a matcher proposes (None: it cannot be had).
    wide: Callable[[MercatorBox], tuple[UInt8Array, Grid] | None] | None = None

    @property
    def window(self) -> MercatorBox:
        return self.grid.box()

    @property
    def ground(self) -> float:
        return ground_scale(self.window.bounds().middle_lat)


@dataclass(frozen=True)
class Found:
    """How the chain ended: the proof it accepted (None: none), how, the proposal behind it, and what it can say of a refusal."""

    proof: Proof | None
    how: str
    model: MeasuredModel | None
    votes: tuple[int, int]
    refused: Proof | None
    tried: tuple[VoteProposal, ...]
    proposer: Proposer | None = None
    # A proof over more ground than the window: what its agreeing tiles span of the window itself (None: the proof's own spread says it).
    window_spread: float | None = None


def hypotheses(search: FrameSearch) -> list[Hypothesis]:
    """The pass's prior first (its own margin), then each orientation at each of the sensor's scales and shears, the model's own scale
    first: a strong proposal there ends the search before the wider scales cost anything."""
    margin = search.search.margin_ground_m / search.ground
    scales = sorted(search.search.scales, key=lambda scale: abs(scale - 1))
    shears = search.search.shears_deg
    plain = [Hypothesis(each, scale, margin, False, shear) for scale in scales for shear in shears for each in search.orientations]
    prior = search.prior
    return [*_from_prior(prior, search), *plain] if prior is not None else plain


def _from_prior(prior: MeasuredModel, search: FrameSearch) -> list[Hypothesis]:
    window = search.window
    margin = prior_margin_m(window)
    fitting = [each for each in search.orientations if prior.fits(each, search.camera)]
    return [Hypothesis(Assignment(each.rotation, each.mirrored, prior.matrix_on(each, window)), 1.0, margin, True) for each in fitting]


@dataclass
class _Run:
    """The chain's state: how many proofs it may still run, what it refused."""

    search: FrameSearch
    reference: DenseGrid
    tick: Callable[[], None]
    say: Callable[[str], None]
    left: int = PROOF_MAX_PROPOSALS
    accepted: Proof | None = None
    refused: Proof | None = None

    def heard(self, proof: Proof) -> None:
        """A verdict kept: an accepted proof, else the refusal with the most tiles, for the log."""
        if proof.accepted:
            self.accepted = proof
        elif self.refused is None or proof.inliers > self.refused.inliers:
            self.refused = proof


def _proved(run: _Run, matrix: FloatArray) -> Proof | None:
    """The proof of a proposal when it is accepted."""
    run.left -= 1
    proof = prove_map(run.search, run.reference, MatrixMap(matrix), run.tick)
    run.say(_proof_line(proof))
    run.heard(proof)
    return proof if proof.accepted else None


def prove_map(search: FrameSearch, reference: DenseGrid, start: PlaceMap, tick: Callable[[], None]) -> Proof:
    """The film read under `start` and measured against the reference, and the verdict."""
    reach = PROOF_SEARCH_GROUND_M / search.ground
    film = read_film(start, search.window, search.reader, search.limits, reach)
    if film is None:
        return no_film(nothing_measured())
    return proved(start, reference, film, search.seed, tick)


def _proof_line(proof: Proof) -> str:
    verdict = "proved" if proof.accepted else f"not proved ({proof.refusal})"
    figure = "" if proof.checked.count == 0 else f", checked {proof.checked.cv_m:.1f} m at {proof.checked.count} places"
    return f"{verdict}: {proof.inliers} of {proof.tried} tiles agree{figure}"


def _vote_line(proposal: VoteProposal, ground: float) -> str:
    moved = (proposal.shift[0] ** 2 + proposal.shift[1] ** 2) ** 0.5 * ground / 1000
    place = proposal.hypothesis.assignment
    mirror = ", mirrored" if place.mirrored else ""
    shear = f", shear {proposal.hypothesis.shear_deg:g}" if proposal.hypothesis.shear_deg else ""
    turned = f"rotation {place.rotation * 90}{mirror}{shear}, scale {proposal.scale:.3f}, moved {moved:.1f} km"
    return f"tile votes: {proposal.agreed} of {proposal.tiles} agree ({turned})"


def _vote_all(search: FrameSearch, run: _Run, grid: VoteGrid, tried: list[VoteProposal]) -> VoteProposal | None:
    """Every warp in turn; a strong proposal that proves ends them."""
    warps = hypotheses(search)
    tiles = tiles_per_warp(len(warps))
    for hypothesis in warps:
        proposal = warp_votes(search.frame, hypothesis, grid, tiles, run.tick)
        if proposal is not None and _heard(search, run, proposal, tried):
            return proposal
    return None


def _heard(search: FrameSearch, run: _Run, proposal: VoteProposal, tried: list[VoteProposal]) -> bool:
    """A warp's proposal logged and kept; True when it was strong enough to prove at once, and proved."""
    run.say(_vote_line(proposal, search.ground))
    tried.append(proposal)
    return proposal.strong and run.left > 0 and _proved(run, proposal.matrix) is not None


def _weak_ones(search: FrameSearch, run: _Run, tried: Sequence[VoteProposal]) -> VoteProposal | None:
    """The merged clusters no early proof took, best first, as long as proofs are left."""
    clusters = merged([each for each in tried if not each.strong], search.ground)
    for proposal in clusters[: max(run.left, 0)]:
        if _proved(run, proposal.matrix) is not None:
            return proposal
    return None


def _ended(search: FrameSearch, run: _Run, winner: VoteProposal, tried: list[VoteProposal]) -> Found:
    model = measured_model(_origin(search, winner), winner.matrix, search.window, search.camera)
    how = "pass" if winner.hypothesis.from_pass else "votes"
    return Found(run.accepted, how, model, (winner.agreed, winner.tiles), None, tuple(tried))


def _origin(search: FrameSearch, proposal: VoteProposal) -> Assignment:
    """The orientation's own first guess, which a measured model is relative to."""
    place = proposal.hypothesis.assignment
    return next(each for each in search.orientations if (each.rotation, each.mirrored) == (place.rotation, place.mirrored))


def _start_scales(search: FrameSearch) -> list[float]:
    """The sensor's scales, the model's own first, as the votes take them."""
    return sorted(search.search.scales, key=lambda each: abs(each - 1))


def _ranked_starts(search: FrameSearch, tried: Sequence[VoteProposal]) -> tuple[FloatArray, ...]:
    """Each orientation's first guess at each of the sensor's scales, the orientations most votes named first. Every scale, not the one
    nearest 1: a full sweep's film at the model's own scale is 4 to 9 % too large, and on F006 at Fetești it matches nothing there."""
    centre = _centre(search.window)

    def votes(each: Assignment) -> int:
        named = [
            p.agreed
            for p in tried
            if (p.hypothesis.assignment.rotation, p.hypothesis.assignment.mirrored) == (each.rotation, each.mirrored)
        ]
        return max(named, default=0)

    ranked = sorted(search.orientations, key=lambda each: -votes(each))
    return tuple(scaled_about(each.matrix, centre, scale) for each in ranked for scale in _start_scales(search))


def _centre(window: MercatorBox) -> tuple[float, float]:
    return (window.left + window.right) / 2, (window.bottom + window.top) / 2


def wider_box(window: MercatorBox, ground: float) -> MercatorBox | None:
    """The window grown about its centre to `MATCHER_PROOF_SIDE_GROUND_M` a side; None when it is as large already."""
    side = MATCHER_PROOF_SIDE_GROUND_M / ground
    if window.width >= side and window.height >= side:
        return None
    half_x, half_y = max(window.width, side) / 2, max(window.height, side) / 2
    x, y = _centre(window)
    return MercatorBox(x - half_x, y - half_y, x + half_x, y + half_y)


def _proving_ground(search: FrameSearch, run: _Run) -> tuple[FrameSearch, DenseGrid]:
    """What a matcher's proposal is proved over: at least 30 km, under the same gates; the window itself when no wider one can be had."""
    box = wider_box(search.window, search.ground)
    found = None if box is None or search.wide is None else search.wide(box)
    if found is None:
        return search, run.reference
    wide = replace(search, reference=found[0], grid=found[1])
    return wide, dense_grid(wide.reference, wide.grid)


def _request(search: FrameSearch, run: _Run, tried: Sequence[VoteProposal]) -> ProposalRequest:
    return ProposalRequest(
        search.frame.pixels,
        search.frame.factor,
        search.reference,
        search.osm_lines,
        search.grid,
        search.sensor,
        _ranked_starts(search, tried),
        search.reader,
        search.limits,
        search.search.margin_ground_m / search.ground,
        run.tick,
        run.say,
        len(search.search.scales),
    )


def _proved_by_matcher(search: FrameSearch, run: _Run, proposals: Sequence[Proposal], tried: Sequence[VoteProposal]) -> Found | None:
    """The proposals the proofs left allow, best first; what a matcher counts stays out of every gate and of `Found.votes`."""
    ground, reference = _proving_ground(search, run)
    for proposal in proposals[: max(run.left, 0)]:
        run.left -= 1
        proof = prove_map(ground, reference, MatrixMap(proposal.matrix), run.tick)
        run.say(_proof_line(proof))
        if proof.accepted:
            spread = None if ground is search else _spread_on_window(search, proof)
            return Found(proof, "local-ai", None, _best_votes(tried), None, tuple(tried), proposal.proposer, spread)
        run.heard(proof)
    return None


def _spread_on_window(search: FrameSearch, proof: Proof) -> float:
    """A wide proof's tiles over the city's window, not the box they were measured on: a corner of a town must not read as all of it."""
    mapping = proof.mapping
    covered = 0.0 if mapping is None else reach_of(mapping, search.window, search.limits).share
    return spread_over(proof, search.grid, covered)


def _from_matcher(search: FrameSearch, run: _Run, tried: list[VoteProposal]) -> Found | None:
    """A local matcher's proposals, the same proof deciding; only after nothing else proved, and only while proofs are left."""
    if run.left <= 0:
        run.say(NO_LOCAL_AI if isinstance(search.matcher, NullProposalMatcher) else NOT_ASKED)
        return None
    proposals = search.matcher.propose(_request(search, run, tried))
    return _proved_by_matcher(search, run, proposals, tried) if proposals else None


def find_frame(search: FrameSearch, tick: Callable[[], None], say: Callable[[str], None]) -> Found:
    """The frame found and proved, else the refusal to log; a refusal is a result, not an exception."""
    margin = search.search.margin_ground_m / search.ground
    run = _Run(search, dense_grid(search.reference, search.grid), tick, say)
    grid, tried = vote_grid(search.reference, search.grid, margin * search.ground), list[VoteProposal]()
    winner = _vote_all(search, run, grid, tried) or _weak_ones(search, run, tried)
    if winner is not None:
        return _ended(search, run, winner, tried)
    return _from_matcher(search, run, tried) or _not_found(run, tried)


def _best_votes(tried: Sequence[VoteProposal]) -> tuple[int, int]:
    best = max(tried, key=lambda each: each.agreed, default=None)
    return (0, 0) if best is None else (best.agreed, best.tiles)


def _not_found(run: _Run, tried: list[VoteProposal]) -> Found:
    return Found(None, "none", None, _best_votes(tried), run.refused, tuple(tried))
