/**
 * A photo's improved and colorized versions (the owner 2026-11-09): the manifest entry, the Firestore document, the URL
 * hash's `pv=` and the export's file names. A photo with only `image` stays valid everywhere.
 */
import { describe, expect, it } from 'vitest';

import { exportPhotoPath } from '../../src/schemas/city-export.js';
import { timestampFromDate } from '../../src/schemas/firestore-common.js';
import { photoDocSchema } from '../../src/schemas/firestore.js';
import { PHOTO_VIEWS } from '../../src/schemas/manifest.js';
import { validateManifest } from '../../src/schemas/validation.js';
import { decodeHash, encodeHash } from '../../src/url/hash.js';
import { validManifest } from '../fixtures/manifest.js';

const IMAGE = { web: 'v/web.webp', thumb: 'v/thumb.webp', w: 2048, h: 1365 };

function withVersions(versions: unknown): unknown {
    const manifest = validManifest() as { photos: Record<string, unknown>[] };
    const [first] = manifest.photos;
    if (first !== undefined) {
        first['versions'] = versions;
    }
    return manifest;
}

describe('manifest photo versions', () => {
    it('happyPath_bothVersionsWithACredit', () => {
        const result = validateManifest(withVersions({ improved: IMAGE, colorized: { ...IMAGE, credit: 'Ana Pop' } }));

        expect(result.ok && result.value.photos[0]?.versions?.colorized?.credit).toBe('Ana Pop');
    });

    it('happyPath_aPhotoWithOnlyItsImageStaysValid', () => {
        expect(validateManifest(validManifest()).ok).toBe(true);
    });

    it.each([
        ['an unknown version', { sepia: IMAGE }],
        ['a version without its size', { improved: { web: 'a.webp', thumb: 'b.webp' } }],
        ['a credit that is no text', { improved: { ...IMAGE, credit: 3 } }],
    ])('badPath_%s', (_name, versions) => {
        expect(validateManifest(withVersions(versions)).ok).toBe(false);
    });

    it('happyPath_theViewsInOrder', () => {
        expect(PHOTO_VIEWS).toEqual(['original', 'improved', 'colorized']);
    });
});

const SHA = 'a'.repeat(64);
const DOC_IMAGE = {
    web: 'https://storage.googleapis.com/b/w.webp',
    thumb: 'https://storage.googleapis.com/b/t.webp',
    sha256: SHA,
    w: 4,
    h: 3,
};
const ORIGINAL = { path: 'originals/photos/c/p/a.jpg', contentType: 'image/jpeg', bytes: 10, sha256: SHA };
const STAMP = { updatedBy: 'u-admin', updatedAt: timestampFromDate(new Date('2026-11-09T00:00:00.000Z')) };
const DOC = { title: { ro: 'T' }, license: 'CC0', published: false, processing: 'done', ...STAMP };

describe('photo document versions', () => {
    it('happyPath_aDocumentWithoutVersionsStaysValid', () => {
        expect(photoDocSchema.safeParse(DOC).success).toBe(true);
    });

    it('happyPath_versionsAndTheirCredits', () => {
        const doc = { ...DOC, versions: { improved: { image: DOC_IMAGE, original: ORIGINAL } }, versionCredits: { improved: 'Ion' } };

        expect(photoDocSchema.safeParse(doc).success).toBe(true);
    });

    it.each([
        ['a version without its original', { ...DOC, versions: { colorized: { image: DOC_IMAGE } } }],
        ['a credit of an unknown version', { ...DOC, versionCredits: { sepia: 'Ion' } }],
        ['a credit too long', { ...DOC, versionCredits: { improved: 'x'.repeat(201) } }],
    ])('badPath_%s', (_name, doc) => {
        expect(photoDocSchema.safeParse(doc).success).toBe(false);
    });
});

describe('the hash pv=', () => {
    it('happyPath_encodedAfterThePhoto', () => {
        expect(encodeHash({ photo: 'p1', photoVersion: 'colorized' })).toBe('#photo=p1&pv=colorized');
    });

    it('badPath_neverWithoutAPhoto', () => {
        expect(encodeHash({ photoVersion: 'improved' })).toBe('');
    });

    it.each(PHOTO_VIEWS)('happyPath_decodes_%s', (view) => {
        expect(decodeHash(`#photo=p1&pv=${view}`)).toEqual({ legacy: false, photo: 'p1', photoVersion: view });
    });

    it.each(['sepia', '', 'COLORIZED', '__proto__'])('badPath_anUnknownValueReadsAsTheOriginal_%s', (value) => {
        expect(decodeHash(`#photo=p1&pv=${value}`).photoVersion).toBe('original');
    });
});

describe('exportPhotoPath', () => {
    it('happyPath_theImageAndEachVersion', () => {
        expect(exportPhotoPath('p1', 'web')).toBe('photos/p1/web.webp');
        expect(exportPhotoPath('p1', 'thumb', 'colorized')).toBe('photos/p1/colorized-thumb.webp');
    });
});
