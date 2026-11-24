"""Renamed streets retain their current name in the import."""

from hcm_pipeline import lost_streets as ls

from tests.unit.test_lost_streets import BOUNDS, way


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
