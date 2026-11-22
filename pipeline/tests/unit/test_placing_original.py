"""A `regeoref` of an archive single map warps its original, the points scaled to it (`placing/original.py`, `steps/warp.py`)."""

from dataclasses import replace
from pathlib import Path

from hcm_pipeline.documents import GeorefInfo
from hcm_pipeline.georef.lattice import Lattice, LatticeNode
from hcm_pipeline.georef.transforms import Gcp
from hcm_pipeline.jobs import JobContext
from hcm_pipeline.placing.original import ORIGINAL, based_original
from hcm_pipeline.steps.warp import full_resolution, scaled, scan_size

from tests.fakes.world import PipelineWorld
from tests.synthetic.town import Drawing, draw_map, placement, town_lines, write_map
from tests.unit.placing_support import originals, series_context

SIZE = (440, 400)
GEOREF = GeorefInfo("gcps", "affine", (Gcp("a", 10.0, 20.0, 44.4, 26.1), Gcp("b", 100.0, 150.0, 44.41, 26.12)))


def regeoref(world: PipelineWorld, tmp_path: Path, kind: str = "single", original: bool = True) -> tuple[JobContext, Path]:
    """A regeoref job based on an archive series' job whose original lies in the archive; its scan is half the original."""
    base = series_context(world, tmp_path, ["Harti/a.tif"], {"class": kind, "encoding": "grey"})
    world.store.update(world.job_path(), {"type": "archive-series", "params": dict(base.job.params)})
    image = draw_map(town_lines(), Drawing(placement(5.2, 3.0, (220, 200)), SIZE, "grey", street_px=3, margin_px=20))
    if original:
        (originals(base) / "Harti").mkdir(parents=True, exist_ok=True)
        write_map(originals(base) / "Harti" / "a.tif", image, grey=True)
    scan = write_map(tmp_path / "scan.tif", image[::2, ::2], grey=True)
    job = replace(base.job, id="rg-1", type="regeoref", params={"basedOn": base.job.id})
    return replace(base, job=job), scan


def test_happy_path_a_regeoref_warps_the_single_maps_original(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-SINGLE-FULLRES"""
    ctx, scan = regeoref(world, tmp_path)

    source, georef = full_resolution(ctx, scan, GEOREF)

    assert source == tmp_path / "scratch" / ORIGINAL
    assert scan_size(source) == SIZE
    assert [(gcp.x, gcp.y) for gcp in georef.gcps] == [(20.0, 40.0), (200.0, 300.0)]


def test_happy_path_a_regeoref_of_a_regeoref_reaches_the_archive_job(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-SINGLE-FULLRES"""
    ctx, scan = regeoref(world, tmp_path)
    world.store.create(f"cities/{ctx.city}/jobs/rg-1", {"type": "regeoref", "params": {"basedOn": ctx.job.params["basedOn"]}})
    world.store.create(f"cities/{ctx.city}/jobs/rg-loop", {"type": "regeoref", "params": {"basedOn": "rg-loop"}})
    world.store.create(f"cities/{ctx.city}/jobs/rg-none", {"type": "regeoref", "params": {}})
    again = replace(ctx, job=replace(ctx.job, id="rg-2", params={"basedOn": "rg-1"}))

    assert full_resolution(again, scan, GEOREF)[0] == tmp_path / "scratch" / ORIGINAL
    assert based_original(replace(ctx, job=replace(ctx.job, params={"basedOn": "rg-loop"}))) is None
    assert based_original(replace(ctx, job=replace(ctx.job, params={"basedOn": "rg-none"}))) is None
    assert based_original(replace(ctx, job=replace(ctx.job, params={"basedOn": "missing"}))) is None


def test_bad_path_another_class_or_no_original_or_another_job_keeps_the_scan(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-SINGLE-FULLRES-GONE"""
    ctx, scan = regeoref(world, tmp_path, kind="atlas")
    assert full_resolution(ctx, scan, GEOREF) == (scan, GEOREF)
    assert full_resolution(ctx, scan, replace(GEOREF, method="corners")) == (scan, GEOREF_CORNERS)
    assert based_original(replace(ctx, job=replace(ctx.job, type="usgs-import"))) is None
    world.store.update(world.job_path(), {"type": "usgs-import"})
    assert based_original(ctx) is None
    gone, _ = regeoref(world, tmp_path / "gone", original=False)
    assert based_original(gone) is None
    assert based_original(replace(ctx, services=replace(ctx.services, archive_root=None))) is None


GEOREF_CORNERS = replace(GEOREF, method="corners")


def test_happy_path_a_lattice_is_scaled_with_the_points() -> None:
    lattice = Lattice("poly2", (LatticeNode(2.0, 3.0, 44.4, 26.1),))
    moved = scaled(replace(GEOREF, lattice=lattice), 2.0, 3.0)
    assert moved.lattice is not None
    assert (moved.lattice.nodes[0].x, moved.lattice.nodes[0].y) == (4.0, 9.0)
