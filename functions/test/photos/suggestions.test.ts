/** What `photos.onUpload` keeps of a file's EXIF and suggests from it and its original name. */
import { describe, expect, it } from 'vitest';

import { exifRecord, suggestedTitle, suggestedYear, suggestionsFrom } from '../../src/photos/suggestions.js';

describe('exifRecord', () => {
    it('happyPath_plainValuesOnlyTheOnesFound', () => {
        expect(exifRecord({ make: 'Cam', dateTimeOriginal: '1936:07:01 10:00:00', gps: { lat: 44.4, lng: 26.1 }, direction: 90 })).toEqual({
            make: 'Cam',
            dateTimeOriginal: '1936:07:01 10:00:00',
            gpsLatitude: 44.4,
            gpsLongitude: 26.1,
            gpsImgDirection: 90,
        });
        expect(exifRecord({})).toEqual({});
    });
});

describe('suggestedYear', () => {
    it.each([
        ['the camera date alone', '1975:05:01 12:00:00', 'IMG_0001.jpg', 1975],
        ['the file-name year alone', undefined, 'Piata Unirii 1936.jpg', 1936],
        ['a scan date later than the file-name year (ignored)', '2024:03:01 09:00:00', 'Calea Victoriei 1936.jpg', 1936],
        ['a camera date earlier than the file-name year', '1930:01:01 00:00:00', 'album 1936.jpg', 1930],
        ['a camera date out of range', '1700:01:01 00:00:00', undefined, undefined],
        ['a malformed camera date', 'last summer', undefined, undefined],
        ['nothing at all', undefined, undefined, undefined],
    ])('%s', (_name, date, name, year) => {
        expect(suggestedYear(date === undefined ? {} : { dateTimeOriginal: date }, name)).toBe(year);
    });
});

describe('suggestedTitle', () => {
    it.each([
        ['Calea_Victoriei  1936.jpg', 'Calea Victoriei 1936'],
        ['Hanul lui Manuc.JPEG', 'Hanul lui Manuc'],
        [`${'a'.repeat(250)}.png`, 'a'.repeat(200)],
    ])('happyPath_%s', (name, title) => {
        expect(suggestedTitle(name)).toBe(title);
    });

    it.each(['IMG_1234.jpg', 'DSC00042.JPG', 'PXL_20260101_101010.jpg', 'scan 3.tif', '   ', undefined])(
        'badPath_noTitleFrom_%s',
        (name) => {
            expect(suggestedTitle(name)).toBeUndefined();
        },
    );
});

describe('suggestionsFrom', () => {
    it('happyPath_positionBearingYearAndTitle', () => {
        expect(
            suggestionsFrom(
                { gps: { lat: 44.432_123_456, lng: 26.103_987_654 }, direction: 359.96, dateTimeOriginal: '1936:07:01 10:00:00' },
                'Lipscani.jpg',
            ),
        ).toEqual({ location: { lat: 44.432_123, lng: 26.103_988 }, bearing: 0, year: 1936, title: 'Lipscani' });
    });

    it('happyPath_aDirectionIsRoundedToATenth', () => {
        expect(suggestionsFrom({ direction: 201.24 }, undefined)).toEqual({ bearing: 201.2 });
    });

    it('badPath_nothingToSuggest', () => {
        expect(suggestionsFrom({ make: 'Cam' }, 'IMG_0001.jpg')).toBeUndefined();
    });
});
