"""The worker's `ObjectStore`: each object to the store its prefix belongs to (docs/research/M7-local-worker.md §1.3).

`usgs-raw/` (the delivery), `work/` (the scratch: segments, frame, checkpoints) and `reference/` (the cache) stay in the
work folder (`LocalObjectStore`); `rasters/` (the version's files) and `uploads/` (an admin's upload) go through signed
URLs (`SignedObjectStore`). Resumable sessions are the local store's (only the delivery streams through one). Any
other prefix is refused, so a path the server would not sign never leaves the computer by accident.
"""

from collections.abc import Mapping
from contextlib import AbstractContextManager
from pathlib import Path
from typing import IO, Final

from hcm_pipeline.objects import ObjectInfo, ObjectStore, ObjectStoreError

LOCAL_PREFIXES: Final = ("usgs-raw/", "work/", "reference/")
# M20 (2026-11-13): an archive series' copy of its sheets, read by the job's worker (`archive/copy.py`).
SIGNED_PREFIXES: Final = ("rasters/", "uploads/", "tmp/archive-copies/")


class RoutedObjectStore:
    def __init__(self, local: ObjectStore, signed: ObjectStore) -> None:
        self._local = local
        self._routes: Mapping[str, ObjectStore] = {
            **dict.fromkeys(LOCAL_PREFIXES, local),
            **dict.fromkeys(SIGNED_PREFIXES, signed),
        }

    def _for(self, path: str) -> ObjectStore:
        store = next((store for prefix, store in self._routes.items() if path.startswith(prefix)), None)
        if store is None:
            raise ObjectStoreError(f"the local worker has no store for {path}")
        return store

    def stat(self, path: str) -> ObjectInfo | None:
        return self._for(path).stat(path)

    def upload_file(self, local: Path, path: str, content_type: str) -> ObjectInfo:
        return self._for(path).upload_file(local, path, content_type)

    def download_file(self, path: str, local: Path) -> ObjectInfo:
        return self._for(path).download_file(path, local)

    def open_read(self, path: str) -> AbstractContextManager[IO[bytes]]:
        return self._for(path).open_read(path)

    def list(self, prefix: str) -> list[ObjectInfo]:
        return self._for(prefix).list(prefix)

    def delete(self, path: str) -> None:
        self._for(path).delete(path)

    def start_resumable(self, path: str, size: int, content_type: str) -> str:
        return self._for(path).start_resumable(path, size, content_type)

    def resumable_offset(self, session: str, size: int) -> int | ObjectInfo:
        return self._local.resumable_offset(session, size)

    def write_chunk(self, session: str, offset: int, data: bytes, size: int) -> int | ObjectInfo:
        return self._local.write_chunk(session, offset, data, size)
