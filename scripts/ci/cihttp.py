"""HTTPS for the network-bound CI checks (`contract` and `deps` stages): one request, no magic.

Only https is spoken, through http.client (no extra dependency, and bandit's urllib audit stays
clean). A `Fetch` is any callable from `Request` to `Response`, so every check takes one as a
parameter and its tests pass a scripted fake instead of the network (the tests' conftest blocks
every non-loopback socket anyway). `with_retry` gives a network error one more chance, so a blip
does not open a weekly issue; `follow` follows redirects with the same method.
"""

import http.client
import json
import ssl
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from http import HTTPStatus
from urllib.parse import urljoin, urlsplit

from cilog import get_logger

LOG = get_logger("http")

USER_AGENT = "historic-city-map-ci (+https://github.com/ventura8/historic-city-map-maker)"
TIMEOUT_SECONDS = 30.0
MAX_REDIRECTS = 10
MAX_BODY_BYTES = 4 << 20
REDIRECTS = frozenset(
    {HTTPStatus.MOVED_PERMANENTLY, HTTPStatus.FOUND, HTTPStatus.SEE_OTHER, HTTPStatus.TEMPORARY_REDIRECT, HTTPStatus.PERMANENT_REDIRECT}
)


class TransportError(Exception):
    """A request this module refuses to make or finish: a non-https URL or a redirect loop."""


NETWORK_ERRORS = (OSError, http.client.HTTPException, TransportError)


@dataclass(frozen=True)
class Request:
    method: str
    url: str
    body: bytes | None = None
    headers: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class Response:
    status: int
    headers: Mapping[str, str] = field(default_factory=dict)
    """Header names in lower case."""
    body: bytes = b""

    def json_document(self) -> object:
        """The body parsed as JSON; None when it is not JSON."""
        try:
            return json.loads(self.body)
        except ValueError:
            return None

    def json_field(self, name: str) -> object:
        """A top-level field of a JSON object body; None when the body is not one."""
        document = self.json_document()
        return document.get(name) if isinstance(document, dict) else None


Fetch = Callable[[Request], Response]


def split_https(url: str) -> tuple[str, int | None, str]:
    """(host, port, path plus query) of an https URL; TransportError for anything else."""
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname:
        raise TransportError(f"only https URLs are checked: {url}")
    path = parts.path or "/"
    return parts.hostname, parts.port, f"{path}?{parts.query}" if parts.query else path


def https_fetch(request: Request) -> Response:
    """One HTTPS exchange, redirects not followed: status, lower-cased headers and at most 4 MiB of body."""
    host, port, target = split_https(request.url)
    connection = http.client.HTTPSConnection(host, port, timeout=TIMEOUT_SECONDS, context=ssl.create_default_context())
    try:
        connection.request(request.method, target, body=request.body, headers={"User-Agent": USER_AGENT, **dict(request.headers)})
        reply = connection.getresponse()
        return Response(reply.status, {name.lower(): value for name, value in reply.getheaders()}, reply.read(MAX_BODY_BYTES))
    finally:
        connection.close()


def with_retry(fetch: Fetch, attempts: int = 2) -> Fetch:
    """`fetch` with `attempts - 1` retries on a network error, so one blip does not open a weekly issue."""

    def retrying(request: Request) -> Response:
        for _ in range(attempts - 1):
            try:
                return fetch(request)
            except NETWORK_ERRORS as error:
                LOG.info("  retrying %s %s after: %s", request.method, request.url, error)
        return fetch(request)

    return retrying


def follow(request: Request, fetch: Fetch) -> Response:
    """The final response after following up to MAX_REDIRECTS redirects with the same method."""
    current = request
    for _ in range(MAX_REDIRECTS + 1):
        response = fetch(current)
        location = response.headers.get("location")
        if response.status not in REDIRECTS or not location:
            return response
        current = Request(current.method, urljoin(current.url, location), current.body, current.headers)
    raise TransportError(f"more than {MAX_REDIRECTS} redirects from {request.url}")


def is_success(status: int) -> bool:
    return HTTPStatus.OK <= status < HTTPStatus.MULTIPLE_CHOICES
