/**
 * The timeline's stops and the "photos near this year" filter. A stop is a year that has at least one historical
 * layer, plus `null` for "today" (no historical layer) at the end; a year without a layer snaps to the nearest stop
 * (scenario S-V04-BAD-YEAR-WITHOUT-LAYER).
 */
import { isPhotoNearYear, PHOTO_YEAR_WINDOW, type Layer, type Photo } from '@hcm/shared';

export type TimelineStop = number | null;

/** The layer years in ascending order without duplicates, then `null` ("today"). */
export function timelineStops(layers: readonly Pick<Layer, 'year'>[]): readonly TimelineStop[] {
    const years = [...new Set(layers.map((layer) => layer.year))].sort((a, b) => a - b);
    return [...years, null];
}

/** The index of the stop that shows `year`: itself, else the nearest year (the earlier one on a tie); "today" is last. */
export function stopIndex(stops: readonly TimelineStop[], year: TimelineStop): number {
    if (year === null) {
        return stops.length - 1;
    }
    let best = stops.length - 1;
    let bestDistance = Number.POSITIVE_INFINITY;
    stops.forEach((stop, index) => {
        const distance = stop === null ? Number.POSITIVE_INFINITY : Math.abs(stop - year);
        if (distance < bestDistance) {
            best = index;
            bestDistance = distance;
        }
    });
    return best;
}

/** The photos dated within `window` years of `year`, in manifest order; none at "today" or for undated photos. */
export function photosNearYear<T extends Pick<Photo, 'year' | 'yearEnd'>>(
    photos: readonly T[],
    year: TimelineStop,
    window: number = PHOTO_YEAR_WINDOW,
): readonly T[] {
    return year === null ? [] : photos.filter((photo) => isPhotoNearYear(photo, year, window));
}

/**
 * How the timeline fits its years (the Pixel Tablet, 2026-11-12: twenty-two stops 30 px apart overflowed the card and
 * clipped 1847 to "7"; the owner, 2026-11-14: "too crowded", only the years; then "the spacing is way nuked":
 * a fixed gap, the same at every width, never stretched to the card nor proportional to time; then a smaller one, 40 px,
 * with a dot per year lying). The years are always
 * exactly `YEAR_GAP_PX` apart from the card's leading edge: `roomy` when they fit the card, the rest of it empty past
 * "today"; `scroll` when they do not, the card scrolling (a finger, a mouse's drag or wheel) and fading the edge it hides.
 */
export type TimelineDensity = 'roomy' | 'scroll';

/**
 * Px between two stops, at every width and both ways (a design token: two four-digit labels in label large, about 32 px
 * each, with room between them; standing, a 20 px label line and room). A longer label that would touch its neighbour's
 * is left out lying (`crowdedLabels`, `timeline-edges.ts`).
 */
export const YEAR_GAP_PX = 40;

/** The density of a card with `roomPx` along its track for `gaps` gaps between stops. */
export function timelineDensity(roomPx: number, gaps: number): TimelineDensity {
    return gaps * YEAR_GAP_PX <= roomPx ? 'roomy' : 'scroll';
}
