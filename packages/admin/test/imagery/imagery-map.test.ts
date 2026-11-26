import { usgsSceneDocSchema } from '@hcm/shared';
import { FakeMap } from '@hcm/test-support/fake-map';
import type { VectorOverlaySpec } from '@hcm/ui/map';
import { describe, expect, it } from 'vitest';

import {
    CITY_OVERLAY,
    footprintColorsOf,
    ImageryMap,
    PREVIEW_PICTURE,
    sceneCorners,
    SELECTED_OVERLAY,
} from '../../src/imagery/imagery-map.js';
import { sceneItemOf, type SceneItem } from '../../src/imagery/model.js';
import type { MapStatus } from '../../src/layers/map-session.js';
import type { AdminMapHandle } from '../../src/map/factory.js';
import { createMapPreview } from '../../src/map/preview.js';
import { settle } from '../app/fakes.js';
import { fakeFrames } from '../map/support.js';
import { factoryOf, host, mapboxHandle } from './maps.js';
import { FakeFiles, FakePictures, sceneDoc } from './world.js';

const FRAME = {
    bounds: [
        [25.9, 44.3],
        [26.3, 44.6],
    ] as const,
    view: { center: [26.1, 44.45] as const, zoom: 12, bearing: 0 },
};

function scene(id: string, overrides: Record<string, unknown> = {}): SceneItem {
    const doc = usgsSceneDocSchema.parse(sceneDoc(id, overrides));
    return sceneItemOf({ id, path: id, data: doc, version: '', pending: false });
}

function fakeHandle(): { readonly handle: AdminMapHandle; readonly map: FakeMap } {
    const map = new FakeMap();
    const handle = {
        port: map,
        preview: createMapPreview(map, fakeFrames()),
        draw: () => Promise.reject(new Error('none')),
        destroy: () => undefined,
    };
    return { handle, map };
}

function session(handle: AdminMapHandle | null, pictures: FakePictures | null = new FakePictures()) {
    const files = new FakeFiles();
    const statuses: MapStatus[] = [];
    const maps = handle === null ? null : factoryOf([{ ok: true, map: handle }]);
    const map = new ImageryMap({
        maps,
        locale: () => 'ro',
        files,
        pictures,
        status: (status) => statuses.push(status),
    });
    return { map, files, statuses };
}

describe('the Imagery page map', () => {
    it('happyPath_theCitysBoundaryAndTheOpenScenesFootprintAtTheCitysView', async () => {
        const { handle, map: fake } = fakeHandle();
        const { map, statuses } = session(handle);
        map.showScenes(null);

        map.attach(host());
        map.setFrame(FRAME);
        await settle();
        map.showScenes(scene('b'));

        expect(statuses).toEqual(['none', 'loading', 'ready']);
        expect(fake.callsOf('addVectorOverlay').map(([spec]) => (spec as { id: string }).id)).toEqual([CITY_OVERLAY, SELECTED_OVERLAY]);
        // The map stays at the city's view: a strip's footprint would zoom it out over the region (finding 51).
        expect(fake.callsOf('fitBounds')).toHaveLength(0);
        map.zoomBy(1);
        map.detach();
        expect(statuses.at(-1)).toBe('none');
    });

    it('happyPath_noSceneOpenDrawsTheCityAloneInTheThemesColourAndAnOpenOneFilled', async () => {
        const { handle, map: fake } = fakeHandle();
        const { map } = session(handle);
        map.attach(host());
        map.setFrame(FRAME);
        await settle();
        map.setColors({ outline: '#123456', selected: '#654321' });
        map.showScenes(null);
        const alone = fake.callsOf('addVectorOverlay').map(([spec]) => (spec as VectorOverlaySpec).id);
        map.showScenes(scene('b'));

        const specs = fake.callsOf('addVectorOverlay').map(([spec]) => spec as VectorOverlaySpec);
        const city = specs.findLast((spec) => spec.id === CITY_OVERLAY);
        const selected = specs.findLast((spec) => spec.id === SELECTED_OVERLAY);
        expect(alone).toEqual([CITY_OVERLAY]);
        expect(city?.features[0]?.geometry).toEqual({
            type: 'LineString',
            coordinates: [
                [25.9, 44.3],
                [26.3, 44.3],
                [26.3, 44.6],
                [25.9, 44.6],
                [25.9, 44.3],
            ],
        });
        expect([city?.color, selected?.color, city?.clickable, selected?.clickable]).toEqual(['#123456', '#654321', false, false]);
        expect(selected?.features.map((feature) => [feature.geometry.type, feature.properties.id])).toEqual([['Polygon', 'b']]);
    });

    it('badPath_aThemeWithoutUsableColoursKeepsTheFixedOnes', () => {
        const light = (tokens: Record<string, string>) =>
            footprintColorsOf({
                seedColor: '#8b5e3c',
                tokens: { light: tokens, dark: tokens, highContrastLight: tokens, highContrastDark: tokens },
            });

        expect(light({ '--md-sys-color-primary': '#8B5E3C', '--md-sys-color-tertiary': '#5b6236' })).toEqual({
            outline: '#8B5E3C',
            selected: '#5b6236',
        });
        expect(light({ '--md-sys-color-primary': 'rgb(1 2 3)' })).toEqual({ outline: '#3949ab', selected: '#c2185b' });
        expect(footprintColorsOf(undefined)).toEqual({ outline: '#3949ab', selected: '#c2185b' });
    });

    it('happyPath_aPictureOfTheBucketGoesOnTheMapAndANewerOneWins', async () => {
        const { handle, native } = await mapboxHandle();
        const { map, files } = session(handle);
        map.attach(host());
        map.setFrame(FRAME);
        await settle();
        files.put('preview.png');
        files.put('other.png');
        files.hold = true;

        const first = map.showPicture(PREVIEW_PICTURE, 'preview.png', sceneCorners(scene('a')), 0.8);
        const second = map.showPicture(PREVIEW_PICTURE, 'other.png', sceneCorners(scene('a')), 0.8);
        files.flush();
        await Promise.all([first, second]);
        await settle();
        map.fitBox(FRAME.bounds);

        expect(native.callsOf('addSource').filter(([id]) => id === 'hcm-picture-preview')).toHaveLength(1);
        expect(map.overlays.has(PREVIEW_PICTURE)).toBe(true);
        map.clearPictures();
        expect(map.overlays.has(PREVIEW_PICTURE)).toBe(false);
    });

    it('badPath_noPictureDecoderOrNoFileShowsNothingAndNoFactoryIsAFailedMap', async () => {
        const { handle } = await mapboxHandle();
        const blind = session(handle, null);
        blind.map.attach(host());
        blind.map.setFrame(FRAME);
        await settle();
        blind.files.put('preview.png');
        await blind.map.showPicture(PREVIEW_PICTURE, 'preview.png', sceneCorners(scene('a')), 1);
        const missing = session(handle);
        await missing.map.showPicture(PREVIEW_PICTURE, 'nothing.png', sceneCorners(scene('a')), 1);
        const none = session(null);
        none.map.attach(host());
        none.map.setFrame(FRAME);
        await settle();

        expect([blind.map.overlays.has(PREVIEW_PICTURE), missing.map.overlays.has(PREVIEW_PICTURE)]).toEqual([false, false]);
        expect(none.statuses).toEqual(['none', 'failed']);
    });

    it('happyPath_aScenesCornersOrElseItsFootprintsBox', () => {
        const cornered = scene('c', {
            corners: {
                nw: { lat: 44.6, lng: 25.9 },
                ne: { lat: 44.61, lng: 26.3 },
                se: { lat: 44.3, lng: 26.31 },
                sw: { lat: 44.29, lng: 25.9 },
            },
        });

        expect(sceneCorners(cornered)[1]).toEqual([26.3, 44.61]);
        expect(sceneCorners(scene('d'))).toEqual([
            [25.9, 44.6],
            [26.3, 44.6],
            [26.3, 44.3],
            [25.9, 44.3],
        ]);
    });
});
