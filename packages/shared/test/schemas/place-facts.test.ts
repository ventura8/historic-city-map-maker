import { describe, expect, it } from 'vitest';

import { manifestSchema } from '../../src/schemas/manifest.js';
import { placeFactsSchema } from '../../src/schemas/place-facts.js';
import { validManifest, validPoi } from '../fixtures/manifest.js';

/** Hotel Dunărea as the content agent's facts.json describes it (the owner's first case). */
const DUNAREA = {
    architects: ['Horia Maicu', 'Nicolae Porumbescu'],
    yearBuilt: 1934,
    yearDemolished: 1985,
    yearAbandoned: 1977,
    style: { ro: 'Modernism', en: 'Modernism' },
    floors: 9,
    heightM: 32.5,
    uses: [{ use: { ro: 'Hotel', en: 'Hotel' }, yearStart: 1934, yearEnd: 1977 }],
    lmiCode: 'B-II-m-B-19750.02',
    addresses: [
        { text: 'Bd. Elisabeta 1', yearStart: 1934, yearEnd: 1948 },
        { text: 'Bd. Regina Elisabeta 1', current: true },
    ],
    relatedPlaceIds: ['casa-uranus'],
};

describe('placeFactsSchema', () => {
    it('happyPath_aBuildingsFactsAreValidAndReachTheManifest @S-V81-HAPPY-FACTS', () => {
        expect(placeFactsSchema.safeParse(DUNAREA).success).toBe(true);
        const manifest = validManifest() as { pois: Record<string, unknown>[] };
        manifest.pois = [{ ...validPoi(), facts: { ...DUNAREA, relatedPlaceIds: ['casa-uranus'] } }];
        expect(manifestSchema.safeParse(manifest).success).toBe(true);
    });

    it.each([
        ['a bad LMI code', { lmiCode: 'B-V-m-A-1' }],
        ['built after demolished', { yearBuilt: 1990, yearDemolished: 1980 }],
        ['a use ending before it starts', { uses: [{ use: { ro: 'x' }, yearStart: 1950, yearEnd: 1940 }] }],
        ['a related place twice', { relatedPlaceIds: ['a', 'a'] }],
        ['an unknown field', { colour: 'red' }],
        ['negative floors', { floors: -1 }],
    ])('badPath_refuses_%s @S-V81-BAD-FACTS', (_label, facts) => {
        expect(placeFactsSchema.safeParse(facts).success).toBe(false);
    });

    it('badPath_aRelatedPlaceTheManifestLacksIsRefused', () => {
        const manifest = validManifest() as { pois: Record<string, unknown>[] };
        manifest.pois = [{ ...validPoi(), facts: { relatedPlaceIds: ['nowhere'] } }];
        const result = manifestSchema.safeParse(manifest);
        expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['pois.0.facts.relatedPlaceIds.0']);
    });
});
