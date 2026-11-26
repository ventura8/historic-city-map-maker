"""`python -m hcm_pipeline run` (the job's remaining steps) and `python -m hcm_pipeline <step>` (one, debugging).

The command builds the real adapters (`services.build`), runs the job (`runner.JobRunner`) and turns its ending into
the process's exit status: 0 when the job is done, waits, was cancelled, was requeued or was not this execution's
to run; 1 when it failed (an invalid job included: Cloud Run's own retries are off, the dispatcher decides).
"""

from collections.abc import Callable, Mapping

from hcm_pipeline.config import Config
from hcm_pipeline.exit_codes import ExitCode
from hcm_pipeline.jobs import Services
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import configure_gdal
from hcm_pipeline.runner import JobRunner, JobStep, RunOutcome
from hcm_pipeline.steps import Outcome, StepContext, StepError

ServicesFactory = Callable[[Config], Services]
StepsFactory = Callable[[], Mapping[str, JobStep]]

_OUTCOMES = {
    RunOutcome.DONE: Outcome.DONE,
    RunOutcome.WAITING: Outcome.WAITING,
    RunOutcome.CANCELLED: Outcome.DONE,
    RunOutcome.REQUEUED: Outcome.WAITING,
    RunOutcome.UNTOUCHED: Outcome.DONE,
}


class RunCommand:
    """A command line step that runs the job (all its remaining steps, or `only` one)."""

    requires_config = True

    def __init__(self, name: str, services: ServicesFactory, steps: StepsFactory, only: str | None = None) -> None:
        self.name = name
        self._services = services
        self._steps = steps
        self._only = only

    def run(self, ctx: StepContext) -> Outcome:
        config = ctx.require_config()
        configure_gdal()
        gdal.UseExceptions()
        outcome = JobRunner(config, self._services(config), self._steps()).run(self._only)
        if outcome is RunOutcome.FAILED:
            raise StepError(f"job {config.job_id} failed", ExitCode.FAILED)
        return _OUTCOMES[outcome]
