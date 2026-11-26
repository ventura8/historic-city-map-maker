"""Command line of the Cloud Run Job: `python -m hcm_pipeline <step>` (or `--list`); on the owner's computer
`python -m hcm_pipeline worker --city <id> --project <id> [--pair <code>] [--supervised --image <digest>] [--port 8765]
[--work /work] [--emulators]` (M7, the local worker: `docs/research/M7-local-worker.md` §1, §1.5).

Configures redacted JSON logging, loads and validates the job configuration from the environment
when the step needs it, runs the step from the registry and returns an ExitCode: OK when the step
is done or WAITING on USGS or Mapbox, FAILED when it failed (Cloud Run may retry), USAGE for a bad
command line and CONFIG for an incomplete environment (a retry cannot help).
"""

import argparse
import logging
import os
from collections.abc import Mapping, Sequence
from types import MappingProxyType
from typing import NoReturn, TextIO

from hcm_pipeline.config import ConfigError, load_config
from hcm_pipeline.contract import PIPELINE_STEPS
from hcm_pipeline.exit_codes import ExitCode
from hcm_pipeline.log import configure
from hcm_pipeline.services import build, default_steps
from hcm_pipeline.steps import Step, StepContext, StepError, StepRegistry
from hcm_pipeline.steps.doctor import DoctorStep
from hcm_pipeline.steps.run import RunCommand
from hcm_pipeline.worker.command import WorkerCommand

NO_OPTIONS: Mapping[str, object] = MappingProxyType({})


class UsageError(Exception):
    """The command line names no step, or one that does not exist."""


class _Parser(argparse.ArgumentParser):
    """argparse that raises UsageError instead of printing and exiting, so main() returns the exit code."""

    def error(self, message: str) -> NoReturn:
        raise UsageError(message)


def default_registry() -> StepRegistry:
    """`doctor`, `run`, one debugging command per pipeline step, and `worker` (M7)."""
    commands = [RunCommand("run", build, default_steps), *(RunCommand(step, build, default_steps, step) for step in PIPELINE_STEPS)]
    return StepRegistry((DoctorStep(), *commands, WorkerCommand()))


def parse_args(argv: Sequence[str] | None, registry: StepRegistry) -> argparse.Namespace:
    parser = _Parser(prog="python -m hcm_pipeline", description="Run one step of the Historic City Map raster pipeline.")
    parser.add_argument("step", nargs="?", choices=registry.names(), help="the step to run")
    parser.add_argument("--list", action="store_true", help="log the registered steps and exit")
    worker = parser.add_argument_group("worker", "the local worker (M7): `worker --city <id> --project <id>`")
    worker.add_argument("--city", help="the city whose jobs the worker runs")
    worker.add_argument("--project", help="the Google Cloud project id")
    worker.add_argument("--port", type=int, help="the local page's port (default 8765)")
    worker.add_argument("--work", help="the work folder: the delivery, the scratch and the reference cache (default /work)")
    worker.add_argument("--emulators", action="store_true", help="talk to the Firebase emulators on this machine")
    worker.add_argument("--pair", help="the one-time pairing code of the admin's command (finding 67)")
    worker.add_argument("--supervised", action="store_true", help="run under the starter's supervisor: an outdated image exits 75")
    worker.add_argument("--image", help="the pipeline image's digest the supervisor runs (sha256:<digest>)")
    return parser.parse_args(argv)


def _options(args: argparse.Namespace) -> dict[str, object]:
    """The options a command reads itself (the worker's), without the dispatcher's own."""
    return {key: value for key, value in vars(args).items() if key not in ("step", "list")}


def run_step(step: Step, env: Mapping[str, str], log: logging.Logger, options: Mapping[str, object] = NO_OPTIONS) -> int:
    """Runs one step with its context; every failure becomes a logged exit code, never a traceback on stderr."""
    try:
        config = load_config(env) if step.requires_config else None
        ctx = StepContext(log=log.getChild(step.name), config=config, options=options, env=env)
        outcome = step.run(ctx)
    except ConfigError as error:
        log.error("step %s cannot start: %s", step.name, error)
        return ExitCode.CONFIG
    except StepError as error:
        log.error("step %s failed: %s", step.name, error)
        return error.exit_code
    except Exception:
        log.exception("step %s crashed", step.name)
        return ExitCode.FAILED
    log.info("step %s %s", step.name, outcome.value)
    return ExitCode.OK


def _dispatch(args: argparse.Namespace, registry: StepRegistry, env: Mapping[str, str], log: logging.Logger) -> int:
    if args.list:
        log.info("steps: %s", ", ".join(registry.names()))
        return ExitCode.OK
    if args.step is None:
        raise UsageError("name the step to run")
    return run_step(registry.get(args.step), env, log, _options(args))


def main(
    argv: Sequence[str] | None = None,
    env: Mapping[str, str] | None = None,
    registry: StepRegistry | None = None,
    stream: TextIO | None = None,
) -> int:
    """The process entry point: arguments default to sys.argv and os.environ, logs go to stderr."""
    log = configure(stream)
    steps = registry or default_registry()
    try:
        return _dispatch(parse_args(argv, steps), steps, os.environ if env is None else env, log)
    except UsageError as error:
        log.error("usage: %s (steps: %s)", error, ", ".join(steps.names()))
        return ExitCode.USAGE
