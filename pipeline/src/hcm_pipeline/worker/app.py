"""What the local page's requests do (docs/research/M7-local-worker.md §1.2, §2.1-§2.3).

Sign in: the tokens must be usable, the project's web configuration readable (the refresh needs its API key), and
`worker.hello {cityId, workerId, version}` must accept the ID token (a token of another project, or of an account
that is not an editor of the city, is refused at once and the page shows the code) before the worker keeps it; its
answer sets how often the worker claims and how often the heartbeat writes. Sign out forgets the tokens; the loop then
stops claiming. Finding 67 of 2026-11-02: pairing (`pairing.py`) signs in through the same `sign_in`, with `keep` (the
session is kept in the work folder); `worker.hello` also says whether this worker's image is still the installed one.
Finding 72 (auto-pair, M7 §2.7): `pair` takes the admin's one-time code from `POST /pair` while the worker has no session
and hands it to the connector (`accept_pairing`), which pairs at the loop's next pass.
"""

import time
from collections.abc import Callable, Mapping
from typing import Final

from hcm_pipeline import __version__
from hcm_pipeline.contract import Errors
from hcm_pipeline.log import get_logger
from hcm_pipeline.worker.ai_state import AiState
from hcm_pipeline.worker.api import HELLO, RevokedError, WorkerApi, WorkerApiError
from hcm_pipeline.worker.args import PAIR_CODE
from hcm_pipeline.worker.pausing import PauseControl, parse_command
from hcm_pipeline.worker.session import SIGNED_OUT, RefreshUnavailableError, Session, Tokens
from hcm_pipeline.worker.state import WorkerState
from hcm_pipeline.worker.webconfig import WebConfig, WebConfigError

# Why a computer cannot clean itself up: no starter that does it runs this worker (a command started it).
NO_STARTER: Final = "no-starter"
LOG = get_logger("worker.app")
CONFIG_MISSING: Final = "configMissing"
# `POST /pair` while a session is held: the computer is paired already.
PAIRED: Final = "paired"


def _seconds(answer: Mapping[str, object], key: str) -> float | None:
    value = answer.get(key)
    return float(value) if isinstance(value, int | float) and value > 0 else None


class PageActions:
    """The worker's side of the page (`server.WorkerApp`)."""

    def __init__(self, session: Session, api: WorkerApi, state: WorkerState, web_config: WebConfig, hello: Mapping[str, object]) -> None:
        self._session = session
        self._api = api
        self._state = state
        self._web_config = web_config
        self._hello = {**hello, "version": __version__}
        self._offer: Callable[[str], None] | None = None
        # The governor's `choose` (M26): the owner's profile from the admin's card.
        self.choose_profile: Callable[[object, object], bool] = lambda _chosen, _battery: False
        # Pause this computer (`pausing.py`): the loop's, given by `Worker.build`; the wall clock a timed pause is checked against.
        self.pausing = PauseControl()
        self.wall: Callable[[], float] = time.time
        # W5: the loop's `remove_here` (Stop using this computer on this page); without it, no starter cleans up.
        self.remove_here: Callable[[], str | None] = lambda: NO_STARTER

    def accept_pairing(self, offer: Callable[[str], None]) -> None:
        """Where `pair` hands a code: the connector's `offer` (finding 72)."""
        self._offer = offer

    def pair(self, code: object) -> str | None:
        """The admin's code (auto-pair): None when it was handed to the connector, else why not."""
        if self._session.active:
            return PAIRED
        if self._offer is None or not isinstance(code, str) or PAIR_CODE.fullmatch(code) is None:
            return Errors.INVALID_REQUEST
        self._offer(code)
        LOG.info("the admin sent a pairing code; pairing now")
        return None

    def profile(self, chosen: object, battery_allowed: object) -> bool:
        """The owner's profile for this computer (M26, docs/research/M26-governor.md §6); False when it is not one."""
        return self.choose_profile(chosen, battery_allowed)

    def pause(self, body: Mapping[str, object]) -> bool:
        """Pause or resume this computer from its page or the admin's card (`POST /pause`); False for a body that is not a command."""
        command = parse_command(body, self.wall())
        if command is None:
            return False
        self.pausing.local(command)
        LOG.info("this computer was %s from its page", "paused" if command.action == "pause" else "resumed")
        return True

    def remove(self) -> str | None:
        """W5: Stop using this computer, from its own page: None once the loop ends for the starter's cleanup, else why not."""
        return self.remove_here()

    def web_config(self) -> Mapping[str, str] | None:
        try:
            return self._web_config.get()
        except WebConfigError as error:
            LOG.warning("the project's web configuration is unreadable: %s", error)
            return None

    def state(self) -> Mapping[str, object]:
        return self._state.snapshot()

    def sign_in(self, id_token: object, refresh_token: object, keep: Callable[[Tokens], None] | None = None) -> str | None:
        """None when the session began, else the code the page shows (also its last error)."""
        refused = self._refusal(id_token, refresh_token)
        if isinstance(refused, str):
            self._state.failed(refused)
            return refused
        tokens, answer = refused
        self._state.timing.poll_seconds = _seconds(answer, "pollSeconds") or self._state.timing.poll_seconds
        self._state.timing.idle_poll_seconds = _seconds(answer, "idlePollSeconds")
        self._state.timing.heartbeat_seconds = _seconds(answer, "heartbeatSeconds")
        self._session.begin(tokens, keep)
        self._state.failed(None)
        self._state.outdated(answer.get("outdated") is True)
        LOG.info("signed in; the worker claims the city's local jobs")
        return None

    def _refusal(self, id_token: object, refresh_token: object) -> str | tuple[Tokens, Mapping[str, object]]:
        """The usable tokens and `worker.hello`'s answer, or the code of why not."""
        try:
            tokens = Tokens.of(id_token, refresh_token)
        except ValueError:
            return Errors.INVALID_REQUEST
        if self.web_config() is None:
            return CONFIG_MISSING
        try:
            return tokens, self._api.call(HELLO, self._introduction(), token=tokens.id_token)
        except (WorkerApiError, RevokedError) as error:
            LOG.warning("worker.hello refused the sign-in: %s", error.code)
            return str(error.code)

    def _introduction(self) -> Mapping[str, object]:
        return {**self._hello, "ai": self._state.ai.as_record()}

    def announce_ai(self, ai: AiState) -> None:
        """The local AI's new state, on `/state` for the starter and through `worker.hello` for the panel (M10); a refused hello changes
        nothing in the run: the panel only lags."""
        self._state.set_ai(ai)
        if not self._session.active:
            return
        try:
            self._api.call(HELLO, self._introduction())
        except (WorkerApiError, RevokedError, RefreshUnavailableError) as error:
            LOG.warning("worker.hello did not take the local AI's state: %s", error)

    def sign_out(self) -> None:
        self._session.end(SIGNED_OUT)
        LOG.info("signed out; the worker stops claiming")
