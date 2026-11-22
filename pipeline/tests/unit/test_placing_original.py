"""A `regeoref` of an archive single map warps its original, the points scaled to it (`placing/original.py`, `steps/warp.py`)."""

from dataclasses import replace
from pathlib import Path

from hcm_pipeline.archive import report, sidecar
from hcm_pipeline.archive.intake import ArchiveStore
from hcm_pipeline.archive.model import Probe
from hcm_pipeline.documents import GeorefInfo, Version
from hcm_pipeline.georef.lattice import Lattice, LatticeNode
from hcm_pipeline.georef.transforms import Gcp
from hcm_pipeline.joblog import JobLog
from hcm_pipeline.jobs import JobContext, RunFlags
from hcm_pipeline.log import get_logger
from hcm_pipeline.model import Job
from hcm_pipeline.placing.original import ORIGINAL, based_original
from hcm_pipeline.steps.warp import full_resolution, scaled, scan_size

from tests.fakes.world import JOB_ID, PipelineWorld
from tests.synthetic.town import Drawing, draw_map, placement, town_lines, write_map

SIZE = (440, 400)
GEOREF = GeorefInfo("gcps", "affine", (Gcp("a", 10.0, 20.0, 44.4, 26.1), Gcp("b", 100.0, 150.0, 44.41, 26.12)))


def regeoref(world: PipelineWorld, tmp_path: Path, sheets: int = 1, keep: bool = True, broken: bool = False) -> tuple[JobContext, Path]:
    """A regeoref of an archive version whose one original (a scanned archive on this computer) is twice its scan's size."""
    world.seed_import()
    tmp_path.mkdir(parents=True, exist_ok=True)
    image = draw_map(town_lines(), Drawing(placement(5.2, 3.0, (220, 200)), SIZE, "grey", street_px=3, margin_px=20))
    original = write_map(tmp_path / "staging.tif", image, grey=True)
    if broken:
        original.write_bytes(b"II*\x00" + b"\x00" * 64)
    store = ArchiveStore(tmp_path / "work", lambda _path: Probe("tiff", SIZE[0], SIZE[1], 1, 8, "grey"))
    archive_id = store.create()
    store.receive(archive_id, "Harti/a.tif", [original.read_bytes()], original.stat().st_size)
    series_id = str(store.scan(archive_id, report.Context(44.43, 2026, sidecar.Sidecar())).series[0]["seriesId"])
    if not keep:
        (store.files(archive_id) / "Harti" / "a.tif").unlink()
    scan = write_map(tmp_path / "scan.tif", image[::2, ::2], grey=True)
    source = {"kind": "archive", "archiveId": archive_id, "seriesId": series_id, "sheetCount": sheets}
    version = replace(Version.of(JOB_ID, world.version()), source=source)
    job = replace(Job.of(JOB_ID, world.job()), type="regeoref", params={"basedOn": "ar-base"})
    log = JobLog(world.store, f"{world.job_path()}/logs", world.clock, get_logger("test"))
    services = replace(world.services(), archive_root=tmp_path / "work")
    return JobContext(world.config, services, job, version, tmp_path / "scratch", RunFlags(), log), scan


def test_happy_path_a_regeoref_warps_the_single_maps_original(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-SINGLE-FULLRES"""
    ctx, scan = regeoref(world, tmp_path)

    source, georef = full_resolution(ctx, scan, GEOREF)

    assert source == tmp_path / "scratch" / ORIGINAL
    assert scan_size(source) == SIZE
    assert [(gcp.x, gcp.y) for gcp in georef.gcps] == [(20.0, 40.0), (200.0, 300.0)]


def test_bad_path_more_sheets_another_job_no_archive_or_a_gone_original_keep_the_scan(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-SINGLE-FULLRES-GONE"""
    ctx, scan = regeoref(world, tmp_path / "many", sheets=2)
    assert full_resolution(ctx, scan, GEOREF) == (scan, GEOREF)
    corners = replace(GEOREF, method="corners")
    assert full_resolution(ctx, scan, corners) == (scan, corners)
    single, _ = regeoref(world, tmp_path / "one")
    assert based_original(replace(single, job=replace(single.job, type="usgs-import"))) is None
    assert based_original(replace(single, services=replace(single.services, archive_root=None))) is None
    gone, gone_scan = regeoref(world, tmp_path / "gone", keep=False)
    assert based_original(gone) is None
    assert full_resolution(gone, gone_scan, GEOREF) == (gone_scan, GEOREF)


def test_bad_path_a_refused_read_warps_the_scan_and_never_fails_the_job(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-SINGLE-FULLRES-GONE"""
    # The live 2026-11-22 regression: every regeoref failed at warp with apiError.worker.refused while looking for the original.
    ctx, scan = regeoref(world, tmp_path, broken=True)

    assert full_resolution(ctx, scan, GEOREF) == (scan, GEOREF)


def test_happy_path_a_lattice_is_scaled_with_the_points() -> None:
    lattice = Lattice("poly2", (LatticeNode(2.0, 3.0, 44.4, 26.1),))
    moved = scaled(replace(GEOREF, lattice=lattice), 2.0, 3.0)
    assert moved.lattice is not None
    assert (moved.lattice.nodes[0].x, moved.lattice.nodes[0].y) == (4.0, 9.0)
