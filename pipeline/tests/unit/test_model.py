"""What the pipeline writes serializes to exactly the golden documents; what it reads is checked first."""

import pytest
from hcm_pipeline.contract import PIPELINE_WRITER
from hcm_pipeline.documents import GeorefInfo, JoinReport, JoinSeam, OutputInfo, ReferenceInfo, ScanInfo, Version
from hcm_pipeline.geo import Bounds
from hcm_pipeline.model import (
    RUN_JOB_TYPES,
    ArchiveSeriesParams,
    DocumentError,
    GeotiffImportParams,
    Job,
    JoinParams,
    JoinPart,
    Lease,
    OutdatedJobError,
    RegeorefParams,
    StepRecord,
    Timestamp,
    UsgsImportParams,
    contract_json,
    member_of,
    number_of,
    optional_text,
    params_of,
    record_of,
    stamp,
    text_of,
)

from tests.contracts_loader import gcp_of, golden, record, records, stored, with_timestamps

JOB = golden("job.usgs-import.running.json")
AWAITING = golden("version.awaiting-approval.json")
NEEDS_GCPS = golden("version.needs-gcps.json")


def ts(value: object) -> Timestamp:
    found = record(value)
    return Timestamp(int(str(found["seconds"])), int(str(found["nanoseconds"])))


def step_of(name: str) -> StepRecord:
    return StepRecord.of(with_timestamps(record(JOB["steps"])[name]))


def test_happy_path_the_running_job_the_pipeline_leaves_is_the_golden_one() -> None:
    created = {
        key: JOB[key]
        for key in ("type", "params", "createdBy", "createdAt", "dispatchAt", "executionName", "machine", "attempt", "layerId", "versionId")
    }
    lease = record(JOB["lease"])
    written = {
        "status": "running",
        "lease": Lease(str(lease["owner"]), ts(lease["until"])).as_record(),
        "startedAt": ts(JOB["startedAt"]),
        "step": "georef",
        "progress": 0.55,
        "steps": {name: step_of(name).as_record() for name in record(JOB["steps"])},
        **stamp(ts(JOB["updatedAt"])),
    }

    assert contract_json({**created, **written}) == JOB


def test_happy_path_the_version_awaiting_approval_is_the_golden_one() -> None:
    created = {
        key: AWAITING[key] for key in ("layerId", "jobId", "origin", "source", "label", "year", "date", "sensor", "createdBy", "createdAt")
    }
    scan, reference, georef, output = (record(AWAITING[key]) for key in ("scan", "reference", "georef", "output"))
    gcps = tuple(gcp_of(gcp) for gcp in records(georef["gcps"]))
    written = {
        "state": "awaiting_approval",
        "scan": ScanInfo.of(scan).as_record(),
        "reference": ReferenceInfo.of(reference).as_record(),
        "georef": GeorefInfo("auto", "poly2", gcps, 6.1, 8.9, 2, kind="held-out").as_record(),
        "calibration": AWAITING["calibration"],
        "output": OutputInfo(
            cog_path=str(output["cogPath"]),
            cog_bytes=212_000_000,
            cog_sha256=str(output["cogSha256"]),
            preview_path=str(output["previewPath"]),
            bounds=Bounds.of(output["bounds"]),
            minzoom=10,
            maxzoom=16,
            area_km2=612.5,
            studio_path=str(output["studioPath"]),
            studio_bytes=180_000_000,
            coverage_pct=94.2,
        ).as_record(),
        **stamp(ts(AWAITING["updatedAt"])),
    }

    assert contract_json({**created, **written}) == AWAITING


def test_happy_path_the_version_waiting_for_points_is_the_golden_one() -> None:
    created = {key: NEEDS_GCPS[key] for key in ("layerId", "jobId", "origin", "source", "label", "year", "createdBy", "createdAt")}
    written = {
        "state": "needs_gcps",
        "scan": ScanInfo.of(NEEDS_GCPS["scan"]).as_record(),
        "reference": ReferenceInfo.of(NEEDS_GCPS["reference"]).as_record(),
        **stamp(ts(NEEDS_GCPS["updatedAt"])),
    }

    assert contract_json({**created, **written}) == NEEDS_GCPS
    assert stamp(Timestamp(1))["updatedBy"] == PIPELINE_WRITER


def test_happy_path_a_joins_report_is_the_golden_one() -> None:
    measured = JoinSeam("D3C1202-200149F039", "D3C1202-200149F040", True, True, 24, 4, 42.75, 61.25, 9.5)
    unmeasured = JoinSeam("D3C1202-200149F040", "D3C1202-200149F041", False, False, 3, 0, 0)
    report = JoinReport((measured, unmeasured), ("D3C1202-200149A039",), 97.5, 3, 42.75, 51.6)

    assert report.as_record() == golden("version.join.json")["join"]


def test_happy_path_a_join_version_reads_back_without_scan_or_georef() -> None:
    version = Version.of("job-1972-0808-join", golden("version.join.json"))

    assert (version.origin, version.scan, version.georef, version.source["kind"]) == ("join", None, None, "join")


def test_happy_path_versions_read_back_what_the_golden_documents_hold() -> None:
    version = Version.of("job-1966-0712", AWAITING)

    assert (version.layer_id, version.origin, version.state, version.sensor) == ("kh-4a-corona-1966", "usgs", "awaiting_approval", "KH-4A")
    assert version.georef is not None
    assert len(version.georef.gcps) == 8
    assert version.georef.gcps[7].origin == "corner"
    assert version.scan is not None
    assert version.scan.preview_scale == 0.2
    assert Version.of("up-plan1911", NEEDS_GCPS).georef is None


def test_happy_path_jobs_read_their_steps_lease_and_params() -> None:
    job = Job.of("job-1966-0712", stored("job.usgs-import.running.json"))

    assert (job.type, job.status, job.attempt, job.layer_id) == ("usgs-import", "running", 1, "kh-4a-corona-1966")
    assert job.lease == Lease("raster-pipeline-x7k2m/0", Timestamp(1792004200))
    assert job.step("fetch").bytes == 734003200
    assert job.step("warp") == StepRecord("pending")
    assert params_of(job) == UsgsImportParams("DS1035-1057DA023", "corona2", "KH-4A")


@pytest.mark.parametrize(
    ("job_type", "params", "expected"),
    [
        (
            "geotiff-import",
            {"uploadPath": "uploads/rasters/a.tif", "replaces": True},
            GeotiffImportParams("uploads/rasters/a.tif", None, True),
        ),
        (
            "geotiff-import",
            {"uploadPath": "u.tif", "originalName": "Plan.tif", "replaces": False},
            GeotiffImportParams("u.tif", "Plan.tif", False),
        ),
        ("regeoref", {"basedOn": "v-1"}, RegeorefParams("v-1")),
        (
            "layer-join",
            {"parts": [{"versionId": "v-1", "layerId": "l-1"}, {"versionId": "v-2", "layerId": "l-2"}], "sensor": "KH-9-pan"},
            JoinParams((JoinPart("v-1", "l-1"), JoinPart("v-2", "l-2")), "KH-9-pan"),
        ),
        (
            "archive-series",
            {"archiveId": "ar-0123456789abcdef", "seriesId": "s-0123456789ab", "class": "grid", "sheets": 4, "order": 1},
            ArchiveSeriesParams("ar-0123456789abcdef", "s-0123456789ab"),
        ),
        (
            "archive-series",
            {
                "archiveId": "ar-0123456789abcdef",
                "seriesId": "s-0123456789ab",
                "class": "pieces",
                "sheets": 60,
                "order": 0,
                "restitch": True,
            },
            ArchiveSeriesParams("ar-0123456789abcdef", "s-0123456789ab"),
        ),
    ],
)
def test_happy_path_each_type_reads_its_own_params(job_type: str, params: dict[str, object], expected: object) -> None:
    assert params_of(Job("j", job_type, "starting", params, None, None)) == expected


@pytest.mark.parametrize(
    ("job_type", "params", "problem"),
    [
        ("usgs-import", {"entityId": "E1", "dataset": "corona2", "sensor": "KH-4A", "extra": 1}, "unknown keys: extra"),
        ("usgs-import", {"entityId": "../x", "dataset": "corona2", "sensor": "KH-4A"}, "entityId must be an id"),
        ("usgs-import", {"entityId": "E1", "dataset": "landsat", "sensor": "KH-4A"}, "dataset must be one of"),
        ("geotiff-import", {"uploadPath": "u.tif", "replaces": "yes"}, "replaces must be true or false"),
        ("geotiff-import", {"uploadPath": "u" * 501, "replaces": False}, "longer than 500"),
        ("regeoref", {"basedOn": ""}, "basedOn must be a non-empty text"),
        ("republish", {"versionId": "v"}, "does not run republish jobs"),
        ("layer-join", {"parts": [{"versionId": "v", "layerId": "l"}], "sensor": "KH-9-pan"}, "2 to 8 frames"),
        ("layer-join", {"parts": [{"versionId": "v", "layerId": "l"}] * 9, "sensor": "KH-9-pan"}, "2 to 8 frames"),
        ("layer-join", {"parts": "v", "sensor": "KH-9-pan"}, "2 to 8 frames"),
        ("layer-join", {"parts": [{"versionId": "v", "layerId": "../l"}] * 2, "sensor": "KH-9-pan"}, "layerId must be an id"),
        ("layer-join", {"parts": [{"versionId": "v", "layerId": "l", "x": 1}] * 2, "sensor": "KH-9-pan"}, "unknown keys: x"),
        ("layer-join", {"parts": ["v", "w"], "sensor": "KH-9-pan"}, "a part must be a record"),
        ("layer-join", {"parts": [{"versionId": "v", "layerId": "l"}] * 2, "sensor": "KH-6"}, "sensor must be one of"),
        ("archive-series", {"archiveId": "ar-1", "seriesId": "s-1", "sheetz": 1}, "unknown keys: sheetz"),
        ("archive-series", {"archiveId": "ar-1", "seriesId": "s-1", "restitch": True, "extra": 1}, "unknown keys: extra"),
        ("archive-series", {"archiveId": "../ar", "seriesId": "s-1"}, "archiveId must be an id"),
        ("regeoref", {"basedOn": "v-1", "restitch": True}, "unknown keys: restitch"),
    ],
)
def test_bad_path_malformed_params_are_refused(job_type: str, params: dict[str, object], problem: str) -> None:
    with pytest.raises(DocumentError, match=problem):
        params_of(Job("j", job_type, "starting", params, None, None))


def test_bad_path_a_type_this_image_does_not_run_is_an_outdated_pipeline_not_a_bad_job() -> None:
    """Scenarios: S-A12-HAPPY-RETRY-OUTDATED"""
    with pytest.raises(OutdatedJobError, match="does not run future-type jobs"):
        params_of(Job("j", "future-type", "starting", {}, None, None))
    assert "archive-series" in RUN_JOB_TYPES
    assert "republish" not in RUN_JOB_TYPES


def test_happy_path_timestamps_round_trip_epoch_seconds() -> None:
    stamp_at = Timestamp.at(1792000000.25)

    assert stamp_at == Timestamp(1792000000, 250_000_000)
    assert stamp_at.epoch() == 1792000000.25
    assert stamp_at.plus(0.75) == Timestamp(1792000001)
    assert contract_json([Timestamp(5), ("a", 1)]) == [{"seconds": 5, "nanoseconds": 0}, ["a", 1]]


def test_bad_path_readers_refuse_wrong_shapes() -> None:
    with pytest.raises(DocumentError, match="scan must be a record"):
        record_of([], "scan")
    with pytest.raises(DocumentError, match="must be a number"):
        number_of({"x": "1"}, "x")
    with pytest.raises(DocumentError, match="must be one of"):
        member_of({"state": "lost"}, "state", ("processing",))
    assert optional_text({}, "osmPath") is None
    assert text_of({"a": "b"}, "a") == "b"
    assert Lease.of({"owner": 3}) is None
    assert StepRecord.of({"status": "done", "bytes": "12"}).bytes is None
