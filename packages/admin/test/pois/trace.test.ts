// M27 "Disappeared streets" (S-A154): a place traced on one of the city's old maps. The places area lists the layers with tiles
// (not a retired frame) by year; the open place's `sourceLayer` puts that map under the drawing, at the admin's opacity, and is
// saved with the place; a place naming a map that no longer exists shows none and can be given another.
import { FIRESTORE_PATHS, type LayerDoc } from '@hcm/shared';
import type { RasterLayerSpec } from '@hcm/ui/map';
import { describe, expect, it } from 'vitest';

import type { AreaStore } from '../../src/content/areas.js';
import { POIS_MODULE } from '../../src/pois/pois.js';
import type { PoisIntents, PoisState } from '../../src/pois/state.js';
import { clampPercent, DEFAULT_TRACE_OPACITY, traceEntryOf } from '../../src/pois/trace-layers.js';
import { layerDoc } from '../layers/fixtures.js';
import { CITY, CONTAINER, seededWorld, seedPlace, settle, type PoisWorld } from './world.js';

const LAYER = (id: string): string => FIRESTORE_PATHS.layer(CITY, id);

function withLayers(): PoisWorld {
    const world = seededWorld();
    world.store.put(LAYER('corona-1968'), layerDoc({ year: 1968 }));
    world.store.put(LAYER('plan-1911'), layerDoc({ year: 1911, label: { ro: 'Planul 1911', en: 'The 1911 plan' }, opacity: 0.6 }));
    world.store.put(LAYER('frame-1966'), layerDoc({ year: 1966, retired: { by: 'join-1966', at: { seconds: 1, nanoseconds: 0 } } }));
    return world;
}

function opened(world: PoisWorld, params: readonly string[] = []): AreaStore<PoisState, PoisIntents> {
    const store = POIS_MODULE.create(world.services);
    store.open(params);
    return store;
}

function rasters(world: PoisWorld): RasterLayerSpec[] {
    return world.maps.map.callsOf('addRasterLayer').map((args) => args[0] as RasterLayerSpec);
}

describe('places: the old maps a street is traced on', () => {
    it('happyPath_theLayersWithTilesAreListedByYearWithoutTheRetiredFrame @S-A154-HAPPY-TRACE', () => {
        const store = opened(withLayers());

        expect(store.state.traceLayers).toEqual([
            { id: 'plan-1911', label: { ro: 'Planul 1911', en: 'The 1911 plan' }, year: 1911 },
            { id: 'corona-1968', label: { ro: 'Corona 1968' }, year: 1968 },
        ]);
        expect(store.state.traceOpacity).toBe(DEFAULT_TRACE_OPACITY);
    });

    it('happyPath_choosingAMapShowsItUnderTheDrawingFadesItAndSavesIt @S-A154-HAPPY-TRACE', async () => {
        const world = withLayers();
        const store = opened(world, ['stavropoleos']);
        store.intents.attachMap(CONTAINER);
        await settle();
        expect(rasters(world)).toEqual([]);

        store.intents.edit({ sourceLayer: 'plan-1911' });
        expect(rasters(world).at(-1)).toMatchObject({ id: 'plan-1911', opacity: 1, visible: true });

        store.intents.setTraceOpacity(40);
        world.maps.frames.run();
        expect(store.state.traceOpacity).toBe(40);
        expect(world.maps.map.callsOf('setOverlayOpacity')).toContainEqual(['plan-1911', 0.4]);

        expect(await store.intents.save()).toEqual({ ok: true });
        expect(world.store.docs.get(FIRESTORE_PATHS.poi(CITY, 'stavropoleos'))).toMatchObject({ sourceLayer: 'plan-1911' });

        // Opening another place shows its own map: none here.
        store.open(['cismigiu']);
        expect(world.maps.map.callsOf('removeLayer')).toContainEqual(['plan-1911']);
    });

    it('happyPath_clearingTheChoiceRemovesTheMapAndTheField', async () => {
        const world = withLayers();
        seedPlace(world, 'lipscani', { sourceLayer: 'corona-1968' });
        const store = opened(world, ['lipscani']);
        store.intents.attachMap(CONTAINER);
        await settle();
        expect(rasters(world).at(-1)).toMatchObject({ id: 'corona-1968' });

        store.intents.edit({ sourceLayer: undefined });
        expect(await store.intents.save()).toEqual({ ok: true });
        expect(world.store.docs.get(FIRESTORE_PATHS.poi(CITY, 'lipscani'))).not.toHaveProperty('sourceLayer');
    });

    it('badPath_aPlaceNamingAMapThatNoLongerExistsShowsNoneAndTakesAnother @S-A154-BAD-GONE-LAYER', async () => {
        const world = withLayers();
        seedPlace(world, 'lipscani', { sourceLayer: 'sters-1900' });
        const store = opened(world, ['lipscani']);
        store.intents.attachMap(CONTAINER);
        await settle();

        expect(store.state.editor?.draft?.value.sourceLayer).toBe('sters-1900');
        expect(rasters(world)).toEqual([]);

        store.intents.edit({ sourceLayer: 'corona-1968' });
        expect(await store.intents.save()).toEqual({ ok: true });
        expect(world.store.docs.get(FIRESTORE_PATHS.poi(CITY, 'lipscani'))).toMatchObject({ sourceLayer: 'corona-1968' });
    });

    it('badPath_aRetiredMapIsNotOfferedAndAFailedListRecoversWithTryAgain', () => {
        const world = withLayers();
        const store = opened(world);
        world.store.fail(FIRESTORE_PATHS.layers(CITY), { kind: 'denied', code: 'permission-denied' });
        store.intents.retry();
        expect(store.state.traceLayers.map((layer) => layer.id)).toEqual(['plan-1911', 'corona-1968']);
        store.close();
    });

    it('badPath_aStrayOpacityIsClamped', () => {
        expect([clampPercent(-5), clampPercent(140), clampPercent(Number.NaN), clampPercent(33.6)]).toEqual([0, 100, 100, 34]);
    });

    it('happyPath_aLayerEntryKeepsItsLabelAndTiles', () => {
        const doc: LayerDoc = layerDoc({ year: 1911, label: { ro: 'Planul', en: 'The plan' } });
        const entry = traceEntryOf({ id: 'plan', path: LAYER('plan'), data: doc, version: 'v1', pending: false });
        expect(entry?.item).toEqual({ id: 'plan', label: { ro: 'Planul', en: 'The plan' }, year: 1911 });
        expect(entry?.spec).toMatchObject({ id: 'plan', source: doc.source });
    });
});
