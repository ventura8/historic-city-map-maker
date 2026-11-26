// The photos page's texts: everything from the catalogues, data shown as text.
import { describe, expect, it } from 'vitest';

import {
    blockText,
    bulkActionText,
    fieldIssue,
    filterText,
    historyHref,
    licenseText,
    localized,
    messageText,
    partId,
    phaseText,
    photoHref,
    skipText,
    stickyText,
    yearsText,
} from '../../../src/admin/photos/photo-text.js';
import { upload } from './fixtures.js';

describe('the photos texts', () => {
    it('happyPath_labelsInBothLanguages', () => {
        expect([filterText('ro', 'rightsReview'), filterText('en', 'all')]).toEqual(['Drepturi de verificat', 'All']);
        expect([licenseText('en', 'CC-BY-SA-4.0'), licenseText('ro', 'unknown')]).toEqual([
            'CC BY-SA 4.0',
            'Necunoscută (nu poate fi publicată)',
        ]);
        expect(blockText('en', 'license')).toBe('Choose a licence to publish it.');
        expect(bulkActionText('ro', 'publish')).toBe('Publică');
        expect([localized('en', { ro: 'Ro' }), localized('en', { ro: 'Ro', en: 'En' }), localized('ro', { ro: 'Ro', en: 'En' })]).toEqual([
            'Ro',
            'En',
            'Ro',
        ]);
    });

    it('happyPath_messagesFromEitherCatalogue', () => {
        expect(messageText('en', 'apiError.photo.duplicate')).toBe('This photo has already been uploaded.');
        expect(messageText('en', 'adminContent.photos.tooBig', { size: '60' })).toBe('The file is over 60 MB.');
        expect(messageText('en', 'adminContent.photos.saved', null)).toContain('Saved.');
    });

    it('happyPath_yearsStickyAndUploads', () => {
        expect([
            yearsText('en', null, null),
            yearsText('en', 1936, null),
            yearsText('en', 1936, 1936),
            yearsText('en', 1936, 1940),
        ]).toEqual(['No year', '1936', '1936', '1936–1940']);
        expect(stickyText('en', {})).toBe('New photos have no author, source or licence yet: set them on the first photo.');
        expect(stickyText('en', { license: 'PD' })).toBe('New photos get: Public domain');
        expect([phaseText('en', upload()), phaseText('en', upload({ phase: 'done' }))]).toEqual(['Uploading: 40 %', 'Done']);
    });

    it('badPath_anUnknownSkipReasonReadsAsInvalid', () => {
        expect(skipText('en', { title: 'X', reason: 'place' })).toBe('“X”: the place is to be checked');
        expect(skipText('en', { title: 'X', reason: '???' })).toBe('“X”: it has a value that is not valid');
    });

    it('happyPath_aFieldsFirstIssue', () => {
        const issues = [
            { path: 'links[0].url', code: 'validation.httpsOnly' as const },
            { path: 'title.ro', code: 'validation.tooSmall' as const },
        ];
        expect(fieldIssue('en', issues, 'links')).toBe('Only https:// addresses are allowed.');
        // An empty Romanian title says what to do (finding 37 of 2026-11-01), never the schema's generic words.
        expect(fieldIssue('en', issues, 'title')).toBe('Add a title in Romanian');
        expect(fieldIssue('en', issues, 'title.ro')).toBe('Add a title in Romanian');
        expect(fieldIssue('en', issues, 'author')).toBeNull();
    });

    it('happyPath_addresses', () => {
        expect([photoHref('p1'), historyHref('p1'), partId('photo-lat', 'error')]).toEqual([
            '#/photos/p1',
            '#/history/photo/p1',
            'photo-lat-error',
        ]);
    });
});
