"""The network firewall of the pipeline tests (Watch-GPS rule, as in scripts/ci/tests/conftest.py).

Only loopback is reachable: a connect to any other address, or a DNS lookup of any other name,
raises NetworkBlockedError, so a test that would reach the internet fails instead of passing by luck.
"""

import ipaddress
import socket
from collections.abc import Callable
from typing import Any

import pytest

LOCAL_NAMES = frozenset({"localhost"})


class NetworkBlockedError(RuntimeError):
    """A test tried to reach a non-loopback host."""


def is_local(host: object) -> bool:
    """True for loopback addresses, `localhost`, and None (getaddrinfo's "this host")."""
    if host is None or str(host) in LOCAL_NAMES:
        return True
    try:
        return ipaddress.ip_address(str(host)).is_loopback
    except ValueError:
        return False


def _guard_connect(original: Callable[..., Any]) -> Callable[..., Any]:
    def guarded(sock: socket.socket, address: object) -> Any:
        if isinstance(address, tuple) and not is_local(address[0]):
            raise NetworkBlockedError(f"network access blocked in tests: {address!r}")
        return original(sock, address)

    return guarded


def _guard_lookup(original: Callable[..., Any]) -> Callable[..., Any]:
    def guarded(host: object, *args: Any, **kwargs: Any) -> Any:
        if not is_local(host):
            raise NetworkBlockedError(f"DNS lookup blocked in tests: {host!r}")
        return original(host, *args, **kwargs)

    return guarded


def block_non_loopback(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(socket.socket, "connect", _guard_connect(socket.socket.connect))
    monkeypatch.setattr(socket.socket, "connect_ex", _guard_connect(socket.socket.connect_ex))
    monkeypatch.setattr(socket, "getaddrinfo", _guard_lookup(socket.getaddrinfo))
