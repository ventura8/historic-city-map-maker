/**
 * The POI fixture set of the e2e fixture manifest (`scripts/seed/e2e-pois.json`, docs/research/M1-interfaces.md §10):
 * merged into the migrated Bucharest manifest, it must stay valid and keep covering what scenarios V22–V24 need.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { overlaysFromManifest } from '../../src/overlays/model.js';
import { poiIcon, poiInYear } from '../../src/overlays/poi.js';
import type { Manifest } from '../../src/schemas/manifest.js';
import { validateManifest } from '../../src/schemas/validation.js';

const ROOT = resolve(import.meta.dirname, '../../../..');

function readJson(path: string): Record<string, unknown> {
    return JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as Record<string, unknown>;
}

function fixtureManifest(): Manifest {
    const result = validateManifest({ ...readJson('seed/bucharest/manifest.static.json'), ...readJson('scripts/seed/e2e-pois.json') });
    if (!result.ok) {
        throw new Error(JSON.stringify(result.issues));
    }
    return result.value;
}

describe('e2e POI fixture set', () => {
    it('happyPath_mergedIntoTheBucharestSeedItIsValid', () => {
        const manifest = fixtureManifest();

        expect(manifest.pois?.map((poi) => [poi.id, poi.geometry.type])).toEqual([
            ['fixture-cladire', 'Point'],
            ['fixture-strada', 'LineString'],
            ['fixture-cvartal', 'Polygon'],
            ['fixture-eveniment', 'Point'],
        ]);
    });

    it('happyPath_itAddsOneOverlayPerCategoryAfterThePhotos', () => {
        expect(overlaysFromManifest(fixtureManifest()).map((overlay) => [overlay.id, overlay.opacity])).toEqual([
            ['photos', 1],
            ['cladiri', 1],
            ['strazi', 0.8],
            ['evenimente', 1],
        ]);
    });

    it('happyPath_theTimelineHidesSomeAndTodayShowsAll', () => {
        const pois = fixtureManifest().pois ?? [];
        const shownIn = (year: number | null) => pois.filter((poi) => poiInYear(poi, year)).map((poi) => poi.id);

        expect(shownIn(null)).toHaveLength(4);
        expect(shownIn(1890)).toEqual(['fixture-cladire', 'fixture-strada', 'fixture-eveniment']);
        expect(shownIn(1990)).toEqual(['fixture-eveniment']);
    });

    it('badPath_anUnbundledCategoryIconDrawsTheDefaultPin', () => {
        expect(fixtureManifest().poiCategories?.map((category) => poiIcon(category.icon))).toEqual(['domain_disabled', 'add_road', 'location_on']);
    });

    it('badPath_markupInADescriptionStaysText', () => {
        expect(fixtureManifest().pois?.[0]?.description?.ro).toContain('<b>Acesta nu este HTML</b>');
    });
});
