/**
 * `cities.setIcon` (`functions/src/cities/set-icon.ts`) through its callable's `.run()`, with the in-memory documents and
 * buckets and the real sharp processor on generated images: an editor's PNG or WebP becomes the city's three PNGs and
 * its `icon` record; Use the default draws the map glyph in the city's seed colour; an SVG, a JPEG, a PDF, a renamed
 * file, an image too big, too small, too large, not square or animated, and a caller who is no editor change nothing.
 */
import { CITY_ICON_LIMITS, FIRESTORE_PATHS, STORAGE_PATHS, cityDocSchema } from '@hcm/shared';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { setIconFunction } from '../../src/cities/set-icon.js';
import type { ImageProcessor } from '../../src/ports/image-processor.js';
import { CITY_ID, cityDoc } from '../publish/city.js';
import { adminCall, contentDeps, publicUrl, type ContentDeps } from '../publish/fakes.js';
import { PDF, SVG, animatedWebp, encoded, jpeg } from '../photos/images.js';
import { fakeAdmins } from '../support/fakes.js';

function base64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64');
}

function seeded(): ContentDeps {
    const deps = contentDeps();
    deps.documents.seed(FIRESTORE_PATHS.city(CITY_ID), cityDoc());
    return deps;
}

function setIcon(deps: ContentDeps, data: unknown) {
    return setIconFunction(() => deps).run(adminCall(data));
}

async function cityIcon(deps: ContentDeps) {
    return (await deps.documents.get(FIRESTORE_PATHS.city(CITY_ID), cityDocSchema))?.icon;
}

const ICON_PATHS = [32, 180, 512].map((size) => STORAGE_PATHS.cityIcon(CITY_ID, size as 32 | 180 | 512));

describe('cities.setIcon: an upload', () => {
    it.each([
        ['a PNG', () => encoded('png', 256, 256)],
        ['a WebP, a little wider than tall', () => encoded('webp', 300, 256)],
    ])('happyPath_%s_becomesTheCitysThreePngs @S-A101-HAPPY-UPLOAD', async (_name, make) => {
        const deps = seeded();

        const answer = await setIcon(deps, { kind: 'upload', cityId: CITY_ID, image: base64(await make()) });

        expect(answer).toMatchObject({ source: 'custom', url: publicUrl(STORAGE_PATHS.cityIcon(CITY_ID, 180)) });
        for (const [index, path] of ICON_PATHS.entries()) {
            const stored = deps.blobs.object('public', path);
            const metadata = await sharp(stored?.bytes).metadata();
            expect([metadata.format, metadata.width, metadata.height]).toEqual(['png', [32, 180, 512][index], [32, 180, 512][index]]);
            expect(stored?.options).toMatchObject({ contentType: 'image/png', cacheControl: 'public, max-age=300' });
        }
        // The tab's own copy, which only an upload has: the city's pages show it in every theme.
        const own = await sharp(deps.blobs.object('public', STORAGE_PATHS.cityOwnIcon(CITY_ID))?.bytes).metadata();
        expect([own.format, own.width, own.height]).toEqual(['png', 32, 32]);
        await expect(cityIcon(deps)).resolves.toMatchObject({ source: 'custom', sha256: answer.sha256, updatedBy: 'u-admin' });
        // An icon-only write: the city's own stamp stays.
        expect((await deps.documents.get(FIRESTORE_PATHS.city(CITY_ID), cityDocSchema))?.updatedAt).toEqual(cityDoc().updatedAt);
    });

    it.each([
        ['an SVG', () => Promise.resolve(SVG), 'apiError.cityIcon.badType'],
        ['a JPEG', () => jpeg(256, 256), 'apiError.cityIcon.badType'],
        ['a PDF', () => Promise.resolve(PDF), 'apiError.cityIcon.badType'],
        ['a text file named icon.png', () => Promise.resolve(new TextEncoder().encode('not an image at all')), 'apiError.cityIcon.badType'],
        ['an image too small', () => encoded('png', 64, 64), 'apiError.cityIcon.tooSmall'],
        ['an image too large', () => encoded('png', 4200, 4200), 'apiError.cityIcon.tooLarge'],
        ['an image that is not square', () => encoded('png', 600, 256), 'apiError.cityIcon.notSquare'],
        ['an animated WebP', () => animatedWebp(256), 'apiError.cityIcon.animated'],
    ])('badPath_%s_isRefusedAndNothingChanges @S-A101-BAD-SVG', async (_name, make, code) => {
        const deps = seeded();

        await expect(setIcon(deps, { kind: 'upload', cityId: CITY_ID, image: base64(await make()) })).rejects.toMatchObject({
            details: { code },
        });
        expect(deps.blobs.paths('public')).toEqual([]);
        await expect(cityIcon(deps)).resolves.toBeUndefined();
    });

    it('badPath_aFileOverOneMegabyteIsTooBig', async () => {
        const deps = seeded();
        const big = new Uint8Array(CITY_ICON_LIMITS.maxBytes + 1);
        big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

        await expect(setIcon(deps, { kind: 'upload', cityId: CITY_ID, image: base64(big) })).rejects.toMatchObject({
            details: { code: 'apiError.cityIcon.tooBig', params: { max: '1 MB' } },
        });
    });

    it('badPath_aPngWhosePixelsCannotBeReadIsInvalid', async () => {
        const base = seeded();
        const deps = { ...base, images: { ...base.images, inspect: () => Promise.reject(new Error('unreadable')) } };

        await expect(
            setIcon(deps, { kind: 'upload', cityId: CITY_ID, image: base64(await encoded('png', 256, 256)) }),
        ).rejects.toMatchObject({
            details: { code: 'apiError.cityIcon.invalid' },
        });
    });

    it('badPath_aRequestThatIsNotBase64IsInvalid', async () => {
        await expect(setIcon(seeded(), { kind: 'upload', cityId: CITY_ID, image: 'not base64!' })).rejects.toMatchObject({
            code: 'invalid-argument',
        });
    });
});

describe('cities.setIcon: the default', () => {
    it('happyPath_useTheDefaultDrawsTheMapGlyphInTheSeedColour @S-A101-HAPPY-RESET', async () => {
        const deps = seeded();
        await setIcon(deps, { kind: 'upload', cityId: CITY_ID, image: base64(await encoded('png', 256, 256)) });

        await expect(setIcon(deps, { kind: 'reset', cityId: CITY_ID })).resolves.toMatchObject({ source: 'default' });

        await expect(cityIcon(deps)).resolves.toMatchObject({ source: 'default', seedColor: '#8B5E3C' });
        // The upload's own tab copy is gone: the city's pages draw the default again, in the visitor's theme.
        expect(deps.blobs.object('public', STORAGE_PATHS.cityOwnIcon(CITY_ID))).toBeUndefined();
        const { data, info } = await sharp(deps.blobs.object('public', ICON_PATHS[2] ?? '')?.bytes)
            .raw()
            .toBuffer({ resolveWithObject: true });
        const edge = (256 * info.width + 60) * info.channels;
        expect(Array.from(data.subarray(edge, edge + 3))).toEqual([0x8b, 0x5e, 0x3c]);
    });

    it('badPath_aCityThatDoesNotExistIsNotFound', async () => {
        const deps = contentDeps();

        await expect(setIcon(deps, { kind: 'reset', cityId: 'nowhere' })).rejects.toMatchObject({ details: { code: 'apiError.notFound' } });
        expect(deps.blobs.paths('public')).toEqual([]);
    });

    it('badPath_aCityDeletedWhileTheIconWasDrawnIsNotFound', async () => {
        const base = seeded();
        const images: ImageProcessor = {
            ...base.images,
            iconPng: async (source, size) => {
                await base.documents.delete(FIRESTORE_PATHS.city(CITY_ID));
                return base.images.iconPng(source, size);
            },
        };
        const deps = { ...base, images };

        await expect(setIcon(deps, { kind: 'reset', cityId: CITY_ID })).rejects.toMatchObject({ details: { code: 'apiError.notFound' } });
    });
});

describe('cities.setIcon: who', () => {
    it('badPath_anUploaderOfTheCityChangesNothing', async () => {
        const deps = { ...seeded(), admins: fakeAdmins(['u-admin'], { cities: { [CITY_ID]: 'uploader' } }) };

        await expect(setIcon(deps, { kind: 'reset', cityId: CITY_ID })).rejects.toMatchObject({ code: 'permission-denied' });
        expect(deps.blobs.paths('public')).toEqual([]);
    });
});
