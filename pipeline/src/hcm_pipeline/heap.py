"""The C heap given back between large steps (docs/research/M26-governor.md §4, *The C heap*; lesson of 2026-11-13).

GDAL's worker threads (`GDAL_NUM_THREADS` above 1: the governor gives the worker the cores but one) allocate their blocks from
glibc's per-thread arenas, and glibc keeps an arena's freed pages for the next allocation instead of returning them. Measured on
the NUC, two 12,000 px colour sheets laid out and mosaicked: one thread peaked at 636 MB; with every core 870 MB, against the
800 MB budget, because about 115 MB of the layout's reads stayed resident in the threads' arenas and the canvas's own reads added
their own. With at most `ARENAS` arenas and the free pages trimmed after the layout and after each sheet (`give_back`): 588 MB
on one thread, 653 on sixteen, the same pixels and no slower (under the worker image's tcmalloc: 650 to 690 MB either way).

`limit_arenas` runs once at the process's start (`python -m hcm_pipeline`: the worker and the Cloud Run job), before GDAL starts
its threads; the canvas gives the heap back before its first sheet and after each one (`placing/canvas_window.render`).

Both calls are glibc's (`mallopt(M_ARENA_MAX)`, `malloc_trim(0)`); on another C library (musl, macOS) they do nothing. The pipeline's
image preloads tcmalloc (GDAL's base image, for the large warps), which serves every `malloc` instead of glibc: there `give_back` also
asks tcmalloc to release its free pages (`MallocExtension_ReleaseFreeMemory`, found in the process when tcmalloc is loaded).
"""

import ctypes
from collections.abc import Callable
from typing import Final, Protocol, cast

M_ARENA_MAX: Final = -8
ARENAS: Final = 2


class CLibrary(Protocol):
    """The two calls of glibc this file makes."""

    def mallopt(self, option: int, value: int, /) -> int: ...

    def malloc_trim(self, pad: int, /) -> int: ...


def _glibc() -> CLibrary | None:
    try:
        library = ctypes.CDLL("libc.so.6")
    except OSError:
        return None
    return cast(CLibrary, library) if hasattr(library, "malloc_trim") and hasattr(library, "mallopt") else None


def _tcmalloc() -> Callable[[], None] | None:
    """tcmalloc's release of its free pages, when tcmalloc is loaded in this process (the pipeline's image preloads it)."""
    try:
        process = ctypes.CDLL(None)
    except OSError:
        return None
    return cast(Callable[[], None] | None, getattr(process, "MallocExtension_ReleaseFreeMemory", None))


GLIBC: Final = _glibc()
TCMALLOC: Final = _tcmalloc()


def limit_arenas(library: CLibrary | None = GLIBC, arenas: int = ARENAS) -> bool:
    """At most `arenas` malloc arenas for the threads created from now on; False where glibc is not the C library."""
    return library is not None and bool(library.mallopt(M_ARENA_MAX, arenas))


def give_back(library: CLibrary | None = GLIBC, release: Callable[[], None] | None = TCMALLOC) -> bool:
    """The heap's free pages returned to the system: tcmalloc's when it serves `malloc`, and every glibc arena's; False where neither
    allocator could be asked (or glibc had nothing to return)."""
    if release is not None:
        release()
    trimmed = library is not None and bool(library.malloc_trim(0))
    return trimmed or release is not None
