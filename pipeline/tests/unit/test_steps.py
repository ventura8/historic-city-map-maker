"""The step registry and the context a step runs with."""

import logging

import pytest
from hcm_pipeline.config import load_config
from hcm_pipeline.exit_codes import ExitCode
from hcm_pipeline.steps import Outcome, StepContext, StepError, StepRegistry

from tests.fakes.environment import VALID_ENV


class NamedStep:
    requires_config = False

    def __init__(self, name: str) -> None:
        self.name = name

    def run(self, ctx: StepContext) -> Outcome:
        ctx.log.info("ran %s", self.name)
        return Outcome.DONE


def test_happy_path_registry_keeps_registration_order() -> None:
    fetch, crop = NamedStep("fetch"), NamedStep("crop")
    registry = StepRegistry((fetch, crop))

    assert registry.names() == ("fetch", "crop")
    assert registry.get("crop") is crop


def test_bad_path_registering_a_name_twice_is_refused() -> None:
    registry = StepRegistry((NamedStep("fetch"),))

    with pytest.raises(ValueError, match="step 'fetch' is registered twice"):
        registry.register(NamedStep("fetch"))


def test_bad_path_unknown_step_is_a_key_error() -> None:
    with pytest.raises(KeyError):
        StepRegistry().get("warp")


def test_happy_path_context_hands_out_the_configuration() -> None:
    config = load_config(VALID_ENV)

    assert StepContext(logging.getLogger("t"), config).require_config() is config


def test_bad_path_context_without_configuration_fails_with_config_exit_code() -> None:
    with pytest.raises(StepError) as caught:
        StepContext(logging.getLogger("t")).require_config()

    assert caught.value.exit_code == ExitCode.CONFIG


def test_happy_path_step_error_fails_by_default() -> None:
    assert StepError("boom").exit_code == ExitCode.FAILED
