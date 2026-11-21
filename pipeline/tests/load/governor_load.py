"""The governor's load test (docs/research/M26-governor.md §8): does the person at the computer keep it while the worker works?

`python -m tests.load.governor_load <folder>` from `pipeline/` (inside the quality image, on the NUC: `nuc-test.sh`). Not a pytest test:
it takes about a minute and the whole of a machine's slot.

1. Baseline: the "user" alone for `PHASE_S`: two processes counting in a loop and a 10 ms timer, its lateness measured.
2. The worker (a process of its own, niced and governed as the product's) warps and compresses a synthetic raster in a loop, the host
   hints saying nobody is at the computer: the governor runs it full.
3. The user starts and the hints say input now: the governor must go quiet within one tick; the user's throughput over the phase, against
   the baseline, and the timer's lateness are measured, and the worker's threads and memory against its budget.

The report is JSON at `<folder>/governor-load.json`; the pass marks are `USER_SHARE_MIN`, `LATE_P99_MAX_MS` and `QUIET_WITHIN_S`.
"""

import json
import multiprocessing
import os
import sys
import threading
import time
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Final

import numpy
from hcm_pipeline.governor.actuate import Actuators, lower_priority
from hcm_pipeline.governor.budget import Budget
from hcm_pipeline.governor.governor import Governor
from hcm_pipeline.governor.probe import HINTS_FILE
from hcm_pipeline.governor.probe_linux import LinuxProbe
from hcm_pipeline.log import get_logger
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import WEB_MERCATOR, driver_of, srs_wkt

LOG = get_logger("governor.load")
PHASE_S: Final = 20.0
WARM_S: Final = 12.0
USER_PROCESSES: Final = 2
TIMER_S: Final = 0.010
SIDE_PX: Final = 3072
USER_SHARE_MIN: Final = 0.85
LATE_P99_MAX_MS: Final = 20.0
QUIET_WITHIN_S: Final = 5.0
PERCENTILE: Final = 99
MS: Final = 1000.0
REPORT: Final = "governor-load.json"
IDLE_LONG_S: Final = 600
KB: Final = 1024


def write_hints(folder: Path, idle_s: float) -> None:
    part = folder / f"{HINTS_FILE}.part"
    part.write_text(json.dumps({"at": time.time(), "idleS": idle_s}), encoding="utf-8")
    part.replace(folder / HINTS_FILE)


def _count(stop: Callable[[], bool], out: Path) -> None:
    """One user process: counts until stopped, then writes how far it got."""
    count = 0
    while not stop():
        count += sum(range(1000)) > 0
    out.write_text(str(count), encoding="utf-8")


def _counter(out: Path, until: float) -> None:
    _count(lambda: time.time() >= until, out)


def _late_ms(until: float) -> list[float]:
    """The timer's lateness, in ms, every `TIMER_S` until `until`."""
    late: list[float] = []
    while time.time() < until:
        asked = time.perf_counter()
        time.sleep(TIMER_S)
        late.append((time.perf_counter() - asked - TIMER_S) * MS)
    return late


def _started(outs: Sequence[Path], until: float) -> Sequence[multiprocessing.process.BaseProcess]:
    context = multiprocessing.get_context("spawn")
    processes = [context.Process(target=_counter, args=(out, until)) for out in outs]
    for process in processes:
        process.start()
    return processes


def user(folder: Path, seconds: float, tag: str) -> dict[str, float]:
    """The user's two busy processes and its timer, for `seconds`: counts per second and the timer's lateness."""
    until = time.time() + seconds
    outs = [folder / f"user-{tag}-{index}" for index in range(USER_PROCESSES)]
    processes = _started(outs, until)
    late = _late_ms(until)
    for process in processes:
        process.join()
    counts = sum(int(out.read_text(encoding="utf-8")) for out in outs)
    return {"rate": counts / seconds, "lateP99Ms": float(numpy.percentile(late, PERCENTILE)), "lateMaxMs": max(late)}


def _source() -> gdal.Dataset:
    data = (numpy.random.default_rng(0).random((SIDE_PX, SIDE_PX)) * 255).astype(numpy.uint8)
    source = driver_of("MEM").Create("", SIDE_PX, SIDE_PX, 1, gdal.GDT_Byte)
    source.SetGeoTransform((26.0, 0.3 / SIDE_PX, 0.0, 44.6, 0.0, -0.3 / SIDE_PX))
    source.SetProjection(srs_wkt(4326))
    source.GetRasterBand(1).WriteArray(data)
    return source


def _rss_mb() -> int:
    for line in Path("/proc/self/status").read_text(encoding="utf-8").splitlines():
        if line.startswith("VmRSS:"):
            return int(line.split()[1]) // KB
    return 0


def _governed(folder: Path, stop: threading.Event) -> Governor:
    lower_priority()
    governor = Governor(LinuxProbe(Path("/"), folder, time.time), folder, Actuators(gdal.SetConfigOption))
    governor.tick_s = 1.0
    threading.Thread(target=governor.run, args=(stop,), daemon=True).start()
    return governor


def _row(budget: Budget | None) -> dict[str, object]:
    """One pass of the worker: the budget in force (none for the control), its memory and its processor time."""
    said: dict[str, object] = {"profile": None, "threads": None, "memoryMb": None}
    if budget is not None:
        said = {"profile": budget.profile, "threads": budget.threads, "memoryMb": budget.memory_mb}
    return {"at": time.time(), **said, "rssMb": _rss_mb(), "cpuS": sum(os.times()[:2])}


def worker(folder: Path, seconds: float, governed: bool) -> None:
    """The worker's process: warping and compressing until `seconds` pass, one line of its state each pass; governed (lowered, its
    threads and cache from the budget) or, for the control, as before M26 (every core, normal priority)."""
    gdal.UseExceptions()
    gdal.SetConfigOption("GDAL_NUM_THREADS", "ALL_CPUS")
    stop = threading.Event()
    governor = _governed(folder, stop) if governed else None
    source, until, rows = _source(), time.time() + seconds, []
    while time.time() < until:
        warped = gdal.Warp("", source, format="MEM", dstSRS=f"EPSG:{WEB_MERCATOR}", multithread=True, resampleAlg="cubic")
        gdal.Translate(f"/vsimem/{os.getpid()}.tif", warped, creationOptions=["COMPRESS=DEFLATE", "NUM_THREADS=ALL_CPUS", "TILED=YES"])
        rows.append(_row(governor.budget if governor else None))
    stop.set()
    (folder / f"worker-{governed}.json").write_text(json.dumps(rows), encoding="utf-8")


def _quiet_after(rows: Sequence[dict[str, object]], started: float) -> float | None:
    for row in rows:
        at = row["at"]
        if isinstance(at, float) and at >= started and row["profile"] == "quiet":
            return at - started
    return None


def _worker_cores(rows: Sequence[dict[str, object]]) -> float | None:
    """The worker's processor time over these rows, in cores."""
    if len(rows) < 2:
        return None
    first, last = rows[0], rows[-1]
    cpu = float(str(last["cpuS"])) - float(str(first["cpuS"]))
    return round(cpu / max(1e-6, float(str(last["at"])) - float(str(first["at"]))), 2)


def main(arguments: Sequence[str]) -> int:
    folder = Path(arguments[0]).resolve()
    folder.mkdir(parents=True, exist_ok=True)
    write_hints(folder, IDLE_LONG_S)
    baseline = user(folder, PHASE_S, "alone")
    control, _rows, _started = _phase(folder, governed=False)
    loaded, rows, started = _phase(folder, governed=True)
    report = {
        **_report(baseline, loaded, rows, started),
        "ungoverned": control,
        "ungovernedShare": round(control["rate"] / baseline["rate"], 3),
    }
    (folder / REPORT).write_text(json.dumps(report, indent=2), encoding="utf-8")
    LOG.info("governor load test: %s", json.dumps(report))
    return 0 if report["passed"] else 1


def _phase(folder: Path, governed: bool) -> tuple[dict[str, float], list[dict[str, object]], float]:
    """The worker warmed up alone, then the user beside it with input hinted every second."""
    write_hints(folder, IDLE_LONG_S)
    process = multiprocessing.get_context("spawn").Process(target=worker, args=(folder, WARM_S + PHASE_S + 2, governed))
    process.start()
    time.sleep(WARM_S)
    started = time.time()
    keep = threading.Event()
    threading.Thread(target=_hint_active, args=(folder, keep), daemon=True).start()
    loaded = user(folder, PHASE_S, f"loaded-{governed}")
    keep.set()
    process.join()
    return loaded, json.loads((folder / f"worker-{governed}.json").read_text(encoding="utf-8")), started


def _hint_active(folder: Path, stop: threading.Event) -> None:
    while not stop.is_set():
        write_hints(folder, 0)
        stop.wait(1.0)


def _first(rows: Sequence[dict[str, object]], key: str) -> object:
    return rows[0][key] if rows else None


def _over_memory(rows: Sequence[dict[str, object]]) -> int:
    """Passes whose memory went above the budget's; a paused pass has a budget of 0 by design (its step waits holding its memory)."""
    return sum(1 for row in rows if isinstance(row["memoryMb"], int) and 0 < row["memoryMb"] < int(str(row["rssMb"])))


def _passed(share: float, loaded: dict[str, float], quiet_after: float | None, over_memory: int) -> bool:
    quiet_in_time = quiet_after is not None and quiet_after <= QUIET_WITHIN_S
    return share >= USER_SHARE_MIN and loaded["lateP99Ms"] < LATE_P99_MAX_MS and quiet_in_time and not over_memory


def _of(rows: Sequence[dict[str, object]], profile: str) -> list[dict[str, object]]:
    return [row for row in rows if row["profile"] == profile]


def _max_rss(rows: Sequence[dict[str, object]]) -> int:
    return max(int(str(row["rssMb"])) for row in rows)


def _report(baseline: dict[str, float], loaded: dict[str, float], rows: list[dict[str, object]], started: float) -> dict[str, object]:
    quiet_after = _quiet_after(rows, started)
    full, quiet = _of(rows, "full"), _of(rows, "quiet")
    share = loaded["rate"] / baseline["rate"]
    over_memory = _over_memory(rows)
    return {
        "cores": os.cpu_count(),
        "baseline": baseline,
        "loaded": loaded,
        "userShare": round(share, 3),
        "quietAfterS": quiet_after,
        "warpsFull": len(full),
        "warpsQuiet": len(quiet),
        "threads": {"full": _first(full, "threads"), "quiet": _first(quiet, "threads")},
        "workerCores": {"full": _worker_cores(full), "quiet": _worker_cores(quiet)},
        "maxRssMb": _max_rss(rows),
        "overMemory": over_memory,
        "passed": _passed(share, loaded, quiet_after, over_memory),
    }


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
