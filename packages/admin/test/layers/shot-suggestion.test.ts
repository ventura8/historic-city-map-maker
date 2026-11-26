/**
 * The shot direction a layer's USGS scene suggests (`packages/admin/src/layers/shot-suggestion.ts`, scenario V93): the
 * frame's top edge from its corners, read once per opened layer; no scene, no corners or a failed read suggest nothing.
 */
import { FIRESTORE_PATHS, type LayerDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { layersModule } from '../../src/layers/layers.js';
import { cornersBearing, ShotSuggestion } from '../../src/layers/shot-suggestion.js';
import { sceneDoc } from '../imagery/world.js';
import { CITY, contentWorld } from '../content/world.js';
import { CITY_PATH, cityDoc, LAYER_PATH, layerDoc } from './fixtures.js';

const SCENE = 'DS1035-1057DA023';
const SCENE_PATH = FIRESTORE_PATHS.usgsScene(CITY, SCENE);
const FROM_USGS: Pick<LayerDoc, 'kind' | 'provenance'> = { kind: 'satellite', provenance: { usgsEntityId: SCENE } };

/** A frame whose top edge points north-east (south-west 44.3/25.9, north-west 44.6/26.3). */
const TILTED = { sw: { lat: 44.3, lng: 25.9 }, nw: { lat: 44.6, lng: 26.3 }, ne: { lat: 44.7, lng: 26.6 }, se: { lat: 44.4, lng: 26.2 } };

function opened(scene: Record<string, unknown> | null, layer: Partial<LayerDoc> = FROM_USGS) {
    const world = contentWorld();
    world.store.docs.set(LAYER_PATH('corona'), layerDoc(layer));
    world.store.docs.set(CITY_PATH, cityDoc());
    if (scene !== null) {
        world.store.docs.set(SCENE_PATH, scene);
    }
    const store = layersModule.create(world.services);
    store.open(['corona']);
    return store;
}

describe('cornersBearing', () => {
    it.each([
        [{ sw: { lat: 44, lng: 26 }, nw: { lat: 45, lng: 26 } }, 0],
        [{ sw: { lat: 45, lng: 26 }, nw: { lat: 44, lng: 26 } }, 180],
        [{ sw: { lat: 44, lng: 26 }, nw: { lat: 44, lng: 25 } }, 270],
        [TILTED, 44],
    ])('happyPath_theTopEdgeOf_%j_is_%d @S-A233-HAPPY-SHOT-USGS', (corners, bearing) => {
        expect(cornersBearing({ ...TILTED, ...corners })).toBe(bearing);
    });
});

describe('the layer editor offers the USGS direction', () => {
    it('happyPath_aSceneWithCornersSuggestsItsTopEdge @S-A233-HAPPY-SHOT-USGS', () => {
        const store = opened(sceneDoc(SCENE, { corners: TILTED }));

        expect(store.state.editor?.shotSuggestion).toBe(44);
        expect(store.state.editor?.draft.dirty).toEqual([]);
    });

    it.each<[string, Record<string, unknown> | null, Partial<LayerDoc>]>([
        ['a scene without corners', sceneDoc(SCENE), FROM_USGS],
        ['no scene', null, FROM_USGS],
        ['a drawn map', sceneDoc(SCENE, { corners: TILTED }), { kind: 'map', provenance: { usgsEntityId: SCENE } }],
        ['a layer from no USGS scene', sceneDoc(SCENE, { corners: TILTED }), { kind: 'satellite' }],
    ])('badPath_%s_suggestsNothing @S-A233-BAD-SHOT-USGS', (_name, scene, layer) => {
        expect(opened(scene, layer).state.editor?.shotSuggestion).toBeUndefined();
    });

    it('badPath_aFailedReadSuggestsNothingAndAnotherLayerStopsTheRead @S-A233-BAD-SHOT-USGS', () => {
        const found: number[] = [];
        const heard: unknown[] = [];
        let stopped = 0;
        const store = {
            watchDoc: (_path: string, _schema: unknown, listen: (doc: unknown) => void, failed: (failure: unknown) => void) => {
                heard.push(listen);
                failed({ code: 'unavailable' });
                return () => {
                    stopped += 1;
                };
            },
        };
        const suggestion = new ShotSuggestion({ store: store as never, cityId: CITY }, (_id, bearing) => found.push(bearing));

        suggestion.load('a', FROM_USGS);
        suggestion.load('a', FROM_USGS);

        expect([found, stopped, heard.length]).toEqual([[], 1, 1]);
    });

    it('badPath_aPendingReadIsStoppedWhenTheEditorCloses', () => {
        let stopped = 0;
        const store = {
            watchDoc: () => () => {
                stopped += 1;
            },
        };
        const suggestion = new ShotSuggestion({ store: store as never, cityId: CITY }, () => undefined);

        suggestion.load('a', FROM_USGS);
        suggestion.stop();
        suggestion.stop();

        expect(stopped).toBe(1);
    });
});
