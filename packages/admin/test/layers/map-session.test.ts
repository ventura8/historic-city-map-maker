import type { MapView } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { layersModule } from '../../src/layers/layers.js';
import { AreaMap, frameOf, rasterOf, type MapStatus } from '../../src/layers/map-session.js';
import { PreviewLayer } from '../../src/layers/preview.js';
import type { AdminMapFactory, AdminMapHandle, AdminMapResult } from '../../src/map/factory.js';
import type { MapContent, PreviewChange, PreviewTarget } from '../../src/map/preview.js';
import { settle } from '../app/fakes.js';
import { contentWorld } from '../content/world.js';
import { CITY_PATH, cityDoc, LAYER_PATH, layerDoc } from './fixtures.js';

interface FakeMap {
    readonly calls: string[];
    readonly handle: AdminMapHandle;
}

function fakeMap(): FakeMap {
    const calls: string[] = [];
    let view: MapView = { center: [26.1, 44.43], zoom: 13, bearing: 0 };
    const port = {
        getView: () => view,
        flyTo: (next: Partial<MapView>) => {
            view = { ...view, ...next };
            calls.push(`flyTo ${JSON.stringify(next)}`);
        },
    };
    const preview = {
        show: (content: MapContent) => calls.push(`show ${JSON.stringify(content.layers?.map((layer) => layer.id))}`),
        preview: (change: PreviewChange) => calls.push(`preview ${JSON.stringify(change)}`),
        restore: (target: PreviewTarget) => calls.push(`restore ${JSON.stringify(target)}`),
    };
    const handle = {
        port,
        preview,
        draw: () => Promise.reject(new Error('no drawing here')),
        destroy: () => calls.push('destroy'),
    } as unknown as AdminMapHandle;
    return { calls, handle };
}

/** A factory whose maps answer in order: a scripted result each, created when the test lets them. */
function factory(results: AdminMapResult[]): AdminMapFactory & { readonly created: string[] } {
    const created: string[] = [];
    return {
        created,
        create: (container, options) => {
            created.push(`${container.id} ${JSON.stringify(options.view.center)}`);
            const result = results.shift();
            return result === undefined ? Promise.reject(new Error('no more maps')) : Promise.resolve(result);
        },
    };
}

function host(id: string): HTMLElement {
    return { id } as unknown as HTMLElement;
}

function session(maps: AdminMapFactory | null) {
    const statuses: MapStatus[] = [];
    const preview = new PreviewLayer();
    const map = new AreaMap({ maps, locale: () => 'ro', preview, status: (status) => statuses.push(status) });
    return { map, statuses, preview };
}

describe('the city frame and the raster', () => {
    it('happyPath_theCitysViewOrTheMiddleOfItsBounds', () => {
        expect(frameOf(cityDoc()).view).toEqual({ center: [26.1, 44.43], zoom: 13, bearing: 0 });
        expect(frameOf(cityDoc({ center: undefined, zoom: undefined })).view).toEqual({ center: [26.1, 44.45], zoom: 13, bearing: 0 });
        expect(frameOf(cityDoc()).bounds).toEqual([
            [25.9, 44.3],
            [26.3, 44.6],
        ]);
    });

    it('happyPath_theOpenLayerIsShownAsSaved', () => {
        expect(
            rasterOf(
                'corona',
                layerDoc({
                    attribution: 'USGS',
                    adjustments: { contrast: 0.2 },
                    bounds: { west: 26, south: 44.4, east: 26.2, north: 44.5 },
                }),
            ),
        ).toEqual({
            id: 'corona',
            source: { type: 'mapbox', tilesetId: 'e2e-user.corona-1968' },
            minzoom: 10,
            maxzoom: 17,
            bounds: [
                [26, 44.4],
                [26.2, 44.5],
            ],
            visible: true,
            opacity: 1,
            adjustments: { contrast: 0.2 },
            order: 1,
            attribution: 'USGS',
        });
        expect(rasterOf('corona', layerDoc())).not.toHaveProperty('bounds');
    });
});

describe('the area map', () => {
    it('happyPath_oneMapOnceTheHostAndTheFrameAreKnownWithThePreviewOnIt', async () => {
        const live = fakeMap();
        const maps = factory([{ ok: true, map: live.handle }]);
        const { map, statuses, preview } = session(maps);

        map.show([rasterOf('corona', layerDoc())]);
        preview.show({ kind: 'layer', id: 'corona', opacity: 0.4 });
        const container = host('a');
        map.attach(container);
        expect(maps.created).toEqual([]);
        map.setFrame(frameOf(cityDoc()));
        map.setFrame(frameOf(cityDoc({ zoom: 14 })));
        map.attach(container);
        await settle();

        expect(maps.created).toEqual(['a [26.1,44.43]']);
        expect(statuses).toEqual(['none', 'loading', 'ready']);
        expect(live.calls).toEqual(['show ["corona"]', 'preview {"kind":"layer","id":"corona","opacity":0.4}']);
        map.zoomBy(1);
        map.show([]);
        map.detach();
        expect(live.calls.slice(2)).toEqual(['flyTo {"zoom":14}', 'show []', 'destroy']);
        map.zoomBy(1);
    });

    it('badPath_noTokenNoFactoryAndAStaleMap', async () => {
        const noToken = session(factory([{ ok: false, reason: 'no-token' }]));
        noToken.map.setFrame(frameOf(cityDoc()));
        noToken.map.attach(host('a'));
        await settle();
        expect(noToken.statuses.at(-1)).toBe('no-token');

        const none = session(null);
        none.map.setFrame(frameOf(cityDoc()));
        none.map.attach(host('a'));
        expect(none.statuses.at(-1)).toBe('failed');

        const stale = fakeMap();
        const later = session(
            factory([
                { ok: true, map: stale.handle },
                { ok: false, reason: 'failed' },
            ]),
        );
        later.map.setFrame(frameOf(cityDoc()));
        later.map.attach(host('a'));
        later.map.attach(host('b'));
        await settle();
        expect(stale.calls).toEqual(['destroy']);
        expect(later.statuses.at(-1)).toBe('failed');
    });
});

describe('the layers store and its map', () => {
    it('happyPath_theOpenLayersSliderPreviewsOnThePagesMap', async () => {
        const live = fakeMap();
        const world = contentWorld({ maps: factory([{ ok: true, map: live.handle }]) });
        world.store.docs.set(CITY_PATH, cityDoc());
        world.store.docs.set(LAYER_PATH('corona'), layerDoc());
        const store = layersModule.create(world.services);
        store.open(['corona']);
        store.intents.attachMap(host('map'));
        await settle();

        store.intents.setOpacity(30);
        store.intents.zoomBy(-1);
        await settle();

        expect(store.state.map).toBe('ready');
        expect(live.calls).toEqual([
            'show ["corona"]',
            'preview {"kind":"layer","id":"corona","opacity":1,"visible":true,"adjustments":{}}',
            'preview {"kind":"layer","id":"corona","opacity":0.3,"visible":true,"adjustments":{}}',
            'flyTo {"zoom":12}',
        ]);
        store.close();
        expect(live.calls.at(-1)).toBe('destroy');
        expect(store.state.map).toBe('none');
    });
});
