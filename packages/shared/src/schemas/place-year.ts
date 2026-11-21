/**
 * A place's (point, line or area) years as Save wants them (the owner's request of 2026-11-12): one year, or a span from
 * and to, or (M27 traced streets) only `yearSeen` — the year of the plan the street was traced on, when start and end
 * are unknown. The stored schemas (`poiDocSchema`, the manifest's `poiSchema`) keep every year optional, so a place
 * written before the rule still loads in the admin and still shows on the public map; the admin's editor, the GeoJSON
 * import, the Firestore rules (`firebase/firestore.rules` → `dated`) and `review.decide` ask for at least one of those
 * before a place is written or approved, and `history.revert` keeps a dated place's years. The stored range stays 1800
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
 * What Save says of a place's years beyond the schema: none at all (`validation.required` on `yearStart`), or a year after
 * `latest` (`validation.tooBig`, whose words the admin's editor gives per field; null: today is not known, nothing is checked). The order of the two and their range
 * (1800 to 2100) are the schema's. A place with only `yearSeen` is dated (traced on a plan of that year).
 */
export function placeYearIssues(place: PlaceYears, latest: number | null): ValidationIssue[] {
    if (!hasPlaceYear(place)) {
        return [{ path: 'yearStart', code: 'validation.required' }];
    }
    return latest === null ? [] : lateYears(place, latest);
}
