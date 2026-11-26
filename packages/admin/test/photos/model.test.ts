// The photo list's model: the filters' queries, the publish gate, the rows, and the search over the loaded page.
import { describe, expect, it } from 'vitest';

import { folded, nullable, photoQuery, photoRow, publishBlock, searchRows, type PhotoRow } from '../../src/photos/model.js';
import { photoDoc, photoPath } from './world.js';

const stored = (id: string, overrides: Parameters<typeof photoDoc>[0] = {}) => ({
    id,
    path: photoPath(id),
    data: photoDoc(overrides),
    version: '2026-10-17T10:00:00.000Z',
    pending: false,
});

describe('photoQuery', () => {
    it('happyPath_eachFilterIsOneIndexedQueryNewestFirst', () => {
        expect(photoQuery('all')).toEqual({ where: [], orderBy: [['updatedAt', 'desc']] });
        expect(photoQuery('published').where).toEqual([['published', '==', true]]);
        expect(photoQuery('unpublished').where).toEqual([['published', '==', false]]);
        expect(photoQuery('processing').where).toEqual([['processing', '==', 'pending']]);
        expect(photoQuery('failed').where).toEqual([['processing', '==', 'failed']]);
        expect(photoQuery('rightsReview').where).toEqual([['rightsReview', '==', true]]);
    });
});

describe('publishBlock', () => {
    it('happyPath_aProcessedPhotoWithAKnownLicenceMayBePublished', () => {
        expect(publishBlock(photoDoc(), false)).toBeNull();
    });

    it.each([
        ['still processing', photoDoc({ processing: 'pending' }), false, 'processing'],
        ['refused', photoDoc({ processing: 'failed' }), false, 'failed'],
        ['without an image', photoDoc({ image: undefined }), false, 'failed'],
        ['of an unknown licence', photoDoc({ license: 'unknown' }), false, 'license'],
        ['left at the fallback pin', photoDoc(), true, 'place'],
    ])('badPath_aPhoto %s cannot be published', (_name, photo, checkPlace, block) => {
        expect(publishBlock(photo, checkPlace)).toBe(block);
    });
});

describe('photoRow', () => {
    it('happyPath_theRowCarriesWhatTheListShows', () => {
        const row = photoRow(stored('p1', { year: 1936, yearEnd: 1940, author: 'Ion', rightsReview: true }), false);

        expect(row).toEqual({
            id: 'p1',
            title: { ro: 'Calea Victoriei' },
            year: 1936,
            yearEnd: 1940,
            author: 'Ion',
            thumb: 'https://storage.googleapis.com/b/thumb.webp',
            published: false,
            processing: 'done',
            error: null,
            duplicateOf: null,
            rightsReview: true,
            checkPlace: false,
            reviewStatus: null,
            reviewNote: null,
            block: null,
        });
    });

    it('badPath_aRefusedDuplicateNamesWhatItRepeats', () => {
        const row = photoRow(
            stored('p2', { processing: 'failed', image: undefined, processingError: 'apiError.photo.duplicate', duplicateOf: 'p1' }),
            true,
        );

        expect(row).toMatchObject({
            thumb: null,
            error: 'apiError.photo.duplicate',
            duplicateOf: 'p1',
            checkPlace: true,
            block: 'failed',
            year: null,
        });
    });
});

describe('searchRows', () => {
    const rows: PhotoRow[] = [
        photoRow(stored('a', { title: { ro: 'Piața Universității', en: 'University Square' }, year: 1936, author: 'Ion Ionescu' }), false),
        photoRow(stored('b', { title: { ro: 'Calea Victoriei' }, year: 1920, yearEnd: 1925 }), false),
        photoRow(stored('c', { title: { ro: 'Fără an' } }), false),
    ];
    const ids = (found: readonly PhotoRow[]) => found.map((row) => row.id);

    it('happyPath_textMatchesEitherTitleOrTheAuthorWithoutDiacritics', () => {
        expect(ids(searchRows(rows, { text: 'piata', yearFrom: null, yearTo: null }))).toEqual(['a']);
        expect(ids(searchRows(rows, { text: 'SQUARE', yearFrom: null, yearTo: null }))).toEqual(['a']);
        expect(ids(searchRows(rows, { text: 'ionescu', yearFrom: null, yearTo: null }))).toEqual(['a']);
        expect(ids(searchRows(rows, { text: '  ', yearFrom: null, yearTo: null }))).toEqual(['a', 'b', 'c']);
    });

    it('happyPath_aSpanOfYearsMeetsAPhotosYears', () => {
        expect(ids(searchRows(rows, { text: '', yearFrom: 1924, yearTo: null }))).toEqual(['a', 'b']);
        expect(ids(searchRows(rows, { text: '', yearFrom: null, yearTo: 1921 }))).toEqual(['b']);
        expect(ids(searchRows(rows, { text: '', yearFrom: 1930, yearTo: 1940 }))).toEqual(['a']);
    });

    it('badPath_anUndatedPhotoMatchesNoSpan', () => {
        expect(ids(searchRows(rows, { text: 'fara', yearFrom: 1800, yearTo: 2100 }))).toEqual([]);
    });

    it('happyPath_foldingAndNullable', () => {
        expect(folded(' Știrbei Vodă ')).toBe('stirbei voda');
        expect([nullable(undefined), nullable(0)]).toEqual([null, 0]);
    });
});

describe('M13: an uploader', () => {
    it('happyPath_readsTheirOwnPhotosWhateverTheFilter', () => {
        expect(photoQuery('published', 'u-1').where).toEqual([['createdBy', '==', 'u-1']]);
        expect(photoQuery('published').where).toEqual([['published', '==', true]]);
    });

    it('happyPath_aRowSaysWhereItStandsInTheQueue', () => {
        const row = photoRow(stored('p1', { reviewStatus: 'refused', reviewNote: 'Nu e din oraș.' }), false);
        expect([row.reviewStatus, row.reviewNote]).toEqual(['refused', 'Nu e din oraș.']);
    });
});
