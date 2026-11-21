// The photos page's map: markers and cones (the edited photo from its draft), the pin in the drawing tools, a pick for
// the direction, and every reason there is no map.
import { describe, expect, it } from 'vitest';

import { PhotoMapSession, PIN_FEATURE_ID, photoFeatures, rounded, type MapPhoto, type MapStatus } from '../../src/photos/map.js';
import { CONTAINER, FakeMaps, settle } from './world.js';

const BOUNDS = [
    [26, 44.3],
    [26.3, 44.55],
] as const;

const OPTIONS = { bounds: BOUNDS, view: { center: [26.1, 44.43] as const, zoom: 13, bearing: 0 }, locale: 'ro' as const };

const PHOTO: MapPhoto = { id: 'p1', title: 'Calea Victoriei', year: 1936, location: { lat: 44.43, lng: 26.1 }, bearing: 90, fov: null };

function session(maps: FakeMaps | null = new FakeMaps()) {
    const statuses: MapStatus[] = [];
    const selected: string[] = [];
    const pins: { position: readonly [number, number]; final: boolean }[] = [];
    let refused = 0;
    const map = new PhotoMapSession(maps, {
        status: (status) => {
            statuses.push(status);
        },
        select: (photoId) => {
            selected.push(photoId);
        },
        pin: (position, final) => {
            pins.push({ position, final });
        },
        refused: () => {
            refused += 1;
        },
    });
    return { map, maps, statuses, selected, pins, refused: () => refused };
}

describe('photoFeatures', () => {
    it('happyPath_markersThenConesOfThePhotosWithADirection', () => {
        const features = photoFeatures([PHOTO, { ...PHOTO, id: 'p2', bearing: null }]);

        expect(features.features.map((feature) => [feature.geometry.type, feature.properties.id])).toEqual([
            ['Point', 'p1'],
            ['Point', 'p2'],
            ['Polygon', 'p1'],
        ]);
        expect(features.features[0]?.properties).toEqual({ id: 'p1', title: 'Calea Victoriei', year: 1936, bearing: 90 });
    });

    it('happyPath_coordinatesAreRoundedToACentimetre', () => {
        expect(rounded([26.123_456_789, 44.987_654_321])).toEqual([26.123_456_8, 44.987_654_3]);
    });
});

describe('PhotoMapSession', () => {
    it('happyPath_theMapShowsThePhotosAndAClickOpensOne', async () => {
        const { map, maps, statuses, selected } = session();
        map.show([PHOTO]);

        await map.attach(CONTAINER, OPTIONS);

        expect(statuses).toEqual(['loading', 'ready']);
        expect(maps?.port.data.at(-1)?.features).toHaveLength(2);
        maps?.port.click('p1');
        expect(selected).toEqual(['p1']);
        map.focus({ lat: 44.4, lng: 26.2 });
        map.zoomBy(1);
        map.zoomBy(-1);
        expect(maps?.port.flights).toEqual([{ center: [26.2, 44.4] }, { zoom: 16 }, { zoom: 14 }]);
        expect(map.centre()).toEqual([26.1, 44.43]);
    });

    it('happyPath_theOpenPhotoIsBroughtIntoViewOnceUntilTheEditorCloses', async () => {
        const { map, maps } = session();
        map.reveal('p1', { lat: 44.4, lng: 26.2 });
        await map.attach(CONTAINER, OPTIONS);

        map.reveal('p1', { lat: 44.4, lng: 26.2 });
        map.reveal('p1', { lat: 44.41, lng: 26.2 });
        await map.editPin(null);
        map.reveal('p1', { lat: 44.41, lng: 26.2 });

        // Nothing before the map exists; then once, and once more after the editor closed and opened it again.
        expect(maps?.port.flights).toEqual([{ center: [26.2, 44.4] }, { center: [26.2, 44.41] }]);
    });

    it.each(['no-token', 'no-webgl', 'failed'] as const)('badPath_noMapBecause %s', async (reason) => {
        const maps = new FakeMaps();
        maps.result = reason;
        const { map, statuses } = session(maps);

        await map.attach(CONTAINER, OPTIONS);

        expect(statuses).toEqual(['loading', reason]);
        expect(map.centre()).toBeNull();
        await expect(map.pick()).resolves.toBeNull();
    });

    it('badPath_withoutAFactoryTheMapIsUnavailable', async () => {
        const { map, statuses } = session(null);

        await map.attach(CONTAINER, OPTIONS);
        await map.editPin({ lat: 44.4, lng: 26.1 });

        expect(statuses).toEqual(['unavailable']);
    });

    it('badPath_aMapCreatedAfterThePageLeftIsDestroyed', async () => {
        const maps = new FakeMaps();
        let release = (): void => undefined;
        maps.hold = new Promise((resolve) => {
            release = resolve;
        });
        const { map } = session(maps);
        const attached = map.attach(CONTAINER, OPTIONS);

        map.detach();
        release();
        await attached;

        expect(maps.destroyed).toBe(1);
    });

    it('happyPath_thePinIsDraggableAndReportsWhereItGoes', async () => {
        const { map, maps, pins, refused } = session();
        await map.attach(CONTAINER, OPTIONS);

        await map.editPin({ lat: 44.43, lng: 26.1 });

        const draw = maps?.draw;
        expect(draw?.calls).toEqual(['attach']);
        expect(draw?.limits).toEqual([
            [25.5, 43.8],
            [26.8, 45.05],
        ]);
        expect(draw?.loaded).toEqual([{ id: PIN_FEATURE_ID, geometry: { type: 'Point', coordinates: [26.1, 44.43] } }]);
        expect([draw?.mode, draw?.selected]).toEqual(['select', PIN_FEATURE_ID]);
        draw?.emitChange({
            features: [{ id: PIN_FEATURE_ID, geometry: { type: 'Point', coordinates: [26.111_111_111, 44.4] } }],
            final: false,
        });
        draw?.emitChange({ features: [{ id: 'other', geometry: { type: 'Point', coordinates: [1, 2] } }], final: true });
        draw?.emitChange({ features: [{ id: PIN_FEATURE_ID, geometry: { type: 'LineString', coordinates: [] } }], final: true });
        draw?.emitRefused();
        expect(pins).toEqual([{ position: [26.111_111_1, 44.4], final: false }]);
        expect(refused()).toBe(1);

        await map.editPin(null);
        expect(draw?.loaded).toEqual([]);
        expect(draw?.mode).toBe('static');
    });

    it('happyPath_aPickReturnsTheClickedPositionRounded', async () => {
        const { map, maps } = session();
        await map.attach(CONTAINER, OPTIONS);

        const picked = map.pick();
        await settle();
        maps?.draw.resolvePick([26.123_456_789, 44.4]);

        await expect(picked).resolves.toEqual([26.123_456_8, 44.4]);
        const cancelled = map.pick();
        await settle();
        map.cancelPick();
        await expect(cancelled).resolves.toBeNull();
    });

    it('happyPath_detachDestroysTheMapAndTheDrawingTools', async () => {
        const { map, maps, statuses } = session();
        await map.attach(CONTAINER, OPTIONS);
        await map.editPin({ lat: 44.43, lng: 26.1 });

        map.detach();

        expect(maps?.destroyed).toBe(1);
        expect(maps?.draw.calls).toContain('detach');
        expect(statuses.at(-1)).toBe('none');
        map.show([PHOTO]);
        map.cancelPick();
    });
});
