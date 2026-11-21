/**
 * M30 (docs/research/M30-historic-overlays.md): Bucharest's open-data overlays (railways, the old Dâmbovița, the 1977-1989
 * demolitions), in the admin's import format. Merged into the migrated Bucharest manifest as places of their categories
 * they must stay valid, and every file must name the open source and licence it came from.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateManifest } from '../../src/schemas/validation.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
/** The open licences an overlay may come from (AGENTS.md: open or original data only). */
const OPEN_LICENCES = new Set(['ODbL-1.0', 'CC0-1.0']);

interface Overlay {
    readonly file: string;
    readonly category: { readonly id: string; readonly label: { readonly ro: string; readonly en: string }; readonly icon: string };
    readonly color: string;
}

const OVERLAYS: readonly Overlay[] = [
    { file: 'railways-bucharest', category: { id: 'railways', label: { ro: 'Căi ferate', en: 'Railways' }, icon: 'train' }, color: '#5F5E5A' },
    {
        file: 'old-rivers-bucharest',
        category: { id: 'old-rivers', label: { ro: 'Cursuri vechi ale râurilor', en: 'Old river courses' }, icon: 'water' },
        color: '#185FA5',
    },
    {
        file: 'demolitions-1977-1989-bucharest',
        category: { id: 'demolitions-1977-1989', label: { ro: 'Demolări 1977–1989', en: 'Demolitions 1977–1989' }, icon: 'domain_disabled' },
        color: '#A32D2D',
    },
];

interface Feature {
    readonly id: string;
    readonly geometry: unknown;
    readonly properties: Record<string, unknown>;
}

interface Collection {
    readonly sources: readonly { readonly licence: string; readonly attribution: string }[];
    readonly features: readonly Feature[];
}

function collection(file: string): Collection {
    return JSON.parse(readFileSync(resolve(ROOT, `scripts/seed/${file}.geojson`), 'utf8')) as Collection;
}

/** The import's fields a manifest place does not carry (the category is the test's, publishing the server's). */
const IMPORT_ONLY = new Set(['category', 'published', 'sourceLayer']);

function asPois(overlay: Overlay, list: readonly Feature[]): unknown[] {
    return list.map(({ id, geometry, properties }) => ({
        ...Object.fromEntries(Object.entries(properties).filter(([key]) => !IMPORT_ONLY.has(key))),
        id,
        category: overlay.category.id,
        geometry,
    }));
}

describe('the historic overlays of Bucharest', () => {
    it('happyPath_everyOverlayIsValidPlacesOfItsOwnCategory', () => {
        const seed = JSON.parse(readFileSync(resolve(ROOT, 'seed/bucharest/manifest.static.json'), 'utf8')) as Record<string, unknown>;
        const result = validateManifest({
            ...seed,
            poiCategories: OVERLAYS.map((overlay) => ({
                ...overlay.category,
                color: overlay.color,
                defaultOpacity: 1,
                defaultVisible: false,
                attribution: collection(overlay.file).sources.map((source) => source.attribution).join('; '),
            })),
            pois: OVERLAYS.flatMap((overlay) => asPois(overlay, collection(overlay.file).features)),
        });

        expect(result.ok ? [] : result.issues.slice(0, 3)).toEqual([]);
        expect(OVERLAYS.map((overlay) => collection(overlay.file).features.length).every((count) => count > 0)).toBe(true);
    });

    it('badPath_noFeatureLeavesItsCategoryAndNoFileHasAClosedOrUnnamedSource', () => {
        const strays = OVERLAYS.flatMap((overlay) =>
            collection(overlay.file).features.filter((feature) => feature.properties['category'] !== overlay.category.id),
        );
        const closedSources = OVERLAYS.flatMap((overlay) =>
            collection(overlay.file).sources.filter((source) => !OPEN_LICENCES.has(source.licence) || source.attribution === ''),
        );

        expect(strays.map((feature) => feature.id)).toEqual([]);
        expect(closedSources).toEqual([]);
    });
});
