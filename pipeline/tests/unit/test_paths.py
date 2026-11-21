"""Unit tests for the private bucket object path builders."""

import pytest
from hcm_pipeline import paths
from hcm_pipeline.paths import PathError


def test_happy_path_path_error_is_a_value_error() -> None:
    assert issubclass(PathError, ValueError)
    error = PathError("not a valid path segment: 'bad'")
    assert isinstance(error, ValueError)


def test_happy_path_upload_constructs_raster_upload_object_path() -> None:
    built = paths.upload("bucharest", "uid-owner", "up-plan1911", "Qx7mP2rT9w.tif")
    assert built == "uploads/rasters/bucharest/uid-owner/up-plan1911/Qx7mP2rT9w.tif"


def test_bad_path_upload_refuses_invalid_file_extension_or_traversal() -> None:
    with pytest.raises(PathError, match="not a valid path segment"):
        paths.upload("bucharest", "uid-owner", "up-plan1911", "plan.png")
    with pytest.raises(PathError, match="not a valid path segment"):
        paths.upload("Bucharest", "uid-owner", "up-plan1911", "Qx7mP2rT9w.tif")
    with pytest.raises(PathError, match="not a valid path segment"):
        paths.upload("bucharest", "uid-owner", "up-plan1911", "../escape.tif")


def test_happy_path_usgs_raw_constructs_delivery_path() -> None:
    built = paths.usgs_raw("corona2", "DS1035-1057DA023", "DS1035-1057DA023.tgz")
    assert built == "usgs-raw/corona2/DS1035-1057DA023/DS1035-1057DA023.tgz"


def test_bad_path_usgs_raw_refuses_unknown_dataset_or_traversal() -> None:
    with pytest.raises(PathError, match="not a valid path segment"):
        paths.usgs_raw("declass1", "DS1035-1057DA023", "DS1035-1057DA023.tgz")
    with pytest.raises(PathError, match="not a valid path segment"):
        paths.usgs_raw("corona2", "DS1035-1057DA023", "../DS1035.tgz")


def test_happy_path_browse_constructs_preview_image_path() -> None:
    built = paths.browse("declassiii", "D3C1213-200346A003")
    assert built == "usgs-browse/declassiii/D3C1213-200346A003.jpg"


def test_bad_path_browse_refuses_unknown_dataset_or_invalid_entity() -> None:
    with pytest.raises(PathError, match="not a valid path segment"):
        paths.browse("unknown-dataset", "D3C1213-200346A003")
    with pytest.raises(PathError, match="not a valid path segment"):
        paths.browse("declassiii", "../escape")


def test_happy_path_work_constructs_scratch_file_path() -> None:
    built_single = paths.work("bucharest", "job-1966-0712", "fetch.checkpoint.json")
    built_nested = paths.work("bucharest", "job-1966-0712", "segments/a.tif")
    assert built_single == "work/bucharest/job-1966-0712/fetch.checkpoint.json"
    assert built_nested == "work/bucharest/job-1966-0712/segments/a.tif"


def test_bad_path_work_refuses_directory_traversal_or_nested_paths() -> None:
    with pytest.raises(PathError, match="not a valid path segment"):
        paths.work("bucharest", "job-1966-0712", "../../secrets.json")
    with pytest.raises(PathError, match="not a valid path segment"):
        paths.work("bucharest", "job-1966-0712", "a/b/c.tif")


def test_happy_path_work_prefix_ends_with_trailing_slash() -> None:
    assert paths.work_prefix("bucharest", "job-1966-0712") == "work/bucharest/job-1966-0712/"


def test_bad_path_work_prefix_refuses_invalid_city_or_job_id() -> None:
    with pytest.raises(PathError, match="not a valid path segment"):
        paths.work_prefix("Bucharest", "job-1966-0712")
    with pytest.raises(PathError, match="not a valid path segment"):
        paths.work_prefix("bucharest", "job/1966")


def test_happy_path_version_constructs_layer_file_path() -> None:
    built = paths.version("bucharest", "kh-4a-corona-1966", "job-1966-0712", "cog.tif")
    assert built == "rasters/bucharest/kh-4a-corona-1966/job-1966-0712/cog.tif"


def test_bad_path_version_refuses_unregistered_file_or_invalid_id() -> None:
    with pytest.raises(PathError, match="not a valid path segment"):
        paths.version("bucharest", "kh-4a-corona-1966", "job-1966-0712", "secrets.json")
    with pytest.raises(PathError, match="not a valid path segment"):
        paths.version("bucharest", "../layer", "job-1966-0712", "cog.tif")


def test_happy_path_reference_selects_extension_by_reference_kind() -> None:
    assert paths.reference("bucharest", "s2", "0f3c9a2e") == "reference/bucharest/s2/0f3c9a2e.tif"
    assert paths.reference("bucharest", "dem", "0f3c9a2e") == "reference/bucharest/dem/0f3c9a2e.tif"
    assert paths.reference("bucharest", "osm", "0f3c9a2e") == "reference/bucharest/osm/0f3c9a2e.geojson"


def test_bad_path_reference_refuses_unknown_kind_or_invalid_hex_key() -> None:
    with pytest.raises(PathError, match="not a valid path segment"):
        paths.reference("bucharest", "srtm", "0f3c9a2e")
    with pytest.raises(PathError, match="not a valid path segment"):
        paths.reference("bucharest", "s2", "NOT-HEX")
    with pytest.raises(PathError, match="not a valid path segment"):
        paths.reference("bucharest", "s2", "../escape")
