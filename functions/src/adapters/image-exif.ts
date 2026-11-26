/**
 * A small, defensive EXIF reader for `adapters/image.ts`: the TIFF structure sharp returns as `metadata().exif`
 * (`Exif\0\0` + TIFF header + IFDs), reading only the fields `photos.onUpload` needs (camera, description, artist,
 * the original date, GPS position and direction). EXIF is attacker-controlled: every offset is bounds-checked, a
 * malformed field is skipped and a malformed block yields an empty summary, never an exception; strings are plain text
 * with control characters replaced, at most 500 characters.
 */
import type { ExifSummary } from '../ports/image-processor.js';

const EXIF_PREFIX = [0x45, 0x78, 0x69, 0x66, 0, 0];
const MAX_TEXT = 500;
const MAX_ENTRIES = 256;
const LITTLE_ENDIAN = 0x4949;
const BIG_ENDIAN = 0x4d4d;
const TIFF_MAGIC = 42;

/** TIFF field types and their sizes in bytes. */
const TYPE_SIZES: Readonly<Record<number, number>> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
const ASCII = 2;
const LONG = 4;
const RATIONAL = 5;

const TAGS = {
    imageDescription: 0x010e,
    make: 0x010f,
    model: 0x0110,
    artist: 0x013b,
    exifIfd: 0x8769,
    gpsIfd: 0x8825,
    dateTimeOriginal: 0x9003,
    gpsLatitudeRef: 0x0001,
    gpsLatitude: 0x0002,
    gpsLongitudeRef: 0x0003,
    gpsLongitude: 0x0004,
    gpsImgDirection: 0x0011,
} as const;

interface Entry {
    readonly type: number;
    readonly count: number;
    /** Where the value starts, relative to the TIFF header. */
    readonly offset: number;
}

/** One IFD's entries by tag. */
type Ifd = ReadonlyMap<number, Entry>;

/** The TIFF block and its byte order; every read is bounds-checked against it. */
interface Tiff {
    readonly view: DataView;
    readonly little: boolean;
}

function inside(tiff: Tiff, offset: number, length: number): boolean {
    return offset >= 0 && offset + length <= tiff.view.byteLength;
}

function u16(tiff: Tiff, offset: number): number {
    return inside(tiff, offset, 2) ? tiff.view.getUint16(offset, tiff.little) : 0;
}

function u32(tiff: Tiff, offset: number): number {
    return inside(tiff, offset, 4) ? tiff.view.getUint32(offset, tiff.little) : 0;
}

/** The 12-byte entry at `at`: a value of at most 4 bytes is stored in place, a longer one at an offset. */
function entryAt(tiff: Tiff, at: number): readonly [number, Entry] | undefined {
    const type = u16(tiff, at + 2);
    const count = u32(tiff, at + 4);
    const size = (TYPE_SIZES[type] ?? 0) * count;
    const offset = size <= 4 ? at + 8 : u32(tiff, at + 8);
    return size > 0 && inside(tiff, offset, size) ? [u16(tiff, at), { type, count, offset }] : undefined;
}

function readIfd(tiff: Tiff, offset: number): Ifd {
    const count = Math.min(u16(tiff, offset), MAX_ENTRIES);
    const entries = Array.from({ length: count }, (_, index) => entryAt(tiff, offset + 2 + index * 12));
    return new Map(entries.filter((entry) => entry !== undefined));
}

/** Control characters (NUL padding included) become spaces; runs of white space collapse. */
function cleanText(raw: string): string | undefined {
    const printable = Array.from(raw, (char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char)).join('');
    const text = printable.replaceAll(/\s+/gu, ' ').trim();
    return text === '' ? undefined : text.slice(0, MAX_TEXT);
}

function text(tiff: Tiff, ifd: Ifd, tag: number): string | undefined {
    const entry = ifd.get(tag);
    if (entry?.type !== ASCII) {
        return undefined;
    }
    return cleanText(new TextDecoder('utf-8').decode(new Uint8Array(tiff.view.buffer, tiff.view.byteOffset + entry.offset, entry.count)));
}

function rationals(tiff: Tiff, ifd: Ifd, tag: number): number[] {
    const entry = ifd.get(tag);
    if (entry?.type !== RATIONAL) {
        return [];
    }
    return Array.from({ length: entry.count }, (_, index) => u32(tiff, entry.offset + index * 8) / u32(tiff, entry.offset + index * 8 + 4));
}

function pointer(tiff: Tiff, ifd: Ifd, tag: number): Ifd {
    const entry = ifd.get(tag);
    return entry?.type === LONG ? readIfd(tiff, u32(tiff, entry.offset)) : new Map<number, Entry>();
}

/** Degrees, minutes and seconds as decimal degrees; NaN unless there are exactly three. */
function decimalDegrees(values: readonly number[]): number {
    return values.length === 3 ? values.reduce((sum, value, index) => sum + value / 60 ** index, 0) : Number.NaN;
}

/** One GPS coordinate with its `N`/`S` or `E`/`W` reference; undefined unless it is a finite number. */
function coordinate(tiff: Tiff, gps: Ifd, tags: readonly [ref: number, value: number], negative: string): number | undefined {
    const value = decimalDegrees(rationals(tiff, gps, tags[1]));
    if (!Number.isFinite(value)) {
        return undefined;
    }
    return text(tiff, gps, tags[0]) === negative ? -value : value;
}

/** A real fix: in range, and not the `0, 0` some cameras write without one. */
function isFix(lat: number, lng: number): boolean {
    return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0);
}

function position(tiff: Tiff, gps: Ifd): ExifSummary['gps'] {
    const lat = coordinate(tiff, gps, [TAGS.gpsLatitudeRef, TAGS.gpsLatitude], 'S');
    const lng = coordinate(tiff, gps, [TAGS.gpsLongitudeRef, TAGS.gpsLongitude], 'W');
    return lat !== undefined && lng !== undefined && isFix(lat, lng) ? { lat, lng } : undefined;
}

function direction(tiff: Tiff, gps: Ifd): number | undefined {
    const [degrees] = rationals(tiff, gps, TAGS.gpsImgDirection);
    return degrees !== undefined && degrees >= 0 && degrees <= 360 ? degrees : undefined;
}

/** The TIFF block: after the `Exif\0\0` sharp puts in front, or the whole buffer when there is none. */
function tiffView(exif: Uint8Array): DataView {
    const start = EXIF_PREFIX.every((byte, index) => exif[index] === byte) ? EXIF_PREFIX.length : 0;
    return new DataView(exif.buffer, exif.byteOffset + start, Math.max(exif.byteLength - start, 0));
}

/** The byte order and IFD0 of a well-formed TIFF header (`II*\0` or `MM\0*`); undefined for anything else. */
function openTiff(exif: Uint8Array): { readonly tiff: Tiff; readonly ifd0: number } | undefined {
    const view = tiffView(exif);
    const order = view.byteLength >= 8 ? view.getUint16(0) : 0;
    const tiff = { view, little: order === LITTLE_ENDIAN };
    const known = order === LITTLE_ENDIAN || order === BIG_ENDIAN;
    return known && u16(tiff, 2) === TIFF_MAGIC ? { tiff, ifd0: u32(tiff, 4) } : undefined;
}

type Found = { readonly [K in keyof ExifSummary]-?: ExifSummary[K] | undefined };

/** The summary without the fields that were not found (`exactOptionalPropertyTypes`: absent, never `undefined`). */
function withoutMissing(found: Found): ExifSummary {
    return Object.fromEntries(Object.entries(found).filter(([, value]) => value !== undefined));
}

/** The fields of `ExifSummary` found in an EXIF block (`metadata().exif`); an empty summary for no or broken EXIF. */
export function readExif(exif: Uint8Array | undefined): ExifSummary {
    const opened = exif === undefined ? undefined : openTiff(exif);
    if (opened === undefined) {
        return {};
    }
    const { tiff } = opened;
    const ifd0 = readIfd(tiff, opened.ifd0);
    const gps = pointer(tiff, ifd0, TAGS.gpsIfd);
    return withoutMissing({
        dateTimeOriginal: text(tiff, pointer(tiff, ifd0, TAGS.exifIfd), TAGS.dateTimeOriginal),
        gps: position(tiff, gps),
        direction: direction(tiff, gps),
        make: text(tiff, ifd0, TAGS.make),
        model: text(tiff, ifd0, TAGS.model),
        imageDescription: text(tiff, ifd0, TAGS.imageDescription),
        artist: text(tiff, ifd0, TAGS.artist),
    });
}
