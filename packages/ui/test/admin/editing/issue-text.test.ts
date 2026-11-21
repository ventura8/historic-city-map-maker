import { describe, expect, it } from 'vitest';

import { cannotSaveText, issueText } from '../../../src/admin/editing/issue-text.js';

describe('issueText', () => {
    it.each([
        [{ path: 'title.ro', code: 'validation.tooSmall' }, 'en', 'Add a title in Romanian'],
        [{ path: 'title', code: 'validation.required' }, 'ro', 'Adaugă un titlu în română'],
        [{ path: 'label.ro', code: 'validation.tooSmall' }, 'en', 'Add a name in Romanian'],
        [{ path: 'name.ro', code: 'validation.required' }, 'en', "Add the city's name in Romanian"],
        [{ path: 'category', code: 'validation.format' }, 'en', 'Choose a category'],
        [{ path: 'category', code: 'validation.reference' }, 'ro', 'Alege o categorie'],
        [{ path: 'geometry', code: 'validation.required' }, 'en', 'Draw the place on the map or add its positions'],
        [{ path: 'year', code: 'validation.type' }, 'en', 'Write the year as a number, such as 1966'],
        [{ path: 'yearStart', code: 'validation.required' }, 'en', 'Write a year, or the years from and to'],
        [{ path: 'yearStart', code: 'validation.tooBig' }, 'en', 'The year cannot be after next year.'],
        [{ path: 'yearEnd', code: 'validation.tooBig' }, 'ro', 'Anul nu poate fi după anul viitor.'],
    ] as const)('happyPath_%j_inLocale_%s_saysWhatToDo', (issue, locale, expected) => {
        expect(issueText(locale, issue)).toBe(expected);
    });

    it.each([
        [{ path: 'title.ro', code: 'validation.tooBig' }, 'The value is too large or too long.'],
        [{ path: 'title.en', code: 'validation.tooSmall' }, 'The value is too small or too short.'],
        [{ path: 'geometry', code: 'validation.outsideCity' }, 'The location is outside the city.'],
        [{ path: 'year', code: 'validation.tooSmall' }, 'The value is too small or too short.'],
        [{ path: 'yearEnd', code: 'validation.tooSmall' }, 'The value is too small or too short.'],
        [{ path: 'toString', code: 'validation.invalid' }, 'The value is not valid.'],
    ] as const)('badPath_%j_keepsTheValidationWords', (issue, expected) => {
        expect(issueText('en', issue)).toBe(expected);
    });
});

describe('cannotSaveText', () => {
    it('happyPath_everyFieldIsNamedOnceInOneSentence', () => {
        const text = cannotSaveText('en', [
            { path: 'title.ro', code: 'validation.tooSmall' },
            { path: 'category', code: 'validation.format' },
            { path: 'category', code: 'validation.reference' },
            { path: 'links[0].url', code: 'validation.httpsOnly' },
        ]);

        expect(text).toBe('Cannot save: add a title in Romanian; choose a category; Links: only https:// addresses are allowed.');
    });

    it('badPath_aFieldTheCatalogueDoesNotKnowKeepsItsStoredName', () => {
        expect(cannotSaveText('ro', [{ path: 'mystery', code: 'validation.invalid' }])).toBe(
            'Nu se poate salva: mystery: valoarea nu este validă.',
        );
    });
});
