"""What a join needs of the scratch folder (docs/research/M8-join-interfaces.md §3, §4)."""

import errno

from hcm_pipeline.contract import Errors
from hcm_pipeline.jobs import StepFailedError
from hcm_pipeline.join.room import needed_to_align, needed_to_merge, out_of_room


def test_happy_path_align_needs_the_two_largest_scans_at_once() -> None:
    assert needed_to_align([300, 100, 200], 0) == 500


def test_happy_path_align_also_needs_what_merge_will_need() -> None:
    assert needed_to_align([300, 100, 200], 50) == 300 + 50 * 4


def test_happy_path_merge_needs_one_scan_each_part_warped_and_the_mosaic() -> None:
    assert needed_to_merge([300, 100], 50) == 300 + 50 * 3


def test_bad_path_a_full_disk_is_no_room() -> None:
    found = out_of_room("F039", OSError(errno.ENOSPC, "No space left on device"))

    assert isinstance(found, StepFailedError)
    assert found.code == Errors.JOIN_NO_ROOM


def test_bad_path_any_other_failure_stays_what_it_is() -> None:
    error = OSError(errno.EIO, "Input/output error")

    assert out_of_room("F039", error) is error
