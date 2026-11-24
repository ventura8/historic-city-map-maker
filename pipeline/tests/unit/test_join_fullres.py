"""A join's merge warps each part from its original at full resolution, else its stored copy (M8-join-interfaces.md §3)."""

from dataclasses import replace
from pathlib import Path

import pytest
from hcm_pipeline.archive import encoding
from hcm_pipeline.documents import ScanInfo
from hcm_pipeline.geo import MercatorBox
from hcm_pipeline.jobs import JobContext
from hcm_pipeline.join.deepest import deepest_zoom, metres_per_px
from hcm_pipeline.join.plan import Part
from hcm_pipeline.join.warping import Warper

from tests.fakes.world import PipelineWorld
from tests.unit.test_placing_original import GEOREF, regeoref

NODES = ((10.0, 20.0, 1000.0, 2000.0),)


def _warper(ctx: JobContext, scan: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Warper, Part, list[str]]:
    said: list[str] = []
    monkeypatch.setattr(ctx.log, "info", lambda message, _step=None: said.append(message))
    monkeypatch.setattr(Warper, "_scan", lambda _self, _part: scan)
    part = Part(ctx.version, ScanInfo("scan.tif", 220, 200, "0", "p.webp", 1.0), GEOREF, "sheet-1", None, 0)
    return Warper(ctx, MercatorBox(0.0, 0.0, 1.0, 1.0)), part, said


def test_happy_path_the_merge_warps_a_part_from_its_original_points_and_nodes_scaled(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P05-HAPPY-JOIN-FULLRES"""
    ctx, scan = regeoref(world, tmp_path)
    warper, part, said = _warper(ctx, scan, monkeypatch)

    sharpest = warper.full(part, NODES)

    assert sharpest.original
    assert sharpest.picture == tmp_path / "scratch" / f"{ctx.version.id}-original.tif"
    assert sharpest.nodes == ((20.0, 40.0, 1000.0, 2000.0),)
    assert [(gcp.x, gcp.y) for gcp in sharpest.georef.gcps] == [(20.0, 40.0), (200.0, 300.0)]
    assert said == ["part sheet-1 warped on the original, 440 x 400 px"]
    warper.done_with(part, sharpest)
    assert not sharpest.picture.exists()
    assert scan.exists()


@pytest.mark.parametrize("case", ["gone", "broken", "corners", "elsewhere"])
def test_bad_path_an_unreachable_original_leaves_the_stored_copy_warped_and_logged(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, case: str
) -> None:
    """Scenarios: S-P05-BAD-JOIN-FULLRES-COPY"""
    ctx, scan = regeoref(world, tmp_path, keep=case != "gone", broken=case == "broken")
    if case == "elsewhere":
        ctx = replace(ctx, services=replace(ctx.services, archive_root=None))
    warper, part, said = _warper(ctx, scan, monkeypatch)
    if case == "corners":
        part = replace(part, georef=replace(GEOREF, method="corners"))

    sharpest = warper.full(part, NODES)

    assert (sharpest.picture, sharpest.nodes, sharpest.original) == (scan, NODES, False)
    assert said == ["part sheet-1 warped on its 220 px copy (original missing)"]
    warper.done_with(part, sharpest)
    assert scan.exists()


def test_happy_path_an_archive_join_is_drawn_as_deep_as_its_parts_originals(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P05-HAPPY-JOIN-ZOOM"""
    ctx, scan = regeoref(world, tmp_path)
    warper, part, said = _warper(ctx, scan, monkeypatch)
    box = MercatorBox(2_900_000.0, 5_530_000.0, 2_900_500.0, 5_530_500.0)

    zoom = deepest_zoom(ctx, warper, [(part, NODES)], box, 10)

    found = metres_per_px(warper.full(part, NODES).georef.gcps)
    assert found is not None
    assert zoom == max(10, encoding.scan_zoom(found))
    assert any("joined to zoom" in line for line in said)


def test_bad_path_a_join_with_no_original_or_too_few_pairs_keeps_its_zoom(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P05-BAD-JOIN-ZOOM"""
    ctx, scan = regeoref(world, tmp_path, keep=False)
    warper, part, _said = _warper(ctx, scan, monkeypatch)
    assert deepest_zoom(ctx, warper, [(part, NODES)], MercatorBox(0.0, 0.0, 1.0, 1.0), 17) == 17
    assert metres_per_px(GEOREF.gcps[:1]) is None
    same = replace(GEOREF.gcps[1], x=GEOREF.gcps[0].x, y=GEOREF.gcps[0].y)
    assert metres_per_px((GEOREF.gcps[0], same)) is None
