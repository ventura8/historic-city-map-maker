"""`register`: the version awaits approval (docs/research/M3-interfaces.md §5.3).

The version's `output` (written by `export`) is checked, its `state` becomes `awaiting_approval`, and the job's
scratch objects (`work/{city}/{job}/`) are deleted; the runner then moves the job to `awaiting_approval`
(`waitReason: 'approval'`) and releases the lease. `imagery.onJobWrite` (functions) applies the approval policy:
published on its own under the city's RMSE threshold, else the approval card.
"""

from hcm_pipeline import paths
from hcm_pipeline.contract import Errors
from hcm_pipeline.jobs import Done, JobContext, StepFailedError, StepResult


class RegisterStep:
    name = "register"

    def run(self, ctx: JobContext) -> StepResult:
        record = ctx.read(ctx.version_path()) or {}
        if not isinstance(record.get("output"), dict):
            raise StepFailedError(Errors.PROCESSING_FAILED, "the version has no exported output")
        ctx.update_version({"state": "awaiting_approval"})
        objects = ctx.services.objects
        for info in objects.list(paths.work_prefix(ctx.city, ctx.job.id)):
            objects.delete(info.path)
        return Done()
