"""Which steps a Landsat scene takes (docs/research/M25-landsat.md §3): its own `extract` and `warp`, no `stitch`, `locate` or `georef`.

`ForLandsat` puts a Landsat step in a declassified step's place under the same name, chosen by the job's dataset, so the job types, their
steps and the dispatcher stay as they are; `AlreadyGeoreferenced` skips a step a georeferenced product never needs.
"""

from dataclasses import dataclass

from hcm_pipeline.contract import LANDSAT_DATASETS
from hcm_pipeline.jobs import JobContext, Skipped, StepResult
from hcm_pipeline.model import Job
from hcm_pipeline.runner import JobStep


def is_landsat(job: Job) -> bool:
    """True for a `usgs-import` of a Landsat scene (its dataset says so)."""
    return job.type == "usgs-import" and job.params.get("dataset") in LANDSAT_DATASETS


@dataclass(frozen=True)
class AlreadyGeoreferenced:
    """A step a Landsat scene skips: its product is on the ground already."""

    name: str

    def run(self, ctx: JobContext) -> StepResult:
        return Skipped(f"a Landsat scene is already georeferenced: no {ctx.step or self.name}")


class ForLandsat:
    """`landsat` for a Landsat scene's job, `other` for every other job, under `other`'s name."""

    def __init__(self, other: JobStep, landsat: JobStep) -> None:
        self._other = other
        self._landsat = landsat

    @property
    def name(self) -> str:
        return self._other.name

    def run(self, ctx: JobContext) -> StepResult:
        return (self._landsat if is_landsat(ctx.job) else self._other).run(ctx)
