"""How often an idle worker asks for a job (reports/resource-audit.md §4: every 30 s for ever was 86,400 calls a month a worker,
each with its Firestore reads, for nothing).

Awake, the worker claims every `pollSeconds`: for `AWAKE_SECONDS` after it started, after a job it ran, and after the admin's page
looked at it (`GET /state` from a Hosting origin: somebody is there, and may start a job). Past that, each idle pass waits twice as
long as the one before, up to `idlePollSeconds` of `worker.hello` (a minute: a new job never waits longer), a tenth more or less
so that workers do not ask together. A server that names no `idlePollSeconds` (one older than this image) is asked every
`pollSeconds` as before. Its admin counts a worker gone after three minutes of silence.

A city may have several workers (2026-11-13: the laptop, the NUC and the PC). A hot or busy computer leaves a queued job to a cooler or
idler one: each wait is stretched by up to `RELUCTANCE` times by the governor's headroom (`Governor.headroom`: 1 with room, 0 while
paused), so the computer with room asks first. A lone worker still takes the job, only later.
"""

import secrets
import time
from collections.abc import Callable
from typing import Final

AWAKE_SECONDS: Final = 600.0
GROWTH: Final = 2.0
JITTER: Final = 0.1
# Doublings counted at most: far past any `idlePollSeconds`, and a float still holds it.
MAX_PASSES: Final = 16
# A computer with no headroom waits 1 + RELUCTANCE times as long: four polls, so a cooler worker polling every `pollSeconds` asks first.
RELUCTANCE: Final = 3.0


def _jitter() -> float:
    return secrets.SystemRandom().uniform(-JITTER, JITTER)


class Pace:
    """The wait before the next claim. `wake` may come from any thread (one assignment each: no lock)."""

    def __init__(self, clock: Callable[[], float] = time.monotonic, jitter: Callable[[], float] = _jitter) -> None:
        self._clock = clock
        self._jitter = jitter
        self._awake_until = clock() + AWAKE_SECONDS
        self._passes = 0
        self._spread = 0.0
        # The governor's headroom (`Governor.headroom`; the worker sets it): full room until it says otherwise.
        self.headroom: Callable[[], float] = lambda: 1.0

    def wake(self) -> None:
        """A job ran, or the admin looked: fast again."""
        self._awake_until = self._clock() + AWAKE_SECONDS

    @property
    def awake(self) -> bool:
        return self._clock() < self._awake_until

    def idle_pass(self) -> None:
        """One more pass found no job: the next wait, when not awake, is longer."""
        self._passes = 0 if self.awake else min(self._passes + 1, MAX_PASSES)
        self._spread = self._jitter()

    def wait(self, poll: float, slowest: float | None) -> float:
        """Seconds from the pass's end to the next claim: `poll` while awake or with no `slowest`, else grown up to `slowest`; either
        stretched by the lack of headroom (`headroom`, 0 to 1)."""
        reluctance = 1 + RELUCTANCE * (1 - min(1.0, max(0.0, self.headroom())))
        if slowest is None or self.awake:
            return poll * reluctance
        return min(max(slowest, poll), poll * GROWTH**self._passes) * (1 + self._spread) * reluctance
