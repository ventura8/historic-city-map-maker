import type { PhotoContentType } from '@hcm/shared';

import { UpstreamError } from '../../src/ports/errors.js';
import type { ImageProcessor } from '../../src/ports/image-processor.js';
import { PortRecorder, promised } from './recorder.js';

/**
 * An `ImageProcessor` without sharp, for the handlers of `photos.*`: a test builds the bytes of an "image" with
 * `fakeImage({...})` (a marker plus JSON: its type, size and EXIF), and the fake reads them back as `inspect` would read
 * a real file. Bytes without the marker are not an accepted photo (`contentType` undefined, like an SVG or a PDF);
 * `UNREADABLE_IMAGE` and an image over `maxInputPixels` reject with `UpstreamError` `invalid`, as the adapter does. The
 * WebP derivatives and the icon's PNGs are fake bytes that name their size. The adapter itself is tested with generated images and sharp.
 */

type Inspection = Awaited<ReturnType<ImageProcessor['inspect']>>;

const MARKER = 'HCM-FAKE-IMAGE:';
const UNREADABLE = 'HCM-FAKE-UNREADABLE';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Bytes the fake cannot decode (`photo.unreadable`). */
export const UNREADABLE_IMAGE = encoder.encode(UNREADABLE);

/** The bytes of a fake image: a JPEG of 4000 × 3000 without EXIF unless told otherwise. */
export function fakeImage(
    overrides: Partial<{ contentType: PhotoContentType; width: number; height: number; exif: Inspection['exif'] }> = {},
): Uint8Array {
    const image = { contentType: 'image/jpeg', width: 4000, height: 3000, exif: {}, ...overrides };
    return encoder.encode(`${MARKER}${JSON.stringify(image)}`);
}

function inspectBytes(bytes: Uint8Array, maxInputPixels: number): Inspection {
    const text = decoder.decode(bytes);
    if (text === UNREADABLE) {
        throw new UpstreamError('image', 'invalid');
    }
    if (!text.startsWith(MARKER)) {
        return { contentType: undefined, width: 0, height: 0, exif: {} };
    }
    const image = JSON.parse(text.slice(MARKER.length)) as Inspection;
    if (image.width * image.height > maxInputPixels) {
        throw new UpstreamError('image', 'invalid');
    }
    return image;
}

/** The fake; `maxInputPixels` mirrors `PHOTO_LIMITS.maxInputPixels` (200 MP). */
export function createFakeImageProcessor(maxInputPixels = 200_000_000) {
    const recorder = new PortRecorder<'inspect' | 'webp' | 'iconPng' | 'grey' | 'jpeg'>();
    const images: ImageProcessor = {
        inspect: (bytes) =>
            promised(() => {
                recorder.enter('inspect', [bytes.length]);
                return inspectBytes(bytes, maxInputPixels);
            }),
        webp: (bytes, options) =>
            promised(() => {
                recorder.enter('webp', [options]);
                const source = inspectBytes(bytes, maxInputPixels);
                const scale = Math.min(1, options.longEdge / Math.max(source.width, source.height, 1));
                const width = Math.round(source.width * scale);
                const height = Math.round(source.height * scale);
                return {
                    bytes: encoder.encode(`HCM-FAKE-WEBP:${String(width)}x${String(height)}@${String(options.quality)}`),
                    width,
                    height,
                };
            }),
        iconPng: (source, size) =>
            promised(() => {
                recorder.enter('iconPng', ['upload' in source ? 'upload' : 'ownSvg', size]);
                return encoder.encode(`HCM-FAKE-PNG:${String(size)}`);
            }),
        // The photos' handlers never ask for a grey copy; the cloud estimate is tested with sharp on generated images.
        grey: (_bytes, longEdge) =>
            promised(() => {
                recorder.enter('grey', [longEdge]);
                throw new UpstreamError('image', 'invalid');
            }),
        jpeg: (_bytes, longEdge) =>
            promised(() => {
                recorder.enter('jpeg', [longEdge]);
                throw new UpstreamError('image', 'invalid');
            }),
    };
    return { images, recorder };
}
