import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { legacyCityFields } from '../../src/import/city.js';

/** The bundled seed city as the fields `setup.createCity` writes under the project's city id (CR-M2b-1, CR-M2b-12). */

const MANIFEST = new URL('../../../../seed/bucharest/manifest.static.json', import.meta.url);

describe('legacyCityFields', () => {
    it('happyPath_theSeedCityBecomesCityDocumentFields', () => {
        const city = (JSON.parse(readFileSync(MANIFEST, 'utf8')) as { city: unknown }).city;

        const fields = legacyCityFields(city);

        expect(fields).toMatchObject({
            name: { ro: 'București dispărut', en: 'Lost Bucharest' },
            center: { lng: 26.085298, lat: 44.427037 },
            bounds: { west: 25.93, south: 44.33, east: 26.25, north: 44.55 },
            zoom: 14.5,
        });
        expect(fields).not.toHaveProperty('id');
        expect(fields).not.toHaveProperty('mapbox');
        expect(fields).not.toHaveProperty('analytics');
    });

    it('happyPath_theSeedsTargetYearsTravelWithTheCity', () => {
        const city = (JSON.parse(readFileSync(MANIFEST, 'utf8')) as { city: object }).city;

        expect(legacyCityFields({ ...city, imagery: { targetYears: [1972, 1984] } })?.imagery).toEqual({ targetYears: [1972, 1984] });
        expect(legacyCityFields(city)).not.toHaveProperty('imagery');
    });

    it('badPath_invalidTargetYearsRefuseTheCity', () => {
        const city = (JSON.parse(readFileSync(MANIFEST, 'utf8')) as { city: object }).city;

        expect(legacyCityFields({ ...city, imagery: { targetYears: [1972, 1972] } })).toBeUndefined();
    });

    it('badPath_somethingThatIsNotACityIsRefused', () => {
        expect(legacyCityFields({ center: [26, 44] })).toBeUndefined();
        expect(
            legacyCityFields({
                name: { ro: '' },
                center: [26, 44],
                bounds: [
                    [25, 44],
                    [27, 45],
                ],
            }),
        ).toBeUndefined();
    });
});
