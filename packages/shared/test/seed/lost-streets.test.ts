/**
 * M27 (docs/research/M27-lost-streets.md): the first batches of Bucharest's disappeared streets, in the admin's import
 * format. Merged into the migrated Bucharest manifest as places of one category they must stay valid; the traced batch
 * names our own plan of each street (its layer id) and no two batches hold the same street.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateManifest } from '../../src/schemas/validation.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const CATEGORY = { id: 'lost-streets', label: { ro: 'Străzi dispărute', en: 'Disappeared streets' }, icon: 'add_road', color: '#B3261E' };
/** Our georeferenced plans a street may be traced on (the live city's layer ids) and the plan year each names. */
const OUR_PLANS: Readonly<Record<string, number>> = {
    'harta-bucuresti-1939': 1939,
    'bucuresti-harta-1914-socec': 1914,
    '1921-mihai-pantea': 1921,
};

interface Feature {
    readonly id: string;
    readonly geometry: unknown;
    readonly properties: Record<string, unknown> & { readonly title: { readonly ro: string } };
}

function features(file: string): readonly Feature[] {
    return (JSON.parse(readFileSync(resolve(ROOT, file), 'utf8')) as { features: Feature[] }).features;
}

/** The import's fields a manifest place does not carry (the category is the test's, publishing the server's). */
const IMPORT_ONLY = new Set(['category', 'published', 'sourceLayer']);

function asPois(list: readonly Feature[]): unknown[] {
    return list.map(({ id, geometry, properties }) => ({
        ...Object.fromEntries(Object.entries(properties).filter(([key]) => !IMPORT_ONLY.has(key))),
        id,
        category: CATEGORY.id,
        geometry,
    }));
}

const OHM = features('scripts/seed/lost-streets-bucharest.geojson');
const FIRST_TRACES = features('scripts/seed/lost-streets-bucharest-traced.geojson');
/** The second pass: new traces and corrections of the first (the same ids, so an import updates them). */
const SECOND_TRACES = features('scripts/seed/lost-streets-bucharest-traced-2.geojson');
const SECOND_IDS = new Set(SECOND_TRACES.map((feature) => feature.id));
const TRACED = [...FIRST_TRACES.filter((feature) => !SECOND_IDS.has(feature.id)), ...SECOND_TRACES];

describe('the disappeared streets of Bucharest', () => {
    it('happyPath_bothBatchesAreValidPlacesOfOneCategory', () => {
        const seed = JSON.parse(readFileSync(resolve(ROOT, 'seed/bucharest/manifest.static.json'), 'utf8')) as Record<string, unknown>;
        const result = validateManifest({
            ...seed,
            poiCategories: [{ ...CATEGORY, defaultOpacity: 1, defaultVisible: false, pinned: true, attribution: 'OpenHistoricalMap (CC0)' }],
            pois: asPois([...TRACED, ...OHM]),
        });

        expect(result.ok ? [] : result.issues.slice(0, 3)).toEqual([]);
        expect(TRACED.length).toBeGreaterThan(0);
    });

    it('badPath_everyTracedStreetNamesOneOfOurPlansAndNoStreetIsInBothBatches', () => {
        const ohmTitles = new Set(OHM.map((feature) => feature.properties.title.ro));
        const unknownPlan = TRACED.filter((feature) => !(String(feature.properties['sourceLayer']) in OUR_PLANS));
        const wrongSeen = TRACED.filter((feature) => {
            const layer = String(feature.properties['sourceLayer']);
            return feature.properties['yearSeen'] !== OUR_PLANS[layer];
        });

        expect(unknownPlan).toEqual([]);
        expect(wrongSeen.map((feature) => feature.id)).toEqual([]);
        expect(TRACED.filter((feature) => ohmTitles.has(feature.properties.title.ro)).map((feature) => feature.id)).toEqual([]);
    });
});
