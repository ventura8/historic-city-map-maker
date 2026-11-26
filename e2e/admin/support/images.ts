import { writeFile } from 'node:fs/promises';

import type { TestInfo } from '@playwright/test';
import sharp, { type Exif } from 'sharp';

/**
 * The photos the admin tier uploads (docs/research/M2c-interfaces.md §12.3 "Images"): generated at run time, never
 * committed binaries. Real JPEGs from sharp with EXIF written by its `withExif` (a GPS position, the capture date, the
 * camera's direction), an HEIC file's first bytes, and a PDF named like a photo; each written as a file of the test's
 * output folder, which is what a person chooses in the browser's file dialog.
 */

/** What a generated photo's EXIF says. */
export interface PhotoExif {
    /** `[longitude, latitude]`, in decimal degrees. */
    readonly at?: readonly [number, number];
    /** The capture date (`1977:03:04 12:00:00`). */
    readonly taken?: string;
    /** Degrees from north. */
    readonly direction?: number;
}

/** Decimal degrees as EXIF's three rationals: degrees, minutes, seconds in hundredths. */
function dms(value: number): string {
    const absolute = Math.abs(value);
    const degrees = Math.floor(absolute);
    const minutes = Math.floor((absolute - degrees) * 60);
    const hundredths = Math.round(((absolute - degrees) * 60 - minutes) * 60 * 100);
    return `${String(degrees)}/1 ${String(minutes)}/1 ${String(hundredths)}/100`;
}

function exifOf(exif: PhotoExif): Exif {
    const gps =
        exif.at === undefined
            ? {}
            : {
                  GPSLatitudeRef: exif.at[1] >= 0 ? 'N' : 'S',
                  GPSLatitude: dms(exif.at[1]),
                  GPSLongitudeRef: exif.at[0] >= 0 ? 'E' : 'W',
                  GPSLongitude: dms(exif.at[0]),
              };
    const direction = exif.direction === undefined ? {} : { GPSImgDirectionRef: 'T', GPSImgDirection: `${String(exif.direction)}/1` };
    return {
        IFD0: { Make: 'E2E', Model: 'Scanner' },
        IFD2: exif.taken === undefined ? {} : { DateTimeOriginal: exif.taken },
        IFD3: { ...gps, ...direction },
    };
}

/** A JPEG of one colour (`background` makes two photos different files), with `exif` or none. */
export async function jpegBytes(background: string, exif?: PhotoExif): Promise<Buffer> {
    const image = sharp({ create: { width: 64, height: 48, channels: 3, background } }).jpeg();
    return exif === undefined ? image.toBuffer() : image.withExif(exifOf(exif)).toBuffer();
}

/** The first bytes of an HEIC file (an ISO media `ftyp` box of brand `heic`): what a phone exports by default. */
export function heicBytes(): Buffer {
    return Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic', 'ascii'), Buffer.alloc(4), Buffer.from('mif1heic', 'ascii')]);
}

/** A PDF document's first bytes (a scan exported as PDF and renamed `.jpg`). */
export function pdfBytes(): Buffer {
    return Buffer.from('%PDF-1.7\n%e2e\n');
}

/** Writes `bytes` as `name` in the test's output folder and returns its path (what the file dialog hands over). */
export async function photoFile(testInfo: TestInfo, name: string, bytes: Buffer): Promise<string> {
    const path = testInfo.outputPath(name);
    await writeFile(path, bytes);
    return path;
}
