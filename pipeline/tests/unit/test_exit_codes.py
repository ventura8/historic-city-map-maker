"""Process exit codes of a pipeline run (`hcm_pipeline/exit_codes.py`)."""

import pytest
from hcm_pipeline.exit_codes import ExitCode

EXPECTED_MEMBERS: dict[str, int] = {
    "OK": 0,
    "FAILED": 1,
    "USAGE": 2,
    "CONFIG": 3,
    "OUTDATED": 75,
    "REMOVE": 76,
    "REMOVE_DOCKER": 77,
    "REMOVE_KEEP": 78,
    "REMOVE_KEEP_DOCKER": 79,
}


@pytest.mark.parametrize(("name", "value"), list(EXPECTED_MEMBERS.items()))
def test_happy_path_exit_code_members_match_expected_values(name: str, value: int) -> None:
    code = ExitCode(value)
    assert code.name == name
    assert code.value == value
    assert code == value
    assert isinstance(code, int)


@pytest.mark.parametrize("invalid_value", [-1, 4, 74, 80, 255])
def test_bad_path_exit_code_rejects_unknown_integer(invalid_value: int) -> None:
    with pytest.raises(ValueError, match="is not a valid ExitCode"):
        ExitCode(invalid_value)


@pytest.mark.parametrize(("name", "value"), list(EXPECTED_MEMBERS.items()))
def test_happy_path_exit_code_by_name_resolves_member(name: str, value: int) -> None:
    member = ExitCode[name]
    assert member.value == value
    assert member == value


@pytest.mark.parametrize("invalid_name", ["", "ok", "SUCCESS", "UNKNOWN", "remove"])
def test_bad_path_exit_code_by_name_rejects_unknown_name(invalid_name: str) -> None:
    with pytest.raises(KeyError):
        _ = ExitCode[invalid_name]


def test_happy_path_exit_code_supports_integer_arithmetic() -> None:
    assert ExitCode.REMOVE + 1 == ExitCode.REMOVE_DOCKER
    assert ExitCode.REMOVE + 2 == ExitCode.REMOVE_KEEP
    assert ExitCode.REMOVE + 3 == ExitCode.REMOVE_KEEP_DOCKER
    assert ExitCode(ExitCode.REMOVE + 1) is ExitCode.REMOVE_DOCKER


def test_bad_path_exit_code_arithmetic_overflows_valid_range() -> None:
    out_of_range = ExitCode.REMOVE_KEEP_DOCKER + 1
    with pytest.raises(ValueError, match="is not a valid ExitCode"):
        ExitCode(out_of_range)


def test_happy_path_exit_code_count_and_set_of_members() -> None:
    assert {member.name: member.value for member in ExitCode} == EXPECTED_MEMBERS
    assert len(ExitCode) == len(EXPECTED_MEMBERS)
