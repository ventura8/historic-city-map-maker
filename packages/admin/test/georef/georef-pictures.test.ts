import { fitTransform, type FittedTransform } from '@hcm/shared';
import { describe, expect, it, vi } from 'vitest';

import {
    deviceRatio,
    GeorefPictures,
    loadWarp,
    REFERENCE_PICTURE,
    referenceOf,
    WARP_DELAY_MS,
    WARPED_PICTURE,
    type WarpLoader,
} from '../../src/georef/georef-pictures.js';
import type { GeorefVersion, ScanDetail, ScanImage } from '../../src/georef/state.js';
import { PictureOverlays } from '../../src/imagery/overlay.js';
import { FakeClock, settle } from '../app/fakes.js';
import { mapboxHandle } from '../imagery/maps.js';
import { FakeFiles, FakePictures } from '../imagery/world.js';
import { pair } from './fixtures.js';

const SCAN = { width: 1000, height: 500, previewScale: 0.5, previewPath: 'v/scan-preview.jpg', detail: null };
const DETAIL = { path: 'v/scan-tiles.bin', scale: 1 };
/** The warp chunk, fetched once before the tests. */
const WARP = await loadWarp();
const LOADED: WarpLoader = () => Promise.resolve(WARP);
const REFERENCE = {
    bounds: [
        [26, 44.4],
        [26.2, 44.5],
    ] as const,
    osmPath: 'v/reference-osm.png',
    s2Path: 'v/reference-s2.jpg',
    s2Date: '2025-08-03',
};

function version(overrides: Partial<GeorefVersion> = {}): GeorefVersion {
    return {
        id: 'v1',
        layerId: 'l',
        label: { ro: 'Scan' },
        state: 'needs_gcps',
        scan: SCAN,
        reference: REFERENCE,
        crop: null,
        editable: true,
        opening: null,
        ...overrides,
    };
}

function fitted(): FittedTransform {
    const result = fitTransform('affine', [pair('g1', 0, 0), pair('g2', 1000, 0), pair('g3', 1000, 500), pair('g4', 0, 500)]);
    if (!result.ok) {
        throw new Error(result.reason);
    }
    return result.transform;
}

async function setup(pictures: FakePictures | null = new FakePictures(), warp: WarpLoader = LOADED) {
    const { handle, native } = await mapboxHandle();
    const files = new FakeFiles();
    const clock = new FakeClock();
    const scans: ScanImage[] = [];
    const details: (ScanDetail | null)[] = [];
    const overlays = new PictureOverlays(() => handle.port);
    const shown = new GeorefPictures({
        ...{ files, pictures, clock, overlays, scan: (image) => scans.push(image) },
        detail: (detail) => details.push(detail),
        warp,
    });
    for (const path of [SCAN.previewPath, REFERENCE.osmPath, REFERENCE.s2Path]) {
        files.put(path);
    }
    return { shown, files, clock, scans, details, overlays, native, pictures };
}

describe('the references a version offers', () => {
    it('happyPath_theOneAskedForElseOpenStreetMapElseSentinel2ElseNone', () => {
        expect(referenceOf(version(), null)?.kind).toBe('osm');
        expect(referenceOf(version(), 's2')).toMatchObject({ kind: 's2', path: REFERENCE.s2Path });
        expect(referenceOf(version({ reference: { ...REFERENCE, osmPath: null } }), 'osm')?.kind).toBe('s2');
        expect(referenceOf(version({ reference: { ...REFERENCE, osmPath: null, s2Path: null } }), null)).toBeNull();
        expect(referenceOf(version({ reference: null }), 'osm')).toBeNull();
    });
});

describe('the georeferencer pictures', () => {
    it('happyPath_theScanThenTheReferenceThenTheWarpedPreviewOncePerFrame', async () => {
        const { shown, clock, scans, overlays, native, pictures } = await setup();

        shown.load(version(), 's2');
        shown.load(version(), 's2');
        await settle();
        shown.warp(fitted(), SCAN, 0.6);
        shown.warp(fitted(), SCAN, 0.7);
        clock.advance(WARP_DELAY_MS);
        shown.warp(fitted(), SCAN, 0.7);
        clock.advance(WARP_DELAY_MS);
        shown.setOpacity(0.3);

        expect(scans).toEqual([{ status: 'loading' }, { status: 'ready', url: `blob:${SCAN.previewPath}` }]);
        expect(shown.reference).toBe('s2');
        expect([overlays.has(REFERENCE_PICTURE), overlays.has(WARPED_PICTURE)]).toEqual([true, true]);
        expect(pictures?.drawn).toHaveLength(2);
        expect(pictures?.drawn[0]?.target).toBe(pictures?.drawn[1]?.target);
        expect(native.paint.get('hcm-picture-layer-warped')?.['raster-opacity']).toBeCloseTo(0.3, 9);
    });

    it('happyPath_theOpenStreetMapLinesAreNotDrawnOverTheBaseMap', async () => {
        const { shown, overlays } = await setup();

        shown.load(version(), 'osm');
        await settle();

        expect([shown.reference, overlays.has(REFERENCE_PICTURE)]).toEqual(['osm', false]);
    });

    it('happyPath_switchingTheReferenceAndARefusedFitTakeThePreviewOff', async () => {
        const { shown, clock, overlays, native } = await setup();
        shown.load(version(), null);
        await settle();

        shown.load(version(), 's2');
        await settle();
        shown.warp(null, SCAN, 1);
        clock.advance(WARP_DELAY_MS);

        expect(shown.reference).toBe('s2');
        expect(native.sources.get('hcm-picture-reference')).toBeDefined();
        shown.load(version({ reference: null }), 's2');
        await settle();
        expect([shown.reference, overlays.has(REFERENCE_PICTURE)]).toEqual([null, false]);
        expect(overlays.has(WARPED_PICTURE)).toBe(false);
    });

    it('badPath_noScanNoReadableScanOrNoDecoderShowsNoPreview', async () => {
        const blind = await setup(null);
        blind.shown.load(version(), null);
        await settle();
        blind.shown.warp(fitted(), SCAN, 1);
        blind.clock.advance(WARP_DELAY_MS);
        const scanless = await setup();
        scanless.shown.load(version({ id: 'v2', scan: null, reference: null }), null);
        const missing = await setup();
        missing.files.objects.delete(SCAN.previewPath);
        missing.shown.load(version(), null);
        await settle();

        const unreadable = await setup();
        unreadable.files.objects.delete(REFERENCE.osmPath);
        unreadable.shown.load(version(), null);
        await settle();

        expect(unreadable.overlays.has(REFERENCE_PICTURE)).toBe(false);
        expect(blind.overlays.has(WARPED_PICTURE)).toBe(false);
        expect(scanless.scans).toEqual([{ status: 'none' }]);
        expect(missing.scans.at(-1)).toEqual({ status: 'failed' });
    });

    it('happyPath_picturesDecodedBeforeTheMapGoOnItOnceItIsReady', async () => {
        const { handle, native } = await mapboxHandle();
        let ready = false;
        const overlays = new PictureOverlays(() => (ready ? handle.port : null));
        const files = new FakeFiles();
        const clock = new FakeClock();
        const shown = new GeorefPictures({
            ...{ files, pictures: new FakePictures(), clock, overlays },
            ...{ scan: () => undefined, detail: () => undefined, warp: LOADED },
        });
        for (const path of [SCAN.previewPath, REFERENCE.s2Path]) {
            files.put(path);
        }
        shown.load(version(), 's2');
        shown.warp(fitted(), SCAN, 0.7);
        clock.advance(WARP_DELAY_MS);
        await settle();
        expect([overlays.has(REFERENCE_PICTURE), overlays.has(WARPED_PICTURE)]).toEqual([false, false]);

        shown.mapStatus('loading');
        ready = true;
        shown.mapStatus('ready');
        await settle();

        expect([overlays.has(REFERENCE_PICTURE), overlays.has(WARPED_PICTURE)]).toEqual([true, true]);
        expect(native.sources.get('hcm-picture-warped')).toBeDefined();
        shown.load(version({ id: 'v4', reference: null }), null);
        shown.clear();
        shown.mapStatus('ready');
        expect(overlays.has(WARPED_PICTURE)).toBe(false);
    });

    it('happyPath_clearingReleasesTheScanAndDropsALateOne', async () => {
        const { shown, files, clock, scans } = await setup();
        shown.load(version(), null);
        await settle();
        shown.warp(fitted(), SCAN, 1);

        shown.clear();
        clock.advance(WARP_DELAY_MS);
        files.hold = true;
        shown.load(version({ id: 'v3' }), null);
        await settle();
        shown.clear();
        files.hold = false;
        files.flush();
        await settle();

        expect(files.released).toEqual([`blob:${SCAN.previewPath}`, `blob:${SCAN.previewPath}`]);
        expect(scans.at(-1)).toEqual({ status: 'none' });
    });
});

describe('a version whose picture changes (LESSONS 759)', () => {
    it('happyPath_aRelayoutsNewRevisionLoadsThePictureAgainWithoutAReload @S-A-HAPPY-GEOREF-RELAYOUT-REFRESH', async () => {
        const { shown, files, scans, details } = await setup();
        const first = { ...SCAN, detail: null, revision: 2 };
        shown.load(version({ scan: first }), null);
        await settle();
        shown.load(version({ scan: { ...first, revision: 3, width: 1200 } }), null);
        await settle();

        expect(files.released).toEqual([`blob:${SCAN.previewPath}`]);
        expect(details).toEqual([null]);
        expect(scans.filter((scan) => scan.status === 'ready')).toHaveLength(2);
    });

    it('badPath_theSamePictureIsNotLoadedAgainAndAnOldLoadStillOnItsWayIsDropped @S-A-BAD-GEOREF-RELAYOUT-SAME', async () => {
        const { shown, files, scans } = await setup();
        files.hold = true;
        shown.load(version({ scan: { ...SCAN, revision: 1 } }), null);
        shown.load(version({ scan: { ...SCAN, revision: 2 } }), null);
        shown.load(version({ scan: { ...SCAN, revision: 2 } }), null);
        files.hold = false;
        files.flush();
        await settle();

        expect(scans.filter((scan) => scan.status === 'loading')).toHaveLength(2);
        expect(scans.filter((scan) => scan.status === 'ready')).toHaveLength(1);
    });
});

describe('the warped preview on a small window', () => {
    it('happyPath_onAPhoneSizedWindowTheWarpedPreviewIsHalfAsLong', async () => {
        const { shown, clock, pictures } = await setup();
        const side = (): number => {
            const target = pictures?.drawn.at(-1)?.target;
            return Math.max(target?.width ?? 0, target?.height ?? 0);
        };

        shown.load(version(), 's2');
        await settle();
        shown.warp(fitted(), SCAN, 0.6);
        clock.advance(WARP_DELAY_MS);
        expect(side()).toBe(4096);

        // A 360 CSS px window: 2048 px, 16 MiB of canvas instead of up to 64.
        vi.stubGlobal('innerWidth', 360);
        shown.warp(fitted(), SCAN, 0.6);
        clock.advance(WARP_DELAY_MS);
        expect(side()).toBe(2048);
        vi.unstubAllGlobals();
    });
});

describe('the warp chunk', () => {
    it('badPath_aWarpChunkThatFailsToLoadDrawsNoPreviewAndIsAskedForAgainAtTheNextDraw', async () => {
        let attempts = 0;
        const flaky: WarpLoader = () => {
            attempts += 1;
            return attempts === 1 ? Promise.reject(new TypeError('Failed to fetch dynamically imported module')) : Promise.resolve(WARP);
        };
        const { shown, clock, overlays } = await setup(new FakePictures(), flaky);

        shown.load(version(), 's2');
        await settle();
        shown.warp(fitted(), SCAN, 0.6);
        clock.advance(WARP_DELAY_MS);
        await settle();

        expect(attempts).toBe(2);
        expect(overlays.has(WARPED_PICTURE)).toBe(true);
    });
});

describe('the sharper scan (S-A16-HAPPY-GEOREF-FULL-RES)', () => {
    const DETAILED = { ...SCAN, detail: DETAIL };

    it('happyPath_zoomedPastThePreviewsOwnPixelsTheTilesFileIsFetchedOnceAndDroppedOnClear @S-A16-HAPPY-GEOREF-FULL-RES', async () => {
        const { shown, files, details } = await setup();
        files.put(DETAIL.path);

        // At the preview's own pixels (0.5 CSS px a scan pixel here) and below: the preview is enough, nothing is fetched.
        shown.zoomed(DETAILED, 0.5, 1);
        await settle();
        expect(details).toEqual([]);

        shown.zoomed(DETAILED, 0.8, 1);
        shown.zoomed(DETAILED, 2, 1);
        await settle();
        expect(details).toEqual([{ file: files.objects.get(DETAIL.path), scale: 1 }]);
        shown.zoomed(DETAILED, 4, 1);
        await settle();
        expect(details).toHaveLength(1);

        shown.clear();
        expect(details.at(-1)).toBeNull();
    });

    it('happyPath_onAHiDpiScreenTheDetailIsFetchedFromHalfTheZoom @S-A16-HAPPY-GEOREF-FULL-RES', async () => {
        const { shown, files, details } = await setup();
        files.put(DETAIL.path);

        // 0.3 CSS px a scan pixel: below the preview's 0.5 on a plain screen, past it at two device px a CSS px.
        shown.zoomed(DETAILED, 0.3, 1);
        await settle();
        expect(details).toEqual([]);
        shown.zoomed(DETAILED, 0.3, 2);
        await settle();
        expect(details).toEqual([{ file: files.objects.get(DETAIL.path), scale: 1 }]);
    });

    it('happyPath_theScreensRatioIsAtLeastOneAndOneWithoutAScreen @S-A16-HAPPY-GEOREF-FULL-RES', () => {
        expect(deviceRatio()).toBeGreaterThanOrEqual(1);
        vi.stubGlobal('devicePixelRatio', 2);
        expect(deviceRatio()).toBe(2);
        vi.stubGlobal('devicePixelRatio', 0.5);
        expect(deviceRatio()).toBe(1);
        vi.stubGlobal('devicePixelRatio', undefined);
        expect(deviceRatio()).toBe(1);
        vi.unstubAllGlobals();
    });

    it('badPath_noDetailOrAFailedFetchLeavesThePreviewAndAClearedPageDropsALateOne @S-A16-BAD-GEOREF-FULL-RES-NONE', async () => {
        const { shown, files, details } = await setup();

        // A short scan (or an older version) has none; a missing file keeps the preview; neither is said as an error.
        shown.zoomed(SCAN, 4, 1);
        shown.zoomed(null, 4, 1);
        shown.zoomed(DETAILED, 4, 1);
        await settle();
        expect(details).toEqual([]);

        shown.clear();
        files.put(DETAIL.path);
        files.hold = true;
        shown.zoomed(DETAILED, 4, 1);
        shown.clear();
        files.flush();
        await settle();
        expect(details).toEqual([null, null]);
    });
});
