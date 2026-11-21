// What the georeferencer's map pane shows (`base-layers.ts`): a published layer of the city under the pairs, on the page's one map,
// kept for the next version opened (S-A16-HAPPY-GEOREF-MAP-SHOWS); a draft layer is not offered and a layer that is no longer
// published goes back to the reference (S-A16-BAD-GEOREF-MAP-SHOWS-GONE).
import { FIRESTORE_PATHS } from '@hcm/shared';
import { FakeMap } from '@hcm/test-support/fake-map';
import { FakeMapDraw } from '@hcm/test-support/fake-map-draw';
import { describe, expect, it } from 'vitest';

import { GEOREF_MODULE } from '../../src/georef/georef.js';
import { createMapPreview } from '../../src/map/preview.js';
import { settle } from '../app/fakes.js';
import { factoryOf, host } from '../imagery/maps.js';
import { CITY, cityDoc, golden, imageryWorld, VERSIONS } from '../imagery/world.js';
import { layerDoc } from '../layers/fixtures.js';
import { fakeFrames } from '../map/support.js';

const UPLOAD = 'up-plan1911';
const RENDERED = 'job-1966-0712';
const LAYER = (id: string): string => FIRESTORE_PATHS.layer(CITY, id);

function setup() {
    const map = new FakeMap();
    map.view = { center: [26.1, 44.45], zoom: 13, bearing: 0 };
    const draw = new FakeMapDraw();
    const handle = { port: map, preview: createMapPreview(map, fakeFrames()), draw: () => Promise.resolve(draw), destroy: () => undefined };
    const again = { ...handle };
    const world = imageryWorld({
        maps: factoryOf([
            { ok: true, map: handle },
            { ok: true, map: again },
        ]),
    });
    world.store.docs.set(FIRESTORE_PATHS.city(CITY), cityDoc());
    world.store.docs.set(VERSIONS(UPLOAD), golden('version.needs-gcps.json'));
    world.store.docs.set(VERSIONS(RENDERED), golden('version.awaiting-approval.json'));
    world.store.docs.set(LAYER('plan-1911'), layerDoc({ year: 1911, label: { ro: 'Planul 1911' }, opacity: 0.6 }));
    world.store.docs.set(LAYER('corona-1968'), layerDoc({ year: 1968 }));
    world.store.docs.set(LAYER('draft-1900'), layerDoc({ year: 1900, published: false }));
    return { ...world, map, georef: GEOREF_MODULE.create(world.services) };
}

/** The ids of the raster layers the map was asked to draw, in order. */
function drawn(map: FakeMap): readonly string[] {
    return map.callsOf('addRasterLayer').map((call) => (call[0] as { id: string }).id);
}

describe('what the map pane shows', () => {
    it('happyPath_aPublishedLayerGoesUnderThePairsOnTheSameMapAndIsKeptForTheNextVersion @S-A16-HAPPY-GEOREF-MAP-SHOWS', async () => {
        const { georef, map } = setup();
        georef.open([UPLOAD]);
        georef.intents.attachMap(host());
        await settle();

        // The published layers, oldest first; the draft is not offered; nothing is drawn until one is chosen.
        expect(georef.state.baseLayers).toEqual([
            { id: 'plan-1911', label: { ro: 'Planul 1911' }, year: 1911 },
            { id: 'corona-1968', label: { ro: 'Corona 1968' }, year: 1968 },
        ]);
        expect([georef.state.base, drawn(map)]).toEqual([null, []]);

        georef.intents.setBase('plan-1911');
        expect(georef.state.base).toBe('plan-1911');
        expect(map.callsOf('addRasterLayer').at(-1)).toMatchObject([{ id: 'plan-1911', opacity: 1, visible: true }, 'middle']);

        // Another layer replaces it; the reference alone takes it off.
        georef.intents.setBase('corona-1968');
        expect(drawn(map).at(-1)).toBe('corona-1968');
        expect(map.callsOf('removeLayer').map((call) => call[0])).toContain('plan-1911');
        georef.intents.setBase(null);
        expect(map.callsOf('removeLayer').map((call) => call[0])).toContain('corona-1968');

        // Kept while the admin is open: the next version opens on the layer chosen, drawn once its map is made.
        georef.intents.setBase('plan-1911');
        const before = drawn(map).length;
        georef.close();
        expect(georef.state.base).toBe('plan-1911');
        georef.open([RENDERED]);
        georef.intents.attachMap(host());
        await settle();
        expect(georef.state.base).toBe('plan-1911');
        expect(drawn(map).slice(before)).toContain('plan-1911');
    });

    it('badPath_aLayerNoLongerPublishedGoesBackToTheReference @S-A16-BAD-GEOREF-MAP-SHOWS-GONE', async () => {
        const { georef, map, store } = setup();
        georef.open([UPLOAD]);
        georef.intents.attachMap(host());
        await settle();
        georef.intents.setBase('corona-1968');

        store.put(LAYER('corona-1968'), layerDoc({ year: 1968, published: false }));
        await settle();

        expect(georef.state.baseLayers.map((layer) => layer.id)).toEqual(['plan-1911']);
        expect(georef.state.base).toBeNull();
        expect(map.callsOf('removeLayer').map((call) => call[0])).toContain('corona-1968');

        // A layer that does not exist draws nothing.
        georef.intents.setBase('nowhere');
        expect(drawn(map).at(-1)).toBe('corona-1968');
    });
});
