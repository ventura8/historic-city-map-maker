"""Unit tests for Landsat step routing (hcm_pipeline.landsat.route)."""

from dataclasses import dataclass, field
from typing import cast

import pytest
from hcm_pipeline.contract import LANDSAT_DATASETS
from hcm_pipeline.jobs import Done, JobContext, Skipped, StepResult
from hcm_pipeline.landsat.route import AlreadyGeoreferenced, ForLandsat, is_landsat
from hcm_pipeline.model import Job


def make_job(dataset: str | None = "landsat_tm_c2_l1", job_type: str = "usgs-import") -> Job:
    """A minimal job record with an optional dataset parameter."""
    params: dict[str, object] = {"entityId": "LT51830291989193MTI00", "sensor": "L5-TM"}
    if dataset is not None:
        params["dataset"] = dataset
    return Job("job-1", job_type, "running", params, None, None)


@dataclass
class Context:
    """The subset of JobContext fields read by routing and step selection."""

    job: Job
    step: str = ""


@dataclass
class NamedStep:
    """A scripted test step recording which job datasets ran through it."""

    name: str
    ran: list[str] = field(default_factory=list)

    def run(self, ctx: JobContext) -> StepResult:
        self.ran.append(str(ctx.job.params.get("dataset", "")))
        return Done()


@pytest.mark.parametrize("dataset", LANDSAT_DATASETS)
def test_happy_path_is_landsat_returns_true_for_landsat_datasets(dataset: str) -> None:
    assert is_landsat(make_job(dataset)) is True


@pytest.mark.parametrize(
    ("dataset", "job_type"),
    [
        ("corona2", "usgs-import"),
        ("declassii", "usgs-import"),
        ("unknown_dataset", "usgs-import"),
        (None, "usgs-import"),
        ("landsat_tm_c2_l1", "regeoref"),
        ("landsat_etm_c2_l1", "manual-align"),
    ],
)
def test_bad_path_is_landsat_returns_false_for_non_landsat_or_other_types(dataset: str | None, job_type: str) -> None:
    assert is_landsat(make_job(dataset=dataset, job_type=job_type)) is False


def test_happy_path_already_georeferenced_skips_using_context_step_name() -> None:
    step = AlreadyGeoreferenced("stitch")
    ctx = cast("JobContext", Context(make_job(), step="locate"))

    result = step.run(ctx)

    assert step.name == "stitch"
    assert isinstance(result, Skipped)
    assert result.reason == "a Landsat scene is already georeferenced: no locate"


def test_bad_path_already_georeferenced_falls_back_to_its_name_when_step_is_empty() -> None:
    step = AlreadyGeoreferenced("stitch")
    ctx = cast("JobContext", Context(make_job(), step=""))

    result = step.run(ctx)

    assert isinstance(result, Skipped)
    assert result.reason == "a Landsat scene is already georeferenced: no stitch"


def test_happy_path_for_landsat_routes_to_landsat_step_and_preserves_other_name() -> None:
    other, landsat = NamedStep("extract"), NamedStep("landsat-extract")
    step = ForLandsat(other, landsat)
    ctx = cast("JobContext", Context(make_job("landsat_tm_c2_l1")))

    result = step.run(ctx)

    assert step.name == "extract"
    assert isinstance(result, Done)
    assert landsat.ran == ["landsat_tm_c2_l1"]
    assert other.ran == []


def test_bad_path_for_landsat_routes_to_other_step_for_non_landsat_job() -> None:
    other, landsat = NamedStep("extract"), NamedStep("landsat-extract")
    step = ForLandsat(other, landsat)
    ctx_corona = cast("JobContext", Context(make_job("corona2")))
    ctx_regeoref = cast("JobContext", Context(make_job("landsat_tm_c2_l1", job_type="regeoref")))

    result_corona = step.run(ctx_corona)
    result_regeoref = step.run(ctx_regeoref)

    assert isinstance(result_corona, Done)
    assert isinstance(result_regeoref, Done)
    assert landsat.ran == []
    assert other.ran == ["corona2", "landsat_tm_c2_l1"]
