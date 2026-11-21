import { decodeHash } from '@hcm/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { comparedOverlays, compareModeOf, displayedOverlays, initialState, isCompareLayer, withManifest } from '../../src/core/state.js';
import { applyDecodedHash, encodeViewerHash, HASH_WRITE_DELAY_MS, hashLimits } from '../../src/core/url-sync.js';
import { manifest } from './fixtures.js';
import { harness, loaded } from './harness.js';

/** Swipe compare in the engine's entry (M4, V06): the state, the URL hash and the store's actions, without the chunk. */

const city = manifest();
const ready = { ...withManifest(initialState('ro', 'system', 'unknown'), city), status: 'ready' as const };

function rasterVisibility(overlays: ReturnType<typeof comparedOverlays>): Record<string, boolean> {
    return Object.fromEntries(overlays.filter((overlay) => overlay.kind === 'raster').map((overlay) => [overlay.id, overlay.visible]));
}

describe('compare state', () => {
    it('happyPath_aCompactWindowTogglesAndAWiderOneSwipes', () => {
        expect(compareModeOf({ windowClass: 'compact' })).toBe('toggle');
        expect(compareModeOf({ windowClass: 'medium' })).toBe('swipe');
        expect(compareModeOf({ windowClass: 'extra-large' })).toBe('swipe');
    });

    it('happyPath_todayAndTheManifestsLayersCanBeCompared', () => {
        expect(isCompareLayer(city, null)).toBe(true);
        expect(isCompareLayer(city, 'kh9-1980')).toBe(true);
        expect(isCompareLayer(city, 'photos')).toBe(false);
        expect(isCompareLayer(city, 'no-such-layer')).toBe(false);
    });

    it('happyPath_theComparedSideShowsOnlyItsLayerAndKeepsPhotosAndPlaces', () => {
        const shown = ready.overlays.map((overlay) =>
            overlay.kind === 'raster' ? { ...overlay, visible: overlay.id === 'kh4-1966' } : overlay,
        );

        const compared = comparedOverlays(shown, 'kh9-1980');
        const today = comparedOverlays(shown, null);

        expect(rasterVisibility(compared)).toEqual({ 'kh4-1966': false, 'kh9-1980': true });
        expect(rasterVisibility(today)).toEqual({ 'kh4-1966': false, 'kh9-1980': false });
        expect(compared.filter((overlay) => overlay.kind !== 'raster')).toEqual(shown.filter((overlay) => overlay.kind !== 'raster'));
    });

    it('happyPath_theToggleAtZeroShowsTheComparedSideOnTheOneMap', () => {
        const toggled = { ...ready, compare: { layerId: 'kh9-1980', position: 0 } };

        expect(rasterVisibility(displayedOverlays(toggled))).toEqual({ 'kh4-1966': false, 'kh9-1980': true });
    });

    it('badPath_theMapShowsTheMainSideUnlessTheToggleShowsTheOther', () => {
        expect(displayedOverlays(ready)).toBe(ready.overlays);
        expect(displayedOverlays({ ...ready, compare: { layerId: 'kh9-1980', position: 1 } })).toBe(ready.overlays);
        expect(displayedOverlays({ ...ready, windowClass: 'medium', compare: { layerId: 'kh9-1980', position: 0 } })).toBe(ready.overlays);
    });
});

describe('compare in the URL hash', () => {
    it('happyPath_compareIsWrittenAndReadBack', () => {
        const state = { ...ready, compare: { layerId: 'kh9-1980', position: 0.3 } };

        const hash = encodeViewerHash(state, 'ro');
        const read = applyDecodedHash(ready, decodeHash(hash, hashLimits(city)));

        expect(hash).toContain('cmp=kh9-1980&sw=30');
        expect(read.state.compare).toEqual({ layerId: 'kh9-1980', position: 0.3 });
        expect(encodeViewerHash({ ...ready, compare: { layerId: null, position: 0.5 } }, 'ro')).toMatch(/&cmp=$/);
    });

    it('badPath_anUnknownLayerOrNoCmpLeavesCompareClosed', () => {
        const open = { ...ready, compare: { layerId: null, position: 0.5 } };

        expect(applyDecodedHash(ready, decodeHash('#cmp=no-such-layer&sw=30', hashLimits(city))).state.compare).toBeNull();
        expect(applyDecodedHash(open, decodeHash('#15/44.43/26.09', hashLimits(city))).state.compare).toBeNull();
        expect(applyDecodedHash(ready, decodeHash('#sw=30', hashLimits(city))).state).toBe(ready);
        expect(applyDecodedHash({ ...ready, manifest: null }, decodeHash('#cmp=', hashLimits(city))).state.compare).toBeNull();
    });
});

describe('compare actions of the store', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('happyPath_openMoveAndCloseWriteTheHashAndLogTheOpeningOnce', async () => {
        const { store, telemetry, location } = await loaded();

        store.openCompare(null);
        store.openCompare('kh9-1980');
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);
        const opened = location.written.at(-1);
        store.setComparePosition(0.25);
        store.setComparePosition(0.25);
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);
        const moved = location.written.at(-1);
        store.closeCompare();
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(opened).toContain('cmp=kh9-1980');
        expect(moved).toContain('cmp=kh9-1980&sw=25');
        expect(location.written.at(-1)).not.toContain('cmp=');
        expect(store.getState().compare).toBeNull();
        expect(telemetry.events.filter((event) => event.name === 'compare_open')).toHaveLength(1);
    });

    it('happyPath_thePositionIsClampedAndKeptWhenTheSideChanges', async () => {
        const { store } = await loaded();

        store.openCompare(null, 1.7);
        const first = store.getState().compare;
        store.setComparePosition(-2);
        store.openCompare('kh4-1966');

        expect(first).toEqual({ layerId: null, position: 1 });
        expect(store.getState().compare).toEqual({ layerId: 'kh4-1966', position: 0 });
    });

    it('badPath_anUnknownLayerACallBeforeTheManifestOrAClosedCompareChangeNothing', async () => {
        const early = harness();
        early.store.openCompare(null);
        const { store, telemetry } = await loaded();
        const before = store.getState();

        store.openCompare('no-such-layer');
        store.setComparePosition(0.2);
        store.closeCompare();

        expect(early.store.getState().compare).toBeNull();
        expect(store.getState()).toBe(before);
        expect(telemetry.events.some((event) => event.name === 'compare_open')).toBe(false);
    });

    it('happyPath_aSharedLinkOpensCompareWhereItWas', async () => {
        const { store } = await loaded({ hash: '#15/44.43/26.09&cmp=kh9-1980&sw=30' });

        expect(store.getState().compare).toEqual({ layerId: 'kh9-1980', position: 0.3 });
    });

    it('badPath_aLinkComparingAnUnknownLayerIsRewrittenWithoutCompare', async () => {
        const { store, location } = await loaded({ hash: '#15/44.43/26.09&cmp=no-such-layer&sw=30' });
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(store.getState().compare).toBeNull();
        expect(location.written).not.toHaveLength(0);
        expect(location.written.at(-1)).not.toMatch(/cmp=|sw=/);
    });

    it('badPath_aHashWithoutCmpTheVisitorNavigatesToClosesCompare', async () => {
        const { store, location } = await loaded();
        store.openCompare(null);

        location.navigate('#15/44.43/26.09');

        expect(store.getState().compare).toBeNull();
    });
});
