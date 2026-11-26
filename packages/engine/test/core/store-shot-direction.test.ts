import { describe, expect, it } from 'vitest';

import { bearingGap } from '../../src/core/compass.js';
import { harness, loaded } from './harness.js';

/** The shot direction button (scenario V93): `faceBearing` turns the camera to the image's shot direction, the tilt kept. */
describe('faceBearing', () => {
    it('happyPath_turnsTheCameraToTheShotDirection @S-V93-HAPPY-TURN', async () => {
        const { store, map } = await loaded();
        map.view = { ...map.view, bearing: 10 };

        store.faceBearing(135);

        expect(map.callsOf('flyTo').at(-1)).toEqual([{ bearing: 135 }, { animate: true }]);
    });

    it('happyPath_360IsNorthAndReducedMotionJumps', async () => {
        const { store, map } = await loaded({ reducedMotion: true });
        map.view = { ...map.view, bearing: 90 };

        store.faceBearing(360);

        expect(map.callsOf('flyTo').at(-1)).toEqual([{ bearing: 0 }, { animate: false }]);
    });

    it('badPath_alreadyFacingItNothingMoves @S-V93-BAD-ALREADY', async () => {
        const { store, map } = await loaded();
        map.view = { ...map.view, bearing: 359.99 };
        const flights = map.callsOf('flyTo').length;

        store.faceBearing(0);

        expect(map.callsOf('flyTo')).toHaveLength(flights);
    });

    it('badPath_beforeTheMapNothingMoves', () => {
        const { store, map } = harness();

        store.faceBearing(90);

        expect(map.callsOf('flyTo')).toEqual([]);
    });
});

describe('bearingGap', () => {
    it.each([
        [0, 0, 0],
        [10, 350, 20],
        [350, 10, 20],
        [0, 180, 180],
        [90, 450, 0],
    ])('happyPath_%d_to_%d_is_%d', (from, to, gap) => {
        expect(bearingGap(from, to)).toBe(gap);
    });
});
