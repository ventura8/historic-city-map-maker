import { PHOTO_LIMITS, type PhotoContentType } from '@hcm/shared';
import type sharp from 'sharp';

import { UpstreamError } from '../ports/errors.js';
import type { GreyImage, IconSource, ImageInspection, ImageProcessor } from '../ports/image-processor.js';
import { readExif } from './image-exif.js';

type Sniffer = (bytes: Uint8Array) => boolean;

function startsWith(bytes: Uint8Array, at: number, expected: readonly number[] | string): boolean {
    const wanted = typeof expected === 'string' ? Array.from(expected, (char) => char.charCodeAt(0)) : expected;
    return wanted.every((byte, index) => bytes[at + index] === byte);
}

/** The ISO base media brand of a HEIF file (`ftyp` box at offset 4, major brand at 8). */
function brandIn(bytes: Uint8Array, brands: readonly string[]): boolean {
    return startsWith(bytes, 4, 'ftyp') && brands.some((brand) => startsWith(bytes, 8, brand));
}

/**
 * The accepted photo types by their magic numbers (security review §1.5: never the client's content type or the file
 * name). SVG, PDF, AVIF, GIF and everything else match none and are refused.
 */
const SNIFFERS: readonly (readonly [PhotoContentType, Sniffer])[] = [
    ['image/jpeg', (bytes) => startsWith(bytes, 0, [0xff, 0xd8, 0xff])],
    ['image/png', (bytes) => startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ['image/webp', (bytes) => startsWith(bytes, 0, 'RIFF') && startsWith(bytes, 8, 'WEBP')],
    ['image/tiff', (bytes) => startsWith(bytes, 0, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, 0, [0x4d, 0x4d, 0x00, 0x2a])],
    ['image/heic', (bytes) => brandIn(bytes, ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'])],
    ['image/heif', (bytes) => brandIn(bytes, ['mif1', 'msf1', 'heif'])],
];

/** What the bytes are, from their magic numbers alone. */
export function sniffPhotoType(bytes: Uint8Array): PhotoContentType | undefined {
    return SNIFFERS.find(([, sniff]) => sniff(bytes))?.[0];
}

/**
 * HEIC and HEIF photos (iPhones) are HEVC-coded, which sharp's prebuilt libvips cannot decode (it reads AVIF only):
 * they are reported with their type and no size, and `photos.onUpload` refuses them with an actionable message.
 */
const UNDECODABLE: ReadonlySet<PhotoContentType> = new Set(['image/heic', 'image/heif']);

let sharpLoading: Promise<typeof sharp> | undefined;

/**
 * sharp and its native libvips, loaded on the first photo (DECISIONS-for-review.md §22c): the 32 functions are one
 * codebase, so every instance loads `index.js`, and only `photos.onUpload` ever needs an image library.
 */
async function loadSharp(): Promise<typeof sharp> {
    // Admin sweep 2026-11-14: libvips keeps a cache of up to 50 MB of decoded images by default, a fifth of a 256 MiB function
    // (`imagery.browse` ran out of memory 14 times); every image here is decoded once, so nothing is cached.
    sharpLoading ??= import('sharp').then((module) => {
        module.default.cache(false);
        return module.default;
    });
    return sharpLoading;
}

/** Bytes sharp cannot read (CR-M2-23): `photos.onUpload` answers `apiError.photo.unreadable`. */
function unreadable(): UpstreamError {
    return new UpstreamError('image', 'invalid');
}

/** Header only (no pixels are decoded), so the size of an image over the pixel limit is still reported. */
async function inspectDecodable(bytes: Uint8Array, contentType: PhotoContentType): Promise<ImageInspection> {
    const decoder = await loadSharp();
    const metadata = await decoder(bytes, { limitInputPixels: false })
        .metadata()
        .catch(() => {
            throw unreadable();
        });
    const size = metadata.autoOrient;
    const frames = metadata.pages ?? 1;
    return { contentType, width: size.width, height: size.height, exif: readExif(metadata.exif), ...(frames > 1 ? { frames } : {}) };
}

/** The input sharp decodes for an icon: the upload's bytes, or our own SVG text (never a user's). */
function iconInput(source: IconSource): Buffer {
    return 'upload' in source ? Buffer.from(source.upload) : Buffer.from(source.ownSvg, 'utf8');
}

/** One PNG of `source` fitted inside a `size` square, transparent around it, no metadata. */
async function iconPng(source: IconSource, size: number): Promise<Uint8Array> {
    const decoder = await loadSharp();
    const output = await decoder(iconInput(source), { limitInputPixels: PHOTO_LIMITS.maxInputPixels })
        .resize({ width: size, height: size, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toBuffer()
        .catch(() => {
            throw unreadable();
        });
    return new Uint8Array(output);
}

/** A small grey copy of a browse image (the cloud estimate's input): one channel, fitted inside `longEdge`. */
async function grey(bytes: Uint8Array, longEdge: number): Promise<GreyImage> {
    const decoder = await loadSharp();
    const output = await decoder(bytes, { limitInputPixels: PHOTO_LIMITS.maxInputPixels })
        .greyscale()
        .resize({ width: longEdge, height: longEdge, fit: 'inside', withoutEnlargement: true })
        .extractChannel(0)
        .raw()
        .toBuffer({ resolveWithObject: true })
        .catch(() => {
            throw unreadable();
        });
    return { pixels: new Uint8Array(output.data), width: output.info.width, height: output.info.height };
}

/** A browse image too large to store, shrunk (a JPEG is decoded at a fraction of its size by libvips' shrink-on-load). */
async function jpeg(bytes: Uint8Array, longEdge: number): Promise<Uint8Array> {
    const decoder = await loadSharp();
    const output = await decoder(bytes, { limitInputPixels: PHOTO_LIMITS.maxInputPixels })
        .resize({ width: longEdge, height: longEdge, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer()
        .catch(() => {
            throw unreadable();
        });
    return new Uint8Array(output);
}

/**
 * sharp (libvips) behind the `ImageProcessor` port. `inspect` sniffs the magic numbers before sharp sees anything and
 * reads only the header, so a decompression bomb is measured, never decoded; `webp` decodes with sharp's
 * `limitInputPixels` at `PHOTO_LIMITS.maxInputPixels`, applies the EXIF orientation and writes no metadata at all
 * (sharp keeps none unless asked). Unreadable bytes reject with `UpstreamError` `invalid`.
 */
export function createSharpImageProcessor(): ImageProcessor {
    return {
        inspect: async (bytes) => {
            const contentType = sniffPhotoType(bytes);
            if (contentType === undefined || UNDECODABLE.has(contentType)) {
                return { contentType, width: 0, height: 0, exif: {} };
            }
            return inspectDecodable(bytes, contentType);
        },
        webp: async (bytes, options) => {
            const decoder = await loadSharp();
            const output = await decoder(bytes, { limitInputPixels: PHOTO_LIMITS.maxInputPixels })
                .rotate()
                .resize({ width: options.longEdge, height: options.longEdge, fit: 'inside', withoutEnlargement: true })
                .webp({ quality: options.quality })
                .toBuffer({ resolveWithObject: true })
                .catch(() => {
                    throw unreadable();
                });
            return { bytes: new Uint8Array(output.data), width: output.info.width, height: output.info.height };
        },
        iconPng,
        grey,
        jpeg,
    };
}
