"""What the worker's folder keeps and what it lets go (the owner, 2026-11-14: "workers must not leave behind temp or
unnecessary data"; docs/research/M7-local-worker.md *Disk: what the worker keeps*).

A job's scratch (`work/<city>/<job>`) goes once its job is finished for good, as the server says (`worker.claim`'s
`jobStates` for the folders this computer named in `held`): `succeeded`, `failed`, `cancelled`, or `gone` (no such job any
more), after `FINISHED_GRACE_HOURS` without a write, or at once when the owner pressed Free space now or the disk is under
its floor. A job the server still lists in any other state (queued, running, awaiting points or approval: its stitched film
is there) is never deleted, however old; a folder the server said nothing about yet ages out after `WORK_DAYS` as before
(the film-host rule of the server assumes the same days). The claimed job's folder is never touched. A raw USGS delivery
goes when `locate` crops its frame (`steps/locate.py`), else after `DELIVERY_DAYS`; leftover `*.tmp` and `*.part` files of
an interrupted write go after `TEMP_MAX_AGE_SECONDS` (the live ones are written to every few seconds).
"""

import os
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

HOUR_SECONDS: Final = 60 * 60
DAY_SECONDS: Final = 24 * HOUR_SECONDS
# `PRIVATE_BUCKET_LIFECYCLE` of @hcm/shared, for the same prefixes on this computer.
WORK_DAYS: Final = 14
DELIVERY_DAYS: Final = 7
FINISHED_GRACE_HOURS: Final = 48
TEMP_MAX_AGE_SECONDS: Final = HOUR_SECONDS
# Free space now (or a disk under its floor): an interrupted write's leftovers older than this go too.
TEMP_MAX_AGE_NOW_SECONDS: Final = 10 * 60
# The server's word on a job whose scratch may go: finished for good, or no such job any more.
FINISHED_STATES: Final = frozenset({"succeeded", "failed", "cancelled", "gone"})
SESSIONS: Final = ".sessions"


@dataclass(frozen=True)
class SweepRules:
    """One pass's rules: the claimed job's folder (`work/<city>/<job>`, kept), the server's states, and whether to free space now."""

    claimed: str | None = None
    states: Mapping[str, str] = field(default_factory=dict)
    now_mode: bool = False


def visible(name: str) -> bool:
    return not name.startswith(".")


def written_at(file: Path) -> float:
    return file.lstat().st_mtime if file.exists() else 0.0


def last_written(folder: Path) -> float:
    """When a file under `folder` was last written (an empty folder: the folder itself); hidden leftovers do not count."""
    files = (Path(parent, name) for parent, _folders, names in os.walk(folder) for name in filter(visible, names))
    return max((file.lstat().st_mtime for file in files), default=folder.lstat().st_mtime)


def _grace(state: str | None, rules: SweepRules) -> float | None:
    """How long a job folder stays unwritten before it goes; None: it stays (the server still needs it)."""
    if state is None:
        return WORK_DAYS * DAY_SECONDS
    if state not in FINISHED_STATES:
        return None
    return 0.0 if rules.now_mode else FINISHED_GRACE_HOURS * HOUR_SECONDS


def work_goes(root: Path, folder: Path, now: float, rules: SweepRules) -> bool:
    """True when the job folder `folder` (`work/<city>/<job>`) goes on this pass."""
    if not folder.is_dir() or folder == root / (rules.claimed or "").rstrip("/"):
        return False
    grace = _grace(rules.states.get(folder.name), rules)
    return grace is not None and last_written(folder) <= now - grace


def delivery_goes(folder: Path, now: float) -> bool:
    return folder.is_dir() and last_written(folder) < now - DELIVERY_DAYS * DAY_SECONDS


def _is_leftover(root: Path, file: Path) -> bool:
    """An interrupted write's file: a `.tmp`, or a `.part` that is not a resumable session's (those have their own days)."""
    return file.suffix == ".tmp" or (file.suffix == ".part" and file.parent != root / SESSIONS)


def leftovers(root: Path) -> Iterator[Path]:
    for parent, _folders, names in os.walk(root):
        yield from (candidate for candidate in (Path(parent, name) for name in names) if _is_leftover(root, candidate))


def held_jobs(root: Path, city_id: str, most: int) -> list[str]:
    """The jobs with a scratch folder here, the longest unwritten first (the likeliest finished), at most `most`."""
    folders = [folder for folder in (root / "work" / city_id).glob("*") if folder.is_dir() and visible(folder.name)]
    return [folder.name for folder in sorted(folders, key=written_at)[:most]]


def bytes_under(root: Path) -> int:
    """The bytes of every file under `root` (the worker's use of its disk)."""
    total = 0
    for parent, _folders, names in os.walk(root):
        for name in names:
            try:
                total += Path(parent, name).lstat().st_size
            except OSError:
                continue
    return total
