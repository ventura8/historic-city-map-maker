import { describe, expect, it } from 'vitest';

import { commandAllowed, dialogMode, isDialogSheet, runInputCommand, wrapped } from '../../src/viewer/input-commands.js';
import { FakeStore, idleState, readyState } from './fake-store.js';
import { testManifest } from './fixtures.js';

function layered(): ReturnType<typeof testManifest> {
    return testManifest();
}

function storeWith(change: Parameters<typeof readyState>[1] = {}): FakeStore {
    return new FakeStore(readyState(layered(), change));
}

describe('wrapped', () => {
    it('happyPath_stepsAndWrapsBothWays', () => {
        expect(wrapped(0, 1, 3)).toBe(1);
        expect(wrapped(2, 1, 3)).toBe(0);
        expect(wrapped(0, -1, 3)).toBe(2);
    });

    it('edge_fromNowhereTheFirstOrTheLast', () => {
        expect(wrapped(-1, 1, 3)).toBe(0);
        expect(wrapped(-1, -1, 3)).toBe(2);
    });
});

describe('commandAllowed', () => {
    it('badPath_nothingBeforeTheViewerIsReady', () => {
        expect(commandAllowed(idleState(), 'help')).toBe(false);
    });

    it('happyPath_everyCommandOnAFreeMap', () => {
        const state = readyState(layered());

        expect(commandAllowed(state, 'year-next')).toBe(true);
        expect(commandAllowed(state, 'layers')).toBe(true);
    });

    it('badPath_theLightboxKeepsPhotosAndClose', () => {
        const state = readyState(layered(), { lightbox: true });

        expect(commandAllowed(state, 'photo-next')).toBe(true);
        expect(commandAllowed(state, 'close')).toBe(true);
        expect(commandAllowed(state, 'year-next')).toBe(false);
    });

    it('badPath_aDialogKeepsHelpAndClose', () => {
        for (const sheet of ['about', 'help', 'settings'] as const) {
            const state = readyState(layered(), { sheet });

            expect(isDialogSheet(sheet)).toBe(true);
            expect(dialogMode(sheet)).toBe(sheet);
            expect(commandAllowed(state, 'help')).toBe(true);
            expect(commandAllowed(state, 'photo-next')).toBe(false);
        }
        expect([isDialogSheet('layers'), dialogMode('layers')]).toEqual([false, 'about']);
    });

    it('badPath_noMapCommandsWithoutWebgl', () => {
        const state = readyState(layered(), { webgl: false });

        expect(commandAllowed(state, 'opacity-up')).toBe(false);
        expect(commandAllowed(state, 'photo-next')).toBe(true);
    });
});

describe('runInputCommand', () => {
    it('happyPath_yearsStepAndSayTheirValue', () => {
        const store = storeWith();
        const stops = [...new Set(layered().layers.map((layer) => layer.year))].sort((a, b) => a - b);
        const last = stops.at(-1) ?? 0;

        runInputCommand(store, 'year-previous');
        expect(store.getState().year).toBe(last);
        expect(store.getState().toast).toEqual({ key: 'timeline.year', params: { year: String(last) } });

        runInputCommand(store, 'year-next');
        expect(store.getState().year).toBeNull();
        expect(store.getState().toast?.key).toBe('timeline.present');
    });

    it('edge_theYearStopsAtTheEnds', () => {
        const store = storeWith();

        runInputCommand(store, 'year-next');

        expect(store.getState().year).toBeNull();
    });

    it('badPath_noTimelineStaysAtToday', () => {
        const store = new FakeStore(readyState({ ...layered(), layers: [] }));

        runInputCommand(store, 'year-previous');

        expect(store.getState().year).toBeNull();
    });

    it('happyPath_opacityStepsTheVisibleLayerClampedAndFinal', () => {
        const manifest = layered();
        const store = new FakeStore(readyState(manifest));
        const id = store.getState().overlays.find((overlay) => overlay.kind === 'raster')?.id ?? '';
        store.toggleOverlay(id, true);
        store.setOverlayOpacity(id, 0.95);

        runInputCommand(store, 'opacity-up');

        expect(store.callsOf('setOverlayOpacity').at(-1)).toEqual([id, 1, true]);
        expect(store.getState().toast?.key).toBe('layers.opacityChanged');
        expect(store.getState().toast?.params?.['percent']).toBe('100');

        runInputCommand(store, 'opacity-down');
        expect(store.callsOf('setOverlayOpacity').at(-1)).toEqual([id, 0.9, true]);
    });

    it('badPath_noVisibleLayerSaysSo', () => {
        const store = storeWith();
        for (const overlay of store.getState().overlays) {
            store.toggleOverlay(overlay.id, false);
        }

        runInputCommand(store, 'opacity-down');

        expect(store.callsOf('setOverlayOpacity')).toEqual([]);
        expect(store.getState().toast).toEqual({ key: 'input.noLayer' });
    });

    it('happyPath_photosStepThroughTheListAndWrap', () => {
        const manifest = layered();
        const store = new FakeStore(readyState(manifest));
        const [first] = manifest.photos;
        const last = manifest.photos.at(-1);

        runInputCommand(store, 'photo-next');
        expect(store.getState().selectedPhotoId).toBe(first?.id);

        runInputCommand(store, 'photo-previous');
        expect(store.getState().selectedPhotoId).toBe(last?.id);
    });

    it('happyPath_theLightboxStaysOpenAndStepsAllPhotos', () => {
        const manifest = layered();
        const store = new FakeStore(readyState(manifest, { lightbox: true, year: 1, selectedPhotoId: manifest.photos[0]?.id ?? null }));

        runInputCommand(store, 'photo-next');

        expect(store.getState().lightbox).toBe(true);
    });

    it('badPath_noPhotoNearTheYearSaysSo', () => {
        const store = storeWith({ year: 1 });

        runInputCommand(store, 'photo-next');

        expect(store.callsOf('openPhoto')).toEqual([]);
        expect(store.getState().toast).toEqual({ key: 'input.noPhoto' });
    });

    it('happyPath_layersAndHelpOpenAndClose', () => {
        const store = storeWith();

        runInputCommand(store, 'layers');
        expect(store.getState().sheet).toBe('layers');
        runInputCommand(store, 'layers');
        expect(store.getState().sheet).toBe('none');

        runInputCommand(store, 'help');
        expect(store.getState().sheet).toBe('help');
        runInputCommand(store, 'help');
        expect(store.getState().sheet).toBe('none');
    });

    it('happyPath_closeTakesTheFrontSurface', () => {
        const store = storeWith({ lightbox: true, sheet: 'about' });

        runInputCommand(store, 'close');
        expect(store.getState().lightbox).toBe(false);
        expect(store.getState().sheet).toBe('about');

        runInputCommand(store, 'close');
        expect(store.getState().sheet).toBe('none');
    });
});
