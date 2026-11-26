"""Renamed streets retain their current name in the import."""

import json
from pathlib import Path

from hcm_pipeline import lost_streets as ls

from tests.unit.test_lost_streets import BOUNDS, fake, way


def test_renamed_street_classifies_into_renamed_category_with_current_name() -> None:
    renamed_way = way(14, "Podul Mogoșoaiei", [(26.0, 44.4), (26.01, 44.41)], end_date="1878", current_name="Calea Victoriei")
    street = ls.street_of(ls.OHM, renamed_way)
    assert street is not None
    assert street.current_name == "Calea Victoriei"
    assert ls.category_of(street) == ls.RENAMED_CATEGORY
    feature = ls.feature_of(street, BOUNDS)
    assert feature is not None
    properties = feature["properties"]
    assert isinstance(properties, dict)
    assert properties["category"] == ls.RENAMED_CATEGORY
    assert properties["title"] == {"ro": "Podul Mogoșoaiei", "en": "Podul Mogoșoaiei"}
    assert properties["currentName"] == {"ro": "Calea Victoriei", "en": "Calea Victoriei"}


def test_same_current_name_does_not_mark_a_street_renamed() -> None:
    same_name = ls.street_of(ls.OHM, way(15, "Calea Victoriei", [(26.0, 44.4), (26.01, 44.41)], current_name="Calea Victoriei"))
    assert same_name is not None
    assert same_name.current_name is None
    assert ls.category_of(same_name) == ls.CATEGORY


def test_existing_city_category_is_used_for_disappeared_streets() -> None:
    manifest = {"poiCategories": [{"id": "old-roads", "label": {"en": "Disappeared streets"}}]}
    assert ls.disappeared_category_of(manifest) == "old-roads"
    street = ls.street_of(ls.OHM, way(16, "Old street", [(26.0, 44.4), (26.01, 44.41)]))
    assert street is not None
    feature = ls.feature_of(street, BOUNDS, ls.disappeared_category_of(manifest))
    assert feature is not None
    properties = feature["properties"]
    assert isinstance(properties, dict)
    assert properties["category"] == "old-roads"
    assert ls.category_of(ls.Street(ls.OHM, "1", "Old", street.line, current_name="New"), "old-roads") == ls.RENAMED_CATEGORY


def test_category_fallbacks() -> None:
    assert ls.disappeared_category_of({"poiCategories": [{"id": "strazi-disparute"}]}) == "strazi-disparute"
    assert ls.disappeared_category_of({"pois": [{"id": "ls-ohm-1", "category": "historic-roads"}]}) == "historic-roads"
    assert ls.disappeared_category_of({"pois": [{"id": "ls-ohm-1", "category": "renamed-streets"}]}) == ls.CATEGORY
    assert ls.disappeared_category_of({}) == ls.CATEGORY


def test_main_reads_city_manifest_and_writes_its_category(tmp_path: Path) -> None:
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"poiCategories": [{"id": "strazi-disparute"}]}), encoding="utf-8")
    out = tmp_path / "streets.json"
    streets = [way(16, "Old street", [(26.0, 44.4), (26.01, 44.41)])]
    args = ["--bounds", "25.93,44.33,26.25,44.55", "--out", str(out), "--city-manifest", str(manifest)]
    assert ls.main(args, fake(streets, [])) == 0
    result = json.loads(out.read_text(encoding="utf-8"))
    assert result["features"][0]["properties"]["category"] == "strazi-disparute"
    manifest.write_text("not json", encoding="utf-8")
    assert ls.main(args, fake(streets, [])) == 2
