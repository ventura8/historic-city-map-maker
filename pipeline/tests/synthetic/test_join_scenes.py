"""Several frames of one date over one seeded world (docs/research/M8-join-interfaces.md §8)."""

import json
from pathlib import Path

import numpy
from hcm_pipeline.geo import to_mercator

from tests.synthetic.scenes import (
    CENTRE,
    JOIN_ENTITIES,
    JOIN_OFFSET_M,
    SceneSpec,
    affine_scan,
    join_specs,
    main,
    render_world,
    truth_for,
    world_grid,
)


def test_happy_path_a_frames_offset_moves_its_truth_and_nothing_else() -> None:
    plain, moved = truth_for(SceneSpec()), truth_for(SceneSpec(centre_offset_m=(1000.0, -500.0)))

    assert numpy.allclose(numpy.subtract(moved.corners, plain.corners), [1000.0, -500.0])


def test_happy_path_a_larger_world_keeps_its_centre_and_its_density() -> None:
    small, large = world_grid(), world_grid(2048)

    assert large.width == 2 * small.width
    assert (large.left + large.width * large.resolution / 2, large.top - large.height * large.resolution / 2) == to_mercator(*CENTRE)
    assert render_world(1, 1536).pixels.shape == (1536, 1536)


def test_happy_path_an_affine_scan_lies_where_it_is_asked_and_printed_as_it_is_asked() -> None:
    world = render_world(2)
    plain = affine_scan(world, (200, 100), (6.0, 0.0, 0.0, -6.0))
    moved = affine_scan(world, (200, 100), (6.0, 0.0, 0.0, -6.0), (600.0, 0.0))
    dark = affine_scan(world, (200, 100), (6.0, 0.0, 0.0, -6.0), gain=0.5)

    assert moved.origin[0] - plain.origin[0] == 600.0
    # A hundred pixels on, the moved scan starts where the plain one left off.
    assert numpy.array_equal(moved.pixels[:, :100], plain.pixels[:, 100:])
    assert float(dark.pixels.mean()) < float(plain.pixels.mean()) * 0.6


def test_happy_path_join_writes_each_frame_in_its_entitys_folder(tmp_path: Path) -> None:
    assert main(["--out", str(tmp_path), "--seed", "3", "--join"]) == 0

    for name, spec in zip(JOIN_ENTITIES, join_specs(3), strict=True):
        truth = json.loads((tmp_path / name / "truth.json").read_text(encoding="utf-8"))
        assert (tmp_path / name / f"{name}.tgz").exists()
        assert truth["spec"]["entity_id"] == spec.entity_id
        assert abs(truth["spec"]["centre_offset_m"][0]) == JOIN_OFFSET_M
