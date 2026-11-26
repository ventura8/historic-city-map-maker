import { MAX_GCPS, type Gcp } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import {
    moveGeo,
    movePixel,
    nextPairId,
    pairsToSave,
    roundGeo,
    roundPixel,
    samePairs,
    togglePair,
    withoutPair,
    withPair,
} from '../../src/georef/pairs.js';

const AUTO: Gcp = {
    id: 'a017',
    pixel: { x: 10, y: 20 },
    geo: { lat: 44.4, lng: 26.1 },
    enabled: true,
    origin: 'auto',
    score: 0.8,
    residualM: 4,
};

describe('the pairs', () => {
    it('happyPath_aNewPairIsManualNamedPastTheHighestAndRounded', () => {
        const pairs = withPair([AUTO, { ...AUTO, id: 'g7' }], { x: 1, y: 2 }, { lat: 44.123456789, lng: 26.987654321 });

        expect(pairs.at(-1)).toEqual({
            id: 'g8',
            pixel: { x: 1, y: 2 },
            geo: { lat: 44.1234568, lng: 26.9876543 },
            enabled: true,
            origin: 'manual',
        });
        expect(nextPairId([])).toBe('g1');
        expect(roundPixel({ x: -3, y: 12.3456 }, 10, 10)).toEqual({ x: 0, y: 10 });
        expect(roundGeo({ lat: 1.000000049, lng: 2 })).toEqual({ lat: 1, lng: 2 });
    });

    it('happyPath_aMovedPairBecomesManualAndTogglingKeepsItsOrigin', () => {
        const moved = movePixel([AUTO], 'a017', { x: 11, y: 21 });
        const placed = moveGeo([AUTO], 'a017', { lat: 44.5, lng: 26.2 });
        const toggled = togglePair([AUTO, { ...AUTO, id: 'b' }], 'a017');

        expect(moved[0]).toEqual({ id: 'a017', pixel: { x: 11, y: 21 }, geo: AUTO.geo, enabled: true, origin: 'manual' });
        expect(placed[0]?.geo).toEqual({ lat: 44.5, lng: 26.2 });
        expect(toggled.map((pair) => [pair.id, pair.enabled, pair.origin])).toEqual([
            ['a017', false, 'auto'],
            ['b', true, 'auto'],
        ]);
        expect(withoutPair(toggled, 'b').map((pair) => pair.id)).toEqual(['a017']);
    });

    it('badPath_noPairPastTheLimit', () => {
        const full = Array.from({ length: MAX_GCPS }, (_pair, index) => ({ ...AUTO, id: `g${String(index)}` }));

        expect(withPair(full, { x: 1, y: 1 }, { lat: 1, lng: 1 })).toBe(full);
    });

    it('happyPath_savedPairsLeaveTheirResidualsAndTheGuardComparesThem', () => {
        const manual: Gcp = { id: 'g1', pixel: { x: 1, y: 1 }, geo: { lat: 1, lng: 1 }, enabled: true, origin: 'manual', residualM: 2 };

        expect(pairsToSave([AUTO, manual])).toEqual([
            { id: 'a017', pixel: AUTO.pixel, geo: AUTO.geo, enabled: true, origin: 'auto', score: 0.8 },
            { id: 'g1', pixel: { x: 1, y: 1 }, geo: { lat: 1, lng: 1 }, enabled: true, origin: 'manual' },
        ]);
        expect(samePairs([AUTO], [{ ...AUTO, residualM: 9 }])).toBe(true);
        expect(samePairs([AUTO], [{ ...AUTO, enabled: false }])).toBe(false);
    });
});
