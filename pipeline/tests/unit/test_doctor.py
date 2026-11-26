"""The doctor step with an injected driver lookup (the real GDAL run is in tests/integration)."""

import io
import json

import pytest
from hcm_pipeline.log import get_logger
from hcm_pipeline.steps import Outcome, StepContext, StepError
from hcm_pipeline.steps.doctor import REQUIRED_DRIVERS, DoctorStep, missing_drivers


def test_happy_path_no_driver_missing_when_lookup_knows_them_all() -> None:
    assert missing_drivers(lambda name: object()) == []


def test_bad_path_missing_drivers_are_listed_in_order() -> None:
    known = {"GTiff", "PNG"}

    assert missing_drivers(lambda name: object() if name in known else None) == ["COG", "VRT", "JPEG"]


def test_happy_path_doctor_logs_versions(log_stream: io.StringIO) -> None:
    outcome = DoctorStep(lambda name: object()).run(StepContext(get_logger("doctor")))

    entry = json.loads(log_stream.getvalue().splitlines()[-1])
    assert outcome is Outcome.DONE
    assert entry["message"] == "runtime ready"
    assert {"python", "gdal", "numpy", "opencv"} <= set(entry)


def test_bad_path_doctor_fails_when_a_driver_is_missing() -> None:
    step = DoctorStep(lambda name: None if name == "COG" else object())

    with pytest.raises(StepError, match="GDAL lacks the drivers: COG"):
        step.run(StepContext(get_logger("doctor")))


def test_happy_path_doctor_needs_no_configuration() -> None:
    assert (DoctorStep.name, DoctorStep.requires_config, len(REQUIRED_DRIVERS)) == ("doctor", False, 5)
