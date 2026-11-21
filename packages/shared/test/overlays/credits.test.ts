import { describe, expect, it } from 'vitest';

import { translate } from '../../src/i18n/index.js';
import { creditParts, localizedCredit, STORED_CREDITS } from '../../src/overlays/credits.js';
import { LANDSAT_ATTRIBUTION } from '../../src/schemas/landsat.js';
import { DEM_ATTRIBUTION, USGS_ATTRIBUTION } from '../../src/schemas/usgs-scene.js';

describe('localizedCredit', () => {
    it('happyPath_theStoredCreditsAreTheEnglishTexts', () => {
        expect(translate('en', 'layers.attribution.usgs')).toBe(USGS_ATTRIBUTION);
        expect(translate('en', 'layers.attribution.landsat')).toBe(LANDSAT_ATTRIBUTION);
        // The engine fetches only the page's language: the stored English is matched without the English catalogue.
        expect(STORED_CREDITS).toEqual({ 'layers.attribution.usgs': USGS_ATTRIBUTION, 'layers.attribution.landsat': LANDSAT_ATTRIBUTION });
    });

    it('happyPath_aKnownCreditIsInTheVisitorsLanguage', () => {
        // The Pixel Tablet, 2026-11-12: the Romanian map credited "USGS EROS, declassified imagery (public domain)".
        expect(localizedCredit(USGS_ATTRIBUTION, 'ro')).toBe('USGS EROS, imagini desecretizate (domeniu public)');
        expect(localizedCredit(`${LANDSAT_ATTRIBUTION}; ${DEM_ATTRIBUTION}`, 'ro')).toBe(
            `${translate('ro', 'layers.attribution.landsat')}; ${DEM_ATTRIBUTION}`,
        );
    });

    it('happyPath_aLineDrawnInOneLanguageFollowsTheOther', () => {
        const line = `© Mapbox © OpenStreetMap | ${translate('ro', 'layers.attribution.usgs')}`;

        expect(localizedCredit(line, 'en')).toBe(`© Mapbox © OpenStreetMap | ${USGS_ATTRIBUTION}`);
    });

    it('badPath_anUnknownCreditStaysAsWritten', () => {
        expect(localizedCredit('Arhiva Primăriei', 'en')).toBe('Arhiva Primăriei');
        expect(localizedCredit('', 'ro')).toBe('');
    });
});

describe('creditParts', () => {
    it('happyPath_eachCreditOnceInItsFirstOrder', () => {
        const parts = creditParts([USGS_ATTRIBUTION, `${USGS_ATTRIBUTION}; ${DEM_ATTRIBUTION}`, USGS_ATTRIBUTION], 'ro');

        expect(parts).toEqual([translate('ro', 'layers.attribution.usgs'), DEM_ATTRIBUTION]);
    });

    it('badPath_noAttributionsOrBlankPartsAreNoCredit', () => {
        expect(creditParts([], 'en')).toEqual([]);
        expect(creditParts([' ; ', ''], 'en')).toEqual([]);
    });
});
