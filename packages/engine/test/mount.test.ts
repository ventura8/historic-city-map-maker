import type { MapView } from '@hcm/shared';
import { describe, expect, it, vi } from 'vitest';

import { bootDeclared, bootDeclaredIn, mount, readyOutcome, VIEWER_TAG } from '../src/mount.js';
import { settle } from './core/support.js';
import { FakeContainer, MANIFEST_URL, config, testEnvironment } from './mount-support.js';

describe('mount', () => {
    it('happyPath_rendersAViewerThatBootsAndBecomesReady', async () => {
        const world = testEnvironment();
        const container = new FakeContainer();

        const controller = mount(container.element, config({ engineBase: 'https://cdn.example.org/engine/' }), world.env);

        expect(world.created).toEqual([VIEWER_TAG]);
        expect(container.children).toEqual([world.viewer]);
        expect(world.viewer).toMatchObject({
            manifestUrl: MANIFEST_URL,
            engineVersion: '1.0.0',
            mapboxCssUrl: 'https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.css',
            bootError: null,
        });
        expect(world.viewer.controller).toBe(controller);
        expect(world.fonts).toEqual(['https://cdn.example.org/engine/']);
        await expect(controller.ready).resolves.toEqual({ ok: true, cityId: 'bucuresti' });
        expect(world.map.callsOf('mount')[0]?.[0]).toBe(world.viewer.mapContainer);
        expect(world.viewer.store?.getState().status).toBe('ready');
    });

    it('badPath_anInvalidConfigurationShowsWhatToFix', async () => {
        const world = testEnvironment();
        const container = new FakeContainer();

        const controller = mount(container.element, { manifestUrl: 'http://example.org/manifest.json', lang: 'en' }, world.env);

        expect(world.viewer.bootError).toEqual({
            code: 'error.config.invalid',
            retryable: false,
            params: { detail: 'manifestUrl: The address must be https:// or relative to the manifest.' },
        });
        expect(container.children).toHaveLength(1);
        expect(world.stores).toEqual([]);
        await expect(controller.ready).resolves.toEqual({ ok: false, code: 'error.config.invalid' });
        controller.setYear(1966);
        controller.toggleLayer('kh4-1966');
        controller.setOverlayOpacity('photos', 0.5);
        controller.openPhoto('x');
        controller.openPoi('y');
        controller.setLang('en');
        controller.destroy();
        controller.destroy();
        expect(world.viewer.removed).toBe(1);
    });

    it('badPath_aConfigurationErrorCardSpeaksTheLanguageOfTheConfiguration', () => {
        const world = testEnvironment();

        mount(new FakeContainer().element, { manifestUrl: 'http://example.org/manifest.json', lang: 'en' }, world.env);

        expect(world.viewer.getAttribute('lang')).toBe('en');
    });

    it('badPath_theAddressLanguageWinsForAConfigurationErrorCard', () => {
        // S-V17-BAD-INVALID-CONFIG found it: with `?lang=en` the card's frame was Romanian around an English detail.
        const world = testEnvironment({ location: { search: '?lang=en' } });

        mount(new FakeContainer().element, { manifestUrl: './data/manifest.json', colour: 'red' }, world.env);

        expect(world.viewer.getAttribute('lang')).toBe('en');
        expect(world.viewer.bootError?.params).toEqual({ detail: 'colour: The field is not known.' });
    });

    it('badPath_noConfigurationAtAllIsTheMissingConfigCard', async () => {
        const world = testEnvironment();

        const controller = mount(new FakeContainer().element, undefined, world.env);

        expect(world.viewer.bootError?.code).toBe('error.config.missing');
        await expect(controller.ready).resolves.toEqual({ ok: false, code: 'error.config.missing' });
    });

    it('badPath_withoutMapboxGlTheMapCannotLoad', async () => {
        const world = testEnvironment({ noMapbox: true });

        const controller = mount(new FakeContainer().element, config(), world.env);

        expect(world.viewer.bootError).toEqual({ code: 'error.mapLoad', retryable: false });
        expect(world.log.messages()).toContain('Mapbox GL JS is not available');
        await expect(controller.ready).resolves.toEqual({ ok: false, code: 'error.mapLoad' });
    });

    it('badPath_aManifestThatCannotLoadSettlesReadyAsFailed', async () => {
        const world = testEnvironment({ status: 404 });

        const controller = mount(new FakeContainer().element, config(), world.env);
        controller.setYear(1966);

        await expect(controller.ready).resolves.toEqual({ ok: false, code: 'error.manifest.notFound' });
        expect(world.viewer.store?.getState().year).toBeNull();
    });

    it('happyPath_anInlineManifestNeedsNoUrlAndTheFontsComeFromTheEngine', async () => {
        const world = testEnvironment();
        const { manifest } = await import('./core/fixtures.js');

        const controller = mount(new FakeContainer().element, { manifest: manifest() }, world.env);

        await expect(controller.ready).resolves.toEqual({ ok: true, cityId: 'bucuresti' });
        expect(world.viewer.manifestUrl).toBe('');
        expect(world.fonts).toEqual([undefined]);
    });
});

describe('the controller', () => {
    it('happyPath_callsBeforeReadyRunOnceTheMapIsReady', async () => {
        const world = testEnvironment();
        const controller = mount(new FakeContainer().element, config(), world.env);

        controller.setYear(1966);
        controller.toggleLayer('photos', false);
        controller.setOverlayOpacity('cladiri', 1.7);
        controller.setLang('en');
        expect(world.viewer.store?.getState().status).toBe('idle');
        await controller.ready;

        const state = world.viewer.store?.getState();
        expect(state?.year).toBe(1966);
        expect(state?.locale).toBe('en');
        expect(state?.overlays.find((overlay) => overlay.id === 'photos')?.visible).toBe(false);
        expect(state?.overlays.find((overlay) => overlay.id === 'cladiri')?.opacity).toBe(1);
    });

    it('happyPath_photosAndPoisOpenAndAnUnknownPhotoSaysSo', async () => {
        const world = testEnvironment();
        const controller = mount(new FakeContainer().element, config(), world.env);
        await controller.ready;
        const store = world.viewer.store;

        controller.openPoi('casa-uranus');
        expect(store?.getState().selectedPoiId).toBe('casa-uranus');
        controller.openPhoto('nu-exista');
        expect(store?.getState().toast).toEqual({ key: 'error.unknownPhoto' });
        controller.openPoi(null);
        expect(store?.getState().sheet).toBe('none');
    });

    it('happyPath_destroyRemovesTheMapTheListenersAndTheViewer', async () => {
        const world = testEnvironment();
        const controller = mount(new FakeContainer().element, config(), world.env);
        await controller.ready;

        controller.destroy();
        controller.destroy();
        controller.setYear(1980);

        expect(world.map.callsOf('destroy').length).toBeGreaterThan(0);
        expect(world.telemetry.destroyed).toBe(true);
        expect(world.viewer).toMatchObject({ detached: 1, removed: 1 });
    });

    it('happyPath_compareOpensMovesAndClosesThroughTheController', async () => {
        const world = testEnvironment();
        const controller = mount(new FakeContainer().element, config(), world.env);

        controller.openCompare('kh9-1980', { position: 0.3 });
        await controller.ready;
        const opened = world.viewer.store?.getState().compare;
        controller.setComparePosition(0.6);
        const moved = world.viewer.store?.getState().compare;
        controller.closeCompare();

        expect(opened).toEqual({ layerId: 'kh9-1980', position: 0.3 });
        expect(moved).toEqual({ layerId: 'kh9-1980', position: 0.6 });
        expect(world.viewer.store?.getState().compare).toBeNull();
    });

    it('badPath_compareIgnoresAnUnknownLayerAndAFailedViewer', async () => {
        const world = testEnvironment();
        const controller = mount(new FakeContainer().element, config(), world.env);
        await controller.ready;
        const failed = mount(new FakeContainer().element, { cityId: 'x' }, testEnvironment().env);

        controller.openCompare('no-such-layer');
        controller.openCompare(null);
        failed.openCompare(null);
        failed.setComparePosition(0.2);
        failed.closeCompare();

        expect(world.viewer.store?.getState().compare).toEqual({ layerId: null, position: 0.5 });
        await expect(failed.ready).resolves.toMatchObject({ ok: false });
    });

    it('badPath_setMapLabelsWithNothingIsIgnoredAndTheCallsQueuedAfterItStillRun @S-V31-BAD-API', async () => {
        const world = testEnvironment();
        const controller = mount(new FakeContainer().element, config(), world.env);
        const nothing = null as unknown as Parameters<typeof controller.setMapLabels>[0];

        controller.setMapLabels(nothing);
        controller.setYear(1966);
        await controller.ready;
        await settle();

        expect(world.viewer.store?.getState().year).toBe(1966);
        expect(() => {
            controller.setMapLabels(nothing);
            controller.setMapLabels(undefined as unknown as typeof nothing);
        }).not.toThrow();
        expect(world.viewer.store?.getState().mapLabels.shown).toEqual({ streets: true, pois: true });
    });

    it('badPath_destroyBeforeReadySettlesReadyAndDropsTheQueue', async () => {
        const world = testEnvironment();
        const controller = mount(new FakeContainer().element, config(), world.env);
        controller.setYear(1966);

        controller.destroy();

        await expect(controller.ready).resolves.toEqual({ ok: false, code: 'error.generic' });
        await settle();
        expect(world.map.callsOf('mount')).toEqual([]);
        expect(world.stores[0]?.getState().year).toBeNull();
    });

    it('happyPath_setMapLabelsDrawsWhatTheBasemapHasAndAFailedOrDestroyedControllerIgnoresIt', async () => {
        const world = testEnvironment();
        const controller = mount(new FakeContainer().element, config(), world.env);

        controller.setMapLabels({ pois: false });
        await controller.ready;
        expect(world.viewer.store?.getState().mapLabels.shown).toEqual({ streets: true, pois: false });

        const failed = mount(new FakeContainer().element, { manifestUrl: 'http://example.org/manifest.json' }, testEnvironment().env);
        failed.setMapLabels({ pois: false });
        await expect(failed.ready).resolves.toMatchObject({ ok: false });
        controller.destroy();
        controller.setMapLabels({ pois: true });
    });
});

describe('the gamepad watcher', () => {
    it('happyPath_itWatchesThisViewersMapAndStopsWithIt', () => {
        const world = testEnvironment();
        const stop = vi.fn();
        const watchGamepads = vi.fn(() => stop);

        const controller = mount(new FakeContainer().element, config(), { ...world.env, watchGamepads });

        expect(watchGamepads).toHaveBeenCalledWith(world.viewer, world.map, expect.any(Function));
        controller.destroy();
        expect(stop).toHaveBeenCalledOnce();
    });

    it('edge_withAColorSchemeTheStoreIsGivenIt', () => {
        const world = testEnvironment();
        const colorScheme = { dark: () => true, subscribe: () => () => undefined };

        mount(new FakeContainer().element, config(), { ...world.env, colorScheme });

        expect(world.stores[0]?.getState().systemDark).toBe(true);
    });
});

describe('readyOutcome', () => {
    it('happyPath_readyAndFailedSettle', () => {
        expect(readyOutcome({ status: 'error', manifest: null, error: { code: 'error.manifest.timeout', retryable: true } })).toEqual({
            ok: false,
            code: 'error.manifest.timeout',
        });
    });

    it('badPath_loadingOrIncompleteStatesStayPending', () => {
        expect(readyOutcome({ status: 'loading', manifest: null, error: null })).toBeNull();
        expect(readyOutcome({ status: 'ready', manifest: null, error: null })).toBeNull();
        expect(readyOutcome({ status: 'error', manifest: null, error: null })).toBeNull();
    });
});

describe('the store the viewer drives', () => {
    it('happyPath_theVisitorsPositionMovesTheCamera', async () => {
        const world = testEnvironment();
        const controller = mount(new FakeContainer().element, config(), world.env);
        await controller.ready;
        const view: MapView = { center: [26.1, 44.43], zoom: 16, bearing: 0 };

        world.viewer.store?.flyTo(view);

        expect(world.map.callsOf('flyTo').map((args) => args[0])).toEqual([view]);
        expect(world.viewer.store?.getState().view).toEqual(view);
    });

    it('badPath_aRecordedMapViewDoesNotMoveTheCamera', async () => {
        const world = testEnvironment();
        const controller = mount(new FakeContainer().element, config(), world.env);
        await controller.ready;

        world.viewer.store?.setView({ center: [26.1, 44.43], zoom: 16, bearing: 0 });
        world.viewer.store?.setTheme('dark');

        expect(world.map.callsOf('flyTo')).toEqual([]);
        expect(world.viewer.store?.getState().theme).toBe('dark');
    });
});

describe('declared elements', () => {
    it('happyPath_attributesAndTheManifestPropertyConfigureTheViewer', async () => {
        const world = testEnvironment();
        world.viewer.manifestUrl = MANIFEST_URL;
        world.viewer.cityId = 'bucuresti';
        world.viewer.engineBase = 'https://cdn.example.org/hcm/';
        world.viewer.attributes.set('lang', 'en');

        const controller = bootDeclared(world.viewer.element, world.env);

        await expect(controller.ready).resolves.toEqual({ ok: true, cityId: 'bucuresti' });
        expect(world.viewer.store?.getState().locale).toBe('en');
        expect(world.fonts).toEqual(['https://cdn.example.org/hcm/']);
    });

    it('badPath_anElementWithoutAManifestSaysWhatIsMissing', () => {
        const world = testEnvironment();

        bootDeclaredIn(() => world.env)(world.viewer.element);

        expect(world.viewer.bootError).toMatchObject({ code: 'error.config.invalid' });
        expect(world.viewer.controller).toBeNull();
    });
});
