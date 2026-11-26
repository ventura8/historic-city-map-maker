"""Shared fixtures for the CI tooling tests.

Every test runs with the network blocked except loopback and Unix sockets (Watch-GPS rule):
a test that reaches the internet fails with NetworkBlockedError instead of passing by luck.
"""

import ipaddress
import socket
from collections.abc import Callable

import pytest


class NetworkBlockedError(RuntimeError):
    """Raised when a test tries to open a non-loopback connection."""


def _is_local(address: object) -> bool:
    if not isinstance(address, tuple):
        return True
    host = str(address[0])
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _guard(original: Callable[..., object]) -> Callable[..., object]:
    def guarded(sock: socket.socket, address: object) -> object:
        if not _is_local(address):
            raise NetworkBlockedError(f"network access blocked in tests: {address!r}")
        return original(sock, address)

    return guarded


@pytest.fixture(autouse=True)
def block_network(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(socket.socket, "connect", _guard(socket.socket.connect))
    monkeypatch.setattr(socket.socket, "connect_ex", _guard(socket.socket.connect_ex))
