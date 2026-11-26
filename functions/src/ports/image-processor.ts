import type { PhotoContentType } from '@hcm/shared';

/** The EXIF fields `photos.onUpload` reads (plain values; strings are untrusted text, never markup). */
export interface ExifSummary {
    readonly dateTimeOriginal?: string;
    readonly gps?: { readonly lat: number; readonly lng: number };
    /** Degrees from north, `GPSImgDirection`. */
    readonly direction?: number;
    readonly make?: string;
    readonly model?: string;
    readonly imageDescription?: string;
    readonly artist?: string;
}

/** What the bytes are, read from their magic numbers (never from a file name or a client's content type). */
export interface ImageInspection {
    /** Undefined for anything that is not an accepted photo (SVG, PDF, a renamed file). */
    readonly contentType: PhotoContentType | undefined;
    readonly width: number;
    readonly height: number;
    readonly exif: ExifSummary;
    /** The frames of the image (more than one: an animated WebP or GIF); absent for one. */
    readonly frames?: number;
}

/**
 * What a tab icon is drawn from: the bytes an editor uploaded (a PNG or a WebP the handler checked), or our own SVG text
 * (`mapIconSvg` of `@hcm/shared`, the default icon). A user's SVG never reaches the processor: `inspect` refuses it.
 */
export type IconSource = { readonly upload: Uint8Array } | { readonly ownSvg: string };

interface DerivativeOptions {
    readonly longEdge: number;
    readonly quality: number;
}

/**
 * sharp behind a port (`PHOTO_LIMITS` of `@hcm/shared`: `limitInputPixels` 200 MP, WebP 2048 px and 400 px, metadata
 * stripped). Adapter `functions/src/adapters/image.ts` (fn-content); tests use generated images, never committed
 * binaries.
 */
export interface ImageProcessor {
    /**
     * Reads the header only, never the pixels: an image over the pixel limit is reported with its size (the handler
     * answers `photo.tooLarge`), and a type the runtime cannot decode (HEIC) with its type and no size. Rejects with
     * `UpstreamError('image', 'invalid')` for unreadable bytes (CR-M2-31).
     */
    inspect(bytes: Uint8Array): Promise<ImageInspection>;
    /** A WebP no larger than `longEdge` on its long side, rotated by its EXIF orientation, with no metadata (`limitInputPixels` enforced). */
    webp(
        bytes: Uint8Array,
        options: DerivativeOptions,
    ): Promise<{ readonly bytes: Uint8Array; readonly width: number; readonly height: number }>;
    /**
     * A PNG of the source fitted inside a square of `size` (never cropped, the rest transparent), no metadata
     * (`limitInputPixels` enforced). Rejects with `UpstreamError('image', 'invalid')` for unreadable bytes.
     */
    iconPng(source: IconSource, size: number): Promise<Uint8Array>;
    /**
     * The image in shades of grey, no larger than `longEdge` on its long side (`limitInputPixels` enforced): one byte a pixel, row by
     * row, what the cloud estimate of a USGS browse image reads (`imagery/cloud-estimate.ts`). Rejects with
     * `UpstreamError('image', 'invalid')` for unreadable bytes.
     */
    grey(bytes: Uint8Array, longEdge: number): Promise<GreyImage>;
    /**
     * A JPEG no larger than `longEdge` on its long side, no metadata (`limitInputPixels` enforced): a USGS browse image over the
     * stored size, shrunk. Rejects with `UpstreamError('image', 'invalid')` for unreadable bytes.
     */
    jpeg(bytes: Uint8Array, longEdge: number): Promise<Uint8Array>;
}

/** A small greyscale raster: `pixels[y * width + x]`, 0 black to 255 white. */
export interface GreyImage {
    readonly pixels: Uint8Array;
    readonly width: number;
    readonly height: number;
}
