"""The address guard for addresses that come from data (docs/research/M3-interfaces.md §8.3, the pipeline's half).

The Sentinel-2 asset an item of the public STAC catalogue names is read through GDAL's `/vsicurl/`; that
address is third-party data, so before GDAL sees it: https only (http only for a loopback test server when the
catalogue itself is on loopback), no user information, never a Mapbox host, and every address the host resolves
to must be a public one (never loopback, private, link-local such as the metadata server, CGNAT, multicast or
unspecified). The resolver is injected so the tests never resolve a real name. Under the emulators the rule turns
round: only this machine's addresses (`check_emulated_url`).
"""

import ipaddress
import socket
from collections.abc import Callable, Sequence
from typing import Final
from urllib.parse import SplitResult, urlsplit

from hcm_pipeline.config import LOOPBACK_HOSTS, is_mapbox_host

Resolver = Callable[[str], Sequence[str]]
HTTPS_PORT: Final = 443


class AddressRefusedError(ValueError):
    """An address from data that the pipeline will not fetch."""


def resolve(host: str) -> list[str]:
    """Every address `host` resolves to."""
    return [str(info[4][0]) for info in socket.getaddrinfo(host, HTTPS_PORT, proto=socket.IPPROTO_TCP)]


def _public(address: str, allow_loopback: bool) -> bool:
    ip = ipaddress.ip_address(address.split("%", 1)[0])
    return (ip.is_global and not ip.is_multicast) or (allow_loopback and ip.is_loopback)


def _addresses(host: str, resolver: Resolver) -> Sequence[str]:
    try:
        return [str(ipaddress.ip_address(host.strip("[]")))]
    except ValueError:
        return resolver(host)


def _scheme_ok(parts: SplitResult, allow_loopback: bool) -> bool:
    plain_loopback = allow_loopback and parts.hostname in LOOPBACK_HOSTS and parts.scheme == "http"
    return parts.scheme == "https" or plain_loopback


def _shape_problem(url: str, allow_loopback: bool) -> str | None:
    parts = urlsplit(url)
    checks = (
        (_scheme_ok(parts, allow_loopback), "not an https address"),
        (not (parts.username or parts.password), "an address with user information"),
        (bool(parts.hostname), "an address without a host"),
        (not is_mapbox_host(parts.hostname), "a Mapbox address"),
    )
    return next((problem for passed, problem in checks if not passed), None)


def _address_problem(url: str, allow_loopback: bool, resolver: Resolver) -> str | None:
    addresses = _addresses(urlsplit(url).hostname or "", resolver)
    return None if all(_public(address, allow_loopback) for address in addresses) else "an address that is not public"


def check_emulated_url(url: str) -> str:
    """Under the emulators an address from data must be this machine's, by name, never resolved: the e2e tier's
    pipeline reaches nothing off the machine (a delivery or an asset that names a real host is refused)."""
    parts = urlsplit(url)
    if parts.hostname not in LOOPBACK_HOSTS or parts.username or parts.password:
        raise AddressRefusedError(f"refused an address off this machine under the emulators: {parts.hostname}")
    return url


def check_data_url(url: str, allow_loopback: bool = False, resolver: Resolver = resolve) -> str:
    """`url` when the pipeline may fetch it; AddressRefusedError (with the reason, never the query) otherwise."""
    problem = _shape_problem(url, allow_loopback) or _address_problem(url, allow_loopback, resolver)
    if problem is not None:
        raise AddressRefusedError(f"refused {problem}: {urlsplit(url).netloc}")
    return url
