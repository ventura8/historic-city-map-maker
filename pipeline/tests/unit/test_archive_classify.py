"""Every file of an archive into exactly one series or one skip reason (docs/research/M20-import-local.md §2.3), and the report.

The rows are built here from the inventory's names and shapes (the Bucharest archive as a data fixture: names, sizes and kinds only).
"""

import hashlib
import json
from collections import Counter
from pathlib import Path

import pytest
from hcm_pipeline.archive import classify, encoding, report, rights, sidecar
from hcm_pipeline.archive.model import ARCHIVE_ISSUES_MAX, ARCHIVE_MAX_SERIES, FileRow, Probe, Series, Skip

G4 = Probe("tiff", 7008, 9933, 1, 1, "bilevel", "CCITTFAX4", 300.0)
GREY = Probe("jpeg", 4000, 3000, 1, 8, "grey", "JPEG", 200.0)
RGB = Probe("jpeg", 7846, 9828, 3, 8, "rgb", "JPEG", 300.0)
CONTEXT = report.Context(44.43, 2026, sidecar.Sidecar())


def row(path: str, found: Probe = G4, data: str | None = None, sidecars: tuple[str, ...] = ()) -> FileRow:
    digest = hashlib.sha256((data or path).encode()).hexdigest()
    return FileRow(path, 1000, digest, found, sidecars)


def quarters(folder: str, rows: range, suffix: str = "") -> list[FileRow]:
    return [row(f"{folder}/{r}/{r}{c}{q}{suffix}.tif") for r in rows for c in ("A'", "B'", "A") for q in (1, 2, 3, 4)]


def bucharest() -> list[FileRow]:
    plan = "Harti/Bucuresti actual 500 2000/Bucuresti actual 1_500"
    return [
        *quarters(plan, range(16, 19)),
        *quarters(plan, range(16, 18), "_62"),
        row(f"{plan}/16/16B'2_71.tif"),
        row(f"{plan}/17/17A1 bis.tif"),
        row(f"{plan}/17/17xx.tif"),
        row("Harti/1844-1846_Rudolf Arthur Borroczyn/11_Cuprins.jpg", GREY),
        row("Harti/1844-1846_Rudolf Arthur Borroczyn/1_Autor.jpg", GREY),
        *[row(f"Harti/1844-1846_Rudolf Arthur Borroczyn/{page}.jpg", GREY) for page in range(12, 17)],
        row("Harti/harta București 1939.jpg", RGB),
        row("Harti/1799_Bucharest_1b.jpg", Probe("jpeg", 500, 366, 3, 8, "rgb")),
        row("Harti/bucuresti 1847.jpg", RGB),
        row("Harti/copy/harta București 1939.jpg", RGB, data="Harti/harta București 1939.jpg"),
        row("Harti/Thumbs.db", Probe("ole2")),
        row("Harti/x/AUTOSAVE.VCF", Probe("ole2")),
        row("Harti/x/LL.TXT", Probe("unknown")),
        row("Harti/1969/plan.dwg", Probe("dwg")),
        row("Harti/ortho.tif", Probe("tiff", 1000, 1000, 1, 8, "grey", crs=True)),
        row("Harti/scan.tif", Probe("tiff", 1000, 1000, 1, 8, "grey"), sidecars=(".tfw",)),
        row("Harti/scan.tfw", Probe("unknown")),
        row("Harti/broken.jpg", Probe("jpeg", error="TimeoutExpired")),
        row("Harti/miorini 1923.pdf", Probe("pdf", pages=143)),
        row("__MACOSX/._x.tif", Probe("unknown")),
    ]


def test_happy_path_every_file_lands_in_exactly_one_series_or_one_skip() -> None:
    """Scenarios: S-P20-HAPPY-CLASSIFY"""
    rows = bucharest()

    found = classify.classify(rows)

    placed = [file.path for series in found.series for file in series.files] + [skip.path for skip in found.skips]
    assert sorted(placed) == sorted(file.path for file in rows)
    assert len(placed) == len(set(placed))


def by_class(found: classify.Found) -> dict[str, list[Series]]:
    grouped: dict[str, list[Series]] = {}
    for series in found.series:
        grouped.setdefault(series.series_class, []).append(series)
    return grouped


def test_happy_path_the_sheet_grid_its_edition_and_its_odd_names_are_found() -> None:
    """Scenarios: S-P20-HAPPY-GRID-NAMES"""
    grids = by_class(classify.classify(bucharest()))["grid"]

    base, edition, lone = sorted(grids, key=lambda series: series.edition or "")
    assert (base.title, len(base.files), base.scale, base.year) == ("Bucuresti actual 1 500", 3 * 12 + 2, 500, None)
    assert base.cells["Harti/Bucuresti actual 500 2000/Bucuresti actual 1_500/17/17A'3.tif"] == "17,0,3"
    assert base.cells["Harti/Bucuresti actual 500 2000/Bucuresti actual 1_500/17/17A1 bis.tif"] == "17,-1,1?"
    # A whole cell with words after it (no quarter) is read as its cell and listed as odd.
    assert base.cells["Harti/Bucuresti actual 500 2000/Bucuresti actual 1_500/17/17xx.tif"] == "17,-22,0?"
    assert (edition.edition, edition.year, len(edition.files)) == ("1962", 1962, 24)
    assert (lone.edition, len(lone.files)) == ("1971", 1)


def test_happy_path_an_atlas_keeps_its_maps_and_skips_its_titled_pages() -> None:
    found = classify.classify(bucharest())

    atlas = by_class(found)["atlas"]
    skips = {Path(skip.path).name: skip.reason for skip in found.skips}
    assert [len(series.files) for series in atlas] == [5, 1]
    assert atlas[0].cells["Harti/1844-1846_Rudolf Arthur Borroczyn/12.jpg"] == "12"
    assert (skips["11_Cuprins.jpg"], skips["1_Autor.jpg"]) == ("index-only", "not-a-map-page")


def test_bad_path_junk_duplicates_cad_and_unreadable_files_are_skipped_with_their_reason() -> None:
    """Scenarios: S-P20-BAD-DUPLICATE, S-P20-BAD-CAD"""
    found = classify.classify(bucharest())

    skips = {skip.path: (skip.reason, skip.of) for skip in found.skips}
    assert skips["Harti/copy/harta București 1939.jpg"] == ("duplicate-of", "Harti/harta București 1939.jpg")
    assert skips["Harti/1969/plan.dwg"] == ("needs-cad-export", None)
    assert skips["Harti/broken.jpg"] == ("unreadable", None)
    assert {
        skips[path][0] for path in ("Harti/Thumbs.db", "Harti/x/AUTOSAVE.VCF", "Harti/x/LL.TXT", "Harti/scan.tfw", "__MACOSX/._x.tif")
    } == {"not-a-map"}


def test_happy_path_georeferenced_files_and_single_maps_each_make_one_series() -> None:
    grouped = by_class(classify.classify(bucharest()))

    assert sorted(series.title for series in grouped["georeferenced"]) == ["ortho", "scan"]
    singles = {series.title: series for series in grouped["single"]}
    assert singles["harta București 1939"].year == 1939
    assert singles["1799 Bucharest 1b"].reason == "too-small"


def records(rows: list[FileRow], context: report.Context = CONTEXT) -> dict[str, dict[str, object]]:
    found = classify.classify(rows)
    made = report.report_of(found.series, found.skips, context)
    return {str(record["title"]): record for record in made.series}


def test_happy_path_a_scales_denominator_is_never_a_year() -> None:
    assert classify.year_in("Harti/Bucuresti actual 1_2000") is None
    assert classify.year_in("Harti/Bucuresti 1895-1899/1-10000") is None
    assert classify.year_in("Harti/plan cadastral 1911-1914") == 1911


def test_happy_path_the_report_orders_the_ladder_and_prefills_rights_encoding_and_zoom() -> None:
    """Scenarios: S-P20-HAPPY-REPORT"""
    found = classify.classify(bucharest())
    made = report.report_of(found.series, found.skips, CONTEXT)

    titles = [str(record["title"]) for record in made.series]
    assert titles[:2] == ["ortho", "scan"]
    # The grids solve the city's grid, dated newest first; an undated base edition after them until its owner dates it.
    assert titles[2:5] == ["Bucuresti actual 1 500 (1971)", "Bucuresti actual 1 500 (1962)", "Bucuresti actual 1 500"]
    plan = next(record for record in made.series if record["title"] == "Bucuresti actual 1 500")
    assert (plan["encoding"], plan["action"], plan["scaleDenominator"], plan["yearLabel"]) == ("lineart", "import", 500, "?")
    assert plan["rights"] == {"licence": "unknown", "state": "needs-confirmation", "year": "?", "note": rights.YEARLESS_NOTE}
    assert made.skipped["duplicate-of"] == 1
    assert all(not str(issue["path"]).startswith("/") for issue in made.issues)


def test_happy_path_the_owners_sidecar_states_what_detection_cannot() -> None:
    """Scenarios: S-P20-HAPPY-REPORT"""
    declared = sidecar.parse(
        json.dumps(
            {
                "series": [
                    {
                        "path": "Harti",
                        "sourceLabel": "Idei Urbane \u2013 DocuBucurești",
                        "sourceUrl": "https://ideiurbane.ro/docubucuresti-planuri-harti-si-alte-documente/",
                    },
                    {
                        "path": "Harti/Bucuresti actual 500 2000",
                        "licence": "permission",
                        "state": "clear",
                        "confirmedBy": "Idei Urbane \u2013 DocuBucurești (the owner, 2026-11-09)",
                        "originalLabel": "UAUIM \u201eIon Mincu\u201d",
                        "originalProbable": True,
                    },
                    {
                        "path": "Harti/Bucuresti actual 500 2000/Bucuresti actual 1_500",
                        "title": "Planul topografic 1:500",
                        "year": 1977,
                        "yearLabel": "1961\u20131977",
                        "maxzoom": 19,
                    },
                    {
                        "path": "Harti/harta București 1939.jpg",
                        "originalLabel": "muzeuldefotografie.ro",
                        "originalUrl": "https://muzeuldefotografie.ro/",
                    },
                    {"path": "Harti/b.jpg", "originalProbable": False},
                    {"path": "Harti/bucuresti 1847.jpg", "skip": "do-not-publish"},
                    {"path": "../x", "title": "refused"},
                    {"path": "Harti/a.jpg", "colour": "red"},
                ]
            }
        )
    )
    found = records(bucharest(), report.Context(44.43, 2026, declared))

    plan = found["Planul topografic 1:500"]
    assert (plan["year"], plan["yearLabel"]) == (1977, "1961\u20131977")
    assert plan["rights"] == {
        "licence": "permission",
        "state": "clear",
        "year": "1961\u20131977",
        "sourceLabel": "Idei Urbane \u2013 DocuBucurești",
        "sourceUrl": "https://ideiurbane.ro/docubucuresti-planuri-harti-si-alte-documente/",
        "confirmedBy": "Idei Urbane \u2013 DocuBucurești (the owner, 2026-11-09)",
        "original": {"label": "UAUIM \u201eIon Mincu\u201d", "probable": True},
    }
    # A public-domain map keeps the archive's credit from the root entry, and its own original.
    assert found["harta București 1939"]["rights"] == {
        "licence": "PD",
        "state": "needs-confirmation",
        "year": "1939",
        "note": rights.AUTHOR_NOTE,
        "sourceLabel": "Idei Urbane \u2013 DocuBucurești",
        "sourceUrl": "https://ideiurbane.ro/docubucuresti-planuri-harti-si-alte-documente/",
        "original": {"label": "muzeuldefotografie.ro", "url": "https://muzeuldefotografie.ro/"},
    }
    estimate = plan["estimate"]
    assert isinstance(estimate, dict)
    assert estimate["maxzoom"] <= 19
    assert (found["bucuresti 1847"]["action"], found["bucuresti 1847"]["reason"]) == ("skip", "do-not-publish")
    assert declared.refused == 3


@pytest.mark.parametrize("text", ["not json", "[]", '{"series": 3}'])
def test_bad_path_a_sidecar_that_is_not_one_is_ignored_and_counted(text: str) -> None:
    """Scenarios: S-P20-BAD-SIDECAR"""
    assert sidecar.parse(text) == sidecar.Sidecar(refused=1)


def test_bad_path_more_than_200_series_are_counted_never_sent(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-TOO-MANY-SERIES"""
    rows = [row(f"maps/{index:04d} plan.jpg", RGB) for index in range(ARCHIVE_MAX_SERIES + 5)]
    rows += [row(f"junk/{index}.txt", Probe("unknown")) for index in range(ARCHIVE_ISSUES_MAX)]
    found = classify.classify(rows)

    made = report.report_of(found.series, found.skips, CONTEXT)

    assert len(made.series) == ARCHIVE_MAX_SERIES
    assert made.skipped == {"not-a-map": ARCHIVE_ISSUES_MAX, "too-many-series": 5}
    assert len(made.issues) == ARCHIVE_ISSUES_MAX
    assert str(tmp_path) not in json.dumps([made.series, made.issues])


@pytest.mark.parametrize(
    ("year", "author", "mark", "expected"),
    [
        (1846, None, False, ("PD", "clear")),
        (1921, "C.N. Pantea", False, ("PD", "needs-confirmation")),
        (1939, None, False, ("PD", "needs-confirmation")),
        (1977, None, False, ("unknown", "needs-confirmation")),
        (None, None, False, ("unknown", "needs-confirmation")),
        (1847, "Radu Oltean", True, ("unknown", "do-not-publish")),
    ],
)
def test_happy_path_the_rights_rules_prefill_each_case(year: int | None, author: str | None, mark: bool, expected: tuple[str, str]) -> None:
    """Scenarios: S-P20-HAPPY-REPORT"""
    found = rights.preflag(year, author, 2026, copyright_mark=mark)

    assert (found.licence, found.state) == expected


def test_happy_path_a_1_500_plan_at_300_dpi_gets_zoom_19_under_the_2_gb_budget() -> None:
    gsd = encoding.ground_m_per_px(300, 500)
    assert gsd is not None

    whole = encoding.estimate(284e6, encoding.resolution_zoom(gsd, 44.43), "lineart", 4545, 44.43)

    assert encoding.resolution_zoom(gsd, 44.43) == 21
    assert whole.maxzoom == 19
    assert 0.5e9 < whole.tiles_bytes < 2e9
    assert encoding.ground_m_per_px(None, 500) is None


def test_happy_path_the_encoding_follows_the_scans_kind() -> None:
    assert encoding.encoding_of([G4, G4, GREY]) == "lineart"
    assert encoding.encoding_of([RGB, Probe("png", 10, 10, 1, 8, "palette")]) == "colour"
    assert encoding.encoding_of([GREY]) == "grey"
    assert encoding.encoding_of([]) == "grey"


def test_happy_path_a_series_id_is_stable_for_the_same_files() -> None:
    assert report.series_id("grid:quarter:a") == report.series_id("grid:quarter:a")
    assert report.series_id("grid:quarter:a").startswith("s-")
    assert len(report.series_id("x")) == 14
    assert Counter(Skip("a", "not-a-map").reason for _ in range(2)) == {"not-a-map": 2}


def test_bad_path_a_permission_nobody_granted_or_a_copyright_mark_never_publishes() -> None:
    """Scenarios: S-P20-BAD-SIDECAR"""
    declared = sidecar.parse(
        json.dumps(
            {
                "series": [
                    {"path": "Harti/Bucuresti actual 500 2000/Bucuresti actual 1_500", "licence": "permission", "state": "clear"},
                    {"path": "Harti/bucuresti 1847.jpg", "watermark": "copyright Radu Oltean", "state": "clear"},
                    {"path": "Harti/harta București 1939.jpg", "priority": "low"},
                ]
            }
        )
    )
    context = report.Context(44.43, 2026, declared)
    found = records(bucharest(), context)

    plan = found["Bucuresti actual 1 500"]
    plan_rights, oltean = plan["rights"], found["bucuresti 1847"]
    assert isinstance(plan_rights, dict)
    assert (plan_rights["licence"], plan_rights["state"], plan_rights["note"]) == ("unknown", "needs-confirmation", rights.PERMISSION_NOTE)
    oltean_rights = oltean["rights"]
    assert isinstance(oltean_rights, dict)
    assert (oltean["action"], oltean["reason"], oltean_rights["state"]) == ("skip", "do-not-publish", "do-not-publish")
    ordered = report.report_of(classify.classify(bucharest()).series, [], context).series
    assert ordered[-1]["title"] == "harta București 1939"
