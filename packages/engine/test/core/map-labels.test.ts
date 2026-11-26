import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeMap } from '@hcm/test-support/fake-map';
import type { MapOptions } from '@hcm/ui/map';

import {
    drawMapLabels,
    hashMapLabels,
    mapLabelsOf,
    readMapLabels,
    withHashLabels,
    withMapAnswer,
    withRequestedLabels,
    type MapLabelsState,
} from '../../src/core/map-labels.js';
import { HASH_WRITE_DELAY_MS } from '../../src/core/url-sync.js';
import { manifest } from './fixtures.js';
import { harness, loaded } from './harness.js';

const STANDARD = { streets: true, pois: true } as const;
const NONE = { streets: null, pois: null } as const;

function city(config: Readonly<Record<string, boolean | string>> = {}): ReturnType<typeof manifest> {
    const base = manifest();
    return { ...base, city: { ...base.city, basemap: { style: 'mapbox://styles/mapbox/standard', config } } };
}

const ready: MapLabelsState = withMapAnswer(mapLabelsOf(city()), STANDARD);

describe('the map labels state', () => {
    it('happyPath_theManifestsConfigIsTheDefault', () => {
        const state = mapLabelsOf(city({ showRoadLabels: false }));

        expect(state).toEqual({
            shown: { streets: false, pois: true },
            defaults: { streets: false, pois: true },
            available: null,
            pinned: false,
        });
    });

    it('happyPath_theMapsAnswerSaysWhatTheBasemapHasAndKeepsAHashesChoice', () => {
        const hashed = withHashLabels(mapLabelsOf(city()), { streets: false, pois: true });

        expect(withMapAnswer(hashed, { streets: false, pois: true })).toEqual({
            shown: { streets: false, pois: true },
            defaults: STANDARD,
            available: ['streets', 'pois'],
            pinned: true,
        });
    });

    it('happyPath_aStylesOwnDefaultWinsOverTheAssumedOneWithoutAChoice', () => {
        expect(withMapAnswer(mapLabelsOf(city()), { streets: false, pois: true })).toEqual({
            shown: { streets: false, pois: true },
            defaults: { streets: false, pois: true },
            available: ['streets', 'pois'],
            pinned: false,
        });
    });

    it('badPath_aBasemapWithoutThemDropsAHashesChoice', () => {
        const hashed = withHashLabels(mapLabelsOf(city()), { streets: false, pois: false });
        const state = withMapAnswer(hashed, NONE);

        expect(state).toEqual({ shown: STANDARD, defaults: STANDARD, available: [], pinned: false });
        expect(hashMapLabels(state)).toEqual({});
    });

    it('happyPath_aBasemapWithOneKindKeepsOnlyThatChoice', () => {
        const hashed = withHashLabels(mapLabelsOf(city()), { streets: false, pois: false });
        const state = withMapAnswer(hashed, { streets: null, pois: false });

        expect(state.available).toEqual(['pois']);
        expect(state.shown).toEqual({ streets: true, pois: false });
        expect(withRequestedLabels(state, { streets: false })).toBe(state);
    });

    it('badPath_aRequestBeforeTheMapAnswersOrWithoutAChangeReturnsTheSameState', () => {
        const before = mapLabelsOf(city());

        expect(withRequestedLabels(before, { streets: false })).toBe(before);
        expect(withRequestedLabels(ready, { streets: true })).toBe(ready);
        expect(withRequestedLabels(ready, {})).toBe(ready);
        expect(withRequestedLabels(ready, { streets: 'no' as unknown as boolean })).toBe(ready);
        expect(withRequestedLabels(ready, null)).toBe(ready);
        expect(withRequestedLabels(ready, undefined)).toBe(ready);
        expect(withRequestedLabels(ready, 5 as unknown as Partial<typeof STANDARD>)).toBe(ready);
    });

    it('happyPath_aHashWithoutLabelsReturnsToTheDefault', () => {
        const chosen = withRequestedLabels(ready, { pois: false });

        expect(withHashLabels(chosen, undefined).shown).toEqual(STANDARD);
        expect(withHashLabels(ready, undefined)).toBe(ready);
    });

    it('happyPath_theHashCarriesOnlyADifferenceFromTheDefault', () => {
        expect(hashMapLabels(ready)).toEqual({});
        expect(hashMapLabels(withRequestedLabels(ready, { pois: false }))).toEqual({ labels: { streets: true, pois: false } });
    });
});

describe('the map labels on a map', () => {
    it('happyPath_writesOnlyWhatDiffers', () => {
        const map = new FakeMap();

        drawMapLabels(map, { streets: false, pois: true });
        drawMapLabels(map, { streets: false, pois: true });

        expect(map.callsOf('setBasemapFlag')).toEqual([['showRoadLabels', false]]);
    });

    it('happyPath_transitStationsFollowThePointsOfInterestOffAndOn', () => {
        const map = new FakeMap({ basemapFlags: { showRoadLabels: true, showPointOfInterestLabels: true, showTransitLabels: true } });

        drawMapLabels(map, { streets: true, pois: false });
        drawMapLabels(map, { streets: true, pois: true });

        expect(map.callsOf('setBasemapFlag')).toEqual([
            ['showPointOfInterestLabels', false],
            ['showTransitLabels', false],
            ['showPointOfInterestLabels', true],
            ['showTransitLabels', true],
        ]);
    });

    it('happyPath_theCitysOwnTransitChoiceStands', () => {
        const map = new FakeMap({ basemapFlags: { showPointOfInterestLabels: true, showTransitLabels: false } });

        drawMapLabels(map, { streets: true, pois: false }, { showTransitLabels: false });
        drawMapLabels(map, { streets: true, pois: true }, { showTransitLabels: false });

        expect(map.callsOf('setBasemapFlag')).toEqual([
            ['showPointOfInterestLabels', false],
            ['showPointOfInterestLabels', true],
        ]);
    });

    it('badPath_transitIsNeverWrittenWithoutThePointsOfInterest', () => {
        const map = new FakeMap({ basemapFlags: { showRoadLabels: true, showTransitLabels: false } });

        drawMapLabels(map, { streets: false, pois: true });

        expect(map.callsOf('setBasemapFlag')).toEqual([['showRoadLabels', false]]);
    });

    it('badPath_aPropertyTheStyleDoesNotHaveIsNeverWritten', () => {
        const map = new FakeMap({ basemapFlags: {} });

        drawMapLabels(map, { streets: false, pois: false });

        expect(readMapLabels(map)).toEqual(NONE);
        expect(map.callsOf('setBasemapFlag')).toEqual([]);
    });
});

describe('the viewer store with map labels', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('happyPath_aSwitchWritesTheMapLiveAndTheHashWithNoNewMap', async () => {
        const { store, map, location } = await loaded();

        store.setMapLabels({ streets: false });
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(map.callsOf('setBasemapFlag')).toEqual([['showRoadLabels', false]]);
        expect(map.mapLoadCount).toBe(1);
        expect(location.written.at(-1)).toContain('labels=pois');

        store.setMapLabels({ streets: true });
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);
        expect(location.written.at(-1)).not.toContain('labels');
    });

    it('happyPath_aHashRestoresTheChoiceInTheMountItself', async () => {
        const { store, map, location } = await loaded({ hash: '#14/44.43/26.1&labels=' });
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(store.getState().mapLabels.shown).toEqual({ streets: false, pois: false });
        expect((map.callsOf('mount')[0]?.[1] as MapOptions).config).toMatchObject({
            showRoadLabels: false,
            showPointOfInterestLabels: false,
        });
        expect(map.callsOf('setBasemapFlag')).toEqual([]);
        expect(location.hash).toContain('labels=');
    });

    it('badPath_anInvalidHashValueLeavesTheCitysDefaultAndTheEncoderDropsIt', async () => {
        const { store, map, location } = await loaded({ hash: '#14/44.43/26.1&labels=nonsense' });
        store.setMapLabels({});
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(store.getState().mapLabels.shown).toEqual(STANDARD);
        expect(map.callsOf('setBasemapFlag')).toEqual([]);
        expect(location.hash).not.toContain('labels');
    });

    it('happyPath_theCitysConfigIsTheDefaultAndALinkMayTurnThemBackOn', async () => {
        const { store, location } = await loaded({ manifest: city({ showRoadLabels: false }) });
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);
        expect(store.getState().mapLabels.shown).toEqual({ streets: false, pois: true });
        expect(location.hash).not.toContain('labels');

        store.setMapLabels({ streets: true });
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);
        expect(location.hash).toContain('labels=streets,pois');
    });

    it('badPath_aCustomBasemapOffersNothingDropsTheLinksChoiceAndIsNeverWritten', async () => {
        const { store, map, location } = await loaded({ map: { basemapFlags: {} }, hash: '#14/44.43/26.1&labels=' });
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        store.setMapLabels({ streets: false });
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(store.getState().mapLabels).toEqual({ shown: STANDARD, defaults: STANDARD, available: [], pinned: false });
        expect(map.callsOf('setBasemapFlag')).toEqual([]);
        expect(location.hash).not.toContain('labels');
    });

    it('happyPath_theBackButtonToALinkWithoutLabelsRestoresTheDefault', async () => {
        const { store, map, location } = await loaded({ hash: '#14/44.43/26.1&labels=streets' });

        location.navigate('#14/44.43/26.1');

        expect(store.getState().mapLabels.shown).toEqual(STANDARD);
        expect(map.callsOf('setBasemapFlag')).toEqual([['showPointOfInterestLabels', true]]);
    });

    it('badPath_noWebGlNoMapNoSwitchesButTheLinkIsKept', async () => {
        const { store, location } = await loaded({ map: { webgl: false }, hash: '#14/44.43/26.1&labels=' });
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(store.getState().mapLabels.available).toBeNull();
        store.setMapLabels({ streets: true });
        expect(store.getState().mapLabels.shown).toEqual({ streets: false, pois: false });
        expect(location.hash).toContain('labels=');
    });

    /** A style whose own default leaves street names off, with no `basemap.config` to say so. */
    const STREETS_OFF = { basemapFlags: { showRoadLabels: false, showPointOfInterestLabels: true } };

    it('happyPath_aLinkTurningOnWhatTheStyleLeavesOffKeepsItsChoice @S-V31-HAPPY-STYLE-DEFAULT', async () => {
        const { store, map, location } = await loaded({ map: STREETS_OFF, hash: '#14/44.43/26.1&labels=streets,pois' });
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(store.getState().mapLabels.shown).toEqual(STANDARD);
        expect(store.getState().mapLabels.defaults).toEqual({ streets: false, pois: true });
        expect(map.callsOf('setBasemapFlag')).toEqual([['showRoadLabels', true]]);
        expect(location.hash).toContain('labels=streets,pois');
    });

    it('badPath_aLinkOverAStylesUnknownDefaultKeepsItsLabelsSoAReloadLosesNothing @S-V31-BAD-STYLE-DEFAULT', async () => {
        const { store, location } = await loaded({ map: STREETS_OFF, hash: '#14/44.43/26.1&labels=pois' });

        store.setMapLabels({ streets: true });
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(store.getState().mapLabels.shown).toEqual(STANDARD);
        expect(location.hash).toContain('labels=streets,pois');

        const again = await loaded({ map: STREETS_OFF, hash: location.hash });
        expect(again.store.getState().mapLabels.shown).toEqual(STANDARD);
    });

    it('happyPath_aLinkWithoutLabelsLetsGoOfThePin', async () => {
        const { store, location } = await loaded({ hash: '#14/44.43/26.1&labels=pois' });

        location.navigate('#14/44.43/26.1');
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(store.getState().mapLabels.pinned).toBe(false);
        expect(location.hash).not.toContain('labels');
    });

    it('badPath_aLinkNamingTheDefaultKeepsItWhileNoMapHasAnswered', async () => {
        const { store, location } = await loaded({ map: { webgl: false }, hash: '#14/44.43/26.1&labels=streets,pois' });
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(store.getState().mapLabels.available).toBeNull();
        expect(location.hash).toContain('labels=streets,pois');
    });

    it('badPath_callsBeforeTheManifestAreIgnored', () => {
        const { store } = harness();

        store.setMapLabels({ streets: false });

        expect(store.getState().mapLabels.shown).toEqual(STANDARD);
    });
});
