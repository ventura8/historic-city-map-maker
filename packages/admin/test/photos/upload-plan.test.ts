// What a chosen file becomes before anything is sent: refused in the page, or a new photo document and an upload.
import { PHOTO_LIMITS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { checkFile, MAX_UPLOAD_MB, newPhotoFields, originalName, titleFromName } from '../../src/photos/upload-plan.js';
import { file } from './world.js';

describe('checkFile', () => {
    it('happyPath_eachPhotoExtensionHasItsUploadType', () => {
        expect(checkFile(file('a.JPG'))).toEqual({ ok: true, kind: { ext: 'jpg', contentType: 'image/jpeg' } });
        expect(checkFile(file('a.jpeg'))).toMatchObject({ kind: { ext: 'jpg' } });
        expect(checkFile(file('a.tiff'))).toMatchObject({ kind: { ext: 'tif', contentType: 'image/tiff' } });
        expect(checkFile(file('a.heic'))).toMatchObject({ kind: { ext: 'heic', contentType: 'image/heic' } });
        expect(checkFile(file('a.webp'))).toMatchObject({ kind: { ext: 'webp' } });
        expect(checkFile(file('a.png'))).toMatchObject({ kind: { ext: 'png' } });
        expect(checkFile(file('a.heif'))).toMatchObject({ kind: { ext: 'heif' } });
        expect(checkFile(file('a.tif'))).toMatchObject({ kind: { ext: 'tif' } });
    });

    it('badPath_aFileOverTheLimitIsRefusedBeforeAnyWrite', () => {
        expect(checkFile(file('big.jpg', PHOTO_LIMITS.maxUploadBytes + 1))).toEqual({
            ok: false,
            error: 'adminContent.photos.tooBig',
            params: { size: String(MAX_UPLOAD_MB) },
        });
        expect(MAX_UPLOAD_MB).toBe(60);
    });

    it('badPath_aNameNoPhotoUploadMayHaveIsRefused', () => {
        expect(checkFile(file('scan.pdf'))).toEqual({ ok: false, error: 'apiError.photo.unsupportedType' });
        expect(checkFile(file('README'))).toEqual({ ok: false, error: 'apiError.photo.unsupportedType' });
    });
});

describe('the new photo', () => {
    it('happyPath_titleFromTheFileName', () => {
        expect(titleFromName('Calea_Victoriei__1936.jpg', 'x')).toBe('Calea Victoriei 1936');
        expect(titleFromName('photo', 'x')).toBe('photo');
        expect(titleFromName('.jpg', 'fallback')).toBe('.jpg');
        expect(titleFromName('___.jpg', 'fallback')).toBe('fallback');
        expect(titleFromName(`${'a'.repeat(300)}.jpg`, 'x')).toHaveLength(200);
    });

    it('happyPath_theStickyFieldsAndThePinAreCopied', () => {
        expect(newPhotoFields(file('a.jpg'), 'p1', { author: 'Ion', license: 'CC0', sourceUrl: undefined }, [26.1, 44.4])).toEqual({
            title: { ro: 'a' },
            author: 'Ion',
            license: 'CC0',
            location: { lat: 44.4, lng: 26.1 },
            published: false,
            processing: 'pending',
        });
    });

    it('badPath_withoutAStickyLicenceTheLicenceIsUnknown', () => {
        expect(newPhotoFields(file('a.jpg'), 'p1', {}, [26, 44]).license).toBe('unknown');
    });

    it('happyPath_theOriginalNameIsCutTo255', () => {
        expect(originalName('x'.repeat(300))).toHaveLength(255);
    });
});
