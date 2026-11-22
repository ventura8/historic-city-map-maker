import { describe, expect, it } from 'vitest';

import type { Overlay } from '../../src/overlays/model.js';
import { categoryGroups, groupShown, poiGroupOf, withOverlayGroup } from '../../src/overlays/poi-groups.js';

const point = { type: 'Point', coordinates: [26.1, 44.43] } as const;
const line = {
    type: 'LineString',
    coordinates: [
        [26.1, 44.43],
        [26.2, 44.44],
    ],
} as const;

const RIVERS: Overlay = {
    id: 'old-rivers',
    kind: 'poi',
    label: { ro: 'Cursuri vechi' },
    visible: true,
    opacity: 1,
    defaultVisible: true,
    defaultOpacity: 1,
};

describe("a place category's sub-groups", () => {
    it('happyPath_aPlacesGroupElseItsGeometryInFirstSeenOrder', () => {
        const pois = [
            { category: 'old-rivers', geometry: line },
            { category: 'old-rivers', geometry: point, group: 'poduri' },
            { category: 'old-rivers', geometry: line },
            { category: 'other', geometry: point },
        ];
        expect(poiGroupOf({ geometry: point })).toBe('points');
        expect(categoryGroups(pois, 'old-rivers')).toEqual(['lines', 'poduri']);
        expect(categoryGroups(pois, 'other')).toEqual(['points']);
    });

    it('happyPath_aGroupSwitchedOffHidesItsPlacesAndOnAgainShowsThem', () => {
        const off = withOverlayGroup([RIVERS], 'old-rivers', 'poduri', false);
        expect(off[0]?.hiddenGroups).toEqual(['poduri']);
        expect(groupShown(off[0], { geometry: point, group: 'poduri' })).toBe(false);
        expect(groupShown(off[0], { geometry: line })).toBe(true);
        expect(withOverlayGroup(off, 'old-rivers', 'poduri', true)[0]?.hiddenGroups).toEqual([]);
    });

    it('badPath_aGroupTurnedOnTurnsAHiddenCategoryOn_andAnotherIdIsUntouched', () => {
        const hidden = { ...RIVERS, visible: false };
        expect(withOverlayGroup([hidden], 'old-rivers', 'lines', true)[0]?.visible).toBe(true);
        expect(withOverlayGroup([hidden], 'nothing', 'lines', true)[0]).toBe(hidden);
        expect(groupShown(undefined, { geometry: point })).toBe(true);
    });
});
