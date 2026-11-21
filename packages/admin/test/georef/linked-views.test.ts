// The georeferencer's linked views (S-A16-HAPPY-GEOREF-LINKED, S-A16-BAD-GEOREF-LINKED-NO-FIT): the scan's place and zoom go to
// the map through the fit and back through its inverse, once a frame, with no echo, and not while linking is off, there is no fit
// or a point is being dragged.
import { fitTransform, WEB_MERCATOR_RADIUS_M, type FittedTransform } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { mapToScan, metresPerPixel, scanToMap, ViewLink, type MapCamera, type ScanCamera } from '../../src/georef/linked-views.js';
import { pair } from './fixtures.js';

/** The fixtures' exact map: 2 Web Mercator metres a scan pixel. */
function fitted(): FittedTransform {
    const result = fitTransform('affine', [pair('g1', 0, 0), pair('g2', 1000, 0), pair('g3', 1000, 500), pair('g4', 0, 500)]);
    if (!result.ok) {
        throw new Error(result.reason);
    }
    return result.transform;
}

/** The zoom at which one CSS pixel of Mapbox's 512-pixel tiles spans `metres` Web Mercator metres. */
function zoomFor(metres: number): number {
    return Math.log2((2 * Math.PI * WEB_MERCATOR_RADIUS_M) / (512 * metres));
}

interface Harness {
    readonly link: ViewLink;
    readonly maps: MapCamera[];
    readonly scans: ScanCamera[];
    readonly frames: (() => void)[];
    readonly flags: { active: boolean; transform: FittedTransform | null };
    /** Runs the frames waiting (the browser's next animation frame). */
    readonly flush: () => void;
}

/** A link whose map plays its own `move` back at once, as Mapbox does on a jump. */
function harness(): Harness {
    const maps: MapCamera[] = [];
    const scans: ScanCamera[] = [];
    const frames: (() => void)[] = [];
    const flags = { active: true, transform: fitted() as FittedTransform | null };
    const link: ViewLink = new ViewLink({
        transform: () => flags.transform,
        active: () => flags.active,
        moveMap: (camera) => {
            maps.push(camera);
            link.map(camera);
        },
        moveScan: (camera) => {
            scans.push(camera);
        },
        frame: (run) => {
            frames.push(run);
        },
    });
    const flush = (): void => {
        for (const run of frames.splice(0)) {
            run();
        }
    };
    return { link, maps, scans, frames, flags, flush };
}

describe('the linked views', () => {
    it('happyPath_theScansCentreAndZoomGoToTheMapThroughTheFitAndBack @S-A16-HAPPY-GEOREF-LINKED', () => {
        const transform = fitted();
        const camera = scanToMap(transform, { centre: { x: 250, y: 100 }, scale: 1 });
        const geo = transform.toGeo({ x: 250, y: 100 });

        expect(metresPerPixel(transform, { x: 250, y: 100 })).toBeCloseTo(2, 6);
        expect(camera?.center[0]).toBeCloseTo(geo.lng, 9);
        expect(camera?.center[1]).toBeCloseTo(geo.lat, 9);
        expect(camera?.zoom).toBeCloseTo(zoomFor(2), 6);
        // Twice the zoom on the scan is one zoom level more on the map; the map's place comes back to the same pixel and scale.
        expect(scanToMap(transform, { centre: { x: 250, y: 100 }, scale: 2 })?.zoom).toBeCloseTo(zoomFor(2) + 1, 6);
        const back = mapToScan(transform, camera ?? { center: [0, 0], zoom: 0 });
        expect(back?.centre.x).toBeCloseTo(250, 6);
        expect(back?.centre.y).toBeCloseTo(100, 6);
        expect(back?.scale).toBeCloseTo(1, 6);
    });

    it('happyPath_onceAFrameTheLatestMoveOnlyAndTheMapsOwnEchoIsNotSentBack @S-A16-HAPPY-GEOREF-LINKED', () => {
        const { link, maps, scans, frames, flush } = harness();
        // The map has moved before (Mapbox's first `move`): the jump's own `move` below is a real change of its camera.
        link.map({ center: [26, 44.4], zoom: 12 });

        link.scan({ centre: { x: 10, y: 10 }, scale: 1 });
        link.scan({ centre: { x: 500, y: 250 }, scale: 4 });
        expect(frames).toHaveLength(1);
        flush();

        // One jump of the map, to the latest scan move; the map's `move` it caused moved nothing back.
        expect(maps).toHaveLength(1);
        expect(maps[0]?.zoom).toBeCloseTo(zoomFor(2) + 2, 6);
        expect(scans).toEqual([]);
        expect(frames).toEqual([]);

        // The owner then moves the map: the scan follows it.
        const there = scanToMap(fitted(), { centre: { x: 900, y: 50 }, scale: 0.5 });
        link.map(there ?? { center: [0, 0], zoom: 0 });
        flush();
        expect(scans).toHaveLength(1);
        expect(scans[0]?.centre.x).toBeCloseTo(900, 6);
        expect(scans[0]?.scale).toBeCloseTo(0.5, 6);
    });

    it('badPath_noFitLinkingOffOrAPointDraggedMovesNothing @S-A16-BAD-GEOREF-LINKED-NO-FIT', () => {
        const { link, maps, scans, flags, flush } = harness();
        link.map({ center: [26, 44.4], zoom: 12 });

        flags.transform = null;
        link.scan({ centre: { x: 10, y: 10 }, scale: 1 });
        link.map({ center: [26.1, 44.4], zoom: 12 });
        flush();
        flags.transform = fitted();
        flags.active = false;
        link.scan({ centre: { x: 10, y: 10 }, scale: 1 });
        link.map({ center: [26.2, 44.4], zoom: 12 });
        flush();

        expect([maps, scans]).toEqual([[], []]);
    });

    it('badPath_aMapMoveThatLeavesItsCameraWhereItWasOrTheFirstOneMovesNothing @S-A16-BAD-GEOREF-LINKED-NO-FIT', () => {
        const { link, scans, frames } = harness();

        link.map({ center: [26, 44.4], zoom: 12 });
        link.map({ center: [26, 44.4], zoom: 12 });

        expect([scans, frames]).toEqual([[], []]);
    });

    it('badPath_aPlaceTheFitCannotMapMovesNothing @S-A16-BAD-GEOREF-LINKED-NO-FIT', () => {
        const { link, maps, scans, flags, flush } = harness();
        const nowhere: FittedTransform = {
            kind: 'affine',
            toGeo: () => ({ lat: Number.NaN, lng: Number.NaN }),
            toPixel: () => ({ x: Number.NaN, y: 0 }),
        };
        flags.transform = nowhere;
        link.map({ center: [26, 44.4], zoom: 12 });

        link.scan({ centre: { x: 10, y: 10 }, scale: 1 });
        flush();
        link.map({ center: [26.1, 44.4], zoom: 12 });
        flush();

        expect([maps, scans]).toEqual([[], []]);
        expect(scanToMap(nowhere, { centre: { x: 1, y: 1 }, scale: 1 })).toBeNull();
        expect(mapToScan(nowhere, { center: [26, 44], zoom: 3 })).toBeNull();
        // A fit that puts the whole scan on one place spans nothing there: no scale to show it at.
        const point: FittedTransform = { kind: 'affine', toGeo: () => ({ lat: 44.4, lng: 26.1 }), toPixel: () => ({ x: 5, y: 5 }) };
        expect(mapToScan(point, { center: [26, 44], zoom: 3 })).toBeNull();
    });
});
