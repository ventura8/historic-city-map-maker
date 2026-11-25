import { describe, expect, it } from 'vitest';

import { completeBounds, EDGES, nextDraft } from '../../../src/admin/cities/area-edges.js';

/**
 * The New city rectangle's four edge fields (behaviour A50): typed values stay in a draft until all four edges are
 * numbers, and clearing or invalidating one edge keeps the other three.
 */

describe('area-edges', () => {
    it('happyPath_edgesListsTheFourCardinalSidesInOrder', () => {
        expect(EDGES).toEqual(['west', 'south', 'east', 'north']);
    });

    it('happyPath_nextDraftSetsAndReplacesAnEdgeWhileKeepingTheOthers', () => {
        const first = nextDraft({}, 'west', '25.9');
        const second = nextDraft(first, 'south', '44.3');
        const replaced = nextDraft(second, 'west', '26.0');

        expect(first).toEqual({ west: 25.9 });
        expect(second).toEqual({ west: 25.9, south: 44.3 });
        expect(replaced).toEqual({ west: 26, south: 44.3 });
    });

    it('badPath_nextDraftDropsAnEdgeWhenClearedOrNotAFiniteNumber', () => {
        const full = { west: 25.9, south: 44.3, east: 26.2, north: 44.5 };

        expect(nextDraft(full, 'south', '')).toEqual({ west: 25.9, east: 26.2, north: 44.5 });
        expect(nextDraft(full, 'east', 'not-a-number')).toEqual({ west: 25.9, south: 44.3, north: 44.5 });
        expect(nextDraft(full, 'north', 'Infinity')).toEqual({ west: 25.9, south: 44.3, east: 26.2 });
    });

    it('happyPath_completeBoundsReturnsTheRectangleWhenAllFourEdgesAreNumbers', () => {
        expect(completeBounds({ west: 0, south: -10.5, east: 26.2, north: 44.5 })).toEqual({
            west: 0,
            south: -10.5,
            east: 26.2,
            north: 44.5,
        });
    });

    it('badPath_completeBoundsReturnsNullWhenAnyEdgeIsMissing', () => {
        expect(completeBounds({})).toBeNull();
        expect(completeBounds({ south: 44.3, east: 26.2, north: 44.5 })).toBeNull();
        expect(completeBounds({ west: 25.9, east: 26.2, north: 44.5 })).toBeNull();
        expect(completeBounds({ west: 25.9, south: 44.3, north: 44.5 })).toBeNull();
        expect(completeBounds({ west: 25.9, south: 44.3, east: 26.2 })).toBeNull();
    });
});
