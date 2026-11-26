// The scan pane's memory budget (the resource audit of 2026-11-12, S-A16-HAPPY-GEOREF-FULL-RES): a 16,384 × 4,096 px sharper scan
// (268 MiB of RGBA if it were decoded whole, as one JPEG was before) zoomed and panned from end to end keeps at most 32 tiles decoded,
// 128 MiB, none larger than a tile, and the page's JavaScript heap does not grow with the pan.
import { html } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defineHcmScanViewer, type HcmScanViewer } from '../../../src/admin/georef/hcm-scan-viewer.js';
import { SCAN_TILES_KEPT } from '../../../src/admin/georef/scan-tiles.js';
import { blankImage } from '../imagery/fixtures.js';
import { cleanup, mount, updated } from '../shell/fake-app.js';

defineHcmScanViewer();

const WIDTH = 16384;
const HEIGHT = 4096;
const TILE = 1024;
const MIB = 1024 * 1024;

/** One 1,024 px JPEG tile, used for every tile of the file (the budget is about decoded pixels, not their content). */
async function tileJpeg(): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = TILE;
    canvas.height = TILE;
    const context = canvas.getContext('2d');
    context?.fillRect(0, 0, TILE / 2, TILE / 2);
    return new Promise<Blob>((resolve) => {
        canvas.toBlob((blob) => {
            resolve(blob ?? new Blob());
        }, 'image/jpeg');
    });
}

/** A `scan-tiles.bin` of the whole picture: 16 columns by 4 rows. */
async function stripFile(): Promise<Blob> {
    const piece = await tileJpeg();
    const count = (WIDTH / TILE) * (HEIGHT / TILE);
    const first = 24 + 4 * (count + 1);
    const offsets = Array.from({ length: count + 1 }, (_, index) => first + index * piece.size);
    return new Blob([
        new Uint32Array([0x544d4348, 1, TILE, WIDTH, HEIGHT, count, ...offsets]),
        ...Array.from({ length: count }, () => piece),
    ]);
}

/** The JavaScript heap in use, in bytes (Chromium's `performance.memory`; 0 where the browser has none). */
function heapUsed(): number {
    return (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
}

describe('the scan pane within its memory budget', () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('happyPath_aLongStripPannedFromEndToEndKeepsAtMostTheBudgetDecoded @S-A16-HAPPY-GEOREF-FULL-RES', async () => {
        // Every bitmap the page decodes and every one it closes: what is live is the difference.
        const live = new Set<ImageBitmap>();
        const sizes: number[] = [];
        /** Each bitmap with its decoded bytes, read while it is open (a closed bitmap's size is 0). */
        const made: [ImageBitmap, number][] = [];
        const native = globalThis.createImageBitmap.bind(globalThis);
        vi.spyOn(globalThis, 'createImageBitmap').mockImplementation(async (...args: Parameters<typeof native>) => {
            const bitmap = await native(...args);
            live.add(bitmap);
            sizes.push(bitmap.width * bitmap.height);
            made.push([bitmap, bitmap.width * bitmap.height * 4]);
            return bitmap;
        });
        const closed = vi.spyOn(ImageBitmap.prototype, 'close');
        /** The bitmaps decoded and not closed since. */
        const open = (): ImageBitmap[] => {
            const gone = new Set<unknown>(closed.mock.contexts);
            return [...live].filter((bitmap) => !gone.has(bitmap));
        };
        const liveBytes = (): number => made.reduce((sum, [bitmap, bytes]) => sum + (open().includes(bitmap) ? bytes : 0), 0);

        // A laptop's half window: 960 × 600 CSS px; the preview is a quarter of the scan (4,096 px long).
        const element = await mount<HcmScanViewer>(
            html`<hcm-scan-viewer
                style="display: block; inline-size: 960px; block-size: 600px"
                .src=${blankImage()}
                .scanWidth=${WIDTH}
                .scanHeight=${HEIGHT}
                .previewScale=${0.25}
                .label=${'The scan'}
            ></hcm-scan-viewer>`,
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
        element.detail = { file: await stripFile(), scale: 1 };
        await updated(element);
        const before = heapUsed();
        const canvas = element.renderRoot.querySelector('canvas');
        const settle = async (): Promise<void> => {
            await new Promise((resolve) => setTimeout(resolve, 30));
        };
        let most = 0;

        // Three zooms (just past the preview, the sharper scan's own pixels, four times that), panned from end to end along both halves.
        for (const [scale, y] of [
            [0.3, 1000],
            [0.3, 3100],
            [1, 1000],
            [4, 3100],
        ] as const) {
            for (let x = 480; x < WIDTH; x += 900) {
                element.follow = { centre: { x, y }, scale };
                await updated(element);
                await settle();
                most = Math.max(most, liveBytes());
                expect(open().length).toBeLessThanOrEqual(SCAN_TILES_KEPT);
            }
        }

        expect(canvas).not.toBeNull();
        expect(sizes.length).toBeGreaterThan(SCAN_TILES_KEPT);
        expect(Math.max(...sizes)).toBeLessThanOrEqual(TILE * TILE);
        // At most 128 MiB decoded at any moment, where the whole picture is 256 MiB (and was decoded whole before).
        expect(most).toBeGreaterThan(0);
        expect(most).toBeLessThanOrEqual(SCAN_TILES_KEPT * TILE * TILE * 4);
        expect(most).toBeLessThanOrEqual(128 * MIB);
        expect(most).toBeLessThan(WIDTH * HEIGHT * 4);
        // The JavaScript heap holds the tiles' bookkeeping only: it does not grow by more than 32 MiB over the whole pan.
        expect(heapUsed() - before).toBeLessThan(32 * MIB);

        // The pane leaves the page: nothing stays decoded.
        element.remove();
        expect(open()).toEqual([]);
    });
});
