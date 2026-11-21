// EXIF auto-fill: what is applied to a new photo, what is offered after a reload, and a position outside the city.
import { describe, expect, it } from 'vitest';

import { autofillOf, insideCity, pendingSuggestions, suggestionPatch } from '../../src/photos/autofill.js';
import { photoDoc } from './world.js';

const BOUNDS = [
    [26, 44.3],
    [26.3, 44.55],
] as const;

const SUGGESTED = { location: { lat: 44.44, lng: 26.11 }, year: 1936, bearing: 201.2, title: 'Calea Victoriei 1936' };

describe('autofillOf', () => {
    it('happyPath_everySuggestionOfANewPhotoIsApplied', () => {
        const photo = photoDoc({ title: { ro: 'IMG 0001', en: 'Old' }, suggested: SUGGESTED });

        expect(autofillOf(photo, BOUNDS)).toEqual({
            fields: { location: SUGGESTED.location, year: 1936, bearing: 201.2, title: { ro: 'Calea Victoriei 1936', en: 'Old' } },
            checkPlace: false,
        });
    });

    it('badPath_aPositionOutsideTheCityIsNotApplied', () => {
        const photo = photoDoc({ suggested: { location: { lat: 47, lng: 27 }, year: 1950 } });

        expect(autofillOf(photo, BOUNDS)).toEqual({ fields: { year: 1950 }, checkPlace: true });
    });

    it('badPath_aPhotoWithoutEXIFKeepsTheFallbackPin', () => {
        expect(autofillOf(photoDoc(), BOUNDS)).toEqual({ fields: {}, checkPlace: true });
    });

    it('happyPath_halfADegreeOutsideTheBoundsStillCounts', () => {
        expect(insideCity({ lat: 44.8, lng: 26.1 }, BOUNDS)).toBe(true);
        expect(insideCity({ lat: 45.1, lng: 26.1 }, BOUNDS)).toBe(false);
    });
});

describe('pendingSuggestions', () => {
    it('happyPath_theSuggestionsThatDifferAreOffered', () => {
        const photo = photoDoc({ year: 1936, suggested: { ...SUGGESTED, location: { lat: 47, lng: 27 } } });

        expect(pendingSuggestions(photo, BOUNDS)).toEqual([
            { field: 'location', text: '47, 27', outside: true },
            { field: 'bearing', text: '201.2', outside: false },
            { field: 'title', text: 'Calea Victoriei 1936', outside: false },
        ]);
    });

    it('badPath_nothingIsOfferedWhenThePhotoAlreadyHasThem', () => {
        const photo = photoDoc({
            location: { lat: 44.440_000_01, lng: 26.11 },
            year: 1936,
            bearing: 201.2,
            title: { ro: 'Calea Victoriei 1936' },
            suggested: SUGGESTED,
        });

        expect(pendingSuggestions(photo, BOUNDS)).toEqual([]);
        expect(pendingSuggestions(photoDoc(), BOUNDS)).toEqual([]);
    });
});

describe('suggestionPatch', () => {
    it('happyPath_oneSuggestionPatchesTheDraft', () => {
        const photo = photoDoc({ suggested: SUGGESTED });

        expect(suggestionPatch(photo, 'year', BOUNDS)).toEqual({ year: 1936 });
        expect(suggestionPatch(photo, 'location', BOUNDS)).toEqual({ location: SUGGESTED.location });
    });

    it('badPath_aPositionOutsideTheCityPatchesNothing', () => {
        expect(suggestionPatch(photoDoc({ suggested: { location: { lat: 47, lng: 27 } } }), 'location', BOUNDS)).toEqual({});
    });
});
