/** Automatic GCP suggestions (M4, behaviours A44 and P03; docs/research/M4-interfaces.md §2). */
import { describe, expect, it } from 'vitest';

import { acceptSuggestions, gcpSuggestionsSchema, MAX_SUGGESTIONS, pendingSuggestions } from '../../src/schemas/autogcp.js';
import { timestampFromDate } from '../../src/schemas/firestore-common.js';
import { MAX_GCPS, type Gcp } from '../../src/schemas/georef.js';
import { validate } from '../../src/schemas/validation.js';

function pair(id: string, x: number, changes: Partial<Gcp> = {}): Gcp {
    return { id, pixel: { x, y: x }, geo: { lat: 44.4, lng: 26.1 }, enabled: true, origin: 'auto', score: 0.45, ...changes };
}

const SUGGESTIONS = {
    method: 'sift',
    channels: ['s2', 'osm'],
    generatedAt: timestampFromDate(new Date('2026-10-24T08:00:00Z')),
    minConfidence: 0.6,
    tiles: { matched: 41, total: 64 },
    pairs: [pair('a001', 10), pair('a002', 20, { residualM: 18.5 })],
};

describe('the suggestions document', () => {
    it('happyPath_suggestionsValidate', () => {
        expect(validate(gcpSuggestionsSchema, SUGGESTIONS).ok).toBe(true);
    });

    it.each([
        ['the same id twice', { pairs: [pair('a001', 10), pair('a001', 20)] }],
        ['an unknown matcher', { method: 'akaze' }],
        ['no channel', { channels: [] }],
        ['too many pairs', { pairs: Array.from({ length: MAX_SUGGESTIONS + 1 }, (_, index) => pair(`a${String(index)}`, index)) }],
    ])('badPath_%s_isRefused', (_name, changes) => {
        expect(validate(gcpSuggestionsSchema, { ...SUGGESTIONS, ...changes }).ok).toBe(false);
    });
});

describe('accepting suggestions', () => {
    const placed = [pair('g1', 1, { origin: 'manual' }), pair('a001', 2, { origin: 'corner' })];

    it('happyPath_acceptAllAddsEverySuggestionEnabled', () => {
        const result = acceptSuggestions(placed, [pair('a003', 30, { enabled: false }), pair('a004', 40)]);

        expect(result.map((gcp) => [gcp.id, gcp.enabled, gcp.origin])).toEqual([
            ['g1', true, 'manual'],
            ['a001', true, 'corner'],
            ['a003', true, 'auto'],
            ['a004', true, 'auto'],
        ]);
    });

    it('happyPath_acceptOneKeepsTheOthersOut', () => {
        expect(acceptSuggestions(placed, [pair('a003', 30), pair('a004', 40)], ['a004']).map((gcp) => gcp.id)).toEqual([
            'g1',
            'a001',
            'a004',
        ]);
    });

    it('badPath_aTakenIdGetsASuffixAndAPlacedPixelIsNotAddedTwice', () => {
        const result = acceptSuggestions(placed, [pair('a001', 50), pair('a005', 1)]);

        expect(result.map((gcp) => gcp.id)).toEqual(['g1', 'a001', 'a001-2']);
    });

    it('badPath_neverMoreThanTheMostPairs', () => {
        const full = Array.from({ length: MAX_GCPS }, (_, index) => pair(`g${String(index)}`, index + 1000));

        expect(acceptSuggestions(full, [pair('a001', 1)])).toHaveLength(MAX_GCPS);
    });

    it('happyPath_pendingLeavesOutTheRejectedAndThePlaced', () => {
        const suggestions = [pair('a003', 30), pair('a004', 40), pair('a005', 1)];

        expect(pendingSuggestions(suggestions, placed, new Set(['a004'])).map((gcp) => gcp.id)).toEqual(['a003']);
    });
});
