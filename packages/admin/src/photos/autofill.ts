/**
 * EXIF auto-fill (`docs/research/M2c-interfaces.md` §6.2 step 4): `photos.onUpload` writes what it read from the file
 * as `suggested` (position, year, direction, a title from the file name or the EXIF description); for a photo created
 * in this session that the admin has not touched, the area applies them in one stamped update. A position outside the
 * city (its bounds plus `PHOTO_LOCATION_SLACK_DEG`) is never applied (`S-A08-BAD-EXIF-OUTSIDE-CITY`). After a reload
 * the suggestions not applied yet are offered one by one in the editor. Suggestions are text: shown, never rendered.
 */
import { bboxContains, bboxExpand, PHOTO_LOCATION_SLACK_DEG, roundTo, type BBox, type LngLat, type PhotoDoc } from '@hcm/shared';

type Suggested = NonNullable<PhotoDoc['suggested']>;

/** The fields a suggestion fills. */
export type SuggestionField = 'location' | 'year' | 'bearing' | 'title';

export type AutofillFields = Partial<Pick<PhotoDoc, 'location' | 'year' | 'bearing' | 'title'>>;

export interface Autofill {
    readonly fields: AutofillFields;
    /** No position from the file, or one outside the city: the photo keeps the fallback pin (check its place). */
    readonly checkPlace: boolean;
}

/** One suggestion the editor offers: its value as text, and whether applying it is refused (outside the city). */
export interface Suggestion {
    readonly field: SuggestionField;
    readonly text: string;
    readonly outside: boolean;
}

/** Whether `location` lies inside the city's bounds plus the slack the manifest and the rules allow. */
export function insideCity(location: { readonly lat: number; readonly lng: number }, bounds: BBox): boolean {
    const position: LngLat = [location.lng, location.lat];
    return bboxContains(bboxExpand(bounds, PHOTO_LOCATION_SLACK_DEG), position);
}

function locationFields(suggested: Suggested, bounds: BBox): AutofillFields {
    return suggested.location !== undefined && insideCity(suggested.location, bounds) ? { location: suggested.location } : {};
}

function titleFields(photo: PhotoDoc, suggested: Suggested): AutofillFields {
    return suggested.title === undefined ? {} : { title: { ...photo.title, ro: suggested.title } };
}

/** What to apply to a new photo the admin has not touched, once processed. */
export function autofillOf(photo: PhotoDoc, bounds: BBox): Autofill {
    const suggested = photo.suggested ?? {};
    const fields: AutofillFields = {
        ...locationFields(suggested, bounds),
        ...(suggested.year === undefined ? {} : { year: suggested.year }),
        ...(suggested.bearing === undefined ? {} : { bearing: suggested.bearing }),
        ...titleFields(photo, suggested),
    };
    return { fields, checkPlace: fields.location === undefined };
}

function sameLocation(a: { readonly lat: number; readonly lng: number }, b: { readonly lat: number; readonly lng: number }): boolean {
    return roundTo(a.lat, 7) === roundTo(b.lat, 7) && roundTo(a.lng, 7) === roundTo(b.lng, 7);
}

function locationSuggestion(photo: PhotoDoc, suggested: Suggested, bounds: BBox): Suggestion[] {
    const location = suggested.location;
    if (location === undefined || (photo.location !== undefined && sameLocation(location, photo.location))) {
        return [];
    }
    return [{ field: 'location', text: `${String(location.lat)}, ${String(location.lng)}`, outside: !insideCity(location, bounds) }];
}

function valueSuggestion(field: 'year' | 'bearing', value: number | undefined, current: number | undefined): Suggestion[] {
    return value === undefined || value === current ? [] : [{ field, text: String(value), outside: false }];
}

function titleSuggestion(photo: PhotoDoc, suggested: Suggested): Suggestion[] {
    const title = suggested.title;
    return title === undefined || title === photo.title.ro ? [] : [{ field: 'title', text: title, outside: false }];
}

/** The suggestions that differ from the photo as it is (each offered with Apply, or with why it cannot be). */
export function pendingSuggestions(photo: PhotoDoc, bounds: BBox): readonly Suggestion[] {
    const suggested = photo.suggested ?? {};
    return [
        ...locationSuggestion(photo, suggested, bounds),
        ...valueSuggestion('year', suggested.year, photo.year),
        ...valueSuggestion('bearing', suggested.bearing, photo.bearing),
        ...titleSuggestion(photo, suggested),
    ];
}

/** The draft fields one accepted suggestion sets (none for a refused position). */
export function suggestionPatch(photo: PhotoDoc, field: SuggestionField, bounds: BBox): AutofillFields {
    const fields = autofillOf(photo, bounds).fields;
    return fields[field] === undefined ? {} : { [field]: fields[field] };
}
