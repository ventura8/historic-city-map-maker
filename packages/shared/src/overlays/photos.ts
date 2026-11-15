/**
 * When a photo is "near" a timeline stop (scenario V04): one rule for the engine's map filter and the viewer's
 * "photos near this year" chip and list (M1-interfaces CR-18). What "today" (`null`) means differs between them (the
 * map shows every photo, the chip none), so that choice stays with the caller.
 */
import type { Photo } from '../schemas/manifest.js';

/** Photos within this many years of the selected stop are "near this year". */
export const PHOTO_YEAR_WINDOW = 10;

/** The windows a visitor can pick for "Only near the selected year" (the owner, 2026-11-15: design B), in years. */
export const PHOTOS_NEAR_WINDOWS = [5, 10, 25] as const;

/**
 * True when the photo's `[year, yearEnd]` span meets `[year - window, year + window]`; an undated photo is near no
 * year.
 */
export function isPhotoNearYear(photo: Pick<Photo, 'year' | 'yearEnd'>, year: number, window: number = PHOTO_YEAR_WINDOW): boolean {
    if (photo.year === undefined) {
        return false;
    }
    const end = photo.yearEnd ?? photo.year;
    return photo.year <= year + window && end >= year - window;
}
