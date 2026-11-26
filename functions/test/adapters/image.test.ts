/**
 * The sharp image adapter on generated images: magic-number sniffing (never the name or the client's type), header-only
 * inspection (a 240-megapixel header is measured, not decoded), HEIC reported but not decoded, and WebP derivatives
 * that are oriented, resized without enlargement and carry no metadata.
 */
import { PHOTO_LIMITS } from '@hcm/shared';
import { mapIconSvg } from '@hcm/shared/tab-icon';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { createSharpImageProcessor, sniffPhotoType } from '../../src/adapters/image.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { PDF, SVG, animatedWebp, encoded, isoMedia, jpeg, pngHeaderOnly, rotatedJpeg, truncatedJpeg } from '../photos/images.js';

const images = createSharpImageProcessor();

describe('sniffPhotoType', () => {
    it.each([
        ['image/jpeg', () => jpeg(4, 4)],
        ['image/png', () => encoded('png')],
        ['image/webp', () => encoded('webp')],
        ['image/tiff', () => encoded('tiff')],
        ['image/heic', () => Promise.resolve(isoMedia('heic'))],
        ['image/heif', () => Promise.resolve(isoMedia('mif1'))],
    ] as const)('happyPath_recognises_%s', async (type, make) => {
        expect(sniffPhotoType(await make())).toBe(type);
    });

    it('happyPath_aBigEndianTiffIsATiff', () => {
        expect(sniffPhotoType(new Uint8Array([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8]))).toBe('image/tiff');
    });

    it.each([
        ['an SVG', SVG],
        ['a PDF', PDF],
        ['an AVIF', isoMedia('avif')],
        ['a RIFF that is not WebP', new TextEncoder().encode('RIFF\0\0\0\0WAVEfmt ')],
        ['nothing', new Uint8Array(0)],
    ])('badPath_%s_isNoPhoto', (_name, bytes) => {
        expect(sniffPhotoType(bytes)).toBeUndefined();
    });
});

describe('inspect', () => {
    it('happyPath_reportsTypeSizeAndExif', async () => {
        const inspection = await images.inspect(await jpeg(40, 30, { make: 'TestCam' }));

        expect(inspection).toEqual({ contentType: 'image/jpeg', width: 40, height: 30, exif: { make: 'TestCam', model: 'M1' } });
    });

    it('happyPath_theSizeIsTheDisplayedOne', async () => {
        await expect(images.inspect(await rotatedJpeg(40, 20))).resolves.toMatchObject({ width: 20, height: 40 });
    });

    it('happyPath_aHugeHeaderIsMeasuredNotDecoded', async () => {
        await expect(images.inspect(pngHeaderOnly(20_000, 12_000))).resolves.toEqual({
            contentType: 'image/png',
            width: 20_000,
            height: 12_000,
            exif: {},
        });
    });

    it.each([
        ['an HEIC photo, which the runtime cannot decode', isoMedia('heic'), 'image/heic'],
        ['an SVG, which is never handed to sharp', SVG, undefined],
    ] as const)('badPath_%s', async (_name, bytes, contentType) => {
        await expect(images.inspect(bytes)).resolves.toEqual({ contentType, width: 0, height: 0, exif: {} });
    });

    it('badPath_anUnreadableHeaderIsInvalid', async () => {
        const error = await images.inspect(await truncatedJpeg()).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(UpstreamError);
        expect(error).toMatchObject({ service: 'image', failure: 'invalid' });
    });
});

describe('webp', () => {
    it('happyPath_theLongEdgeIsLimitedAndNoMetadataIsKept', async () => {
        const source = await jpeg(800, 400, {
            make: 'TestCam',
            gps: { lat: '44/1 0/1 0/1', latRef: 'N', lng: '26/1 0/1 0/1', lngRef: 'E' },
        });

        const output = await images.webp(source, { longEdge: PHOTO_LIMITS.thumbLongEdge, quality: PHOTO_LIMITS.thumbQuality });
        const metadata = await sharp(output.bytes).metadata();

        expect([output.width, output.height, metadata.format, metadata.width, metadata.height]).toEqual([400, 200, 'webp', 400, 200]);
        expect(metadata.exif).toBeUndefined();
    });

    it('happyPath_aSmallImageIsNotEnlargedAndTheOrientationIsApplied', async () => {
        const output = await images.webp(await rotatedJpeg(60, 30), {
            longEdge: PHOTO_LIMITS.webLongEdge,
            quality: PHOTO_LIMITS.webQuality,
        });

        expect([output.width, output.height]).toEqual([30, 60]);
    });

    it.each([
        ['pixels that cannot be decoded', () => pngHeaderOnly(64, 64)],
        ['more pixels than the limit', () => pngHeaderOnly(20_000, 12_000)],
        ['a truncated header', truncatedJpeg],
    ])('badPath_%s_isInvalid', async (_name, make) => {
        await expect(images.webp(await make(), { longEdge: 400, quality: 72 })).rejects.toMatchObject({ failure: 'invalid' });
    });
});

describe('iconPng', () => {
    it('happyPath_anUploadIsFittedInsideEachSquareNeverCropped', async () => {
        const source = { upload: await encoded('webp', 300, 240) };
        const pngs = await Promise.all([32, 180].map((size) => images.iconPng(source, size)));
        const [small, large] = await Promise.all(pngs.map((png) => sharp(png).metadata()));

        expect([small?.format, small?.width, small?.height, small?.hasAlpha]).toEqual(['png', 32, 32, true]);
        expect([large?.width, large?.height]).toEqual([180, 180]);
        expect(large?.exif).toBeUndefined();
        // The top row is padding (the image is wider than tall): transparent.
        const { data } = await sharp(pngs[1]).raw().toBuffer({ resolveWithObject: true });
        expect(data[3]).toBe(0);
    });

    it('happyPath_ourOwnSvgIsDrawn', async () => {
        const png = await images.iconPng({ ownSvg: mapIconSvg('#336699') }, 512);
        const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
        const centreLeft = (256 * info.width + 64) * info.channels;

        expect([info.width, info.height]).toEqual([512, 512]);
        expect(Array.from(data.subarray(centreLeft, centreLeft + 3))).toEqual([0x33, 0x66, 0x99]);
    });

    it('badPath_unreadableBytesAreInvalid', async () => {
        await expect(images.iconPng({ upload: pngHeaderOnly(64, 64) }, 32)).rejects.toMatchObject({ failure: 'invalid' });
    });
});

describe('grey', () => {
    it('happyPath_aColourImageIsOneGreyChannelFittedInsideTheLongEdge', async () => {
        const grey = await images.grey(await encoded('png', 300, 150), 128);

        expect([grey.width, grey.height, grey.pixels.length]).toEqual([128, 64, 128 * 64]);
    });

    it('badPath_unreadableBytesAreInvalid', async () => {
        await expect(images.grey(pngHeaderOnly(64, 64), 128)).rejects.toMatchObject({ failure: 'invalid' });
        await expect(images.jpeg(pngHeaderOnly(64, 64), 128)).rejects.toMatchObject({ failure: 'invalid' });
    });

    it('happyPath_aLargeImageIsShrunkToAJpegWithinTheLongEdge', async () => {
        const shrunk = await sharp(await images.jpeg(await encoded('png', 600, 100), 300)).metadata();

        expect([shrunk.format, shrunk.width, shrunk.height]).toEqual(['jpeg', 300, 50]);
    });
});

describe('inspect: frames', () => {
    it('happyPath_anAnimatedWebpCountsItsFrames', async () => {
        await expect(images.inspect(await animatedWebp(200))).resolves.toMatchObject({ contentType: 'image/webp', frames: 2 });
    });

    it('happyPath_aStillImageHasNoFrameCount', async () => {
        await expect(images.inspect(await encoded('png'))).resolves.not.toHaveProperty('frames');
    });
});
