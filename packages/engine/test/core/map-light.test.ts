import { FakeMap } from '@hcm/test-support/fake-map';
import { describe, expect, it, vi } from 'vitest';

import { drawMapLight, mapLight } from '../../src/core/map-light.js';
import { mapOptions } from '../../src/core/map-specs.js';
import { manifest } from './fixtures.js';
import { harness, loaded } from './harness.js';

function city(config: Readonly<Record<string, boolean | string>> = {}): ReturnType<typeof manifest> {
    const base = manifest();
    return { ...base, city: { ...base.city, basemap: { style: 'mapbox://styles/mapbox/standard', config } } };
}

const MOMENT = { view: { center: [26, 44] as [number, number], zoom: 14, bearing: 0 }, locale: 'ro', reducedMotion: false } as const;
const DRAWN = { streets: true, pois: true };

describe('mapLight', () => {
    it('happyPath_followsTheEffectiveTheme', () => {
        const base = { manifest: city(), systemDark: false };

        expect(mapLight({ ...base, theme: 'light' })).toBe('day');
        expect(mapLight({ ...base, theme: 'dark' })).toBe('night');
        expect(mapLight({ ...base, theme: 'system' })).toBe('day');
        expect(mapLight({ ...base, theme: 'system', systemDark: true })).toBe('night');
        expect(mapLight({ ...base, theme: 'light', systemDark: true })).toBe('day');
    });

    it('badPath_theCitysConfigWins', () => {
        expect(mapLight({ manifest: city({ lightPreset: 'dusk' }), theme: 'dark', systemDark: false })).toBeNull();
    });

    it('edge_beforeTheManifestItIsTheTheme', () => {
        expect(mapLight({ manifest: null, theme: 'dark', systemDark: false })).toBe('night');
    });
});

describe('drawMapLight', () => {
    it('happyPath_writesOnlyADifference', () => {
        const map = new FakeMap();

        drawMapLight(map, 'day');
        expect(map.callsOf('setBasemapOption')).toEqual([]);

        drawMapLight(map, 'night');
        expect(map.callsOf('setBasemapOption')).toEqual([['lightPreset', 'night']]);
    });

    it('badPath_aStyleWithoutThePropertyIsNeverWritten', () => {
        const map = new FakeMap({ basemapOptions: {} });

        drawMapLight(map, 'night');

        expect(map.callsOf('setBasemapOption')).toEqual([]);
    });

    it('badPath_nullWritesNothing', () => {
        const map = new FakeMap();

        drawMapLight(map, null);

        expect(map.callsOf('setBasemapOption')).toEqual([]);
    });
});

describe('the mount options', () => {
    it('happyPath_aDarkPageMountsAtNight', () => {
        expect(mapOptions(city(), { ...MOMENT, labels: DRAWN, light: 'night' }).config).toMatchObject({ lightPreset: 'night' });
    });

    it('edge_dayIsNotWrittenIntoTheMount', () => {
        expect(mapOptions(city(), { ...MOMENT, labels: DRAWN, light: 'day' }).config).toBeUndefined();
    });

    it('badPath_theCitysOwnPresetStays', () => {
        expect(mapOptions(city({ lightPreset: 'dusk' }), { ...MOMENT, labels: DRAWN, light: null }).config).toEqual({
            lightPreset: 'dusk',
        });
    });
});

describe('the store and the light', () => {
    it('happyPath_aThemeChangeIsLiveWithOneMapLoad', async () => {
        const { store, map } = await loaded({ manifest: city() });

        store.setTheme('dark');
        expect(map.callsOf('setBasemapOption').at(-1)).toEqual(['lightPreset', 'night']);
        store.setTheme('light');
        expect(map.callsOf('setBasemapOption').at(-1)).toEqual(['lightPreset', 'day']);

        expect(map.mapLoadCount).toBe(1);
    });

    it('badPath_aThemeChangeLeavesACitysPresetAlone', async () => {
        const { store, map } = await loaded({ manifest: city({ lightPreset: 'dusk' }) });

        store.setTheme('dark');

        expect(map.callsOf('setBasemapOption')).toEqual([]);
    });

    it('happyPath_theSystemSchemeIsFollowedUntilDestroyed', async () => {
        const listeners: ((dark: boolean) => void)[] = [];
        const stop = vi.fn();
        const colorScheme = {
            dark: () => true,
            subscribe: (next: (dark: boolean) => void) => {
                listeners.push(next);
                return stop;
            },
        };
        const { store, map } = await loaded({ manifest: city(), colorScheme });
        expect(store.getState().systemDark).toBe(true);
        expect(map.callsOf('mount')[0]?.[1]).toMatchObject({ config: { lightPreset: 'night' } });

        listeners[0]?.(false);
        expect(map.callsOf('setBasemapOption').at(-1)).toEqual(['lightPreset', 'day']);

        store.destroy();
        expect(stop).toHaveBeenCalledOnce();
    });
});

describe('the single-key shortcuts preference', () => {
    it('happyPath_turnedOffItIsRememberedForTheCity', async () => {
        const first = await loaded({ manifest: city() });
        expect(first.store.getState().shortcuts).toBe(true);

        first.store.setShortcuts(false);
        first.store.setShortcuts(false);
        expect(first.store.getState().shortcuts).toBe(false);

        const second = harness({ manifest: city(), storage: first.storage });
        await second.store.load();
        expect(second.store.getState().shortcuts).toBe(false);

        second.store.setShortcuts(true);
        const third = harness({ manifest: city(), storage: first.storage });
        await third.store.load();
        expect(third.store.getState().shortcuts).toBe(true);
    });
});
