/**
 * The timeline (scenario V04): its stops are the years of the historical layers plus "today" (`null`, no historical
 * layer). A year without a layer snaps to the nearest stop; photos are "near" a stop within `PHOTO_YEAR_WINDOW`
 * years; POIs follow their own span (`poiInYear` of @hcm/shared).
 */
import { isPhotoNearYear, type Layer, type Photo } from '@hcm/shared';

/** Photos within this many years of the selected stop are "near this year" (defined once, in @hcm/shared). */
export { PHOTO_YEAR_WINDOW } from '@hcm/shared';

/** The distinct layer years, oldest first. */
export function timelineYears(layers: readonly Pick<Layer, 'year'>[]): readonly number[] {
    return [...new Set(layers.map((layer) => layer.year))].sort((a, b) => a - b);
}

/**
 * The stop for `year`: `null` stays "today"; any other year snaps to the nearest layer year (the older one on a tie),
 * or to "today" when the city has no layers. A non-finite year is "today".
 */
export function snapYear(year: number | null, years: readonly number[]): number | null {
    if (year === null || !Number.isFinite(year)) {
        return null;
    }
    return years.reduce<number | null>(
        (best, candidate) => (best === null || Math.abs(candidate - year) < Math.abs(best - year) ? candidate : best),
        null,
    );
}

/** The ids of the layers of a stop (none for "today"). */
export function layerIdsOfYear(layers: readonly Pick<Layer, 'id' | 'year'>[], year: number | null): ReadonlySet<string> {
    return new Set(layers.filter((layer) => layer.year === year).map((layer) => layer.id));
}

/**
 * True when the photo was taken within `PHOTO_YEAR_WINDOW` years of `year`: its `[year, yearEnd]` span meets
 * `[year - window, year + window]`. At "today" every photo is shown; an undated photo is near no year.
 */
export function photoNearYear(photo: Pick<Photo, 'year' | 'yearEnd'>, year: number | null): boolean {
    return year === null || isPhotoNearYear(photo, year);
}

/** The photos the map shows at a stop, in manifest order. */
export function photosNearYear<P extends Pick<Photo, 'year' | 'yearEnd'>>(photos: readonly P[], year: number | null): readonly P[] {
    return year === null ? photos : photos.filter((photo) => photoNearYear(photo, year));
}

/**
 * The year a set of visible layers stands for (a shared link names layers, not a year): the newest year among
 * them, or "today" when none of them is a known layer.
 */
export function yearOfLayers(layers: readonly Pick<Layer, 'id' | 'year'>[], visible: readonly string[]): number | null {
    const years = layers.filter((layer) => visible.includes(layer.id)).map((layer) => layer.year);
    return years.length === 0 ? null : Math.max(...years);
}
