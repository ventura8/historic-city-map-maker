/** The Layers panel's rows and note (`layer-panel-model.ts`) on manifests without places or with a layer gone. */
import { describe, expect, it } from 'vitest';

import { labelsNote, overlayItems } from '../../src/viewer/layer-panel-model.js';
import { readyState } from './fake-store.js';
import { testManifest } from './fixtures.js';

describe('the Layers panel model', () => {
    it('happyPath_theNoteNamesTheCitysPlacesWhenItHasSome', () => {
        const withPlaces = labelsNote(testManifest(), 'en');
        const without = labelsNote(
            testManifest((raw) => {
                delete raw['poiCategories'];
                delete raw['pois'];
            }),
            'en',
        );

        expect(withPlaces.startsWith(without)).toBe(true);
        expect(withPlaces.length).toBeGreaterThan(without.length);
    });

    it('happyPath_namedGroupsOfACategoryShowTheirOwnNames_andAManifestWithoutPlacesHasNone', () => {
        const grouped = testManifest((raw) => {
            const pois = raw['pois'] as Record<string, unknown>[];
            raw['pois'] = pois.map((poi, index) => (poi['category'] === 'cladiri' ? { ...poi, group: `Grup ${String(index)}` } : poi));
        });
        const row = overlayItems(readyState(grouped).overlays, grouped, 'en').find((item) => item.id === 'cladiri');
        expect(row?.subgroups?.map((group) => group.label).every((label) => label.startsWith('Grup '))).toBe(true);

        const bare = testManifest((raw) => {
            delete raw['pois'];
        });
        expect(overlayItems(readyState(bare).overlays, bare, 'en').every((item) => item.subgroups === undefined)).toBe(true);
    });

    it('badPath_aRasterRowWhoseLayerIsGoneStillListsIt', () => {
        const manifest = testManifest();
        const { overlays } = readyState(manifest);
        const orphan = overlays.find((overlay) => overlay.kind === 'raster');
        if (orphan === undefined) {
            throw new Error('no raster overlay');
        }
        const items = overlayItems([...overlays, { ...orphan, id: 'gone-layer' }], manifest, 'en');

        expect(items.map((item) => item.id)).toContain('gone-layer');
    });
});
