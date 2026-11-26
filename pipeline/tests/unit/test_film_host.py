"""The films a worker holds, named in every claim (live report of 2026-11-13). Scenarios: S-P20-HAPPY-FILM-HOST"""

import os
from pathlib import Path

from hcm_pipeline.worker.local_store import held_films


def test_happy_path_the_jobs_with_a_stitched_film_are_named_newest_first(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-FILM-HOST"""
    for job, written in (("job-old", 100), ("job-new", 200)):
        frame = tmp_path / "work" / "bucharest" / job / "frame.json"
        frame.parent.mkdir(parents=True)
        frame.write_text("{}", encoding="utf-8")
        os.utime(frame, (written, written))
    (tmp_path / "work" / "bucharest" / "job-none").mkdir()
    (tmp_path / "work" / "bucharest" / "job-dir" / "frame.json").mkdir(parents=True)

    assert held_films(tmp_path, "bucharest") == ["job-new", "job-old"]
    assert held_films(tmp_path, "bacau") == []
