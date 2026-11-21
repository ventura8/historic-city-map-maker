"""How a seam's offset moves its parts, and the nodes that carry it (docs/research/M8-join-interfaces.md §3, `align` 7 to 9)."""

import numpy
import numpy.typing
import pytest
from hcm_pipeline.geo import FloatArray
from hcm_pipeline.join.correction import (
    ANCHOR_CLEARANCE_M,
    MAX_NODES,
    NODE_BAND_M,
    TAPER_M,
    BaseTransform,
    SeamField,
    distance_m,
    largest_move_m,
    nodes_for,
    share_of,
    taper,
    total_field,
)
from hcm_pipeline.join.measure import SeamModel
from hcm_pipeline.join.seams import Seam

SCALE_M = 10.0
GROUND = 0.5
FAR_M = TAPER_M / GROUND


def seam_at(x: float = 0.0) -> Seam:
    """A seam running north along `x`, 40 km long on the map."""
    line = numpy.column_stack((numpy.full(201, x), numpy.linspace(-20000.0, 20000.0, 201)))
    return Seam(0, 1, line, (x, 0.0), (0.0, 1.0), 40000.0 * GROUND, (), GROUND)


def constant(dx: float, dy: float = 0.0) -> SeamModel:
    return SeamModel((dx,), (dy,), -100.0, 100.0)


def forward(u: FloatArray, v: FloatArray) -> tuple[FloatArray, FloatArray, numpy.typing.NDArray[numpy.bool_]]:
    """A scan of `SCALE_M` a pixel, its middle on the seam."""
    return (u - 2000.0) * SCALE_M, (2000.0 - v) * SCALE_M, numpy.ones(u.shape, numpy.bool_)


def reverse(x: FloatArray, y: FloatArray) -> tuple[FloatArray, FloatArray, numpy.typing.NDArray[numpy.bool_]]:
    return x / SCALE_M + 2000.0, 2000.0 - y / SCALE_M, numpy.ones(x.shape, numpy.bool_)


base = BaseTransform(forward, reverse)


def test_happy_path_the_worse_measured_frame_moves_more() -> None:
    assert share_of(20.0, 40.0) == pytest.approx(0.2)
    assert share_of(40.0, 20.0) == pytest.approx(0.8)


def test_happy_path_no_frame_is_trusted_beyond_the_floor() -> None:
    assert share_of(0.5, 5.0) == pytest.approx(0.5)
    assert share_of(1.0, 10.0) == pytest.approx(0.2)


def test_bad_path_a_missing_figure_splits_equally() -> None:
    assert share_of(None, 40.0) == 0.5
    assert share_of(40.0, None) == 0.5


def test_happy_path_the_taper_runs_from_the_seam_to_its_end() -> None:
    values = taper(numpy.array([0.0, TAPER_M / 2, TAPER_M, TAPER_M * 2]))

    assert values.tolist() == [1.0, 0.5, 0.0, 0.0]


def test_happy_path_a_distance_is_the_nearest_line_point_on_the_ground_over_any_number_of_points() -> None:
    line = numpy.array([[0.0, 0.0], [0.0, 100.0]])
    x = numpy.full((100, 90), 100.0)
    y = numpy.zeros((100, 90))
    y[0, 0] = 100.0

    found = distance_m(x, y, line, GROUND)

    assert found.shape == (100, 90)
    assert bool((found == 50.0).all())


def test_happy_path_a_part_moves_by_its_share_at_the_seam_and_not_past_the_taper() -> None:
    field = SeamField(seam_at(), constant(40.0, -20.0), 0.25)

    dx, dy = field.at(numpy.array([0.0, FAR_M / 2, FAR_M + 1.0]), numpy.zeros(3))

    assert dx.tolist() == [10.0, 5.0, 0.0]
    assert dy.tolist() == [-5.0, -2.5, 0.0]


def test_happy_path_the_two_sides_of_a_seam_close_it() -> None:
    seam, model = seam_at(), constant(30.0)
    a, b = SeamField(seam, model, 0.25), SeamField(seam, model, 0.25 - 1.0)
    x, y = numpy.array([0.0]), numpy.array([500.0])

    a_x, _ = a.at(x, y)
    b_x, _ = b.at(x, y)

    # `a` goes forward along the offset and `b` back: what stood 30 m apart now stands together.
    assert float(a_x[0] - b_x[0]) == pytest.approx(30.0, abs=0.01)


def test_happy_path_the_fields_of_several_seams_add_up() -> None:
    first, second = SeamField(seam_at(-1000.0), constant(20.0), 1.0), SeamField(seam_at(1000.0), constant(20.0), 1.0)
    x, y = numpy.array([0.0]), numpy.array([0.0])

    dx, _ = total_field([first, second], x, y)

    assert float(dx[0]) == pytest.approx(float(first.at(x, y)[0][0]) * 2)
    assert float(dx[0]) > float(first.at(x, y)[0][0])


def test_bad_path_a_part_with_no_field_keeps_its_own_transform() -> None:
    assert nodes_for(base, (4000, 4000), []) == ()


def test_happy_path_nodes_are_dense_in_the_band_sparse_elsewhere_and_close_the_ring() -> None:
    nodes = numpy.array(nodes_for(base, (4000, 4000), [SeamField(seam_at(), constant(40.0), 1.0)]))

    u, v, x, y = nodes.T
    base_x, base_y = (u - 2000.0) * SCALE_M, (2000.0 - v) * SCALE_M
    # The corners are there, and a target is the transform plus the field.
    assert {(0.0, 0.0), (4000.0, 0.0), (0.0, 4000.0), (4000.0, 4000.0)} <= {(float(a), float(b)) for a, b in zip(u, v, strict=True)}
    assert float((x - base_x)[numpy.abs(base_x) < 1.0].max()) == pytest.approx(40.0, abs=1e-6)
    assert float(numpy.abs(y - base_y).max()) < 1e-6
    # Past the taper's end nothing moves, and the dense nodes go a little further.
    assert float(numpy.abs(x - base_x)[numpy.abs(base_x) * GROUND >= TAPER_M].max()) == 0.0
    in_band = numpy.abs(base_x) * GROUND < NODE_BAND_M
    density_in = in_band.sum() / (2 * NODE_BAND_M)
    density_out = (~in_band).sum() / max(4000.0 * SCALE_M * GROUND - 2 * NODE_BAND_M, 1.0)
    assert density_in > density_out


def test_bad_path_a_pixel_the_transform_cannot_answer_makes_no_node() -> None:
    def holes(u: FloatArray, v: FloatArray) -> tuple[FloatArray, FloatArray, numpy.typing.NDArray[numpy.bool_]]:
        x, y, _ = forward(u, v)
        return x, y, numpy.asarray(u > 1.0, numpy.bool_) if u.size > 2 else numpy.ones(u.shape, numpy.bool_)

    nodes = nodes_for(BaseTransform(holes, reverse), (4000, 4000), [SeamField(seam_at(), constant(40.0), 1.0)])

    assert all(node[0] > 1.0 for node in nodes)


def test_bad_path_a_huge_frame_widens_the_spacing_until_the_nodes_fit() -> None:
    def wide(u: FloatArray, v: FloatArray) -> tuple[FloatArray, FloatArray, numpy.typing.NDArray[numpy.bool_]]:
        return u * SCALE_M, v * SCALE_M, numpy.ones(u.shape, numpy.bool_)

    line = numpy.column_stack((numpy.linspace(0.0, 400000.0, 400), numpy.full(400, 100000.0)))
    seam = Seam(0, 1, line, (200000.0, 100000.0), (1.0, 0.0), 200000.0, (), GROUND)

    def narrow(x: FloatArray, y: FloatArray) -> tuple[FloatArray, FloatArray, numpy.typing.NDArray[numpy.bool_]]:
        return x / SCALE_M, y / SCALE_M, numpy.ones(x.shape, numpy.bool_)

    nodes = nodes_for(BaseTransform(wide, narrow), (40000, 20000), [SeamField(seam, constant(10.0), 1.0)])

    assert 100 < len(nodes) <= MAX_NODES


def test_happy_path_a_node_is_the_pixel_the_reverse_transform_reads_there_not_the_grids() -> None:
    def off_by_three(x: FloatArray, y: FloatArray) -> tuple[FloatArray, FloatArray, numpy.typing.NDArray[numpy.bool_]]:
        u, v, good = reverse(x, y)
        return u + 3.0, v - 2.0, good

    nodes = numpy.array(nodes_for(BaseTransform(forward, off_by_three), (4000, 4000), [SeamField(seam_at(), constant(40.0), 1.0)]))

    u, v, x, y = nodes.T
    # What a warp through the nodes reads at the place is what the part's own warp reads there, past the taper.
    far = numpy.abs(x) * GROUND >= TAPER_M
    assert numpy.allclose(u[far], x[far] / SCALE_M + 2003.0)
    assert numpy.allclose(v[far], 1998.0 - y[far] / SCALE_M)


def test_happy_path_a_thin_plate_parts_own_points_are_nodes_and_the_grid_keeps_clear_of_them() -> None:
    point = (15000.0, 3000.0)
    own = BaseTransform(forward, reverse, (point,))

    nodes = numpy.array(nodes_for(own, (4000, 4000), [SeamField(seam_at(), constant(40.0), 1.0)]))

    _, _, x, y = nodes.T
    apart = numpy.hypot(x - point[0], y - point[1]) * GROUND
    assert int((apart < 1e-6).sum()) == 1
    assert float(numpy.sort(apart)[1]) >= ANCHOR_CLEARANCE_M


def test_bad_path_a_part_full_of_points_keeps_a_grid_and_stays_near_the_cap() -> None:
    points = tuple((float(a) * 40.0 - 20000.0, float(b) * 40.0 - 20000.0) for a in range(0, 1000, 25) for b in range(0, 1000, 25))
    own = BaseTransform(forward, reverse, points)

    nodes = nodes_for(own, (4000, 4000), [SeamField(seam_at(), constant(40.0), 1.0)])

    assert len(nodes) > len(points)
    assert len(nodes) <= len(points) + 100


def test_happy_path_the_largest_move_is_the_gap_between_what_the_two_warps_read() -> None:
    nodes = [(2000.0, 2000.0, 0.0, 0.0), (2010.0, 2000.0, 100.0, 0.0)]

    def shifted(x: FloatArray, y: FloatArray) -> tuple[FloatArray, FloatArray, numpy.typing.NDArray[numpy.bool_]]:
        # Between the nodes, and only there: the far corner of the scan reads 5 pixels east of the part's own.
        u, v, good = reverse(x, y)
        return u + numpy.where(x > 19000.0, 5.0, 0.0), v, good

    assert largest_move_m(base, nodes, shifted, (4000, 4000), GROUND) == pytest.approx(5.0 * SCALE_M * GROUND)
    assert largest_move_m(base, [], shifted, (4000, 4000), GROUND) == 0.0


def test_bad_path_places_a_warp_cannot_answer_do_not_count() -> None:
    nodes = [(2000.0, 2000.0, 0.0, 0.0)]

    def nothing(x: FloatArray, y: FloatArray) -> tuple[FloatArray, FloatArray, numpy.typing.NDArray[numpy.bool_]]:
        return x + 1e6, y, numpy.zeros(x.shape, numpy.bool_)

    assert largest_move_m(base, nodes, nothing, (4000, 4000), GROUND) == 0.0
