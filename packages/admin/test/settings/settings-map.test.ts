// The settings page's map (DECISIONS-for-review.md §42a): the city's content as the visitors see it, the bounds as a
// rectangle, two clicks drawing a new one, the map's view as the start view; its lists listen only while it is attached.
import { FIRESTORE_PATHS, type LngLat, type MapView } from '@hcm/shared';
import type { VectorOverlaySpec } from '@hcm/ui/map';
import { describe, expect, it } from 'vitest';

import { PreviewLayer } from '../../src/layers/preview.js';
import type { AdminMapFactory, AdminMapHandle } from '../../src/map/factory.js';
import type { MapContent } from '../../src/map/preview.js';
import { BOUNDS_OVERLAY_ID, boundsOf, SettingsMap, type SettingsMapState } from '../../src/settings/settings-map.js';
import { settingsModule } from '../../src/settings/settings.js';
import { settle } from '../app/fakes.js';
import { CITY, contentWorld } from '../content/world.js';
import { CATEGORY_PATH, categoryDoc, CITY_PATH, cityDoc, LAYER_PATH, layerDoc, photoDoc, poiDoc } from '../layers/fixtures.js';

interface FakeMap {
    readonly contents: MapContent[];
    readonly overlays: (VectorOverlaySpec | string)[];
    readonly destroyed: { count: number };
    readonly click: (position: LngLat) => void;
    readonly listening: () => number;
    readonly handle: AdminMapHandle;
}

function fakeMap(): FakeMap {
    const contents: MapContent[] = [];
    const overlays: (VectorOverlaySpec | string)[] = [];
    const destroyed = { count: 0 };
    const clicks = new Set<(position: LngLat) => void>();
    const view: MapView = { center: [26.12345678, 44.4312345], zoom: 14.256, bearing: 0 };
    const port = {
        getView: () => view,
        flyTo: () => undefined,
        onMapClick: (handler: (position: LngLat) => void) => {
            clicks.add(handler);
            return () => clicks.delete(handler);
        },
        addVectorOverlay: (spec: VectorOverlaySpec) => overlays.push(spec),
        removeLayer: (id: string) => overlays.push(`remove ${id}`),
    };
    const preview = { show: (content: MapContent) => contents.push(content), preview: () => undefined, restore: () => undefined };
    const handle = {
        port,
        preview,
        draw: () => Promise.reject(new Error('no drawing here')),
        destroy: () => {
            destroyed.count += 1;
        },
    } as unknown as AdminMapHandle;
    return {
        ...{ contents, overlays, destroyed, handle },
        click: (position) => {
            for (const handler of [...clicks]) {
                handler(position);
            }
        },
        listening: () => clicks.size,
    };
}

function world(maps: 'ready' | 'none' = 'ready') {
    const map = fakeMap();
    const factory: AdminMapFactory = { create: () => Promise.resolve({ ok: true, map: map.handle }) };
    const content = contentWorld({ maps: maps === 'ready' ? factory : null });
    content.store.docs.set(LAYER_PATH('corona'), layerDoc({ order: 2, year: 1968 }));
    content.store.docs.set(CATEGORY_PATH('cladiri'), categoryDoc({ order: 0 }));
    content.store.docs.set(FIRESTORE_PATHS.photo(CITY, 'p1'), photoDoc(44.43, 26.1, 'Calea Victoriei'));
    content.store.docs.set(FIRESTORE_PATHS.poi(CITY, 'gara'), poiDoc(44.44, 26.07, 'Gara de Nord'));
    content.store.docs.set(FIRESTORE_PATHS.poi(CITY, 'lost'), poiDoc(44.44, 26.08, 'Fără categorie', 'nimic'));
    const states: SettingsMapState[] = [];
    const drawn: unknown[] = [];
    const settings = new SettingsMap({
        services: content.services,
        preview: new PreviewLayer(),
        changed: (state) => states.push(state),
        drawn: (bounds) => drawn.push(bounds),
    });
    return { map, content, settings, states, drawn };
}

const CONTAINER = {} as HTMLElement;

describe('the settings map', () => {
    it('happyPath_itShowsTheCitysContentAndTheBoundsAndTwoClicksDrawANewRectangle', async () => {
        const { map, settings, drawn } = world();
        settings.showBounds({ west: 25.9, south: 44.3, east: 26.3, north: 44.6 });
        settings.attach(CONTAINER);
        settings.attach(CONTAINER);
        settings.setCity(cityDoc({ photosOverlay: { defaultOpacity: 0.6 } }));
        await settle();

        const content = map.contents.at(-1);
        expect(settings.state.status).toBe('ready');
        expect(content?.layers?.map((layer) => [layer.id, layer.visible])).toEqual([['corona', true]]);
        expect(content?.photos?.features).toHaveLength(1);
        expect(content?.photosOpacity).toBeCloseTo(0.6);
        expect(content?.categories?.map((overlay) => [overlay.id, overlay.features.map((feature) => feature.properties.id)])).toEqual([
            ['cladiri', ['gara']],
        ]);
        expect(map.overlays.at(-1)).toMatchObject({ id: BOUNDS_OVERLAY_ID, clickable: false });
        expect(settings.view()).toEqual({ center: [26.12345678, 44.4312345], zoom: 14.256, bearing: 0 });

        settings.toggleDrawing();
        expect(settings.state.drawing).toBe('first');
        map.click([26.2, 44.5]);
        expect(settings.state.drawing).toBe('second');
        map.click([26.0, 44.35]);

        expect(drawn).toEqual([{ west: 26, south: 44.35, east: 26.2, north: 44.5 }]);
        expect(settings.state.drawing).toBeNull();
        expect(map.listening()).toBe(0);
    });

    it('badPath_drawingWaitsForTheMapStopsOnASecondPressAndTheRectangleCanGo', async () => {
        const { map, settings, drawn } = world();
        settings.toggleDrawing();
        expect(settings.state.drawing).toBeNull();
        expect(settings.view()).toBeNull();
        settings.showBounds({ west: 25.9, south: 44.3, east: 26.3, north: 44.6 });
        expect(map.overlays).toEqual([]);

        settings.attach(CONTAINER);
        settings.setCity(cityDoc());
        await settle();
        settings.toggleDrawing();
        map.click([26.2, 44.5]);
        settings.toggleDrawing();
        map.click([26.0, 44.35]);
        settings.showBounds(null);
        settings.zoomBy(1);
        settings.detach();

        expect(drawn).toEqual([]);
        expect(settings.state).toEqual({ status: 'none', drawing: null });
        expect(map.overlays.at(-1)).toBe(`remove ${BOUNDS_OVERLAY_ID}`);
        expect(map.destroyed.count).toBe(1);
    });

    it('badPath_withoutTheMapsFactoryTheMapFails', async () => {
        const { settings } = world('none');

        settings.attach(CONTAINER);
        settings.setCity(cityDoc());
        await settle();

        expect(settings.state.status).toBe('failed');
    });

    it('happyPath_anEnglishAdminSeesThePlacesEnglishTitlesAndTheRomanianOnesWithoutThem', async () => {
        const map = fakeMap();
        const content = contentWorld({ maps: { create: () => Promise.resolve({ ok: true, map: map.handle }) } });
        content.store.docs.set(CATEGORY_PATH('cladiri'), categoryDoc({ order: 0 }));
        content.store.docs.set(FIRESTORE_PATHS.poi(CITY, 'gara'), {
            ...poiDoc(44.44, 26.07, 'Gara de Nord'),
            title: { ro: 'Gara de Nord', en: 'North Station' },
        });
        content.store.docs.set(FIRESTORE_PATHS.poi(CITY, 'ateneu'), poiDoc(44.44, 26.09, 'Ateneul Român'));
        const settings = new SettingsMap({
            services: { ...content.services, locale: () => 'en' },
            preview: new PreviewLayer(),
            changed: () => undefined,
            drawn: () => undefined,
        });

        settings.attach(CONTAINER);
        settings.setCity(cityDoc());
        await settle();

        const titles = map.contents.at(-1)?.categories?.[0]?.features.map((feature) => feature.properties.title);
        expect(titles?.toSorted()).toEqual(['Ateneul Român', 'North Station']);
    });

    it('happyPath_twoCornersMakeTheRectangleWhicheverComesFirst', () => {
        expect(boundsOf([26.3, 44.3], [25.9, 44.6])).toEqual({ west: 25.9, south: 44.3, east: 26.3, north: 44.6 });
        expect(boundsOf([26.123456789, 44.4], [26.2, 44.5])).toMatchObject({ west: 26.1234568 });
    });
});

describe('the settings area and its map', () => {
    it('happyPath_aDrawnRectangleAndTheMapsViewBecomeTheAreaSectionsDraft', async () => {
        const map = fakeMap();
        const content = contentWorld({ maps: { create: () => Promise.resolve({ ok: true, map: map.handle }) } });
        content.store.docs.set(CITY_PATH, cityDoc());
        const store = settingsModule({ passes: () => true }).create(content.services);
        store.open(['area']);
        store.intents.attachMap(CONTAINER);
        await settle();

        expect(store.state.map.status).toBe('ready');
        expect(map.overlays.at(-1)).toMatchObject({ id: BOUNDS_OVERLAY_ID });
        store.intents.drawBounds();
        map.click([26.0, 44.35]);
        map.click([26.2, 44.5]);
        store.intents.useMapView();
        store.intents.zoomBy(1);

        expect(store.state.citySection.draft.value).toMatchObject({
            bounds: { west: 26, south: 44.35, east: 26.2, north: 44.5 },
            center: { lat: 44.4312345, lng: 26.1234568 },
            zoom: 14.26,
        });
        expect(store.state.citySection.draft.dirty).toEqual(expect.arrayContaining(['bounds', 'center', 'zoom']));
        store.open(['texts']);
        expect(map.overlays.at(-1)).toBe(`remove ${BOUNDS_OVERLAY_ID}`);
        store.close();
        expect(map.destroyed.count).toBe(1);
    });

    it('badPath_withoutAMapTheViewIsNotTaken', () => {
        const content = contentWorld();
        content.store.docs.set(CITY_PATH, cityDoc());
        const store = settingsModule({ passes: () => true }).create(content.services);
        store.open(['area']);

        store.intents.useMapView();
        store.intents.drawBounds();

        expect(store.state.citySection.draft.dirty).toEqual([]);
        expect(store.state.map.drawing).toBeNull();
    });
});
