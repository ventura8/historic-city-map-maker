"""The doctor step against the real GDAL, numpy and OpenCV of the image."""

import io
import json

import pytest
from hcm_pipeline.exit_codes import ExitCode
from hcm_pipeline.main import main
from hcm_pipeline.raster import gdal


def test_happy_path_doctor_passes_in_the_image_and_logs_versions() -> None:
    stream = io.StringIO()

    code = main(["doctor"], {}, None, stream)

    entries = [json.loads(line) for line in stream.getvalue().splitlines()]
    ready = next(entry for entry in entries if entry["message"] == "runtime ready")
    assert code == ExitCode.OK
    assert ready["gdal"] == gdal.__version__
    assert str(ready["gdal"]).startswith("3.")
    assert str(ready["python"]).startswith("3.14.")
    assert entries[-1]["message"] == "step doctor done"


def test_bad_path_gdal_raises_instead_of_returning_none() -> None:
    with pytest.raises(RuntimeError, match="No such file or directory"):
        gdal.Open("/nonexistent/hcm/raster.tif")
