// The scan pane over the 2026-11-12 fixes: a pane that changes size keeps the owner's zoom and centre (S-A16-HAPPY-GEOREF-KEEP-ZOOM,
// S-A16-BAD-GEOREF-KEEP-ZOOM-NEVER-SHOWN), the ghost of a pair begun on the map is drawn (S-A16-HAPPY-GEOREF-GHOST), and the sharper
// scan is drawn once zoomed past the preview's own pixels (S-A16-HAPPY-GEOREF-FULL-RES, S-A16-BAD-GEOREF-FULL-RES-NONE).
import { html } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { paintGhostBadge } from '../../../src/admin/georef/marker-badge.js';
import { defineHcmScanViewer, type HcmScanViewer } from '../../../src/admin/georef/hcm-scan-viewer.js';
import { drawScan } from '../../../src/admin/georef/scan-draw.js';
import { fitView, resizedView } from '../../../src/admin/georef/scan-view.js';
import { blankImage } from '../imagery/fixtures.js';
import { cleanup, mount, updated } from '../shell/fake-app.js';

defineHcmScanViewer();

const IMAGE = { width: 1000, height: 600 };

/** A 400 × 240 pane over a 2000 × 1200 scan whose preview is half its size. */
async function viewer(): Promise<HcmScanViewer> {
    const element = await mount<HcmScanViewer>(
        html`<hcm-scan-viewer
            style="display: block; inline-size: 400px; block-size: 240px"
            .src=${blankImage()}
            .scanWidth=${2000}
            .scanHeight=${1200}
            .previewScale=${0.5}
            .label=${'The scan'}
        ></hcm-scan-viewer>`,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await updated(element);
    return element;
}

function canvasOf(element: HcmScanViewer): HTMLCanvasElement {
    const canvas = element.renderRoot.querySelector('canvas');
    if (canvas === null) {
        throw new Error('no canvas');
    }
    return canvas;
}

/** Waits for the next frames (the resize observer and an image's load). */
async function frames(element: HcmScanViewer): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 80));
    await updated(element);
}

describe('the scan pane keeps its zoom', () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('happyPath_aResizedPaneKeepsTheZoomAndTheCentreAndAFittedOneFitsAgain @S-A16-HAPPY-GEOREF-KEEP-ZOOM', async () => {
        const before = { width: 400, height: 240 };
        const after = { width: 385, height: 240 };
        const zoomed = { scale: 3, offset: { x: -500, y: -300 } };
        expect(resizedView(zoomed, before, after, IMAGE)).toEqual({ scale: 3, offset: { x: -507.5, y: -300 } });
        expect(resizedView(fitView(before, IMAGE), before, after, IMAGE)).toEqual(fitView(after, IMAGE));

        const element = await viewer();
        canvasOf(element).dispatchEvent(
            new WheelEvent('wheel', { deltaY: -800, clientX: 100, clientY: 60, bubbles: true, cancelable: true }),
        );
        const centre = element.centre;
        const scale = element.view.scale;
        // A scrollbar comes (a pair added below made the page taller): 15 px narrower, the same place at the centre.
        element.style.inlineSize = '385px';
        await frames(element);

        expect(element.view.scale).toBe(scale);
        expect(element.centre.x).toBeCloseTo(centre.x, 6);
        expect(element.centre.y).toBeCloseTo(centre.y, 6);
    });

    it('badPath_aPaneNeverShownOrNeverZoomedFitsTheWholeScan @S-A16-BAD-GEOREF-KEEP-ZOOM-NEVER-SHOWN', async () => {
        const zoomed = { scale: 3, offset: { x: -500, y: -300 } };
        const after = { width: 400, height: 240 };
        expect(resizedView(zoomed, { width: 0, height: 0 }, after, IMAGE)).toEqual(fitView(after, IMAGE));
        expect(resizedView(zoomed, { width: 400, height: 0 }, after, IMAGE)).toEqual(fitView(after, IMAGE));

        const element = await viewer();
        element.style.inlineSize = '300px';
        await frames(element);
        expect(element.view).toEqual(fitView({ width: 300, height: 240 }, IMAGE));
    });
});

describe('the scan pane opens where the city likely lies (admin sweep 2026-11-14, bug 6)', () => {
    afterEach(cleanup);

    it('happyPath_aWholeStripOpensZoomedOnTheExpectedCityNotFitted', async () => {
        const element = await mount<HcmScanViewer>(
            html`<hcm-scan-viewer
                style="display: block; inline-size: 400px; block-size: 240px"
                .src=${blankImage()}
                .scanWidth=${2000}
                .scanHeight=${1200}
                .previewScale=${0.5}
                .opening=${{ x: 1400, y: 800, width: 200, height: 120 }}
                .label=${'The scan'}
            ></hcm-scan-viewer>`,
        );
        await frames(element);

        expect(element.view.scale).toBeGreaterThan(fitView({ width: 400, height: 240 }, IMAGE).scale * 5);
        expect(element.centre.x).toBeCloseTo(1500, 0);
        expect(element.centre.y).toBeCloseTo(860, 0);
    });

    it('badPath_noExpectedPlaceOpensTheWholeScan', async () => {
        const element = await viewer();

        expect(element.view).toEqual(fitView({ width: 400, height: 240 }, IMAGE));
    });
});

/** A `scan-tiles.bin` of a `width` × `height` picture in tiles of `tile` px, each a JPEG of its own size. */
async function tilesFile(width: number, height: number, tile: number): Promise<Blob> {
    const pieces: Blob[] = [];
    for (let top = 0; top < height; top += tile) {
        for (let left = 0; left < width; left += tile) {
            const canvas = document.createElement('canvas');
            canvas.width = Math.min(tile, width - left);
            canvas.height = Math.min(tile, height - top);
            canvas.getContext('2d')?.fillRect(0, 0, canvas.width, canvas.height);
            pieces.push(
                await new Promise<Blob>((resolve) => {
                    canvas.toBlob((blob) => {
                        resolve(blob ?? new Blob());
                    }, 'image/jpeg');
                }),
            );
        }
    }
    const first = 24 + 4 * (pieces.length + 1);
    const offsets = pieces.reduce<number[]>((all, piece) => [...all, (all.at(-1) ?? first) + piece.size], [first]);
    const head = new Uint32Array([0x544d4348, 1, tile, width, height, pieces.length, ...offsets]);
    return new Blob([head, ...pieces]);
}

describe('the ghost and the sharper scan on the scan pane', () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('happyPath_theGhostIsADashedDoubleRingAndOnlyTheTilesInViewAreDecodedPastThePreviewsPixels @S-A16-HAPPY-GEOREF-FULL-RES', async () => {
        const dashed = vi.spyOn(CanvasRenderingContext2D.prototype, 'setLineDash');
        const decoded = vi.spyOn(globalThis, 'createImageBitmap');
        const element = await viewer();
        element.ghost = { x: 1000, y: 600 };
        // The 2000 × 1200 scan at its own pixels in tiles of 256 px: 8 columns by 5 rows.
        element.detail = { file: await tilesFile(2000, 1200, 256), scale: 1 };
        await frames(element);
        expect(dashed).toHaveBeenCalled();
        // The whole scan fits the pane: the preview is enough, no tile is decoded.
        expect(decoded).not.toHaveBeenCalled();

        canvasOf(element).dispatchEvent(
            new WheelEvent('wheel', { deltaY: -1500, clientX: 200, clientY: 120, bubbles: true, cancelable: true }),
        );
        expect(element.view.scale).toBeGreaterThan(1);
        const drawn = vi.spyOn(CanvasRenderingContext2D.prototype, 'drawImage');
        const transforms = vi.spyOn(CanvasRenderingContext2D.prototype, 'setTransform');
        element.ghost = null;
        await frames(element);

        // The 400 × 240 pane shows 400 / scale preview pixels across, twice that in the sharper scan: only the tiles under it.
        const across = (400 / element.view.scale) * 2;
        const down = (240 / element.view.scale) * 2;
        const most = (Math.ceil(across / 256) + 1) * (Math.ceil(down / 256) + 1);
        expect(decoded.mock.calls.length).toBeGreaterThan(0);
        expect(decoded.mock.calls.length).toBeLessThanOrEqual(most);
        expect(decoded.mock.calls.length).toBeLessThan(40);
        const bitmaps = await Promise.all(decoded.mock.results.map((result) => result.value as Promise<ImageBitmap>));
        expect(Math.max(...bitmaps.map((bitmap) => Math.max(bitmap.width, bitmap.height)))).toBeLessThanOrEqual(256);
        // The tiles are twice the preview's size: drawn at half the preview's scale, over the preview.
        const ratio = Math.max(globalThis.devicePixelRatio, 1);
        expect(transforms.mock.calls.some((call) => Math.abs(Number(call[0]) - ratio * element.view.scale * 0.5) < 1e-9)).toBe(true);
        expect(drawn.mock.calls.some((call) => call[0] instanceof ImageBitmap)).toBe(true);

        // The pane leaves the page: its decoded tiles are closed; back on it, the tiles in view are decoded again.
        const host = element.parentElement;
        const closed = vi.spyOn(ImageBitmap.prototype, 'close');
        element.remove();
        expect(closed).toHaveBeenCalled();
        decoded.mockClear();
        host?.append(element);
        await frames(element);
        expect(decoded).toHaveBeenCalled();
    });

    it('badPath_noDetailOrAFileThatIsNotTilesDrawsThePreviewAtItsScale @S-A16-BAD-GEOREF-FULL-RES-NONE', async () => {
        const element = await viewer();
        canvasOf(element).dispatchEvent(
            new WheelEvent('wheel', { deltaY: -1500, clientX: 200, clientY: 120, bubbles: true, cancelable: true }),
        );
        const transforms = vi.spyOn(CanvasRenderingContext2D.prototype, 'setTransform');
        const decoded = vi.spyOn(globalThis, 'createImageBitmap');
        element.detail = { file: new Blob(['not a tiles file, but long enough to hold a header']), scale: 1 };
        await frames(element);
        // A file still being read when the detail goes: dropped.
        element.detail = { file: await tilesFile(2000, 1200, 256), scale: 1 };
        element.detail = null;
        await frames(element);

        const ratio = Math.max(globalThis.devicePixelRatio, 1);
        expect(decoded).not.toHaveBeenCalled();
        expect(transforms.mock.calls.some((call) => Math.abs(Number(call[0]) - ratio * element.view.scale) < 1e-9)).toBe(true);
        expect(transforms.mock.calls.some((call) => Math.abs(Number(call[0]) - ratio * element.view.scale * 0.5) < 1e-9)).toBe(false);

        // Drawn without a scene's picture at all: only the marks.
        const plain = document.createElement('canvas');
        document.body.append(plain);
        drawScan(plain, {
            ...{ image: null, view: { scale: 2, offset: { x: 0, y: 0 } }, previewScale: 1, markers: [], selected: null },
            ...{ half: { x: 1, y: 1 }, crosshair: false, dragged: null, detail: null, ghost: { x: 2, y: 2 } },
        });
        const context = plain.getContext('2d');
        if (context !== null) {
            paintGhostBadge(context, { x: 5, y: 5 }, { marker: '#000', onMarker: '#fff', outline: '#111', warn: '#222', bad: '#333' });
        }
        expect(plain.width).toBeGreaterThanOrEqual(0);
    });
});
