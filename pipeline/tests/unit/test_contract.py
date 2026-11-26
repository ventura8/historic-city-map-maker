"""The pipeline's constants and paths equal the golden contract both languages share (docs/research/M3-interfaces.md §5.8)."""

from collections.abc import Callable

import pytest
from hcm_pipeline import contract, documents, paths
from hcm_pipeline.archive import model

from tests.contracts_loader import golden, record, records

ENUMS = golden("enums.json")
PATHS = golden("paths.json")
BUILDERS: dict[str, Callable[..., str]] = {
    "upload": paths.upload,
    "usgsRaw": paths.usgs_raw,
    "browse": paths.browse,
    "work": paths.work,
    "version": paths.version,
    "reference": paths.reference,
}


def test_happy_path_the_constants_equal_the_shared_copy() -> None:
    sensors = {name: spec.as_contract() for name, spec in contract.SENSOR_SPECS.items()}

    assert {key: value for key, value in ENUMS.items() if key != "comment"} == {
        "JOB_STATUSES": list(contract.JOB_STATUSES),
        "JOB_WAIT_REASONS": list(contract.JOB_WAIT_REASONS),
        "JOB_STEP_STATES": list(contract.JOB_STEP_STATES),
        "PIPELINE_STEPS": list(contract.PIPELINE_STEPS),
        "DOWNLOAD_STEPS": list(contract.DOWNLOAD_STEPS),
        "JOB_MACHINES": list(contract.JOB_MACHINES),
        "JOB_STEPS": {job_type: list(steps) for job_type, steps in contract.JOB_STEPS.items()},
        "LAYER_VERSION_STATES": list(contract.LAYER_VERSION_STATES),
        "VERSION_ORIGINS": list(documents.VERSION_ORIGINS),
        "GEOREF_TRANSFORMS": list(contract.GEOREF_TRANSFORMS),
        "MIN_GCPS": dict(contract.MIN_GCPS),
        "GCP_ORIGINS": list(contract.GCP_ORIGINS),
        "VERSION_FILES": list(contract.VERSION_FILES),
        "LEASE_SECONDS": contract.LEASE_SECONDS,
        "HEARTBEAT_SECONDS": contract.HEARTBEAT_SECONDS,
        "USGS_BACKOFF_MINUTES": list(contract.USGS_BACKOFF_MINUTES),
        "SCAN_PREVIEW_MAX_PX": contract.SCAN_PREVIEW_MAX_PX,
        "SCAN_DETAIL_MAX_PX": contract.SCAN_DETAIL_MAX_PX,
        "SCAN_DETAIL_MAX_PIXELS": contract.SCAN_DETAIL_MAX_PIXELS,
        "SCAN_TILE_PX": contract.SCAN_TILE_PX,
        "STUDIO_MAX_BYTES": contract.STUDIO_MAX_BYTES,
        "SENSOR_SPECS": sensors,
        "MAX_GCPS": contract.MAX_GCPS,
        "MAX_SCAN_PIXELS": contract.MAX_SCAN_PIXELS,
        "JOIN_MAX_PARTS": contract.JOIN_MAX_PARTS,
        "RECALIBRATE_MIN_GAIN_M": contract.RECALIBRATE_MIN_GAIN_M,
        "RECALIBRATE_MIN_CHECKS": contract.RECALIBRATE_MIN_CHECKS,
        "S2_CHECK_STATUSES": list(contract.S2_CHECK_STATUSES),
        "ALIGNMENT_STATUSES": list(contract.ALIGNMENT_STATUSES),
        "ALIGNMENT_MAX_PARTNERS": contract.ALIGNMENT_MAX_PARTNERS,
        # M20 (docs/research/M20-import-local.md): the archive's vocabulary (`archive/model.py`).
        "ARCHIVE_SERIES_CLASSES": list(model.ARCHIVE_SERIES_CLASSES),
        "ARCHIVE_SKIP_REASONS": list(model.ARCHIVE_SKIP_REASONS),
        "ARCHIVE_ENCODINGS": list(model.ARCHIVE_ENCODINGS),
        "ARCHIVE_AUTO_LIKELIHOODS": list(model.ARCHIVE_AUTO_LIKELIHOODS),
        "ARCHIVE_PLACE_METHODS": list(model.ARCHIVE_PLACE_METHODS),
        "STITCH_METHODS": list(model.STITCH_METHODS),
        "LEFT_OUT_REASONS": list(model.LEFT_OUT_REASONS),
        "STITCHED_LEFT_OUT_MAX": model.STITCHED_LEFT_OUT_MAX,
        "RIGHTS_LICENCES": list(model.RIGHTS_LICENCES),
        "RIGHTS_STATES": list(model.RIGHTS_STATES),
        "HELP_REASONS": list(model.HELP_REASONS),
        # The tile layout (docs/research/M20-import-local.md §19).
        "SEAM_STATES": list(model.SEAM_STATES),
        "SHEET_SOURCES": list(model.SHEET_SOURCES),
        "SHEET_TURNS": list(model.SHEET_TURNS),
        "STITCH_VERDICTS": list(model.STITCH_VERDICTS),
        "SEAM_SIDES": list(model.SEAM_SIDES),
        "STITCH_GOOD_PLACED_PCT": model.STITCH_GOOD_PLACED_PCT,
        "STITCH_GOOD_SEAM_NCC": model.STITCH_GOOD_SEAM_NCC,
        "STITCH_GOOD_RMS_PX": model.STITCH_GOOD_RMS_PX,
        "STITCH_MAX_MOVE_CELL": model.STITCH_MAX_MOVE_CELL,
        "LAYOUT_WEAK_SEAMS_MAX": model.LAYOUT_WEAK_SEAMS_MAX,
        "LAYOUT_SHEETS_MAX": model.LAYOUT_SHEETS_MAX,
        "LAYOUT_SEAMS_MAX": model.LAYOUT_SEAMS_MAX,
        "THUMB_CELL_PX": model.THUMB_CELL_PX,
        "THUMB_SPRITE_COLS": model.THUMB_SPRITE_COLS,
        "SEAM_CELL_PX": model.SEAM_CELL_PX,
        "ARCHIVE_MAX_SERIES": model.ARCHIVE_MAX_SERIES,
        "ARCHIVE_ISSUES_MAX": model.ARCHIVE_ISSUES_MAX,
        "ARCHIVE_SERIES_MAX_BYTES": model.ARCHIVE_SERIES_MAX_BYTES,
        # Every code a step fails or waits with: the shared test holds each to a code the admin can read (finding 62).
        "PIPELINE_ERROR_CODES": sorted(value for name, value in vars(contract.Errors).items() if name.isupper()),
    }


@pytest.mark.parametrize("job_type", ["usgs-import", "geotiff-import", "regeoref", "layer-join", "archive-series"])
def test_happy_path_each_pipeline_job_type_weighs_its_steps_to_one(job_type: str) -> None:
    weights = contract.step_weights(job_type)

    assert tuple(weights) == contract.pipeline_steps_of(job_type)
    assert sum(weights.values()) == pytest.approx(1.0)


def test_happy_path_a_join_runs_its_own_steps_with_the_contract_shares() -> None:
    weights = contract.step_weights("layer-join")

    assert contract.pipeline_steps_of("layer-join") == ("align", "merge", "export", "pyramid", "register")
    # align 0.15, merge 0.25, export 0.10, register 0.05 of 0.55.
    assert weights["merge"] == pytest.approx(0.25 / 0.55)
    assert weights["align"] == pytest.approx(0.15 / 0.55)


def test_happy_path_usgs_import_keeps_the_contract_weights() -> None:
    assert contract.step_weights("usgs-import")["fetch"] == pytest.approx(0.25)
    assert contract.pipeline_steps_of("republish") == ()
    assert contract.pipeline_steps_of("unknown") == ()


@pytest.mark.parametrize("case", records(PATHS["built"]), ids=lambda case: str(case["path"]))
def test_happy_path_paths_build_exactly_the_golden_ones(case: dict[str, object]) -> None:
    args = case["args"]
    assert isinstance(args, list)

    assert BUILDERS[str(case["builder"])](*args) == case["path"]


@pytest.mark.parametrize("case", records(PATHS["refused"]), ids=lambda case: f"{case['builder']}:{case['args']}")
def test_bad_path_paths_refuse_exactly_the_golden_ones(case: dict[str, object]) -> None:
    args = case["args"]
    assert isinstance(args, list)

    with pytest.raises(paths.PathError):
        BUILDERS[str(case["builder"])](*args)


def test_happy_path_a_jobs_scratch_prefix_ends_with_a_slash() -> None:
    assert paths.work_prefix("bucharest", "job-1") == "work/bucharest/job-1/"
    assert record({"a": 1}) == {"a": 1}


@pytest.mark.parametrize(
    ("builder", "args"),
    [
        (paths.version, ("bucharest", "layer", "v1", "secrets.json")),
        (paths.reference, ("bucharest", "srtm", "0f3c9a2e")),
        (paths.browse, ("declass1", "E1")),
    ],
)
def test_bad_path_unknown_files_kinds_and_datasets_are_refused(builder: object, args: tuple[str, ...]) -> None:
    assert callable(builder)
    with pytest.raises(paths.PathError):
        builder(*args)
