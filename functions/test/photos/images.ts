/**
 * Test images, generated at run time (never committed binaries): real JPEG, PNG, WebP and TIFF files from sharp,
 * EXIF written with sharp's `withExif`, and hand-made headers for what sharp cannot or should not produce (an HEIC
 * `ftyp` box, a PNG whose header claims 240 megapixels, a PNG whose pixels are garbage).
 */
import { crc32, deflateSync } from 'node:zlib';

import sharp from 'sharp';

export interface ExifInput {
    readonly make?: string;
    readonly description?: string;
    readonly dateTimeOriginal?: string;
    /** Degrees, minutes, seconds as EXIF rationals (`'44/1 25/1 3000/100'`) with their reference letters. */
    readonly gps?: { readonly lat: string; readonly latRef: string; readonly lng: string; readonly lngRef: string };
    readonly direction?: string;
}

function exifBlock(exif: ExifInput) {
    return {
        IFD0: {
            ...(exif.make === undefined ? {} : { Make: exif.make, Model: 'M1' }),
            ...(exif.description === undefined ? {} : { ImageDescription: exif.description, Artist: 'Someone' }),
        },
        IFD2: exif.dateTimeOriginal === undefined ? {} : { DateTimeOriginal: exif.dateTimeOriginal },
        IFD3: {
            ...(exif.gps === undefined
                ? {}
                : {
                      GPSLatitudeRef: exif.gps.latRef,
                      GPSLatitude: exif.gps.lat,
                      GPSLongitudeRef: exif.gps.lngRef,
                      GPSLongitude: exif.gps.lng,
                  }),
            ...(exif.direction === undefined ? {} : { GPSImgDirectionRef: 'T', GPSImgDirection: exif.direction }),
        },
    };
}

/** A JPEG of `width` × `height` pixels, with the given EXIF (none when `exif` is omitted). */
export async function jpeg(width: number, height: number, exif?: ExifInput): Promise<Uint8Array> {
    const image = sharp({ create: { width, height, channels: 3, background: '#8b5e3c' } }).jpeg();
    return new Uint8Array(await (exif === undefined ? image : image.withExif(exifBlock(exif))).toBuffer());
}

/** A JPEG whose EXIF orientation (6: rotate 90°) makes a `width` × `height` image display as `height` × `width`. */
export async function rotatedJpeg(width: number, height: number): Promise<Uint8Array> {
    return new Uint8Array(
        await sharp({ create: { width, height, channels: 3, background: '#335577' } })
            .jpeg()
            .withMetadata({ orientation: 6 })
            .toBuffer(),
    );
}

export async function encoded(format: 'png' | 'webp' | 'tiff', width = 30, height = 20): Promise<Uint8Array> {
    return new Uint8Array(
        await sharp({ create: { width, height, channels: 3, background: '#224466' } })
            .toFormat(format)
            .toBuffer(),
    );
}

function chunk(type: string, data: Uint8Array): Uint8Array {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
}

/** A PNG with a valid header (`width` × `height`, 8-bit grey) and pixel data that cannot be decoded. */
export function pngHeaderOnly(width: number, height: number): Uint8Array {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return new Uint8Array(
        Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(10))), chunk('IEND', Buffer.alloc(0))]),
    );
}

/** The first bytes of an ISO base media file with the given major brand (`heic`, `mif1`, `avif`). */
export function isoMedia(brand: string): Uint8Array {
    return new Uint8Array(
        Buffer.concat([
            Buffer.from([0, 0, 0, 24]),
            Buffer.from(`ftyp${brand}`, 'ascii'),
            Buffer.alloc(4),
            Buffer.from(`mif1${brand}`, 'ascii'),
        ]),
    );
}

export const SVG = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
);

export const PDF = new TextEncoder().encode('%PDF-1.7\n%test\n');

/** A JPEG cut after its first 200 bytes: the header itself is incomplete. */
export async function truncatedJpeg(): Promise<Uint8Array> {
    return (await jpeg(64, 64)).subarray(0, 200);
}

/** An animated WebP of two `side` × `side` frames (the tab icon refuses it). */
export async function animatedWebp(side: number): Promise<Uint8Array> {
    const frames = await Promise.all(
        ['#224466', '#664422'].map((background) =>
            sharp({ create: { width: side, height: side, channels: 3, background } })
                .png()
                .toBuffer(),
        ),
    );
    return new Uint8Array(
        await sharp(frames, { join: { animated: true } })
            .webp({ loop: 0, delay: [100, 100] })
            .toBuffer(),
    );
}
