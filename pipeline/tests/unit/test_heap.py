"""The C heap given back (`heap.py`): glibc's calls, and nothing where the C library is another."""

import pytest
from hcm_pipeline import heap


class FakeLibc:
    def __init__(self, answer: int) -> None:
        self.answer = answer
        self.calls: list[tuple[str, tuple[int, ...]]] = []

    def mallopt(self, option: int, value: int, /) -> int:
        self.calls.append(("mallopt", (option, value)))
        return self.answer

    def malloc_trim(self, pad: int, /) -> int:
        self.calls.append(("malloc_trim", (pad,)))
        return self.answer


def test_happy_path_glibc_limits_the_arenas_and_trims_the_free_pages() -> None:
    """Scenarios: S-P31-HAPPY-CANVAS-THREADS"""
    libc = FakeLibc(1)
    assert heap.limit_arenas(libc)
    assert heap.give_back(libc, None)
    assert libc.calls == [("mallopt", (heap.M_ARENA_MAX, heap.ARENAS)), ("malloc_trim", (0,))]
    # The real library of this image is glibc: both calls answer.
    assert heap.GLIBC is not None
    assert heap.limit_arenas()
    heap.give_back()


def test_happy_path_tcmalloc_is_asked_to_release_its_free_pages_too() -> None:
    """The pipeline's image preloads tcmalloc. Scenarios: S-P31-HAPPY-CANVAS-THREADS"""
    released: list[bool] = []
    assert heap.give_back(None, lambda: released.append(True))
    assert heap.give_back(FakeLibc(0), lambda: released.append(True))
    assert released == [True, True]


def test_bad_path_another_c_library_or_nothing_to_return_is_not_an_error() -> None:
    """Scenarios: S-P31-BAD-CANVAS-THREADS-NO-GLIBC"""
    assert not heap.limit_arenas(None)
    assert not heap.give_back(None, None)
    assert not heap.give_back(FakeLibc(0), None)


def test_bad_path_a_library_without_the_calls_is_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenarios: S-P31-BAD-CANVAS-THREADS-NO-GLIBC"""

    def missing(_name: str) -> object:
        raise OSError("no libc.so.6")

    monkeypatch.setattr("ctypes.CDLL", missing)
    assert heap._glibc() is None
    assert heap._tcmalloc() is None
    monkeypatch.setattr("ctypes.CDLL", lambda _name: object())
    assert heap._glibc() is None
    # Without tcmalloc in the process (the quality image clears the preload) there is no release to call.
    assert heap._tcmalloc() is None
