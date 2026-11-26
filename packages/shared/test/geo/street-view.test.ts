import { describe, expect, it } from 'vitest';

import { streetViewUrl } from '../../src/geo/street-view.js';

describe('streetViewUrl', () => {
    it('happyPath_thePlaceAndTheHeading', () => {
        expect(streetViewUrl({ lat: 44.4270371, lng: 26.0852981 }, 359.6)).toBe(
            'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=44.427037,26.085298&heading=0',
        );
    });

    it('badPath_noBearingNoHeading', () => {
        expect(streetViewUrl({ lat: 44.43, lng: 26.1 })).toBe('https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=44.43,26.1');
    });
});
