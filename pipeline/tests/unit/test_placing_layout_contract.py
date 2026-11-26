"""`layout.json` and `help.stitched.layout` as the pipeline really writes them, for the wizard's schemas (M20 §19.7).

The adversarial review of 2026-11-13: the shared schemas (`layoutFileSchema`, `stitchLayoutSchema` of @hcm/shared) were tried only on a
hand-written sample, so a field the pipeline writes differently went unnoticed. Here a synthetic series with every case the wizard
reads (a sheet left out as foreign, a strong seam, weak and missing seams with their strips and suggestions) is laid out, and its two
records must have the **shape** (every field path with its JSON type, list items merged) of `contracts/layout.json`, whose documents
`packages/shared/test/schemas/pipeline-contract.test.ts` parses. A writer that adds or changes a field fails here until the file is
written again:

    HCM_WRITE_CONTRACTS=1 python -m pytest -c pipeline/pyproject.toml --rootdir . pipeline/tests/unit/test_placing_layout_contract.py

then `npx prettier --write pipeline/tests/contracts/layout.json`.
"""

import json
import os
from pathlib import Path
from typing import Final

import numpy
from hcm_pipeline.archive import model
from hcm_pipeline.placing import autostitch, layout_files

from tests.contracts_loader import CONTRACTS, golden, record, records
from tests.synthetic.sheets import SheetsSpec, make_series
from tests.synthetic.town import write_map

GOLDEN: Final = "layout.json"
# The series: 2 x 3 named sheets, one foreign sheet, and the last real sheet's picture replaced by noise (its seams are missing).
SPEC: Final = SheetsSpec(rows=2, cols=3, overlap=0.06, names="rc", foreign=1, shuffle=False)


def _kind(value: object) -> str:
    return "boolean" if isinstance(value, bool) else "number" if isinstance(value, int | float) else type(value).__name__


def _children(value: object, prefix: str) -> list[tuple[object, str]]:
    if isinstance(value, dict):
        return [(item, f"{prefix}.{key}") for key, item in value.items()]
    return [(item, f"{prefix}[]") for item in value] if isinstance(value, list) else []


def _paths(value: object, prefix: str = "") -> set[str]:
    """Every field path of a JSON value with its type, list items merged (`[]`)."""
    if not isinstance(value, dict | list):
        return {f"{prefix}:{_kind(value)}"}
    return set().union(*(_paths(item, path) for item, path in _children(value, prefix)))


def _written(tmp_path: Path) -> dict[str, object]:
    series = make_series(tmp_path, SPEC)
    noisy = series.named[SPEC.rows * SPEC.cols - 1][1]
    write_map(noisy, numpy.asarray(numpy.random.default_rng(9).integers(0, 256, (360, 480, 3)), numpy.uint8), grey=True)
    proposal = autostitch.propose(series.named)
    return {"layout": layout_files.layout_record(proposal, 1), "summary": layout_files.summary(proposal, 1)}


def test_happy_path_the_written_layout_has_the_shape_the_wizard_parses(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-STITCH-NAMES"""
    written = json.loads(json.dumps(_written(tmp_path)))
    if os.environ.get("HCM_WRITE_CONTRACTS") == "1":
        (CONTRACTS / GOLDEN).write_text(json.dumps(written, indent=4) + "\n", encoding="utf-8")

    assert _paths(written) == _paths(golden(GOLDEN))
    layout = record(written["layout"])
    seams = records(layout["seams"])
    assert {seam["state"] for seam in seams} >= {"strong", "missing"}
    assert any("strip" in seam for seam in seams if seam["state"] == "missing")
    assert {sheet.get("out") for sheet in records(layout["sheets"])} >= {None, "no-join"}
    assert len(records(layout["sheets"])) <= model.LAYOUT_SHEETS_MAX
    assert len(seams) <= model.LAYOUT_SEAMS_MAX
