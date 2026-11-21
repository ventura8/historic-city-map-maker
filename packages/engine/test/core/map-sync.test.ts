import { rasterAdjustmentPaint, withOverlayOpacity, withOverlayVisibility } from '@hcm/shared';
import { FakeMap } from '@hcm/test-support/fake-map';
import type { RasterLayerSpec, VectorOverlaySpec } from '@hcm/ui/map';
import { describe, expect, it } from 'vitest';

import { MapSync } from '../../src/core/map-sync.js';
import { initialState, withManifest, withYear } from '../../src/core/state.js';
import { layer, manifest, omit } from './fixtures.js';

describe('MapSync', () => {
    const loaded = withManifest(
        initialState('ro', 'system', 'unknown'),
        manifest({ layers: [layer({ adjustments: { contrast: 0.3 } }), layer({ id: 'kh9-1980', year: 1980, order: 2 })] }),
    );

    it('happyPath_drawsRastersPhotosAndPoisOnAMountedMap', () => {
        const map = new FakeMap();

        new MapSync(map, 'https://storage.example.org/m.json').render(loaded);

        expect(map.calls.map((call) => call.method)).toEqual([
            'addRasterLayer',
            'setLayerPaint',
            'addRasterLayer',
            'setLayerPaint',
            'setOverlayVisibility',
            'setOverlayOpacity',
            'setPhotosData',
            'addVectorOverlay',
            'addVectorOverlay',
            'setMyLocation',
        ]);
        const [spec, slot] = map.callsOf('addRasterLayer')[0] as [RasterLayerSpec, string];
        expect(spec).toMatchObject({ id: 'kh4-1966', visible: false, opacity: 0.9 });
        expect(slot).toBe('middle');
        expect(map.callsOf('setLayerPaint')[0]).toEqual(['kh4-1966', rasterAdjustmentPaint({ contrast: 0.3 })]);
        expect(map.callsOf('setLayerPaint')[1]).toEqual(['kh9-1980', rasterAdjustmentPaint()]);
        expect(map.callsOf('setOverlayVisibility')[0]).toEqual(['photos', true]);
        const [poi, poiSlot] = map.callsOf('addVectorOverlay')[0] as [VectorOverlaySpec, string];
        expect(poi.id).toBe('cladiri');
        expect(poiSlot).toBe('top');
    });

    it('happyPath_theVisitorsPositionIsDrawnOnceKnownAndRemovedWhenOff', () => {
        const map = new FakeMap();
        const sync = new MapSync(map, undefined);
        const fix = { center: [26.1, 44.43] as const, accuracy: 15, heading: 30 };
        const waiting = { ...loaded, myLocation: 'waiting' as const };
        const shown = { ...loaded, myLocation: fix };

        sync.update(loaded, waiting);
        sync.update(waiting, shown);
        sync.update(shown, shown);
        sync.update(shown, loaded);
        new MapSync(map, undefined).render(shown);

        expect(map.callsOf('setMyLocation')).toEqual([[null], [fix], [null], [fix]]);
    });

    it('happyPath_showOnMapsRingFollowsTheStateOnEveryMap', () => {
        const map = new FakeMap();
        const sync = new MapSync(map, undefined);
        const ringed = { ...loaded, photoMark: [26.1, 44.43] as const };

        sync.update(loaded, ringed);
        sync.update(ringed, ringed);
        sync.update(ringed, loaded);
        new MapSync(map, undefined).render(ringed);
        new MapSync(map, undefined).render(loaded);

        expect(map.callsOf('markPhoto')).toEqual([[[26.1, 44.43]], [null], [[26.1, 44.43]]]);
    });

    it('badPath_nothingIsDrawnWithoutAManifest', () => {
        const map = new FakeMap();

        new MapSync(map, undefined).render(initialState('ro', 'system', 'unknown'));

        expect(map.calls).toEqual([]);
    });

    it('happyPath_aChangedOverlayIsAppliedAlone', () => {
        const map = new FakeMap();
        const sync = new MapSync(map, undefined);
        const next = {
            ...loaded,
            overlays: withOverlayOpacity(withOverlayVisibility(loaded.overlays, 'cladiri', false), 'kh4-1966', 0.25),
        };

        sync.update(loaded, next);

        expect(map.calls).toEqual([
            { method: 'setOverlayOpacity', args: ['kh4-1966', 0.25] },
            { method: 'setOverlayVisibility', args: ['cladiri', false] },
        ]);
    });

    it('happyPath_aNewOverlayIsDrawnWithItsVisibilityAndOpacity', () => {
        const map = new FakeMap();
        const before = { ...loaded, overlays: loaded.overlays.filter((overlay) => overlay.id !== 'strazi') };

        new MapSync(map, undefined).update(before, loaded);

        expect(map.calls).toEqual([
            { method: 'setOverlayVisibility', args: ['strazi', true] },
            { method: 'setOverlayOpacity', args: ['strazi', 0.8] },
        ]);
    });

    it('happyPath_aNewYearOrLanguageRedrawsPhotosAndPois', () => {
        const map = new FakeMap();
        const sync = new MapSync(map, undefined);
        const at1966 = withYear(loaded, 1966);

        sync.update(loaded, at1966);
        sync.update(at1966, { ...at1966, locale: 'en' });

        expect(map.callsOf('setPhotosData')).toHaveLength(2);
        expect(map.callsOf('addVectorOverlay')).toHaveLength(4);
        expect(map.callsOf('setOverlayVisibility')).toEqual([['kh4-1966', true]]);
        expect(map.callsOf('setLocale')).toEqual([['en']]);
    });

    it('badPath_aNewYearAloneLeavesMapboxLabelsAlone', () => {
        // The tour: a language switch left Mapbox's own labels in the first language; only a switch relabels them.
        const map = new FakeMap();

        new MapSync(map, undefined).update(loaded, withYear(loaded, 1966));

        expect(map.callsOf('setLocale')).toEqual([]);
        expect(map.callsOf('setPhotosData')).toHaveLength(1);
    });

    it('badPath_anotherManifestOrNoneIsNotDiffed', () => {
        const map = new FakeMap();
        const sync = new MapSync(map, undefined);

        sync.update(loaded, withManifest(loaded, manifest()));
        sync.update(loaded, { ...loaded, manifest: null });
        sync.update(loaded, { ...loaded, view: { center: [26, 44.4], zoom: 12, bearing: 0 } });

        expect(map.calls).toEqual([]);
    });

    it('badPath_aManifestWithoutPhotosOverlayStillGetsItsPhotos', () => {
        const map = new FakeMap();
        const bare = {
            ...loaded,
            overlays: loaded.overlays.filter((overlay) => overlay.id !== 'photos'),
            manifest: omit(manifest(), 'photosOverlay'),
        };

        new MapSync(map, undefined).render(bare);

        expect(map.callsOf('setOverlayVisibility')).toEqual([]);
        expect(map.callsOf('setPhotosData')).toHaveLength(1);
    });
});

describe('MapSync: the stack (V15)', () => {
    const loaded = withManifest(
        initialState('ro', 'system', 'unknown'),
        manifest({ layers: [layer(), layer({ id: 'kh9-1980', year: 1980, order: 2 })] }),
    );

    it('happyPath_theLayerSwitchedOnLastMovesToTheFrontAndTheTimelinesStopRestacks', () => {
        const map = new FakeMap();
        const sync = new MapSync(map, undefined);
        const both = {
            ...loaded,
            overlays: withOverlayVisibility(withOverlayVisibility(loaded.overlays, 'kh4-1966', true), 'kh9-1980', true),
        };
        const newer = { ...both, year: 1980, front: 'kh9-1980' };
        const older = { ...both, year: 1966, front: 'kh4-1966' };

        sync.update(newer, older);
        sync.update(older, older);

        const orders = new Map(map.callsOf('setLayerOrder') as [string, number][]);
        expect(orders.get('kh4-1966')).toBeGreaterThan(orders.get('kh9-1980') ?? Infinity);
        expect(map.callsOf('setLayerOrder')).toHaveLength(2);
    });

    it('badPath_aRenderedStackStartsByDateWithoutAFront', () => {
        const map = new FakeMap();

        new MapSync(map, undefined).render(loaded);

        const specs = map.callsOf('addRasterLayer').map(([spec]) => spec as RasterLayerSpec);
        expect(specs.map((spec) => spec.order)).toEqual([1966, 1980]);
        expect(map.callsOf('setLayerOrder')).toEqual([]);
    });
});
