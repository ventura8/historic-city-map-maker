"""A series' rights, pre-flagged for the owner to check (docs/research/M20-import-local.md §7).

The rules: a work of 1931 or earlier with no named author is public domain (`clear`); a named author whose death date is unknown, or an
institution's work less than 70 years after publication (Romanian law 8/1996), needs the owner's confirmation; a visible copyright mark
means do not publish. The owner's sidecar (`sidecar.py`) states what the rules cannot know, and wins where it validates.
"""

from collections.abc import Callable
from typing import Final

from hcm_pipeline.archive.model import Rights

PUBLIC_DOMAIN_UNTIL: Final = 1931
PROTECTED_YEARS: Final = 70
AUTHOR_NOTE: Final = "Check the author's death date."
INSTITUTION_NOTE: Final = "An institution's work less than 70 years old: confirm where it came from and that you may publish it."
YEARLESS_NOTE: Final = "No year was found: confirm the map's date and rights."
COPYRIGHT_NOTE: Final = "The scan carries a copyright mark."
PERMISSION_NOTE: Final = "A permission needs who granted it: type their name to confirm."


Rule = Callable[[int | None, str | None, int, bool], Rights | None]


def _marked(year: int | None, author: str | None, _now: int, mark: bool) -> Rights | None:
    return Rights("unknown", "do-not-publish", _label(year), author, note=COPYRIGHT_NOTE) if mark else None


def _yearless(year: int | None, author: str | None, _now: int, _mark: bool) -> Rights | None:
    return Rights("unknown", "needs-confirmation", "?", author, note=YEARLESS_NOTE) if year is None else None


def _recent(year: int | None, author: str | None, now: int, _mark: bool) -> Rights | None:
    recent = year is not None and year > now - PROTECTED_YEARS
    return Rights("unknown", "needs-confirmation", _label(year), author, note=INSTITUTION_NOTE) if recent else None


def _authored(year: int | None, author: str | None, _now: int, _mark: bool) -> Rights | None:
    unsure = author is not None or (year or 0) > PUBLIC_DOMAIN_UNTIL
    return Rights("PD", "needs-confirmation", _label(year), author, note=AUTHOR_NOTE) if unsure else None


def _label(year: int | None) -> str:
    return "?" if year is None else str(year)


RULES: Final[tuple[Rule, ...]] = (_marked, _yearless, _recent, _authored)


def preflag(year: int | None, author: str | None, current_year: int, *, copyright_mark: bool = False) -> Rights:
    """The rules of §7, in order: a copyright mark, no year, a recent work, a named author or a year past 1931; else public domain."""
    for rule in RULES:
        found = rule(year, author, current_year, copyright_mark)
        if found is not None:
            return found
    return Rights("PD", "clear", _label(year))
