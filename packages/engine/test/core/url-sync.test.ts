import { decodeHash, overlaysFromManifest, withOverlayOpacity, withOverlayVisibility } from '@hcm/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initialState, withManifest } from '../../src/core/state.js';
import { applyDecodedHash, encodeViewerHash, hashLimits, HashWriter, HASH_WRITE_DELAY_MS, hashStateOf } from '../../src/core/url-sync.js';
import { layer, manifest, omit } from './fixtures.js';

describe('url sync', () => {
    const city = manifest();
    const loaded = withManifest(initialState('ro', 'system', 'unknown'), city);

    it('happyPath_theLimitsOfACity', () => {
        const limits = hashLimits(city);

        expect(limits).toMatchObject({ minZoom: 10, maxZoom: 20, bounds: city.city.bounds });
        expect([...(limits.overlayIds ?? [])]).toEqual(['kh4-1966', 'kh9-1980', 'photos', 'cladiri', 'strazi']);
    });

    it('badPath_aCityWithoutPoiCategoriesHasOnlyLayerAndPhotoOverlays', () => {
        expect([...(hashLimits(omit(city, 'poiCategories', 'pois')).overlayIds ?? [])]).toEqual(['kh4-1966', 'kh9-1980', 'photos']);
    });

    it('happyPath_aSharedLinkRestoresViewLayersOpacitiesPhotoAndLanguage', () => {
        const hash = decodeHash(
            '#16/44.43/26.1/90&layers=kh9-1980&op=kh9-1980:40,cladiri:25&photo=mihai-voda-1978&lang=en',
            hashLimits(city),
        );

        const { state, unknownPhoto } = applyDecodedHash(loaded, hash);

        expect(unknownPhoto).toBeNull();
        expect(state.view).toEqual({ center: [26.1, 44.43], zoom: 16, bearing: 90 });
        expect(state.year).toBe(1980);
        expect(state.overlays.map((overlay) => [overlay.id, overlay.visible, overlay.opacity])).toEqual([
            ['kh4-1966', false, 0.9],
            ['kh9-1980', true, 0.4],
            ['photos', true, 1],
            ['cladiri', true, 0.25],
            ['strazi', true, 0.8],
        ]);
        expect(state).toMatchObject({ selectedPhotoId: 'mihai-voda-1978', sheet: 'photo', locale: 'en' });
    });

    it('badPath_anUnknownPhotoIsReportedAndNothingElseChanges', () => {
        const applied = applyDecodedHash(loaded, decodeHash('#photo=nope', hashLimits(city)));

        expect(applied).toEqual({ state: loaded, unknownPhoto: 'nope' });
    });

    it('badPath_anEmptyHashChangesNothing', () => {
        expect(applyDecodedHash(loaded, decodeHash('', hashLimits(city))).state).toBe(loaded);
    });

    it('badPath_layersBeforeTheManifestAreIgnored', () => {
        const empty = initialState('ro', 'system', 'unknown');

        expect(applyDecodedHash(empty, { legacy: false, layers: ['kh4-1966'] }).state).toBe(empty);
    });

    it('happyPath_anUntouchedViewerWritesOnlyItsView', () => {
        expect(hashStateOf(loaded, 'ro')).toEqual({ view: loaded.view });
        expect(encodeViewerHash(loaded, 'ro')).toBe('#14.5/44.42704/26.0853');
    });

    it('happyPath_whatDiffersFromTheDefaultsIsWritten', () => {
        const overlays = withOverlayOpacity(withOverlayVisibility(loaded.overlays, 'kh4-1966', true), 'photos', 0.5);
        const state = { ...loaded, overlays, selectedPhotoId: 'mihai-voda-1978', locale: 'en' as const };

        expect(hashStateOf(state, 'ro')).toEqual({
            view: loaded.view,
            layers: ['kh4-1966'],
            overlayOpacity: { photos: 0.5 },
            photo: 'mihai-voda-1978',
            lang: 'en',
        });
    });

    it('happyPath_hidingADefaultLayerWritesAnEmptyLayerList', () => {
        const city1966 = manifest({ layers: [layer({ defaultVisible: true })] });
        const state = withManifest(initialState('ro', 'system', 'unknown'), city1966);

        expect(hashStateOf({ ...state, overlays: withOverlayVisibility(state.overlays, 'kh4-1966', false) }, 'ro').layers).toEqual([]);
        expect(hashStateOf(state, 'ro')).not.toHaveProperty('layers');
    });

    it('badPath_nothingIsEncodedBeforeTheManifest', () => {
        expect(encodeViewerHash(initialState('ro', 'system', 'unknown'), 'ro')).toBe('');
    });

    it('happyPath_overlaysOfAManifestRoundTrip', () => {
        const overlays = withOverlayOpacity(overlaysFromManifest(city), 'strazi', 0.1);
        const encoded = encodeViewerHash({ ...loaded, overlays }, 'ro');

        expect(applyDecodedHash(loaded, decodeHash(encoded, hashLimits(city))).state.overlays).toEqual(overlays);
    });
});

describe('HashWriter', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function location(hash = ''): { hash: string; written: string[]; replaceHash(next: string): void } {
        return {
            hash,
            written: [],
            replaceHash(next: string) {
                this.written.push(next);
                this.hash = next;
            },
        };
    }

    it('happyPath_writesOncePerDelayWithTheLatestState', () => {
        const target = location();
        let value = '#1';
        const writer = new HashWriter(target, () => value);

        writer.schedule();
        value = '#2';
        writer.schedule();
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(target.written).toEqual(['#2']);
    });

    it('badPath_anUnchangedHashIsNotWrittenAgain', () => {
        const target = location('#same');
        const writer = new HashWriter(target, () => '#same');

        writer.flush();

        expect(target.written).toEqual([]);
    });

    it('happyPath_flushWritesAtOnceAndCancelsThePendingWrite', () => {
        const target = location();
        const writer = new HashWriter(target, () => '#now');

        writer.schedule();
        writer.flush();
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(target.written).toEqual(['#now']);
    });

    it('badPath_aHashTheVisitorChangedMeanwhileIsNotOverwritten', () => {
        // S-V11-HAPPY found it: a write scheduled by a state change replaced a newly typed `#…&photo=` before its
        // hashchange reached the store.
        const target = location('#start');
        const writer = new HashWriter(target, () => '#state');
        writer.schedule();

        target.hash = '#typed';
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(target.written).toEqual([]);
        writer.schedule();
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);
        expect(target.written).toEqual(['#state']);
    });

    it('happyPath_syncAdoptsTheAddressBeforeItIsApplied', () => {
        const target = location('#start');
        const writer = new HashWriter(target, () => '#state');

        target.hash = '#typed';
        writer.sync();
        writer.flush();

        expect(target.written).toEqual(['#state']);
    });

    it('badPath_aCancelledWriteNeverHappens', () => {
        const target = location();
        const writer = new HashWriter(target, () => '#never');

        writer.schedule();
        writer.cancel();
        writer.cancel();
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS * 2);

        expect(target.written).toEqual([]);
    });
});
