// The ghost's mapping (`ghost.ts`, 2026-11-12): two pairs give a similarity both ways, a fit wins over it, and nothing finite is nothing.
import { describe, expect, it } from 'vitest';

import { ghostOf, similarityOf, type GhostMapping } from '../../src/georef/ghost.js';
import { pair } from './fixtures.js';

describe('the ghost of a pending pair', () => {
    it('happyPath_theTwoLatestEnabledPairsMapAScanPointAndBackAndAFitWins @S-A16-HAPPY-GEOREF-GHOST', () => {
        // A disabled checkpoint and an older pair are left out: the latest two enabled ones decide.
        const pairs = [pair('old', 5000, 5000, 400), pair('a', 0, 0), pair('cp', 9000, 9000, 0, false), pair('b', 1000, 300)];
        const mapping = similarityOf(pairs);
        const at = mapping?.toGeo({ x: 400, y: 900 });
        const expected = pair('x', 400, 900).geo;
        expect(at?.lat).toBeCloseTo(expected.lat, 7);
        expect(at?.lng).toBeCloseTo(expected.lng, 7);
        const back = mapping?.toPixel(expected);
        expect(back?.x).toBeCloseTo(400, 3);
        expect(back?.y).toBeCloseTo(900, 3);

        const fit: GhostMapping = { toGeo: () => ({ lat: 1, lng: 2 }), toPixel: () => ({ x: 3, y: 4 }) };
        expect(ghostOf({ pixel: { x: 1, y: 1 } }, pairs, fit)).toEqual({ geo: { lat: 1, lng: 2 } });
        expect(ghostOf({ geo: { lat: 44, lng: 26 } }, pairs, fit)).toEqual({ pixel: { x: 3, y: 4 } });
    });

    it('badPath_noHalfPairTooFewPairsOneSpotOrNothingFinitePredictsNothing @S-A16-BAD-GEOREF-GHOST-NO-PAIRS', () => {
        const two = [pair('a', 0, 0), pair('b', 1000, 300)];
        expect(ghostOf(null, two, null)).toBeNull();
        expect(ghostOf({ pixel: { x: 1, y: 1 } }, [pair('a', 0, 0)], null)).toBeNull();
        expect(similarityOf([pair('a', 0, 0), pair('b', 0, 0, 50)])).toBeNull();
        expect(similarityOf([pair('a', 0, 0), { ...pair('b', 100, 0), geo: pair('a', 0, 0).geo }])).toBeNull();

        const lost: GhostMapping = { toGeo: () => ({ lat: Number.NaN, lng: 0 }), toPixel: () => ({ x: 0, y: Number.POSITIVE_INFINITY }) };
        expect(ghostOf({ pixel: { x: 1, y: 1 } }, two, lost)).toBeNull();
        expect(ghostOf({ geo: { lat: 44, lng: 26 } }, two, lost)).toBeNull();
    });
});
