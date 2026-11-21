import type { MapOptions, RasterLayerSpec } from '@hcm/ui/map';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { linkCameras } from '../../src/compare/camera-sync.js';
import { compareChoices, compareCredit, mainSideLabel } from '../../src/compare/labels.js';
import { COMPARE_PARK_MS, comparedState, startCompare } from '../../src/compare/session.js';
import { FakeMap } from '@hcm/test-support/fake-map';
import { createLogger } from '@hcm/shared';
import type { CompareHost } from '../../src/core/compare-port.js';
import { initialState, withManifest, type ViewerState } from '../../src/core/state.js';
import { manifest } from '../core/fixtures.js';
import { loaded, type Harness, type HarnessOptions } from '../core/harness.js';
import { settle } from '../core/support.js';
import { FakeCompare } from './support.js';

/**
 * Swipe compare end to end in node (M4, V06; docs/research/M4-interfaces.md §3): the store, the entry's driver, the lazy
 * chunk's session and a recording surface, with FakeMap for both maps.
 */

const WIDE = [1280, 800] as const;
const VIEW = { center: [26.09, 44.43] as [number, number], zoom: 15, bearing: 20 };

async function comparing(
    options: HarnessOptions & { readonly size?: readonly [number, number] } = {},
): Promise<Harness & { compare: FakeCompare }> {
    const compare = options.compare ?? new FakeCompare();
    const parts = await loaded({ ...options, compare });
    const [width, height] = options.size ?? WIDE;
    parts.store.setWindowSize(width, height);
    return { ...parts, compare };
}

/** The raster layers a map was given, by id, with their visibility. */
function rasters(map: FakeMap): Record<string, boolean> {
    return Object.fromEntries(
        map.callsOf('addRasterLayer').map(([spec]) => [(spec as RasterLayerSpec).id, (spec as RasterLayerSpec).visible]),
    );
}

/** Points of interest off on a basemap with transit stations: both properties, live. */
const POIS_OFF_WRITES = [
    ['showPointOfInterestLabels', false],
    ['showTransitLabels', false],
];

describe('swipe compare session', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('happyPath_bothSidesFollowTheMapLabelsChoiceLiveWithNoNewMap', async () => {
        const { store, map, compare } = await comparing();
        store.openCompare(null);
        await settle();
        const second = compare.maps[0];
        const loads = map.mapLoadCount + (second?.mapLoadCount ?? 0);

        store.setMapLabels({ streets: false });

        expect(map.callsOf('setBasemapFlag')).toEqual([['showRoadLabels', false]]);
        expect(second?.callsOf('setBasemapFlag')).toEqual([['showRoadLabels', false]]);
        expect(map.mapLoadCount + (second?.mapLoadCount ?? 0)).toBe(loads);
    });

    it('happyPath_aSecondMapMadeAfterTheChoiceMountsWithIt', async () => {
        const { store, compare } = await comparing({ hash: '#14/44.43/26.1&labels=streets' });
        store.openCompare(null);
        await settle();
        const second = compare.maps[0];

        expect((second?.callsOf('mount')[0]?.[1] as MapOptions).config).toMatchObject({ showPointOfInterestLabels: false });
        expect(second?.getBasemapFlag('showPointOfInterestLabels')).toBe(false);
        expect(second?.callsOf('setBasemapFlag')).toEqual([]);
    });

    it('happyPath_bothSidesHideTransitStationsWithThePointsOfInterest', async () => {
        const flags = { basemapFlags: { showRoadLabels: true, showPointOfInterestLabels: true, showTransitLabels: true } };
        const compare = new FakeCompare();
        compare.mapOptions = flags;
        const { store, map } = await comparing({ compare, map: flags });
        store.openCompare(null);
        await settle();
        const second = compare.maps[0];

        store.setMapLabels({ pois: false });

        expect(map.callsOf('setBasemapFlag')).toEqual(POIS_OFF_WRITES);
        expect(second?.callsOf('setBasemapFlag')).toEqual(map.callsOf('setBasemapFlag'));
        store.setMapLabels({ pois: true });
        expect(second?.getBasemapFlag('showTransitLabels')).toBe(true);
    });

    it('badPath_aCustomBasemapIsNeverWrittenOnEitherSide', async () => {
        const compare = new FakeCompare();
        compare.mapOptions = { basemapFlags: {} };
        const { store, map } = await comparing({ compare, map: { basemapFlags: {} }, hash: '#14/44.43/26.1&labels=' });
        store.openCompare(null);
        await settle();

        store.setMapLabels({ streets: false });

        expect(map.callsOf('setBasemapFlag')).toEqual([]);
        expect(compare.maps[0]?.callsOf('setBasemapFlag')).toEqual([]);
    });

    it('badPath_aChoiceMadeWhileTheSecondMapMountsIsDrawnWhenItLoads', async () => {
        const compare = new FakeCompare();
        let open: () => void = () => undefined;
        compare.mountGate = new Promise((resolve) => {
            open = resolve;
        });
        const { store } = await comparing({ compare });
        store.openCompare(null);
        await settle();

        store.setMapLabels({ pois: false });
        open();
        await settle();

        expect(compare.maps[0]?.getBasemapFlag('showPointOfInterestLabels')).toBe(false);
    });

    it('happyPath_aWideWindowCreatesTheSecondMapOnlyWhenTheVisitorCompares', async () => {
        const { store, map, compare, container } = await comparing();
        expect(compare.loads).toBe(0);

        store.openCompare('kh9-1980');
        await settle();

        expect(compare.loads).toBe(1);
        expect(compare.ui.anchor).toBe(container);
        expect(compare.ui.css).toContain('mapbox-gl.css');
        expect(compare.ui.props).toMatchObject({
            mode: 'swipe',
            position: 0.5,
            layerId: 'kh9-1980',
            mainLabel: 'Azi',
        });
        expect(compare.maps).toHaveLength(1);
        expect(compare.map.mapLoadCount).toBe(1);
        expect(compare.map.callsOf('mount')[0]?.[0]).toBe(compare.ui.container);
        expect(rasters(compare.map)).toEqual({ 'kh4-1966': false, 'kh9-1980': true });
        expect(map.mapLoadCount).toBe(1);
    });

    it('happyPath_bothMapsFollowOneCameraWithoutAFeedbackLoop', async () => {
        const { store, map, compare } = await comparing();
        store.openCompare(null);
        await settle();
        const second = compare.map;

        map.emit('move', VIEW);
        const followed = second.getView();
        const afterMain = second.callsOf('flyTo').length;
        second.flyTo({ ...VIEW, zoom: 16 });

        expect(followed).toEqual(VIEW);
        expect(second.callsOf('flyTo').at(-2)).toEqual([VIEW, { animate: false, pitch: 0 }]);
        expect(map.getView()).toEqual({ ...VIEW, zoom: 16 });
        expect(second.callsOf('flyTo')).toHaveLength(afterMain + 1);
        expect(map.callsOf('flyTo')).toHaveLength(1);
    });

    it('happyPath_theSurfaceDrivesTheStoreAndAnOpacityReachesBothMaps', async () => {
        const { store, map, compare } = await comparing();
        store.openCompare(null);
        await settle();
        const second = compare.map;

        compare.ui.events.onPosition(0.3);
        compare.ui.events.onChoose('kh4-1966');
        store.setOverlayOpacity('kh4-1966', 0.4, true);
        store.setOverlayOpacity('photos', 0.6, true);

        expect(store.getState().compare).toEqual({ layerId: 'kh4-1966', position: 0.3 });
        expect(second.callsOf('setOverlayVisibility')).toContainEqual(['kh4-1966', true]);
        expect(second.callsOf('setOverlayOpacity')).toContainEqual(['kh4-1966', 0.4]);
        expect(second.callsOf('setOverlayOpacity')).toContainEqual(['photos', 0.6]);
        expect(map.callsOf('setOverlayOpacity')).toContainEqual(['photos', 0.6]);
        expect(compare.ui.props?.credit).toBe('Sursa: USGS EROS');
    });
});

describe('swipe compare session: closing and compact windows', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('badPath_closingDestroysTheSecondMapAndTheSurface', async () => {
        const { store, compare } = await comparing();
        store.openCompare(null);
        await settle();

        compare.ui.events.onClose();
        compare.ui.events.onClose();

        expect(store.getState().compare).toBeNull();
        expect(compare.map.callsOf('destroy')).toHaveLength(1);
        expect(compare.map.listenerCount).toBe(0);
        expect(compare.ui.removed).toBe(1);
    });

    it('badPath_aCompactWindowHidesTheSecondMapAWiderOneReusesItAndAMinuteDestroysIt', async () => {
        const { store, map, compare } = await comparing();
        store.toggleOverlay('kh4-1966', true);
        store.openCompare(null);
        await settle();
        const first = compare.map;

        store.setWindowSize(360, 800);
        await settle();
        const toggle = compare.ui.props;
        store.setComparePosition(0);
        // The hidden map keeps drawing the compared side the toggle's chooser picks.
        compare.ui.events.onChoose('kh9-1980');
        store.setWindowSize(1024, 768);
        await settle();

        // Wide again within the minute: the same map, no second map load (a phone turned back and forth).
        expect(first.callsOf('destroy')).toHaveLength(0);
        expect(toggle?.mode).toBe('toggle');
        expect(map.callsOf('setOverlayVisibility')).toContainEqual(['kh4-1966', false]);
        expect(first.callsOf('setOverlayVisibility')).toContainEqual(['kh9-1980', true]);
        expect(compare.maps).toHaveLength(1);
        expect(compare.ui.props?.mode).toBe('swipe');

        // Compact for a whole minute: the hidden map is destroyed, and a wider window then makes a new one.
        store.setWindowSize(360, 800);
        await settle();
        vi.advanceTimersByTime(COMPARE_PARK_MS - 1);
        expect(first.callsOf('destroy')).toHaveLength(0);
        vi.advanceTimersByTime(1);
        expect(first.callsOf('destroy')).toHaveLength(1);
        expect(first.listenerCount).toBe(0);
        store.setWindowSize(1024, 768);
        await settle();
        expect(compare.maps).toHaveLength(2);
        expect(compare.uis).toHaveLength(1);
    });

    it('badPath_closingWhileTheSecondMapIsHiddenDestroysItAtOnce', async () => {
        const { store, compare } = await comparing();
        store.openCompare(null);
        await settle();
        store.setWindowSize(360, 800);
        await settle();

        compare.ui.events.onClose();
        vi.advanceTimersByTime(COMPARE_PARK_MS);

        expect(compare.map.callsOf('destroy')).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('badPath_aCompactWindowNeverCreatesASecondMap', async () => {
        const { store, compare } = await comparing({ size: [360, 800] });

        store.openCompare('kh4-1966');
        await settle();
        compare.ui.events.onPosition(0);

        expect(compare.ui.props).toMatchObject({ mode: 'toggle', position: 0 });
        expect(compare.maps).toHaveLength(0);
    });
});

describe('swipe compare session: failures', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('badPath_aSecondMapThatFailsClosesCompareWithAToast', async () => {
        const compare = new FakeCompare();
        compare.mapOptions = { mountError: new Error('style') };
        const { store, map, log } = await comparing({ compare });

        store.openCompare(null);
        await settle();

        expect(store.getState().compare).toBeNull();
        expect(store.getState().toast).toEqual({ key: 'error.mapLoad' });
        expect(compare.map.callsOf('destroy').length).toBeGreaterThan(0);
        expect(compare.ui.removed).toBe(1);
        expect(map.callsOf('destroy')).toHaveLength(0);
        expect(log.messages()).toContain('the compared map failed to load');
    });

    it('badPath_aChunkThatCannotLoadClosesCompareWithAToast', async () => {
        const compare = new FakeCompare();
        compare.loadError = new Error('network');
        const { store, log } = await comparing({ compare });

        store.openCompare(null);
        await settle();

        expect(store.getState()).toMatchObject({ compare: null, toast: { key: 'error.extraLoad' } });
        expect(compare.uis).toHaveLength(0);
        expect(log.messages()).toContain('compare could not start');
    });

    it('badPath_aChunkThatCannotStartClosesCompareWithTheMapMessage', async () => {
        const compare = new FakeCompare();
        compare.startError = new Error('start');
        const { store, log } = await comparing({ compare });

        store.openCompare(null);
        await settle();

        expect(store.getState()).toMatchObject({ compare: null, toast: { key: 'error.mapLoad' } });
        expect(log.messages()).toContain('compare could not start');
    });

    it('badPath_compareClosedWhileTheChunkLoadsStartsNothing', async () => {
        const { store, compare } = await comparing();

        store.openCompare(null);
        store.closeCompare();
        await settle();

        expect(compare.loads).toBe(1);
        expect(compare.sessions).toHaveLength(0);
    });
});

describe('swipe compare session: closed midway', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('badPath_compareClosedWhileTheSecondMapWaitsForItsContainerMakesNoMapLoad', async () => {
        const compare = new FakeCompare();
        let release: () => void = () => undefined;
        compare.gate = new Promise((resolve) => {
            release = resolve;
        });
        const { store } = await comparing({ compare });
        store.openCompare(null);
        await settle();

        store.closeCompare();
        release();
        await settle();

        expect(compare.map.mapLoadCount).toBe(0);
        expect(compare.map.callsOf('destroy').length).toBeGreaterThan(0);
    });

    it('badPath_compareClosedWhileTheSecondMapLoadsItsStyleDropsThatMap', async () => {
        const compare = new FakeCompare();
        let release: () => void = () => undefined;
        compare.mountGate = new Promise((resolve) => {
            release = resolve;
        });
        const { store } = await comparing({ compare });
        store.openCompare(null);
        await settle();

        store.closeCompare();
        release();
        await settle();

        expect(compare.map.mapLoadCount).toBe(1);
        expect(compare.map.callsOf('destroy').length).toBeGreaterThan(0);
        expect(compare.map.callsOf('addRasterLayer')).toEqual([]);
    });

    it('badPath_aSecondMapFailingAfterCompareClosedSaysNothing', async () => {
        const compare = new FakeCompare();
        compare.mapOptions = { mountError: new Error('style') };
        let release: () => void = () => undefined;
        compare.mountGate = new Promise((resolve) => {
            release = resolve;
        });
        const { store } = await comparing({ compare });
        store.openCompare(null);
        await settle();

        store.closeCompare();
        release();
        await settle();

        expect(store.getState().toast).toBeNull();
        expect(compare.map.callsOf('destroy').length).toBeGreaterThan(0);
    });

    it('badPath_aSurfaceWithoutAContainerMakesNoMapLoad', async () => {
        const compare = new FakeCompare();
        compare.container = null;
        const { store } = await comparing({ compare });

        store.openCompare(null);
        await settle();

        expect(compare.map.mapLoadCount).toBe(0);
        expect(store.getState().compare).not.toBeNull();
    });
});

describe('swipe compare session: the viewer and WebGL', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('badPath_theViewerGoingDestroysBothMaps', async () => {
        const { store, map, compare } = await comparing();
        store.openCompare(null);
        await settle();

        store.destroy();

        expect(compare.map.callsOf('destroy')).toHaveLength(1);
        expect(map.callsOf('destroy')).toHaveLength(1);
        expect(compare.ui.removed).toBe(1);
    });

    it('badPath_aLostWebGlContextEndsTheSessionUntilItIsBack', async () => {
        const { store, map, compare } = await comparing();
        store.openCompare(null);
        await settle();

        map.emit('webglcontextlost', undefined);
        await settle();
        const during = compare.sessions.length;
        map.emit('webglcontextrestored', undefined);
        await settle();

        expect(compare.maps[0]?.callsOf('destroy')).toHaveLength(1);
        expect(during).toBe(1);
        expect(compare.sessions).toHaveLength(2);
        expect(store.getState().compare).not.toBeNull();
    });

    it('badPath_theSecondMapsLayerErrorsAndLostContextAreHandled', async () => {
        const { store, compare } = await comparing();
        store.openCompare('kh9-1980');
        await settle();

        compare.map.emit('error', { kind: 'tile', message: 'tile failed' });
        expect(store.getState().toast).toBeNull();
        compare.map.emit('error', { kind: 'tile', layerId: 'kh9-1980', message: 'tile failed' });
        expect(store.getState().toast).toEqual({ key: 'error.layer', params: { name: 'Corona 1966' } });
        compare.map.emit('webglcontextlost', undefined);

        expect(store.getState().compare).toBeNull();
    });

    it('happyPath_aDeepLinkOpensCompareOnceTheMapIsReady', async () => {
        const { compare, store } = await comparing({ hash: '#15/44.43/26.09&cmp=kh9-1980&sw=30' });
        await settle();

        expect(compare.ui.props).toMatchObject({ layerId: 'kh9-1980', position: 0.3 });
        expect(compare.maps).toHaveLength(1);
        expect(store.getState().compare).toEqual({ layerId: 'kh9-1980', position: 0.3 });
    });
});

describe('compare labels and the camera link', () => {
    const city = manifest();
    const state = withManifest(initialState('en', 'system', 'unknown'), city);

    it('happyPath_theSurfaceNamesBothSidesAndTheComparedSource', () => {
        const shown = { ...state, overlays: state.overlays.map((overlay) => ({ ...overlay, visible: true })) };

        expect(mainSideLabel(state)).toBe('Today');
        expect(mainSideLabel(shown)).toBe('Corona 1966 (EN), Corona 1966 (EN)');
        expect(compareChoices(state, city).map((choice) => choice.layerId)).toEqual(['kh4-1966', 'kh9-1980']);
        expect(compareCredit(state, city, 'kh4-1966')).toBe('Source: USGS EROS');
        expect(compareCredit(state, city, null)).toBe('');
    });

    it('badPath_theMainSidesOwnLayersAreNoChoiceButTheComparedOneStays', () => {
        const mainShows = (ids: readonly string[]): ViewerState => ({
            ...state,
            overlays: state.overlays.map((overlay) => ({ ...overlay, visible: overlay.kind === 'raster' && ids.includes(overlay.id) })),
        });
        const ids = (shown: ViewerState, layerId: string | null): readonly (string | null)[] =>
            compareChoices({ ...shown, compare: { layerId, position: 0.5 } }, city).map((choice) => choice.layerId);

        // The main side shows 1966: comparing it with itself is no choice; today is.
        expect(ids(mainShows(['kh4-1966']), 'kh9-1980')).toEqual(['kh9-1980', null]);
        // Today on the main side: today is no choice, unless it is the side compared now (the chooser keeps it).
        expect(ids(state, 'kh4-1966')).toEqual(['kh4-1966', 'kh9-1980']);
        expect(ids(state, null)).toEqual(['kh4-1966', 'kh9-1980', null]);
        expect(ids(mainShows(['kh4-1966']), 'kh4-1966')).toEqual(['kh4-1966', 'kh9-1980', null]);
    });

    it('happyPath_theComparedStateShowsOnlyItsLayerAndNoToggle', () => {
        const compared = comparedState({ ...state, compare: { layerId: 'kh9-1980', position: 0 } });

        expect(compared.compare).toBeNull();
        expect(compared.overlays.find((overlay) => overlay.id === 'kh9-1980')?.visible).toBe(true);
        expect(comparedState(state).overlays.filter((overlay) => overlay.kind === 'raster' && overlay.visible)).toHaveLength(0);
    });

    it('happyPath_theTiltFollowsToo', () => {
        const main = new FakeMap();
        const second = new FakeMap();
        linkCameras(main, second);

        main.pitch = 40;
        main.emit('move', VIEW);
        second.pitch = 10;
        second.emit('move', VIEW);

        expect(second.callsOf('flyTo').at(-1)).toEqual([VIEW, { animate: false, pitch: 40 }]);
        expect(main.pitch).toBe(10);
    });

    it('badPath_unlinkedCamerasNoLongerFollowEachOther', () => {
        const main = new FakeMap();
        const second = new FakeMap();

        const unlink = linkCameras(main, second);
        unlink();
        main.emit('move', VIEW);

        expect(second.getView()).not.toEqual(VIEW);
        expect(main.listenerCount + second.listenerCount).toBe(0);
    });
});

describe('a session on its own', () => {
    const city = manifest();
    const base: ViewerState = { ...withManifest(initialState('ro', 'system', 'unknown'), city), status: 'ready', windowClass: 'large' };

    function host(state: ViewerState): CompareHost & { listeners: ((next: ViewerState, previous: ViewerState) => void)[] } {
        const listeners: ((next: ViewerState, previous: ViewerState) => void)[] = [];
        return {
            listeners,
            getState: () => state,
            subscribe: (listener) => {
                listeners.push(listener);
                return () => listeners.splice(listeners.indexOf(listener), 1);
            },
            openCompare: () => undefined,
            setComparePosition: () => undefined,
            closeCompare: () => undefined,
            showToast: () => undefined,
        };
    }

    function start(state: ViewerState): { compare: FakeCompare; host: ReturnType<typeof host>; destroy: () => void } {
        const compare = new FakeCompare();
        const parts = host(state);
        const session = startCompare({
            host: parts,
            mainMap: new FakeMap(),
            anchor: { id: 'map' } as unknown as HTMLElement,
            createMap: compare.deps.createMap,
            mapboxCssUrl: '',
            assetBase: undefined,
            reducedMotion: false,
            ui: compare.module.createCompareUi,
            log: createLogger('test'),
        });
        return {
            compare,
            host: parts,
            destroy: () => {
                session.destroy();
            },
        };
    }

    it('badPath_aStateWithoutCompareShowsNothing', () => {
        const { compare } = start(base);

        expect(compare.ui.updates).toEqual([]);
        expect(compare.maps).toEqual([]);
    });

    it('badPath_aDestroyedSessionIgnoresLateStatesAndASecondDestroy', () => {
        const comparingState = { ...base, compare: { layerId: null, position: 0.5 } };
        const { compare, host: parts, destroy } = start(comparingState);
        const late = parts.listeners[0];

        destroy();
        destroy();
        late?.(comparingState, base);

        expect(compare.ui.removed).toBe(1);
        expect(compare.ui.updates).toHaveLength(1);
    });
});

describe('swipe compare session: the visitor position (V10)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('happyPath_theVisitorsPositionIsADotOnBothSides', async () => {
        const { store, map, compare } = await comparing();
        const fix = { center: [26.1, 44.43] as const, accuracy: 15, heading: null };
        store.openCompare(null);
        await settle();
        const second = compare.maps[0];

        store.setMyLocation(fix);

        expect(map.callsOf('setMyLocation').at(-1)).toEqual([fix]);
        expect(second?.callsOf('setMyLocation').at(-1)).toEqual([fix]);
    });

    it('badPath_aSecondMapMadeWhileTheDotIsShownDrawsItAndTurningItOffClearsBoth', async () => {
        const { store, map, compare } = await comparing();
        const fix = { center: [26.1, 44.43] as const, accuracy: 15, heading: 90 };
        store.setMyLocation(fix);
        store.openCompare(null);
        await settle();
        const second = compare.maps[0];

        expect(second?.callsOf('setMyLocation')).toEqual([[fix]]);
        store.setMyLocation(null);
        expect(map.callsOf('setMyLocation').at(-1)).toEqual([null]);
        expect(second?.callsOf('setMyLocation').at(-1)).toEqual([null]);
    });
});

describe("swipe compare session: Show on map's ring (V51)", () => {
    const PLACE = [26.091611, 44.431722] as const;

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('happyPath_theRingIsOnBothSidesOfTheDivider', async () => {
        const { store, map, compare } = await comparing();
        store.openCompare(null);
        await settle();
        const second = compare.maps[0];

        store.locatePhoto('mihai-voda-1978', [0, 0]);

        expect(map.callsOf('markPhoto').at(-1)).toEqual([PLACE]);
        expect(second?.callsOf('markPhoto').at(-1)).toEqual([PLACE]);
    });

    it('badPath_aSecondMapMadeAfterShowOnMapDrawsTheRingAndItGoesFromBoth', async () => {
        const { store, map, compare } = await comparing();
        store.locatePhoto('mihai-voda-1978', [0, 0]);
        store.openCompare(null);
        await settle();
        const second = compare.maps[0];

        expect(second?.callsOf('markPhoto')).toEqual([[PLACE]]);
        store.openPhoto('uranus-1936');
        expect(map.callsOf('markPhoto').at(-1)).toEqual([null]);
        expect(second?.callsOf('markPhoto').at(-1)).toEqual([null]);
    });
});
