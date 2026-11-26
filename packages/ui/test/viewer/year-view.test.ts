import type { Manifest, MapView } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { viewForYear } from '../../src/viewer/year-view.js';
import { testManifest } from './fixtures.js';

const CITY: MapView = { center: [26.1, 44.43], zoom: 13, bearing: 0 };
/** The 1945 Otopeni de Sus sheet: north of the city view. */
const OTOPENI = [
    [25.947, 44.531],
    [26.139, 44.624],
];

function withBounds(bounds: unknown[] | undefined): Manifest {
    return testManifest((raw) => {
        for (const layer of raw['layers'] as Record<string, unknown>[]) {
            layer['bounds'] = bounds;
        }
    });
}

describe('viewForYear', () => {
    it('happyPath_aYearWhoseLayersAreOutOfViewMovesToThem', () => {
        const view = viewForYear(withBounds(OTOPENI), 1966, CITY, 1280);
        expect(view?.center[0]).toBeCloseTo(26.043, 3);
        expect(view?.center[1]).toBeCloseTo(44.5775, 3);
        expect(view?.zoom).toBeGreaterThanOrEqual(10);
        expect(view?.zoom).toBeLessThanOrEqual(13);
        expect(view?.bearing).toBe(0);
    });

    it('happyPath_aLayerAlreadyInViewKeepsTheCamera', () => {
        expect(
            viewForYear(
                withBounds([
                    [26, 44.4],
                    [26.2, 44.5],
                ]),
                1966,
                CITY,
                1280,
            ),
        ).toBeNull();
    });

    it('badPath_todayNoManifestNoLayerOrNoBoundsKeepTheCamera', () => {
        expect(viewForYear(withBounds(OTOPENI), null, CITY, 1280)).toBeNull();
        expect(viewForYear(null, 1966, CITY, 1280)).toBeNull();
        expect(viewForYear(withBounds(OTOPENI), 1800, CITY, 1280)).toBeNull();
        expect(viewForYear(withBounds(undefined), 1966, CITY, 1280)).toBeNull();
    });

    it('badPath_aTinyBoxIsNeverZoomedPastTheCurrentZoom', () => {
        const view = viewForYear(
            withBounds([
                [25, 44],
                [25.0001, 44.0001],
            ]),
            1966,
            CITY,
            4000,
        );
        expect(view?.zoom).toBe(13);
    });
});
