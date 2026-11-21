import type { Photo } from '@hcm/shared';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { HCM_PHOTO_SHEET_TAG, defineHcmPhotoSheet, photoMapYears, type HcmPhotoSheet } from '../../src/viewer/hcm-photo-sheet.js';
import { defineKitDoubles, mountElement, recordEvents, shadowQueryAll, shadowText } from './doubles.js';
import { TEST_MANIFEST_URL, testManifest } from './fixtures.js';

/**
 * The photo's date and the historical layers (V07, the owner 2026-11-09): a date that holds a layer's year is a button to
 * the map of that year; otherwise up to three chips name the layer years within ten years of it, nearest first.
 */
const MANIFEST = testManifest();
/** The timeline's stops: the layer years, then "today". */
const STOPS = [1966, 1977, null];

function photo(id: string, change: Partial<Photo> = {}): Photo {
    const found = MANIFEST.photos.find((candidate) => candidate.id === id);
    if (found === undefined) {
        throw new Error(id);
    }
    return { ...found, ...change };
}

async function sheet(properties: Partial<HcmPhotoSheet>): Promise<HcmPhotoSheet> {
    return mountElement<HcmPhotoSheet>(HCM_PHOTO_SHEET_TAG, {
        photos: MANIFEST.photos,
        open: true,
        mode: 'docked',
        manifestUrl: TEST_MANIFEST_URL,
        canLocate: true,
        years: STOPS,
        ...properties,
    });
}

describe('photoMapYears', () => {
    it('happyPath_aYearInTheSpanIsTheMatch', () => {
        expect(photoMapYears({ year: 1966 }, STOPS)).toEqual({ match: 1966, near: [] });
        expect(photoMapYears({ year: 1975, yearEnd: 1980 }, STOPS)).toEqual({ match: 1977, near: [] });
    });

    it('happyPath_upToThreeNearYearsNearestFirst', () => {
        expect(photoMapYears({ year: 1970 }, [1960, 1962, 1966, 1975, 1979, 1981, null])).toEqual({ near: [1966, 1975, 1962] });
        expect(photoMapYears({ year: 1971 }, [1961, 1981, null])).toEqual({ near: [1961, 1981] });
    });

    it('badPath_nothingBeyondTenYearsOrWithoutADate', () => {
        expect(photoMapYears({ year: 1930 }, STOPS)).toEqual({ near: [] });
        expect(photoMapYears({}, STOPS)).toEqual({ near: [] });
        expect(photoMapYears({ year: 1966 }, [null])).toEqual({ near: [] });
    });
});

describe('<hcm-photo-sheet>: the map of the photo’s year', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmPhotoSheet();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aMatchingDateIsAButtonToItsYear', async () => {
        const element = await sheet({ photo: photo('uranus-1984', { year: 1977 }), locale: 'en' });
        const events = recordEvents(element, 'hcm-year-change');

        await page.getByRole('button', { name: 'Iulie 1984, Map of 1977' }).click();

        expect(events).toEqual([{ type: 'hcm-year-change', detail: { year: 1977 } }]);
    });

    it('happyPath_nearYearsAreChips', async () => {
        const element = await sheet({ photo: photo('mihai-voda-1978', { year: 1970, yearEnd: 1971 }) });
        const events = recordEvents(element, 'hcm-year-change');

        await page.getByRole('button', { name: 'Harta din 1966' }).click();
        await page.getByRole('button', { name: 'Harta din 1977' }).click();

        expect(shadowText(element)).toContain('Anii 1970–1971');
        expect(events.map((event) => event.detail)).toEqual([{ year: 1966 }, { year: 1977 }]);
    });

    it('badPath_noButtonFarFromEveryLayerOrWithoutAMap', async () => {
        const far = await sheet({ photo: photo('mihai-voda-1978', { year: 1930, yearEnd: 1931 }) });
        expect(shadowQueryAll(far, 'hcm-button[icon="map"]')).toHaveLength(0);
        far.remove();

        const noMap = await sheet({ photo: photo('mihai-voda-1978'), canLocate: false });

        expect(shadowText(noMap)).toContain('Anii 1978–1979');
        expect(shadowQueryAll(noMap, 'hcm-button')).toHaveLength(0);
    });
});
