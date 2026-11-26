import { describe, expect, it } from 'vitest';

import { LOCATE_ZOOM, stopMyLocation, toggleMyLocation } from '../../src/viewer/my-location.js';
import type { ViewerServices } from '../../src/viewer/services.js';
import type { MyLocationFix } from '../../src/viewer/store-port.js';
import { FakeStore, idleState, readyState } from './fake-store.js';
import { testManifest } from './fixtures.js';

/** The browser's side of one watch: the test plays its positions and errors, and sees whether it was stopped. */
class FakeWatch {
    onFix: (fix: MyLocationFix) => void = () => undefined;
    onError: (error: unknown) => void = () => undefined;
    started = 0;
    stopped = 0;

    readonly services: ViewerServices = {
        share: null,
        copyText: () => Promise.resolve(),
        watchPosition: (onFix, onError) => {
            this.started += 1;
            this.onFix = onFix;
            this.onError = onError;
            return () => {
                this.stopped += 1;
            };
        },
        pageUrl: () => 'https://example.org/',
        matchMedia: (query) => window.matchMedia(query),
        openPage: () => undefined,
    };
}

const INSIDE: MyLocationFix = { center: [26.1, 44.43], accuracy: 12.4, heading: null };
const MOVED: MyLocationFix = { center: [26.101, 44.431], accuracy: 8, heading: 45 };
const OUTSIDE: MyLocationFix = { center: [2.35, 48.85], accuracy: 10, heading: null };

function toasts(store: FakeStore): readonly unknown[] {
    return store.callsOf('showToast');
}

describe('toggleMyLocation', () => {
    it('happyPath_theFirstPositionBringsTheCameraAndSaysItsAccuracyTheNextOnlyMoveTheDot', () => {
        const store = new FakeStore(readyState());
        const watch = new FakeWatch();
        toggleMyLocation(store, watch.services);

        expect(store.getState().myLocation).toBe('waiting');
        expect(toasts(store)).toEqual([['geolocate.locating', undefined]]);
        watch.onFix(INSIDE);
        watch.onFix(MOVED);

        expect(store.getState().myLocation).toEqual(MOVED);
        expect(store.callsOf('flyTo')).toEqual([[{ center: [26.1, 44.43], zoom: LOCATE_ZOOM, bearing: 0 }]]);
        expect(toasts(store)).toEqual([
            ['geolocate.locating', undefined],
            ['geolocate.shown', { meters: '12' }],
        ]);
        expect(watch.stopped).toBe(0);
    });

    it('happyPath_aCloserCameraKeepsItsZoomAndBearing', () => {
        const store = new FakeStore(readyState(testManifest(), { view: { center: [26, 44.4], zoom: 18, bearing: 30 } }));
        const watch = new FakeWatch();
        toggleMyLocation(store, watch.services);
        watch.onFix(INSIDE);

        expect(store.getState().view).toEqual({ center: [26.1, 44.43], zoom: 18, bearing: 30 });
    });

    it('happyPath_choosingItAgainTurnsItOffWithNothingSaid', () => {
        const store = new FakeStore(readyState());
        const watch = new FakeWatch();
        toggleMyLocation(store, watch.services);
        watch.onFix(INSIDE);
        toggleMyLocation(store, watch.services);

        expect(watch.stopped).toBe(1);
        expect(store.getState().myLocation).toBeNull();
        expect(store.getState().toast).toBeNull();
        toggleMyLocation(store, watch.services);
        expect(watch.started).toBe(2);
    });

    it('badPath_aPositionOutsideTheCityEndsItAndSaysSo', () => {
        const store = new FakeStore(readyState());
        const watch = new FakeWatch();
        toggleMyLocation(store, watch.services);
        watch.onFix(INSIDE);
        watch.onFix(OUTSIDE);

        expect(store.getState().myLocation).toBeNull();
        expect(store.getState().toast).toEqual({ key: 'error.geolocate.outside' });
        expect(watch.stopped).toBe(1);
        expect(store.callsOf('flyTo')).toHaveLength(1);
    });

    it('badPath_aRefusalEndsItAndSaysSo', () => {
        const store = new FakeStore(readyState());
        const watch = new FakeWatch();
        toggleMyLocation(store, watch.services);
        watch.onError({ code: 1 });

        expect(store.getState().myLocation).toBeNull();
        expect(store.getState().toast).toEqual({ key: 'error.geolocate.denied' });
        expect(store.callsOf('flyTo')).toEqual([]);
    });

    it('badPath_noPositionAtAllIsUnavailable', () => {
        const store = new FakeStore(readyState());
        const watch = new FakeWatch();
        toggleMyLocation(store, watch.services);
        watch.onError({ code: 2 });

        expect(store.getState().toast).toEqual({ key: 'error.geolocate.unavailable' });
        expect(watch.stopped).toBe(1);
    });

    it('badPath_aLatePositionWhileOneIsShownKeepsTheDot', () => {
        const store = new FakeStore(readyState());
        const watch = new FakeWatch();
        toggleMyLocation(store, watch.services);
        watch.onFix(INSIDE);
        watch.onError({ code: 3 });

        expect(store.getState().myLocation).toEqual(INSIDE);
        expect(watch.stopped).toBe(0);
        watch.onError({ code: 1 });
        expect(store.getState().myLocation).toBeNull();
        expect(store.getState().toast).toEqual({ key: 'error.geolocate.denied' });
    });

    it('badPath_beforeTheManifestThereIsNoCity', () => {
        const store = new FakeStore(idleState());
        const watch = new FakeWatch();
        toggleMyLocation(store, watch.services);

        expect(store.getState().toast).toEqual({ key: 'error.geolocate.unavailable' });
        expect(watch.started).toBe(0);
        expect(store.callsOf('setMyLocation')).toEqual([]);
    });
});

describe('stopMyLocation', () => {
    it('happyPath_stopsTheWatchAndRemovesTheDot', () => {
        const store = new FakeStore(readyState());
        const watch = new FakeWatch();
        toggleMyLocation(store, watch.services);
        watch.onFix(INSIDE);
        stopMyLocation(store);

        expect(watch.stopped).toBe(1);
        expect(store.getState().myLocation).toBeNull();
    });

    it('badPath_offAlreadyDoesNothing', () => {
        const store = new FakeStore(readyState());
        stopMyLocation(store);

        expect(store.calls).toEqual([]);
    });
});
