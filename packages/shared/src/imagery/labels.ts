/**
 * The label and year of a new layer version (`docs/research/M3-interfaces.md` §4.1): a USGS scene is named after its
 * camera and acquisition date in each language (`KH-4A Corona, 12 iulie 1966`, `KH-4A Corona, 12 July 1966`); an
 * uploaded GeoTIFF after its file name without the extension (Romanian only: the English label falls back to it).
 */
import { MAX_YEAR, MIN_YEAR, yearIn } from '../migration/year.js';
import { fileStem } from '../migration/slug.js';
import { SENSOR_SPECS, type Sensor } from '../schemas/usgs-scene.js';

const MONTHS = {
    ro: [
        'ianuarie',
        'februarie',
        'martie',
        'aprilie',
        'mai',
        'iunie',
        'iulie',
        'august',
        'septembrie',
        'octombrie',
        'noiembrie',
        'decembrie',
    ],
    en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
} as const;

/** A layer's label as the documents store it (`localizedPartial`). */
export interface LayerLabel {
    readonly ro: string;
    readonly en?: string;
}

/** `YYYY-MM-DD` (a valid date: the schemas checked it) as `12 iulie 1966`. */
function spelled(date: string, months: readonly string[]): string {
    const day = Number(date.slice(8, 10));
    const month = months[Number(date.slice(5, 7)) - 1];
    return `${String(day)} ${String(month)} ${date.slice(0, 4)}`;
}

/** The label of a version made from a scene of `sensor` taken on `date` (`YYYY-MM-DD`). */
export function layerLabelFor(sensor: Sensor, date: string): { readonly ro: string; readonly en: string } {
    const name = SENSOR_SPECS[sensor].name;
    return { ro: `${name}, ${spelled(date, MONTHS.ro)}`, en: `${name}, ${spelled(date, MONTHS.en)}` };
}

/** The year of a `YYYY-MM-DD` date. */
export function yearOfDate(date: string): number {
    return Number(date.slice(0, 4));
}

/** The label of an uploaded raster: its file name without the extension, or `fallback` for a name that is only one. */
export function uploadLabelFor(originalName: string | undefined, fallback: string): LayerLabel {
    const stem = originalName === undefined ? '' : fileStem(originalName).trim();
    return { ro: (stem === '' ? fallback : stem).slice(0, 200) };
}

/** `value` as a year between `MIN_YEAR` and `MAX_YEAR`, or undefined. */
function validYear(value: string | undefined): number | undefined {
    const year = Number(value);
    return Number.isInteger(year) && year >= MIN_YEAR && year <= MAX_YEAR ? year : undefined;
}

/** The year an upload shows: its metadata's `year`, else the one its name says, else undefined (the admin is asked). */
export function uploadYearOf(metadataYear: string | undefined, originalName: string | undefined): number | undefined {
    return validYear(metadataYear) ?? (originalName === undefined ? undefined : yearIn(originalName));
}

/**
 * A KH-5 Argon frame by its id (admin sweep 2026-11-14, bug 5): missions 9xxxA with `MC`, the mapping camera (DS09065A089MC039). USGS
 * files them under `corona2`, and frames harvested before the id rule were imported as KH-4A Corona.
 */
export const ARGON_FRAME_ID = /^DS0*9\d{3}A\d+MC\d+$/i;

/** The label a version shows: an Argon frame imported under another camera's name is named after Argon, its date kept. */
export function frameLabel<Label extends { readonly ro: string; readonly en?: string | undefined }>(
    label: Label,
    entityId: string | undefined,
): Label {
    if (entityId === undefined || !ARGON_FRAME_ID.test(entityId)) {
        return label;
    }
    const argon = SENSOR_SPECS['KH-5'].name;
    const rename = (text: string): string => text.replace(/^KH-4[AB]? Corona/, argon);
    return label.en === undefined ? { ...label, ro: rename(label.ro) } : { ...label, ro: rename(label.ro), en: rename(label.en) };
}

/** A frame too coarse for a city's streets (about 140 m a pixel where the city needs 15 m): an Argon frame, by its camera or its id. */
export function tooCoarseForStreets(entityIds: readonly string[], sensor: Sensor | undefined): boolean {
    return sensor === 'KH-5' || entityIds.some((id) => ARGON_FRAME_ID.test(id));
}
