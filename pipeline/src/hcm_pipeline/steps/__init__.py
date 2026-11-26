"""Pipeline steps: the Step protocol, what a step returns, and the registry main dispatches to.

A step is short, idempotent and resumable (docs/research/PLAN.md, "Raster pipeline"): it skips work
whose recorded outputs already exist, and returns WAITING instead of polling when it depends on
something outside us (USGS preparing a download or in maintenance, Mapbox processing a tileset).
"""

import enum
import logging
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Protocol

from hcm_pipeline.config import Config
from hcm_pipeline.exit_codes import ExitCode


class Outcome(enum.Enum):
    DONE = "done"
    """The step's work is complete (or was already complete)."""
    WAITING = "waiting"
    """Blocked on USGS or the admin: the job state records why, and the scheduled imagery.tick resumes it."""


class StepError(Exception):
    """A failure the step understands; the run exits with `exit_code`."""

    def __init__(self, message: str, exit_code: ExitCode = ExitCode.FAILED) -> None:
        super().__init__(message)
        self.exit_code = exit_code


@dataclass(frozen=True)
class StepContext:
    """What a step runs with: its logger and, for steps that declare `requires_config`, the job configuration; the
    command line's options and the environment for a command that reads its own (`worker`, M7)."""

    log: logging.Logger
    config: Config | None = None
    options: Mapping[str, object] = field(default_factory=dict)
    env: Mapping[str, str] = field(default_factory=dict)

    def require_config(self) -> Config:
        if self.config is None:
            raise StepError("this step needs the job configuration (set requires_config)", ExitCode.CONFIG)
        return self.config


class Step(Protocol):
    """One pipeline step, run as `python -m hcm_pipeline <name>`.

    `requires_config` is True when the step needs the job environment: main then loads and validates
    it before `run`, and a missing variable fails the run with ExitCode.CONFIG.
    """

    @property
    def name(self) -> str: ...

    @property
    def requires_config(self) -> bool: ...

    def run(self, ctx: StepContext) -> Outcome: ...


class StepRegistry:
    """Steps by name, in registration order."""

    def __init__(self, steps: Iterable[Step] = ()) -> None:
        self._steps: dict[str, Step] = {}
        for step in steps:
            self.register(step)

    def register(self, step: Step) -> None:
        if step.name in self._steps:
            raise ValueError(f"step '{step.name}' is registered twice")
        self._steps[step.name] = step

    def names(self) -> tuple[str, ...]:
        return tuple(self._steps)

    def get(self, name: str) -> Step:
        """The step called `name`; KeyError when there is none (main only passes registered names)."""
        return self._steps[name]
