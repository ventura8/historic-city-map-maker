import { decodeHash } from '@hcm/shared';
import type { PhotoFeatureCollection } from '@hcm/ui/map';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createViewerStore, PHOTO_YEAR_WINDOW } from '../../src/core/store.js';
import { HASH_WRITE_DELAY_MS, hashLimits } from '../../src/core/url-sync.js';
import { manifest } from './fixtures.js';
import { harness, loaded } from './harness.js';

describe('viewer store actions', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('happyPath_theLanguageSwitchesLiveAndIsRemembered', async () => {
        const { store, map, storage, telemetry, location } = await loaded();
        const photosBefore = map.callsOf('setPhotosData').length;

        store.setLocale('en');
        store.setLocale('en');
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(store.getState().locale).toBe('en');
        expect(telemetry.events.filter((event) => event.name === 'locale_change')).toEqual([{ name: 'locale_change', locale: 'en' }]);
        expect(storage.get('hcm:bucuresti:lang')).toBe('en');
        expect(map.callsOf('setPhotosData')).toHaveLength(photosBefore + 1);
        const titles = (map.callsOf('setPhotosData').at(-1)?.[0] as PhotoFeatureCollection).features.map((feature) => feature.properties);
        expect(titles[0]).toMatchObject({ title: 'Mihai Voda street' });
        expect(telemetry.contexts.at(-1)?.locale).toBe('en');
        expect(location.written.at(-1)).toContain('lang=en');
    });

    it('badPath_beforeTheManifestTheLanguageIsStoredOnlyForAConfiguredCity', () => {
        const anonymous = harness();
        const named = harness({ config: { cityId: 'bucuresti' } });

        anonymous.store.setLocale('en');
        named.store.setLocale('en');

        expect(anonymous.storage.size).toBe(0);
        expect(named.storage.get('hcm:bucuresti:lang')).toBe('en');
    });

    it('happyPath_aYearShowsItsLayerAndEveryPhoto', async () => {
        const { store, map, telemetry } = await loaded();

        store.setYear(1975);
        store.setYear(1980);

        expect(store.getState().year).toBe(1980);
        expect(map.callsOf('setOverlayVisibility')).toContainEqual(['kh9-1980', true]);
        expect(telemetry.events).toContainEqual({ name: 'year_change', year: 1980 });
        expect(telemetry.events.filter((event) => event.name === 'year_change')).toHaveLength(1);
        const shown = (map.callsOf('setPhotosData').at(-1)?.[0] as PhotoFeatureCollection).features.filter(
            (feature) => feature.geometry.type === 'Point',
        );
        expect(PHOTO_YEAR_WINDOW).toBe(10);
        expect(shown.map((feature) => feature.properties.id)).toEqual(['mihai-voda-1978', 'uranus-1936', 'undated']);
    });

    it('happyPath_theSameYearRestoresItsLayersWithoutANewEvent', async () => {
        const { store, telemetry } = await loaded();
        store.setYear(1980);
        store.toggleOverlay('kh9-1980', false);

        store.setYear(1980);

        expect(store.getState().overlays.find((overlay) => overlay.id === 'kh9-1980')?.visible).toBe(true);
        expect(telemetry.events.filter((event) => event.name === 'year_change')).toHaveLength(1);
    });

    it('happyPath_aSnappedYearWithoutChangesLogsNothing', async () => {
        const { store, telemetry } = await loaded({ manifest: manifest({ layers: [] }) });

        store.setYear(1975);

        expect(store.getState().year).toBeNull();
        expect(telemetry.events.filter((event) => event.name === 'year_change')).toEqual([]);
    });

    it('happyPath_toggleShowsAndHidesAnyOverlay', async () => {
        const { store, map, telemetry } = await loaded();

        store.toggleOverlay('cladiri');
        store.toggleOverlay('kh9-1980', true);
        store.toggleOverlay('kh9-1980', true);

        expect(map.callsOf('setOverlayVisibility')).toContainEqual(['cladiri', false]);
        expect(map.callsOf('setOverlayVisibility')).toContainEqual(['kh9-1980', true]);
        expect(telemetry.events.filter((event) => event.name === 'layer_toggle')).toEqual([
            { name: 'layer_toggle', layerId: 'cladiri', visible: false },
            { name: 'layer_toggle', layerId: 'kh9-1980', visible: true },
        ]);
    });

    it('badPath_anUnknownOverlayIsIgnored', async () => {
        const { store, telemetry } = await loaded();
        const before = store.getState();

        store.toggleOverlay('nope');
        store.setOverlayOpacity('nope', 0.5, true);

        expect(store.getState()).toBe(before);
        expect(telemetry.events.filter((event) => event.name === 'layer_toggle')).toEqual([]);
    });

    it('happyPath_opacityFollowsLiveAndIsWrittenToTheHashOnRelease', async () => {
        const { store, map, location } = await loaded();
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);
        const writes = location.written.length;

        store.setOverlayOpacity('photos', 0.5);
        store.setOverlayOpacity('photos', 0.4);
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);
        expect(location.written).toHaveLength(writes);

        store.setOverlayOpacity('photos', 0.4, true);
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(map.callsOf('setOverlayOpacity').slice(-2)).toEqual([
            ['photos', 0.5],
            ['photos', 0.4],
        ]);
        expect(location.written.at(-1)).toContain('op=photos:40');
    });
});

describe('viewer store: photos, POIs and sheets', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('happyPath_aPhotoOpensInTheSheetOnceAndCloses', async () => {
        const { store, telemetry, map } = await loaded();

        map.clickPhoto('mihai-voda-1978');
        store.openPhoto('mihai-voda-1978');
        store.setLightbox(true);

        expect(store.getState()).toMatchObject({ selectedPhotoId: 'mihai-voda-1978', sheet: 'photo', lightbox: true });
        expect(telemetry.events.filter((event) => event.name === 'photo_open')).toEqual([
            { name: 'photo_open', photoId: 'mihai-voda-1978' },
        ]);
        store.openPhoto(null);
        expect(store.getState()).toMatchObject({ selectedPhotoId: null, sheet: 'none', lightbox: false });
    });

    it('badPath_anUnknownPhotoShowsAToast', async () => {
        const { store } = await loaded();

        store.openPhoto('nope');

        expect(store.getState()).toMatchObject({ selectedPhotoId: null, toast: { key: 'error.unknownPhoto' } });
        store.dismissToast();
        store.dismissToast();
        expect(store.getState().toast).toBeNull();
    });

    it('happyPath_aPoiOpensItsDetailsAndCloses', async () => {
        const { store, telemetry, map } = await loaded();
        store.openPhoto('mihai-voda-1978');

        map.clickPoi('casa-uranus');
        store.openPoi('casa-uranus');

        expect(store.getState()).toMatchObject({ selectedPoiId: 'casa-uranus', selectedPhotoId: null, sheet: 'poi' });
        expect(telemetry.events.filter((event) => event.name === 'poi_open')).toEqual([{ name: 'poi_open', poiId: 'casa-uranus' }]);
        store.openPoi(null);
        expect(store.getState()).toMatchObject({ selectedPoiId: null, sheet: 'none' });
    });

    it('badPath_anUnknownPoiOrAManifestWithoutPoisIsIgnored', async () => {
        const { store } = await loaded();
        const { store: bare } = await loaded({ manifest: manifest({ categories: [], pois: [] }) });

        store.openPoi('nope');
        bare.openPoi('casa-uranus');

        expect(store.getState().selectedPoiId).toBeNull();
        expect(bare.getState().selectedPoiId).toBeNull();
    });

    it('badPath_closingWhatIsNotOpenKeepsTheSheet', async () => {
        const { store } = await loaded();
        const early = harness();
        early.store.openPoi('casa-uranus');
        store.openSheet('layers');

        store.openPhoto(null);
        store.openPoi(null);
        store.openSheet('poi');
        expect(store.getState()).toMatchObject({ sheet: 'poi', selectedPoiId: null });
        store.openSheet('photo');

        expect(early.store.getState().selectedPoiId).toBeNull();
        expect(store.getState()).toMatchObject({ sheet: 'photo', selectedPhotoId: null });
    });

    it('badPath_theLightboxNeedsAPhoto', async () => {
        const { store } = await loaded();

        store.setLightbox(true);
        store.setLightbox(false);

        expect(store.getState().lightbox).toBe(false);
    });

    it('happyPath_sheetsKeepOnlyTheirOwnSelection', async () => {
        const { store } = await loaded();
        store.openPhoto('mihai-voda-1978');
        store.setLightbox(true);

        store.openSheet('photo');
        expect(store.getState()).toMatchObject({ sheet: 'photo', selectedPhotoId: 'mihai-voda-1978', lightbox: true });
        store.openSheet('layers');
        expect(store.getState()).toMatchObject({ sheet: 'layers', selectedPhotoId: null, lightbox: false });
        store.openPoi('casa-uranus');
        store.openSheet('poi');
        store.openSheet('about');
        expect(store.getState()).toMatchObject({ sheet: 'about', selectedPoiId: null });
    });
});

describe('viewer store: view, window, theme, consent', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('happyPath_theMapViewIsWrittenToTheHash', async () => {
        const { store, map, location } = await loaded();

        map.emit('moveend', { center: [26.1, 44.43], zoom: 17, bearing: 45 });
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(store.getState().view).toEqual({ center: [26.1, 44.43], zoom: 17, bearing: 45 });
        expect(location.written.at(-1)).toBe('#17/44.43/26.1/45');
    });

    it('happyPath_flyToMovesTheMountedCameraAndRecordsTheViewButNotInTheHash', async () => {
        const { store, map, location } = await loaded();
        store.flyTo({ center: [26.11, 44.44], zoom: 16, bearing: 0 });
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(map.callsOf('flyTo').map((args) => args[0])).toEqual([{ center: [26.11, 44.44], zoom: 16, bearing: 0 }]);
        expect(store.getState().view).toEqual({ center: [26.11, 44.44], zoom: 16, bearing: 0 });
        expect(location.written.join(' '), "the view is the visitor's position: not in the address").not.toContain('26.11');
    });

    it('badPath_flyToBeforeTheMapOnlyRecordsTheView', () => {
        const { store, map } = harness();

        store.flyTo({ center: [26.11, 44.44], zoom: 16, bearing: 0 });

        expect(map.callsOf('flyTo')).toEqual([]);
        expect(store.getState().view).toEqual({ center: [26.11, 44.44], zoom: 16, bearing: 0 });
    });

    it('happyPath_theVisitorsPositionReachesTheMapAndNothingElse', async () => {
        const { store, map, location, telemetry, storage } = await loaded();
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);
        const written = location.written.length;
        const events = telemetry.events.length;
        const drawn = map.callsOf('setMyLocation').length;
        const fix = { center: [26.1, 44.43] as const, accuracy: 15, heading: null };

        store.setMyLocation('waiting');
        store.setMyLocation(fix);
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(store.getState().myLocation).toEqual(fix);
        expect(map.callsOf('setMyLocation').slice(drawn)).toEqual([[null], [fix]]);
        expect(location.written).toHaveLength(written);
        expect(telemetry.events).toHaveLength(events);
        expect([...storage.values()].join(' ')).not.toContain('44.43');
    });

    it('badPath_aPositionBeforeTheMapOnlyStaysInTheState', () => {
        const { store, map } = harness();

        store.setMyLocation({ center: [26.1, 44.43], accuracy: 15, heading: 10 });
        store.setMyLocation(null);

        expect(store.getState().myLocation).toBeNull();
        expect(map.callsOf('setMyLocation')).toEqual([]);
    });

    it('happyPath_aShareIsLoggedAsTheShareEvent', async () => {
        const { store, telemetry } = await loaded();

        store.logShare();

        expect(telemetry.events.at(-1)).toEqual({ name: 'share' });
    });

    it('happyPath_windowSizeSetsTheWindowClass', async () => {
        const { store, telemetry } = await loaded();
        const states: string[] = [];
        store.subscribe((state, previous) => states.push(`${previous.windowClass}->${state.windowClass}`));

        store.setWindowSize(1300, 900);
        store.setWindowSize(1300, 900);
        store.setWindowSize(1300, 400);

        expect(store.getState()).toMatchObject({ windowClass: 'large', compactHeight: true, dockable: true });
        expect(states).toEqual(['compact->large', 'large->large']);
        expect(telemetry.contexts.at(-1)?.windowClass).toBe('large');
    });

    it('happyPath_aTabletHeldUprightCanDockASheet', async () => {
        const { store } = await loaded();
        const states: boolean[] = [];
        store.subscribe((state) => states.push(state.dockable));

        store.setWindowSize(800, 1280);
        store.setWindowSize(700, 1280);

        expect(states).toEqual([true, false]);
        expect(store.getState()).toMatchObject({ windowClass: 'medium', dockable: false });
    });

    it('happyPath_beforeTheManifestTheThemeIsStoredForTheConfiguredCity', () => {
        const { store, storage } = harness({ config: { cityId: 'bucuresti' } });

        store.setTheme('light');

        expect(storage.get('hcm:bucuresti:theme')).toBe('light');
    });

    it('happyPath_theThemeIsRemembered', async () => {
        const { store, storage, telemetry } = await loaded();

        store.setTheme('dark');
        store.setTheme('dark');

        expect(telemetry.events.filter((event) => event.name === 'theme_change')).toEqual([{ name: 'theme_change', theme: 'dark' }]);
        expect(store.getState().theme).toBe('dark');
        expect(storage.get('hcm:bucuresti:theme')).toBe('dark');
    });

    it('happyPath_consentGoesThroughTelemetry', async () => {
        const { store, telemetry } = await loaded();

        store.setConsent('granted');

        expect(telemetry.consent).toBe('granted');
        expect(store.getState().consent).toBe('granted');
    });

    it('happyPath_aToastWithParameters', () => {
        const { store } = harness();

        store.showToast('error.layer', { name: 'Corona' });

        expect(store.getState().toast).toEqual({ key: 'error.layer', params: { name: 'Corona' } });
    });

    it('badPath_anErrorToastIsMeasuredByItsKeyAndAnotherToastIsNot', () => {
        const { store, telemetry } = harness();

        store.showToast('error.layer', { name: 'Corona' });
        store.showToast('timeline.year', { year: '1966' });

        expect(telemetry.measures.filter((measure) => measure.kind === 'ui_error')).toEqual([{ kind: 'ui_error', code: 'error.layer' }]);
    });

    it('happyPath_aPadOrAConsoleIsReportedOnceAPageEach', () => {
        const { store, telemetry } = harness();

        store.logInput('gamepad');
        store.logInput('gamepad');
        store.logInput('console');

        expect(telemetry.events.filter((event) => event.name === 'input_device')).toEqual([
            { name: 'input_device', device: 'gamepad' },
            { name: 'input_device', device: 'console' },
        ]);
    });
});

describe('viewer store: hash, map events, lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('happyPath_anAppliedHashMovesTheMapWithoutAnimation', async () => {
        const { store, map } = await loaded();
        const city = store.getState().manifest ?? manifest();

        store.applyHash(decodeHash('#18/44.43/26.09&op=cladiri:50', hashLimits(city)));

        expect(map.callsOf('flyTo').at(-1)).toEqual([{ center: [26.09, 44.43], zoom: 18, bearing: 0 }, { animate: false }]);
        expect(store.getState().overlays.find((overlay) => overlay.id === 'cladiri')?.opacity).toBe(0.5);
    });

    it('badPath_anAppliedHashWithAnUnknownPhotoShowsAToastAndBeforeTheMapNothingMoves', () => {
        const { store, map } = harness();

        store.applyHash({ legacy: false, view: { center: [26, 44.4], zoom: 12, bearing: 0 }, photo: 'nope' });

        expect(store.getState().toast).toEqual({ key: 'error.unknownPhoto' });
        expect(map.callsOf('flyTo')).toEqual([]);
    });

    it('happyPath_aHashTheVisitorEditsIsApplied', async () => {
        const { store, location, map } = await loaded();

        location.navigate('#15/44.43/26.1&photo=mihai-voda-1978');
        location.navigate('#photo=nope');

        expect(store.getState().selectedPhotoId).toBe('mihai-voda-1978');
        expect(store.getState().toast).toEqual({ key: 'error.unknownPhoto' });
        expect(map.callsOf('flyTo')).toHaveLength(1);
    });

    it('badPath_aHashChangeBeforeTheManifestIsIgnored', () => {
        const { store, location } = harness();

        location.navigate('#photo=mihai-voda-1978');

        expect(store.getState().selectedPhotoId).toBeNull();
    });

    it('happyPath_mapErrorsBecomeToastsAndTheMapSurvives', async () => {
        const { store, map, log } = await loaded();

        map.emit('error', { kind: 'tile', layerId: 'kh4-1966', message: 'Not Found' });
        map.emit('error', { kind: 'tile', message: 'Not Found' });
        expect(store.getState().toast).toEqual({ key: 'error.layer', params: { name: 'Corona 1966' } });
        store.dismissToast();
        map.emit('error', { kind: 'tile', message: 'Not Found' });
        expect(store.getState().toast).toEqual({ key: 'error.tiles' });
        store.dismissToast();
        map.emit('error', { kind: 'unknown', message: 'odd' });
        expect(store.getState().toast).toBeNull();
        map.emit('error', { kind: 'source', layerId: 'kh9-1980', message: 'gone' });

        expect(store.getState()).toMatchObject({ status: 'ready', toast: { key: 'error.layer', params: { name: 'Corona 1966' } } });
        expect(log.messages().filter((message) => message === 'map error')).toHaveLength(5);
    });

    it('happyPath_aLostWebGlContextShowsTheFallbackUntilRestored', async () => {
        const { store, map } = await loaded();

        map.emit('webglcontextlost', undefined);
        expect(store.getState().webgl).toBe(false);
        map.emit('webglcontextrestored', undefined);
        expect(store.getState().webgl).toBe(true);
    });

    it('badPath_aThrowingSubscriberIsLoggedAndTheStoreGoesOn', () => {
        const { store, log } = harness();
        store.subscribe(() => {
            throw new Error('render failed');
        });

        store.showToast('error.generic');

        expect(store.getState().toast).toEqual({ key: 'error.generic' });
        expect(log.messages()).toContain('state listener failed');
    });

    it('happyPath_destroyRemovesTheMapListenersAndTelemetry', async () => {
        const { store, map, telemetry, location } = await loaded();
        const heard: unknown[] = [];
        store.subscribe((state) => heard.push(state));

        store.destroy();
        store.destroy();
        store.showToast('error.generic');
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(map.callsOf('destroy')).toHaveLength(1);
        expect(map.listenerCount).toBe(0);
        expect(telemetry.destroyed).toBe(true);
        expect(telemetry.listenerCount).toBe(0);
        expect(location.listeners.size).toBe(0);
        expect(heard).toEqual([]);
    });

    it('happyPath_aLocationWithoutHashChangeSupportStillWorks', () => {
        const parts = harness();
        const bare = { hash: '', replaceHash: vi.fn() };
        const store = createViewerStore({
            config: { manifestUrl: 'https://storage.example.org/m.json' },
            fetch: () => Promise.reject(new Error('offline')),
            map: parts.map,
            telemetry: parts.telemetry,
            storage: parts.storage,
            location: bare,
            log: parts.log.log,
            engineVersion: '1.0.0',
            mapContainer: () => null,
        });

        store.destroy();

        expect(bare.replaceHash).not.toHaveBeenCalled();
        expect(parts.telemetry.destroyed).toBe(true);
    });
});
