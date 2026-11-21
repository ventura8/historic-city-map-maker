import { createLogger } from '@hcm/shared';
import { createRecordingSink } from '@hcm/test-support';
import { describe, expect, it } from 'vitest';

import { Preferences, preferenceKey } from '../../src/core/preferences.js';
import { cityView, initialState, overlayName, withManifest, withVisibleLayers, withYear } from '../../src/core/state.js';
import { layer, manifest } from './fixtures.js';
import { brokenStorage, memoryStorage } from './support.js';

describe('viewer state', () => {
    const start = initialState('ro', 'system', 'unknown');

    it('happyPath_startsIdleWithoutAManifest', () => {
        expect(start).toMatchObject({
            status: 'idle',
            error: null,
            locale: 'ro',
            manifest: null,
            overlays: [],
            sheet: 'none',
            theme: 'system',
        });
    });

    it('happyPath_aManifestBringsItsOverlaysViewAndDefaultStop', () => {
        const city = manifest({ layers: [layer(), layer({ id: 'kh9-1980', year: 1980, order: 2, defaultVisible: true })] });

        const state = withManifest({ ...start, sheet: 'about', selectedPhotoId: 'x' }, city);

        expect(state.overlays.map((overlay) => overlay.id)).toEqual(['kh4-1966', 'kh9-1980', 'photos', 'cladiri', 'strazi']);
        expect(state.view).toEqual(cityView(city));
        expect(state.view).toEqual({ center: [26.085298, 44.427037], zoom: 14.5, bearing: 0 });
        expect(state.year).toBe(1980);
        expect(state).toMatchObject({ sheet: 'none', selectedPhotoId: null, selectedPoiId: null, lightbox: false });
    });

    it('happyPath_aYearShowsExactlyItsLayers', () => {
        const state = withManifest(start, manifest());

        const at1966 = withYear(state, 1970);

        expect(at1966.year).toBe(1966);
        expect(at1966.overlays.filter((overlay) => overlay.visible).map((overlay) => overlay.id)).toEqual([
            'kh4-1966',
            'photos',
            'cladiri',
            'strazi',
        ]);
        expect(withYear(at1966, null).overlays.find((overlay) => overlay.id === 'kh4-1966')?.visible).toBe(false);
    });

    it('badPath_theSameStopReturnsTheSameState', () => {
        const state = withYear(withManifest(start, manifest()), 1966);

        expect(withYear(state, 1967)).toBe(state);
        expect(withYear(start, 1966)).toBe(start);
    });

    it('badPath_unknownLayerIdsAreIgnored', () => {
        const state = withManifest(start, manifest());

        expect(withVisibleLayers(state.overlays, new Set(['nope']))).toBe(state.overlays);
    });

    it('happyPath_overlayNamesFollowTheLanguage', () => {
        const state = withManifest(start, manifest());

        expect(overlayName(state, 'cladiri')).toBe('Clădiri dispărute');
        expect(overlayName({ ...state, locale: 'en' }, 'kh4-1966')).toBe('Corona 1966 (EN)');
        expect(overlayName(state, 'unknown-id')).toBe('unknown-id');
    });
});

describe('Preferences', () => {
    it('happyPath_storesPerCity', () => {
        const storage = memoryStorage();
        const preferences = new Preferences(storage, createLogger('test', { sink: createRecordingSink().sink }));

        preferences.set('bucuresti', 'lang', 'en');
        preferences.set('cluj', 'lang', 'ro');

        expect(preferenceKey('bucuresti', 'lang')).toBe('hcm:bucuresti:lang');
        expect(preferences.get('bucuresti', 'lang')).toBe('en');
        expect(storage.get('hcm:cluj:lang')).toBe('ro');
        preferences.set('bucuresti', 'lang', null);
        expect(preferences.get('bucuresti', 'lang')).toBeNull();
    });

    it('badPath_withoutACityNothingIsReadOrStored', () => {
        const storage = memoryStorage();
        const preferences = new Preferences(storage, createLogger('test', { sink: createRecordingSink().sink }));

        preferences.set(undefined, 'theme', 'dark');

        expect(storage.size).toBe(0);
        expect(preferences.get(undefined, 'theme')).toBeNull();
    });

    it('badPath_aThrowingStorageReadsAsNothingAndLogsALostWrite', () => {
        const recording = createRecordingSink();
        const preferences = new Preferences(brokenStorage, createLogger('test', { sink: recording.sink }));

        expect(preferences.get('bucuresti', 'consent')).toBeNull();
        preferences.set('bucuresti', 'consent', 'granted');
        preferences.set('bucuresti', 'consent', null);

        expect(recording.records.map((record) => record.message)).toEqual(['preference not stored', 'preference not stored']);
    });
});
