#!/usr/bin/env python3
"""How much runs at once, from the memory that is free as well as the cores (the owner, 2026-11-12: ESLint on four workers took
12 GB on a 31 GB laptop and the desktop ran out of memory).

    python3 scripts/ci/parallel.py <lint|gates|vitest|playwright>      prints one number

| kind | default | what it sets |
| --- | --- | --- |
| `lint` | one ESLint group per 2 CPUs and per 4 GiB available | how many of `scripts/ci/lint.sh`'s groups run at once |
| `gates` | the CPUs, one per 2 GiB available | how many gates of a stage run at once (`PIPELINE_JOBS` still wins) |
| `vitest` | the CPUs, one per 2 GiB available | `VITEST_MAX_WORKERS` |
| `playwright` | half the CPUs, one per 2 GiB available | `HCM_E2E_WORKERS` (`e2e/playwright.config.ts`) |

Always at least one. `HCM_MAX_PARALLEL=<n>` caps every kind; `HCM_LOW_MEM=1` is the low-memory mode (gates one at a time, one lint
group, two Vitest and two Playwright workers); `HCM_LINT_WORKERS=<n>` sets the lint groups outright. No gate is dropped or relaxed:
only how many things run side by side changes. `/proc/meminfo` inside a container is the host's, so the available memory is also
capped by the container's own limit (cgroup v2 `memory.max` less `memory.current`): a run under `q.sh`'s 8 GB cap counts 8 GB at
most, not the host's free memory.

ESLint measured on the NUC (16 threads, the container's `memory.peak`, 2026-11-12): the whole tree in one process held all 21
TypeScript programs (typescript-eslint's `projectService`): one worker 181 to 228 s and 8.6 to 8.8 GB, two 14.2 GB, four 17.8 GB.
`scripts/ci/lint.sh` now runs one process per group of projects; the largest group peaks at 2.9 GB, hence 4 GiB a group.
"""

import os
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from cilog import get_logger

LOG = get_logger("parallel")
MEMINFO = Path("/proc/meminfo")
CGROUP = Path("/sys/fs/cgroup")
KIB_PER_GIB = 1024 * 1024
MAX_VARIABLE = "HCM_MAX_PARALLEL"
LOW_VARIABLE = "HCM_LOW_MEM"
LINT_VARIABLE = "HCM_LINT_WORKERS"
EXIT_USAGE = 2


@dataclass(frozen=True)
class Kind:
    """One thing that runs in parallel: the CPUs one of them takes, the GiB it needs, its count in the low-memory mode."""

    cpus_each: int
    gib_each: int
    low: int


KINDS: Mapping[str, Kind] = {
    "lint": Kind(cpus_each=2, gib_each=4, low=1),
    "gates": Kind(cpus_each=1, gib_each=2, low=1),
    "vitest": Kind(cpus_each=1, gib_each=2, low=2),
    "playwright": Kind(cpus_each=2, gib_each=2, low=2),
}
# The variable each kind's count is handed to the tools in (the gates' count stays inside the pipeline).
VARIABLES: Mapping[str, str] = {"lint": LINT_VARIABLE, "vitest": "VITEST_MAX_WORKERS", "playwright": "HCM_E2E_WORKERS"}


@dataclass(frozen=True)
class Machine:
    cpus: int
    available_gib: int | None


def available_gib(meminfo: Path = MEMINFO) -> int | None:
    """`MemAvailable` in whole GiB; None where the file or the line is missing (then only the cores count)."""
    try:
        lines = meminfo.read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    kib = _positive(next((" ".join(line.split()[1:2]) for line in lines if line.startswith("MemAvailable:")), None))
    return None if kib is None else kib // KIB_PER_GIB


def _read_int(path: Path) -> int | None:
    try:
        text = path.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return int(text) if text.isdecimal() else None


def cgroup_spare_gib(cgroup: Path = CGROUP) -> int | None:
    """What this container may still take under its own memory limit, in whole GiB; None without a limit (`max`) or cgroup v2."""
    limit = _read_int(cgroup / "memory.max")
    used = _read_int(cgroup / "memory.current")
    if limit is None or used is None:
        return None
    return max(0, limit - used) // (KIB_PER_GIB * 1024)


def _smaller(first: int | None, second: int | None) -> int | None:
    known = [value for value in (first, second) if value is not None]
    return min(known) if known else None


def this_machine() -> Machine:
    return Machine(os.process_cpu_count() or 1, _smaller(available_gib(), cgroup_spare_gib(CGROUP)))


def _positive(value: str | None) -> int | None:
    text = (value or "").strip()
    return int(text) if text.isdecimal() and int(text) > 0 else None


def _by_machine(kind: Kind, machine: Machine) -> int:
    by_cpus = machine.cpus // kind.cpus_each
    if machine.available_gib is None:
        return max(1, by_cpus)
    return max(1, min(by_cpus, machine.available_gib // kind.gib_each))


def workers(name: str, environ: Mapping[str, str], machine: Machine) -> int:
    """How many of `name` run at once on `machine` under `environ`'s overrides."""
    kind = KINDS[name]
    asked = _positive(environ.get(LINT_VARIABLE)) if name == "lint" else None
    if asked is not None:
        return asked
    count = kind.low if environ.get(LOW_VARIABLE, "").strip() == "1" else _by_machine(kind, machine)
    return max(1, min(count, _positive(environ.get(MAX_VARIABLE)) or count))


def tool_variables(environ: Mapping[str, str], machine: Machine) -> dict[str, str]:
    """The variables the tools read, for those `environ` does not already set."""
    return {variable: str(workers(name, environ, machine)) for name, variable in VARIABLES.items() if not environ.get(variable)}


def main(argv: Sequence[str] | None = None) -> int:
    names = list(sys.argv[1:] if argv is None else argv)
    if len(names) != 1 or names[0] not in KINDS:
        LOG.error("usage: parallel.py <%s>", "|".join(KINDS))
        return EXIT_USAGE
    LOG.info("%d", workers(names[0], os.environ, this_machine()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
