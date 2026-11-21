import { STARTER_POI_CATEGORIES } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { guessCategoryIcon } from '../../src/settings/icon-guess.js';

describe('guessCategoryIcon', () => {
    it('happyPath_aRomanianLabelWithItsDiacriticsNamesItsIcon', () => {
        expect(guessCategoryIcon({ ro: 'Fântâni' })).toBe('water');
        expect(guessCategoryIcon({ ro: 'Biserici' })).toBe('church');
        expect(guessCategoryIcon({ ro: 'Școli vechi' })).toBe('school');
        expect(guessCategoryIcon({ ro: 'Gări' })).toBe('train');
        expect(guessCategoryIcon({ ro: 'Piețe și hale' })).toBe('store');
    });

    it('happyPath_theEnglishLabelIsReadTooAndTheSpecificKindWinsOverTheGenericOne', () => {
        expect(guessCategoryIcon({ ro: 'Colecția A', en: 'Theatres' })).toBe('theater_comedy');
        expect(guessCategoryIcon({ ro: 'Biserici demolate', en: 'Demolished churches' })).toBe('church');
        expect(guessCategoryIcon({ ro: 'Clădiri demolate' })).toBe('domain_disabled');
    });

    it('happyPath_theStarterCategoriesIconsAreTheOnesTheirLabelsSuggest', () => {
        for (const category of STARTER_POI_CATEGORIES) {
            expect(guessCategoryIcon(category.label)).toBe(category.icon);
        }
    });

    it('badPath_aLabelWithNoKnownWordKeepsThePin', () => {
        expect(guessCategoryIcon({ ro: 'Corona 1968' })).toBe('location_on');
        expect(guessCategoryIcon({ ro: '' })).toBe('location_on');
    });

    it('badPath_aShortWordIsMatchedWholeOnly', () => {
        expect(guessCategoryIcon({ ro: 'Garaje' })).toBe('location_on');
        expect(guessCategoryIcon({ ro: 'Parcări' })).toBe('location_on');
        expect(guessCategoryIcon({ ro: 'Lacul Tei' })).toBe('water');
    });
});
