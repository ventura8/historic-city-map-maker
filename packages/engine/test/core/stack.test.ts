import { describe, expect, it } from 'vitest';

import { frontLayerId, frontOfIds, hashLayerIds, stackOrder, type StackInput } from '../../src/core/stack.js';

/** V15 (the owner 2026-11-13): the timeline's layer on top, even over a newer opaque one; the rest by date. */
describe('the stack of historical layers', () => {
    const layers = [
        { id: 'a-1966', year: 1966 },
        { id: 'b-1966', year: 1966 },
        { id: 'c-1980', year: 1980 },
    ];

    function raster(id: string, visible: boolean): StackInput['overlays'][number] {
        return { id, kind: 'raster', visible };
    }

    function input(visible: readonly string[], year: number | null, front: string | null = null): StackInput {
        const overlays = [
            ...layers.map((layer) => raster(layer.id, visible.includes(layer.id))),
            { id: 'photos', kind: 'photos' as const, visible: true },
        ];
        return { layers, overlays, year, front };
    }

    it('happyPath_theChosenOlderLayerIsAboveTheNewerOne', () => {
        const [a, b, c] = layers.map(stackOrder(input(['a-1966', 'c-1980'], 1966, 'a-1966')));

        expect(a).toBeGreaterThan(Number(c));
        expect(b).toBeGreaterThan(Number(c));
        expect(a).toBeGreaterThan(Number(b));
    });

    it('happyPath_withoutAChoiceTheLastLayerOfTheYearIsOnTop', () => {
        expect(frontLayerId(input(['a-1966', 'b-1966'], 1966))).toBe('b-1966');
        const [a, , c] = layers.map(stackOrder(input(['a-1966', 'c-1980'], 1980)));
        expect(c).toBeGreaterThan(Number(a));
    });

    it('badPath_aHiddenFrontOrTodayHasNoFront', () => {
        expect(frontLayerId(input(['c-1980'], 1980, 'a-1966'))).toBe('c-1980');
        expect(frontLayerId(input([], null))).toBeNull();
        expect(layers.map(stackOrder(input([], null)))).toEqual([1966, 1966, 1980]);
    });

    it('happyPath_theHashNamesTheFrontLastAndOnlyWhenItDiffersFromTheDefaults', () => {
        const defaults = input(['c-1980'], 1980);

        expect(hashLayerIds({ ...input(['a-1966', 'c-1980'], 1966, 'a-1966'), defaults })).toEqual(['c-1980', 'a-1966']);
        expect(hashLayerIds({ ...input(['c-1980'], 1980), defaults })).toBeNull();
        expect(hashLayerIds({ ...input([], null), defaults })).toEqual([]);
    });

    it('badPath_theDefaultLayersWithAnotherOnTopAreStillWritten', () => {
        const defaults = input(['a-1966', 'c-1980'], 1980);

        expect(hashLayerIds({ ...input(['a-1966', 'c-1980'], 1966, 'a-1966'), defaults })).toEqual(['c-1980', 'a-1966']);
    });

    it('happyPath_aLinksLastKnownLayerIsItsFront', () => {
        expect(frontOfIds(layers, ['c-1980', 'a-1966', 'gone'])).toEqual({ year: 1966, front: 'a-1966' });
    });

    it('badPath_aLinkWithNoKnownLayerIsToday', () => {
        expect(frontOfIds(layers, ['gone'])).toEqual({ year: null, front: null });
        expect(frontOfIds(layers, [])).toEqual({ year: null, front: null });
    });
});
