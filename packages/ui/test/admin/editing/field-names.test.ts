import { describe, expect, it } from 'vitest';

import { fieldName, fieldNames } from '../../../src/admin/editing/field-names.js';

describe('field names in the admin language', () => {
    it('happyPath_knownFieldsUseTheCatalogueNameInTheChosenLanguage', () => {
        expect(fieldName('en', 'title')).toBe('Title');
        expect(fieldName('ro', 'title')).toBe('Titlul');
        expect(fieldNames('en', ['title', 'year'])).toBe('Title, Year');
        expect(fieldNames('ro', ['title', 'year'])).toBe('Titlul, Anul');
        expect(fieldNames('en', [])).toBe('');
    });

    it('badPath_unknownServerFieldsKeepTheirStoredName', () => {
        expect(fieldName('en', 'futureField')).toBe('futureField');
        expect(fieldNames('en', ['title', 'futureField'])).toBe('Title, futureField');
    });
});
