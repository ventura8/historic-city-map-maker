// The sharper scan's tiles (`scan-tiles.ts`): the file's layout, the tiles a view touches, and the cache that decodes only those and
// keeps at most `SCAN_TILES_KEPT` (S-A16-HAPPY-GEOREF-FULL-RES, S-A16-BAD-GEOREF-FULL-RES-NONE).
import { describe, expect, it, vi } from 'vitest';

import { DetailTiles } from '../../../src/admin/georef/scan-input.js';
import {
    detailScene,
    openDetail,
    readScanTiles,
    SCAN_TILES_KEPT,
    TileCache,
    tilesIn,
    type ScanTiles,
} from '../../../src/admin/georef/scan-tiles.js';

const MAGIC = 0x544d4348;

/** A tiles file of `sizes.length` tiles of those byte lengths. */
function fileOf(header: readonly number[], sizes: readonly number[]): Blob {
    const first = 24 + 4 * (sizes.length + 1);
    const offsets = sizes.reduce<number[]>((all, size) => [...all, (all.at(-1) ?? first) + size], [first]);
    return new Blob([new Uint32Array([...header, ...offsets]), ...sizes.map((size) => new Uint8Array(size).fill(7))]);
}

/** A 16,384 × 16,384 picture in tiles of 1,024 px: 256 tiles, none with any bytes worth decoding. */
function largest(): ScanTiles {
    return { tile: 1024, width: 16384, height: 16384, columns: 16, pieces: Array.from({ length: 256 }, () => new Blob(['t'])) };
}

/** The bitmaps closed so far. */
const counts = { closed: 0 };

class FakeBitmap {
    readonly width = 1024;
    readonly height = 1024;

    close(): void {
        counts.closed += 1;
    }
}

/** A decoder that counts, and answers at once with a 1,024 px bitmap. */
function decoder(): { readonly decode: (piece: Blob) => Promise<ImageBitmap>; readonly asked: Blob[] } {
    const asked: Blob[] = [];
    return {
        asked,
        decode: (piece) => {
            asked.push(piece);
            return Promise.resolve(new FakeBitmap() as unknown as ImageBitmap);
        },
    };
}

const settle = async (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('the tiles file', () => {
    it('happyPath_theFileIsReadAsItsTilesRowByRow @S-A16-HAPPY-GEOREF-FULL-RES', async () => {
        const tiles = await readScanTiles(fileOf([MAGIC, 1, 1024, 2500, 1100, 6], [10, 20, 30, 40, 50, 60]));

        expect(tiles).toMatchObject({ tile: 1024, width: 2500, height: 1100, columns: 3 });
        expect(tiles?.pieces.map((piece) => [piece.size, piece.type])).toEqual(
            [10, 20, 30, 40, 50, 60].map((size) => [size, 'image/jpeg']),
        );
        expect(await readScanTiles(fileOf([MAGIC, 1, 1024, 0, 0, 0], []))).toMatchObject({ pieces: [] });
    });

    it('badPath_anotherFileACutOneOrAWrongCountIsNotTiles @S-A16-BAD-GEOREF-FULL-RES-NONE', async () => {
        expect(await readScanTiles(new Blob(['short']))).toBeNull();
        expect(await readScanTiles(new Blob([new Uint8Array(64)]))).toBeNull();
        expect(await readScanTiles(fileOf([MAGIC, 2, 1024, 2500, 1100, 6], [1, 1, 1, 1, 1, 1]))).toBeNull();
        expect(await readScanTiles(fileOf([MAGIC, 1, 1024, 2500, 1100, 5], [1, 1, 1, 1, 1]))).toBeNull();
        expect(await readScanTiles(fileOf([MAGIC, 1, 0, 2500, 1100, 6], [1, 1, 1, 1, 1, 1]))).toBeNull();
        // The header says six tiles; the offsets were cut off.
        expect(await readScanTiles(fileOf([MAGIC, 1, 1024, 2500, 1100, 6], []).slice(0, 30))).toBeNull();
    });
});

describe('an opened sharper scan', () => {
    it('happyPath_aTilesFileOpensAndANotTilesFileDoesNot @S-A16-HAPPY-GEOREF-FULL-RES', async () => {
        const opened = await openDetail({ file: fileOf([MAGIC, 1, 1024, 2500, 1100, 6], [1, 1, 1, 1, 1, 1]), scale: 0.5 }, () => undefined);
        // The pieces are not pictures: asked for, never drawn; the scene is the tiles' scale and none decoded yet.
        expect(
            opened?.scene({ view: { scale: 4, offset: { x: 0, y: 0 } }, pane: { width: 200, height: 100 }, previewScale: 0.25, ratio: 1 }),
        ).toEqual({ scale: 0.5, pieces: [] });
        opened?.dispose();

        expect(await openDetail({ file: new Blob(['short']), scale: 1 }, () => undefined)).toBeNull();
    });
});

describe('the scan pane holds its sharper scan', () => {
    it('badPath_aDetailReplacedDroppedOrNotTilesWhileItOpensIsNeverDrawn @S-A16-BAD-GEOREF-FULL-RES-NONE', async () => {
        const holder = new DetailTiles();
        const view = { scale: 4, offset: { x: 0, y: 0 } };
        const pane = { width: 200, height: 100 };
        let changes = 0;
        const changed = (): void => {
            changes += 1;
        };
        const tiles = (): { file: Blob; scale: number } => ({
            file: fileOf([MAGIC, 1, 1024, 2500, 1100, 6], [1, 1, 1, 1, 1, 1]),
            scale: 1,
        });

        // Replaced while it opens: the first is closed when it arrives, the second is the pane's.
        holder.load(tiles(), changed);
        holder.load(tiles(), changed);
        // Waits for the second to open, however slow the machine (a fixed 50 ms failed under load).
        await vi.waitFor(() => {
            expect(holder.scene(view, pane, 0.25)).toEqual({ scale: 1, pieces: [] });
        });
        // Not a tiles file: nothing to draw. Dropped while it opens: closed when it arrives.
        holder.load({ file: new Blob(['short']), scale: 1 }, changed);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(holder.scene(view, pane, 0.25)).toBeNull();
        holder.load(tiles(), changed);
        holder.drop();
        holder.load(null, changed);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(holder.scene(view, pane, 0.25)).toBeNull();
        expect(changes).toBe(4);
    });
});

describe('the tiles in view', () => {
    it('happyPath_aBoxTouchesOnlyItsTiles @S-A16-HAPPY-GEOREF-FULL-RES', () => {
        const tiles = largest();

        expect(tilesIn(tiles, { left: 0, top: 0, right: 1024, bottom: 1024 })).toEqual([0]);
        expect(tilesIn(tiles, { left: 1000, top: 1000, right: 2100, bottom: 1100 })).toEqual([0, 1, 2, 16, 17, 18]);
        expect(tilesIn(tiles, { left: -500, top: 15000, right: 300, bottom: 99999 })).toEqual([224, 240]);
    });

    it('badPath_aBoxOffThePictureTouchesNone @S-A16-BAD-GEOREF-FULL-RES-NONE', () => {
        expect(tilesIn(largest(), { left: 20000, top: 0, right: 21000, bottom: 500 })).toEqual([]);
        expect(tilesIn(largest(), { left: 0, top: -900, right: 500, bottom: -100 })).toEqual([]);
        expect(tilesIn({ tile: 1024, width: 0, height: 0, columns: 0, pieces: [] }, { left: 0, top: 0, right: 9, bottom: 9 })).toEqual([]);
    });
});

describe('the decoded tiles', () => {
    it('happyPath_aLaptopPaneDecodesOnlyItsTilesAndPanningKeepsAtMostTheBudget @S-A16-HAPPY-GEOREF-FULL-RES', async () => {
        counts.closed = 0;
        const tiles = largest();
        const { decode, asked } = decoder();
        let changes = 0;
        const cache = new TileCache(
            tiles,
            () => {
                changes += 1;
            },
            decode,
        );
        const shown = { tiles, cache, scale: 1 };
        // A 1,280 × 800 CSS px pane on a screen of two device px a CSS px; the preview is a quarter of the scan (4,096 px).
        const pane = { width: 1280, height: 800 };
        const scene = (scale: number, x: number): ReturnType<typeof detailScene> =>
            detailScene(shown, { view: { scale, offset: { x, y: 0 } }, pane, previewScale: 0.25, ratio: 2 });

        // Just past one device pixel a preview pixel: 2,560 preview px across, 4 × that in the sharper scan would be 10 × 7 tiles.
        expect(scene(0.51, 0)).toEqual({ scale: 1, pieces: [] });
        expect(asked).toHaveLength(0);

        // Zoomed in until at most the budget is in view: decoded, each tile once, 1,024 px a side (4 MiB of RGBA each).
        expect(scene(1.2, 0)?.pieces).toEqual([]);
        await settle();
        const first = scene(1.2, 0)?.pieces ?? [];
        expect(first).toHaveLength(asked.length);
        expect(asked.length).toBeGreaterThan(0);
        expect(asked.length).toBeLessThanOrEqual(SCAN_TILES_KEPT);
        expect(first[1]).toMatchObject({ x: 1024, y: 0 });
        expect(changes).toBe(asked.length);

        // Panned across the whole scan: never more than the budget decoded at once (about 128 MiB), the rest closed.
        for (let x = 0; x > -4096 * 1.2; x -= 400) {
            scene(1.2, x);
            await settle();
            expect(cache.size).toBeLessThanOrEqual(SCAN_TILES_KEPT);
            expect(cache.size * 1024 * 1024 * 4).toBeLessThanOrEqual(128 * 1024 * 1024);
        }
        expect(counts.closed).toBeGreaterThan(0);
        // Back at the start: its tiles were closed, and are decoded again.
        const before = asked.length;
        scene(1.2, 0);
        await settle();
        expect(asked.length).toBeGreaterThan(before);

        const kept = cache.size;
        const closedBefore = counts.closed;
        cache.dispose();
        expect([cache.size, counts.closed - closedBefore]).toEqual([0, kept]);
    });

    it('badPath_noTilesAPlainZoomATileThatFailsOrOneLateAfterTheEndDrawNothing @S-A16-BAD-GEOREF-FULL-RES-NONE', async () => {
        counts.closed = 0;
        const tiles = largest();
        const pane = { width: 400, height: 300 };
        const view = { scale: 4, offset: { x: 0, y: 0 } };
        expect(detailScene(null, { view, pane, previewScale: 0.25, ratio: 1 })).toBeNull();

        let failures = 0;
        const failing = new TileCache(
            tiles,
            () => undefined,
            () => {
                failures += 1;
                return Promise.reject(new Error('not a picture'));
            },
        );
        // One device pixel a preview pixel or less: the preview is enough.
        expect(
            detailScene(
                { tiles, cache: failing, scale: 1 },
                { view: { scale: 1, offset: { x: 0, y: 0 } }, pane, previewScale: 0.25, ratio: 1 },
            ),
        ).toBeNull();
        expect(detailScene({ tiles, cache: failing, scale: 1 }, { view, pane, previewScale: 0.25, ratio: 1 })).toEqual({
            scale: 1,
            pieces: [],
        });
        await settle();
        // A tile that does not decode is not asked for again, and a tile the file does not have is not asked for at all.
        expect(detailScene({ tiles, cache: failing, scale: 1 }, { view, pane, previewScale: 0.25, ratio: 1 })).toEqual({
            scale: 1,
            pieces: [],
        });
        expect(failing.show([9999])).toEqual([]);
        expect(failures).toBe(1);

        const { decode } = decoder();
        let changes = 0;
        const late = new TileCache(
            tiles,
            () => {
                changes += 1;
            },
            decode,
        );
        late.show([0, 1]);
        late.dispose();
        await settle();
        expect([late.size, changes, counts.closed]).toEqual([0, 0, 2]);
    });
});
