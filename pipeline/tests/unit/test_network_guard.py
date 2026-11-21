"""The test firewall itself: loopback works, anything else fails loudly."""

import socket

import pytest

from tests.fakes.network import NetworkBlockedError, is_local


@pytest.mark.parametrize(
    ("host", "expected"), [(None, True), ("localhost", True), ("127.0.0.5", True), ("::1", True), ("10.0.0.1", False), ("usgs.gov", False)]
)
def test_happy_path_only_loopback_counts_as_local(host: str | None, expected: bool) -> None:
    assert is_local(host) is expected


def test_bad_path_connect_to_a_public_address_is_blocked() -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock, pytest.raises(NetworkBlockedError):
        sock.connect(("203.0.113.10", 443))


def test_bad_path_connect_ex_to_a_public_address_is_blocked() -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock, pytest.raises(NetworkBlockedError):
        sock.connect_ex(("203.0.113.10", 443))


def test_bad_path_dns_lookup_of_a_public_name_is_blocked() -> None:
    with pytest.raises(NetworkBlockedError):
        socket.getaddrinfo("m2m.cr.usgs.gov", 443)


def test_happy_path_loopback_connections_work() -> None:
    with socket.create_server(("127.0.0.1", 0)) as server, socket.create_connection(server.getsockname()[:2]) as client:
        assert client.getpeername()[0] == "127.0.0.1"
