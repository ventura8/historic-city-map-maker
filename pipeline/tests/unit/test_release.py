"""The image's release (`hcm_pipeline.release_of`): what `worker.hello` reports and the admin's computer cards show."""

import pytest
from hcm_pipeline import UNSTAMPED, release_of


def test_happy_path_the_installer_stamped_release_is_the_version() -> None:
    """Scenarios: S-A62-HAPPY-RELEASE-STAMPED"""
    assert release_of({"HCM_RELEASE": "1.0.0-beta.1+a62d85e"}) == "1.0.0-beta.1+a62d85e"


@pytest.mark.parametrize("value", ["", "1.0.0 beta", "x" * 41, "1.0/0"])
def test_bad_path_an_unstamped_or_malformed_release_is_unstamped(value: str) -> None:
    """Scenarios: S-A62-BAD-RELEASE-UNSTAMPED"""
    assert release_of({"HCM_RELEASE": value}) == UNSTAMPED
    assert release_of({}) == UNSTAMPED
