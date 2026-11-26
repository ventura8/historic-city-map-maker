"""USGS M2M downloads: options, the labelled request, retrieval of the signed address, and the order's removal.

The flow of docs/research/M3-interfaces.md §5.3 (`fetch`) and security review §4.2: `download-options` says whether
the scene is already scanned and how large the delivery is; `download-request` with the deterministic label
`hcm-{job}` (a retry reuses the same request) answers the signed address at once, or says it is being prepared;
`download-retrieve` with the same label returns it once it is ready; `download-order-remove` cleans up. The signed
address is a secret in practice: it is returned to the caller, never logged (the logger also redacts its query).

Landsat Collection 2 Level-1 (M25): `download-options` returns several products (the Product Bundle, band files,
LandsatLook images), and the Bundle may sit under `secondaryDownloads`. Prefer a product whose name contains
"bundle"; otherwise the largest available. Its `filesize` can still understate the tar the signed address sends
(a band-scale figure): `fetch` takes Content-Length of that transfer as the size of the product actually requested.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final, Protocol

from hcm_pipeline.log import get_logger
from hcm_pipeline.m2m import M2MError

LOG = get_logger("usgs")
LABEL_PREFIX: Final = "hcm-"
_BUNDLE: Final = "bundle"


class M2MSession(Protocol):
    def request(self, endpoint: str, payload: Mapping[str, object] | None = None) -> object: ...


@dataclass(frozen=True)
class DownloadOption:
    """The scanned product of a scene: its M2M product id and the delivery's size in bytes."""

    product_id: str
    size: int


def label_for(job_id: str) -> str:
    """The download request's label: deterministic per job, so a retry reuses its request."""
    return f"{LABEL_PREFIX}{job_id}"


def _records(value: object) -> list[dict[str, object]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _filesize(value: object) -> int | None:
    """A positive byte count from `filesize` (int or digit string); bool is not a size."""
    text = str(value) if isinstance(value, int | str) and not isinstance(value, bool) else ""
    return int(text) if text.isdigit() and int(text) > 0 else None


def _option_of(item: Mapping[str, object]) -> DownloadOption | None:
    product, size = item.get("id"), _filesize(item.get("filesize"))
    if size is None or item.get("available") is not True or not isinstance(product, str | int):
        return None
    return DownloadOption(str(product), size)


def _products(answer: object) -> list[dict[str, object]]:
    """Each top-level option and every `secondaryDownloads` child (Landsat nests the Product Bundle there)."""
    top = _records(answer)
    return top + [child for item in top for child in _records(item.get("secondaryDownloads"))]


def _is_bundle(item: Mapping[str, object]) -> bool:
    name = item.get("productName")
    return isinstance(name, str) and _BUNDLE in name.casefold()


def _pick(pairs: Sequence[tuple[Mapping[str, object], DownloadOption]]) -> DownloadOption | None:
    """The Product Bundle when one is available, else the largest; None when nothing is scanned."""
    bundles = [option for item, option in pairs if _is_bundle(item)]
    pool = bundles or [option for _, option in pairs]
    return max(pool, key=lambda option: option.size, default=None)


def download_option(m2m: M2MSession, dataset: str, entity_id: str) -> DownloadOption | None:
    """The scene's available product (the Bundle when named, else the largest), or None when not scanned yet."""
    answer = m2m.request("download-options", {"datasetName": dataset, "entityIds": [entity_id]})
    pairs = [(item, option) for item in _products(answer) if (option := _option_of(item)) is not None]
    return _pick(pairs)


def _first_url(items: Sequence[Mapping[str, object]]) -> str | None:
    urls = [item["url"] for item in items if isinstance(item.get("url"), str) and item["url"]]
    return str(urls[0]) if urls else None


def _section(answer: object, key: str) -> list[dict[str, object]]:
    return _records(answer.get(key)) if isinstance(answer, dict) else []


def request_download(m2m: M2MSession, entity_id: str, product_id: str, label: str) -> str | None:
    """`download-request`: the signed address when it is ready now, else None (USGS prepares it; retrieve later)."""
    answer = m2m.request("download-request", {"downloads": [{"entityId": entity_id, "productId": product_id}], "label": label})
    return _first_url(_section(answer, "availableDownloads"))


def retrieve_download(m2m: M2MSession, label: str) -> str | None:
    """`download-retrieve`: the signed address of the labelled request once it is ready, else None."""
    return _first_url(_section(m2m.request("download-retrieve", {"label": label}), "available"))


def remove_order(m2m: M2MSession, label: str) -> None:
    """`download-order-remove`, best effort: the request expires on its own."""
    try:
        m2m.request("download-order-remove", {"label": label})
    except M2MError as error:
        LOG.warning("USGS download-order-remove failed (%s); the request expires on its own", type(error).__name__)
