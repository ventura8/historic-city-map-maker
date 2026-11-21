/**
 * What `photos.onUpload` stores from the file itself (`docs/research/M2-interfaces.md` §3.6): the EXIF fields as plain
 * values (`exif`), and the suggestions the admin accepts with one click (`suggested`): the GPS position and direction,
 * a year and a title from the original file name. EXIF text is untrusted: it is stored and shown as text only.
 */
import { MAX_YEAR, MIN_YEAR, fileStem, isCameraName, yearIn, type PhotoDoc } from '@hcm/shared';

import type { ExifSummary } from '../ports/image-processor.js';
import { compact } from '../api/objects.js';

type Suggestions = NonNullable<PhotoDoc['suggested']>;
type ExifRecord = NonNullable<PhotoDoc['exif']>;

const COORDINATE_DECIMALS = 6;
const BEARING_DECIMALS = 1;
const MAX_TITLE = 200;

const EXIF_DATE = /^(\d{4}):\d{2}:\d{2}/;

function round(value: number, decimals: number): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

/** The EXIF summary as the photo document stores it: plain strings and numbers, only the fields that were found. */
export function exifRecord(exif: ExifSummary): ExifRecord {
    return compact<ExifRecord>({
        make: exif.make,
        model: exif.model,
        dateTimeOriginal: exif.dateTimeOriginal,
        imageDescription: exif.imageDescription,
        artist: exif.artist,
        gpsLatitude: exif.gps?.lat,
        gpsLongitude: exif.gps?.lng,
        gpsImgDirection: exif.direction,
    });
}

function inYearRange(year: number): boolean {
    return year >= MIN_YEAR && year <= MAX_YEAR;
}

/** The year of `DateTimeOriginal` (`1936:07:01 10:00:00`); NaN, so out of range, when it has none. */
function exifYear(exif: ExifSummary): number | undefined {
    const year = Number(EXIF_DATE.exec(exif.dateTimeOriginal ?? '')?.[1]);
    return inYearRange(year) ? year : undefined;
}

/**
 * The year: the camera's own date unless the file name names an earlier year (a 1936 photo scanned in 2024 has the
 * scan's EXIF date: a date later than the file-name year is ignored), else the file-name year.
 */
export function suggestedYear(exif: ExifSummary, originalName: string | undefined): number | undefined {
    const fromName = originalName === undefined ? undefined : yearIn(originalName);
    const fromExif = exifYear(exif);
    if (fromExif === undefined || fromName === undefined) {
        return fromExif ?? fromName;
    }
    return Math.min(fromExif, fromName);
}

/** The file name without its extension, underscores read as spaces; nothing for a camera's own naming. */
export function suggestedTitle(originalName: string | undefined): string | undefined {
    const stem = fileStem(originalName ?? '')
        .replaceAll('_', ' ')
        .replaceAll(/\s+/gu, ' ')
        .trim();
    return stem === '' || isCameraName(stem) ? undefined : stem.slice(0, MAX_TITLE).trim();
}

/** The suggestions of one upload, or undefined when the file suggests nothing. */
export function suggestionsFrom(exif: ExifSummary, originalName: string | undefined): Suggestions | undefined {
    const suggestions = compact<Suggestions>({
        location: exif.gps && { lat: round(exif.gps.lat, COORDINATE_DECIMALS), lng: round(exif.gps.lng, COORDINATE_DECIMALS) },
        year: suggestedYear(exif, originalName),
        bearing: exif.direction === undefined ? undefined : round(exif.direction, BEARING_DECIMALS) % 360,
        title: suggestedTitle(originalName),
    });
    return Object.keys(suggestions).length === 0 ? undefined : suggestions;
}
