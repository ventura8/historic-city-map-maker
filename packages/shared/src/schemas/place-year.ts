/**
 * A place's (point, line or area) years: one year, a span from and to, (M27 traced streets) only `yearSeen` — the year
 * of the plan the street was traced on — or none at all (the owner's request of 2026-11-22: lines such as railways are
 * imported now and dated when research finishes). Every year is optional in the stored schemas (`poiDocSchema`, the
 * manifest's `poiSchema`), the editor, the GeoJSON import, the Firestore rules (`firebase/firestore.rules` →
 * `yearsInRange`), `review.decide` and `history.revert`; `hasPlaceYear` tells the dated from the research backlog. The stored range stays 1500
 * to 2100 (`yearSchema`): an engine already on jsDelivr validates every manifest against it. The editor, the import and
 * the rules also refuse a year after next year, which needs today's date, so it is a check here and not part of a schema.
 */
import type { ValidationIssue } from './validation.js';

export interface PlaceYears {
    readonly yearStart?: number | undefined;
    readonly yearEnd?: number | undefined;
    /** Year of the historical plan the place was traced on (no known start/end lifespan). */
    readonly yearSeen?: number | undefined;
}

/** True when the place names at least one year (a single year, an open start or end, a span, or a plan year seen). */
export function hasPlaceYear(place: PlaceYears): boolean {
    return place.yearStart !== undefined || place.yearEnd !== undefined || place.yearSeen !== undefined;
}

/** The latest year a place may name at `nowMs` (epoch milliseconds): next year, for a place being built. */
export function latestPlaceYear(nowMs: number): number {
    return new Date(nowMs).getUTCFullYear() + 1;
}

/** The fields of `place` that name a year after `latest`. */
function lateYears(place: PlaceYears, latest: number): ValidationIssue[] {
    return (['yearStart', 'yearEnd', 'yearSeen'] as const)
        .filter((field) => (place[field] ?? 0) > latest)
        .map((field) => ({ path: field, code: 'validation.tooBig' }));
}

/**
 * What Save says of a place's years beyond the schema: a year after `latest` (`validation.tooBig`, whose words the admin's
 * editor gives per field; null: today is not known, nothing is checked). A place with no years at all is valid (the
 * owner's request of 2026-11-22): it is imported now and dated when research finishes, and the viewer shows it at every
 * timeline year with "Years unknown (research ongoing)"; the admin's list finds it with the No years filter.
 */
export function placeYearIssues(place: PlaceYears, latest: number | null): ValidationIssue[] {
    return latest === null ? [] : lateYears(place, latest);
}
