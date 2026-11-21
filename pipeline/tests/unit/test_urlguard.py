"""Addresses from data (a STAC item's asset) are fetched only when they are public https addresses, never Mapbox."""

import pytest
from hcm_pipeline.urlguard import AddressRefusedError, check_data_url, check_emulated_url, resolve


def public(_host: str) -> list[str]:
    return ["52.218.152.1"]


@pytest.mark.parametrize(
    ("url", "loopback"),
    [
        ("https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/35/T/MK/TCI.tif", False),
        ("https://[2600:1f18::1]/TCI.tif", False),
        ("http://127.0.0.1:8123/s2/visual.tif", True),
    ],
)
def test_happy_path_public_https_and_loopback_test_addresses_pass(url: str, loopback: bool) -> None:
    assert check_data_url(url, loopback, public) == url


@pytest.mark.parametrize(
    ("url", "resolved", "reason"),
    [
        ("http://sentinel-cogs.s3.amazonaws.com/TCI.tif", ["52.218.152.1"], "not an https address"),
        ("https://user:pass@sentinel-cogs.s3.amazonaws.com/TCI.tif", ["52.218.152.1"], "user information"),
        ("https:///TCI.tif", [], "without a host"),
        ("https://api.mapbox.com/v4/mapbox.satellite/1/0/0.jpg", ["52.218.152.1"], "a Mapbox address"),
        ("https://metadata.google.internal/computeMetadata/v1/", ["169.254.169.254"], "not public"),
        ("https://10.0.0.8/TCI.tif", [], "not public"),
        ("https://intranet.example/TCI.tif", ["192.168.1.4", "52.218.152.1"], "not public"),
        ("https://cgnat.example/TCI.tif", ["100.64.0.9"], "not public"),
        ("https://multicast.example/TCI.tif", ["224.0.0.251"], "not public"),
        ("https://127.0.0.1/TCI.tif", [], "not public"),
        ("http://127.0.0.1:8123/s2/visual.tif", [], "not an https address"),
    ],
)
def test_bad_path_private_metadata_mapbox_and_plain_addresses_are_refused(url: str, resolved: list[str], reason: str) -> None:
    with pytest.raises(AddressRefusedError, match=reason) as caught:
        check_data_url(url, False, lambda _host: resolved)

    assert "?" not in str(caught.value)


def test_happy_path_the_default_resolver_answers_loopback_names() -> None:
    assert "127.0.0.1" in resolve("localhost") or "::1" in resolve("localhost")


@pytest.mark.parametrize(
    "url", ["http://127.0.0.1:4311/h/dds.cr.usgs.gov/e2e/download/1?sig=x", "http://localhost:9/a", "http://[::1]:9/a"]
)
def test_happy_path_under_the_emulators_this_machines_addresses_pass(url: str) -> None:
    assert check_emulated_url(url) == url


@pytest.mark.parametrize(
    "url",
    ["https://dds.cr.usgs.gov/e2e/download/1?sig=x", "https://52.218.152.1/TCI.tif", "http://user:pass@127.0.0.1:9/a", "http:///a"],
)
def test_bad_path_under_the_emulators_every_other_address_is_refused_unresolved(url: str) -> None:
    with pytest.raises(AddressRefusedError, match="off this machine under the emulators") as caught:
        check_emulated_url(url)

    assert "sig=" not in str(caught.value)
