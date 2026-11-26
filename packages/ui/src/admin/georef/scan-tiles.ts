/**
 * The georeferencer's sharper scan as tiles (`docs/research/M3-interfaces.md` §10.4): `scan-tiles.bin` holds the scan at up to
 * 16,384 px long as JPEG tiles of 1,024 px, because a browser decodes a JPEG whole (about 1 GiB of RGBA at that size). The scan
 * pane decodes only the tiles it shows and keeps at most `SCAN_TILES_KEPT` of them (4 MiB each: about 128 MiB), closing the ones
 * it shows no more; a view that would need more than that draws the preview. The file's layout is the pipeline's
 * (`pipeline/src/hcm_pipeline/scan_tiles.py`): `HCMT`, five little-endian `uint32` (format version, tile side, width, height,
 * tile count), one `uint32` per tile plus one (each tile's first byte, row by row, then the file's length), the JPEG tiles.
 * A lazy chunk of its own (`scan-tiles`): `<hcm-scan-viewer>` fetches it when a version's sharper scan first arrives.
 */
import { paneToScan, type ScanView, type Size } from './scan-view.js';

/** At most this many decoded tiles are kept, and drawn at once. */
export const SCAN_TILES_KEPT = 32;

/** `HCMT` read as a little-endian `uint32`. */
const MAGIC = 0x544d4348;
const FORMAT_VERSION = 1;
const HEADER_BYTES = 24;
const WORD = 4;

/** The sharper scan's tiles: the whole picture's size, the tile's side and each tile's JPEG, row by row. */
export interface ScanTiles {
    readonly tile: number;
    readonly width: number;
    readonly height: number;
    readonly columns: number;
    readonly pieces: readonly Blob[];
}

/** A decoded tile at its place in the sharper scan's pixels. */
export interface ScanPiece {
    readonly image: CanvasImageSource;
    readonly x: number;
    readonly y: number;
}

/** What the scan pane draws over the preview: the decoded tiles in view and their pixels per scan pixel. */
export interface ScanDetailScene {
    readonly scale: number;
    readonly pieces: readonly ScanPiece[];
}

interface Header {
    readonly tile: number;
    readonly width: number;
    readonly height: number;
    readonly count: number;
}

/** A tile side above zero, and as many tiles as the picture's size needs. */
function fits({ tile, width, height, count }: Header): boolean {
    return tile > 0 && count === Math.ceil(width / tile) * Math.ceil(height / tile);
}

/** `count` little-endian `uint32` from `start`; null when the file ends before them. */
async function words(file: Blob, start: number, count: number): Promise<readonly number[] | null> {
    const bytes = await file.slice(start, start + count * WORD).arrayBuffer();
    if (bytes.byteLength < count * WORD) {
        return null;
    }
    const view = new DataView(bytes);
    return Array.from({ length: count }, (_, index) => view.getUint32(index * WORD, true));
}

async function headerOf(file: Blob): Promise<Header | null> {
    const bytes = await file.slice(0, HEADER_BYTES).arrayBuffer();
    if (bytes.byteLength < HEADER_BYTES) {
        return null;
    }
    const view = new DataView(bytes);
    const word = (index: number): number => view.getUint32(index * WORD, true);
    const header = { tile: word(2), width: word(3), height: word(4), count: word(5) };
    return word(0) === MAGIC && word(1) === FORMAT_VERSION && fits(header) ? header : null;
}

/** The tiles of a `scan-tiles.bin`; null when the file is not one (another format, cut short, a tile count that does not fit). */
export async function readScanTiles(file: Blob): Promise<ScanTiles | null> {
    const header = await headerOf(file);
    const offsets = header === null ? null : await words(file, HEADER_BYTES, header.count + 1);
    if (header === null || offsets === null) {
        return null;
    }
    const pieces = offsets.slice(1).map((end, index) => file.slice(offsets[index], end, 'image/jpeg'));
    return { tile: header.tile, width: header.width, height: header.height, columns: Math.ceil(header.width / header.tile), pieces };
}

/** A box in the sharper scan's pixels. */
export interface TileBox {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}

/** The first and one past the last tile a span of pixels touches, within `count` tiles. */
function span(from: number, to: number, tile: number, count: number): readonly [number, number] {
    return [Math.max(0, Math.floor(from / tile)), Math.min(count, Math.ceil(to / tile))];
}

/** The tiles a box touches, row by row (none for a box off the picture). */
export function tilesIn(tiles: ScanTiles, box: TileBox): readonly number[] {
    const [firstColumn, endColumn] = span(box.left, box.right, tiles.tile, tiles.columns);
    const [firstRow, endRow] = span(box.top, box.bottom, tiles.tile, tiles.pieces.length / Math.max(tiles.columns, 1));
    const found: number[] = [];
    for (let row = firstRow; row < endRow; row += 1) {
        for (let column = firstColumn; column < endColumn; column += 1) {
            found.push(row * tiles.columns + column);
        }
    }
    return found;
}

/** Decodes one tile (`createImageBitmap` by default; a seam for the tests). */
export type TileDecoder = (piece: Blob) => Promise<ImageBitmap>;

const decodeTile: TileDecoder = async (piece) => createImageBitmap(piece);

/** The decoded tiles: the ones in view are decoded once, the oldest ones out of view are closed past `SCAN_TILES_KEPT`. */
export class TileCache {
    readonly #tiles: ScanTiles;
    readonly #changed: () => void;
    readonly #decode: TileDecoder;
    /** Decoded tiles, the least recently shown first. */
    readonly #decoded = new Map<number, ImageBitmap>();
    /** Tiles asked for: being decoded, decoded, or failed (a tile that does not decode is not asked for again). */
    readonly #asked = new Set<number>();
    #wanted: readonly number[] = [];
    #disposed = false;

    constructor(tiles: ScanTiles, changed: () => void, decode: TileDecoder = decodeTile) {
        this.#tiles = tiles;
        this.#changed = changed;
        this.#decode = decode;
    }

    /** The decoded tiles kept now. */
    get size(): number {
        return this.#decoded.size;
    }

    /** The decoded tiles among `wanted`, the rest asked for; none at all when the view needs more than `SCAN_TILES_KEPT`. */
    show(wanted: readonly number[]): readonly ScanPiece[] {
        if (wanted.length > SCAN_TILES_KEPT) {
            return [];
        }
        this.#wanted = wanted;
        return wanted.flatMap((index) => this.#piece(index));
    }

    dispose(): void {
        this.#disposed = true;
        for (const bitmap of this.#decoded.values()) {
            bitmap.close();
        }
        this.#decoded.clear();
    }

    #piece(index: number): readonly ScanPiece[] {
        const image = this.#decoded.get(index);
        if (image === undefined) {
            this.#ask(index);
            return [];
        }
        // Shown again: the last to be closed.
        this.#decoded.delete(index);
        this.#decoded.set(index, image);
        const { tile, columns } = this.#tiles;
        return [{ image, x: (index % columns) * tile, y: Math.floor(index / columns) * tile }];
    }

    #ask(index: number): void {
        const piece = this.#tiles.pieces[index];
        if (piece === undefined || this.#asked.has(index)) {
            return;
        }
        this.#asked.add(index);
        void this.#decode(piece).then(
            (bitmap) => {
                this.#keep(index, bitmap);
            },
            () => undefined,
        );
    }

    #keep(index: number, bitmap: ImageBitmap): void {
        if (this.#disposed) {
            bitmap.close();
            return;
        }
        this.#decoded.set(index, bitmap);
        this.#trim();
        this.#changed();
    }

    /** Closes the oldest tiles out of view until at most `SCAN_TILES_KEPT` are kept (a closed tile is decoded again when shown). */
    #trim(): void {
        for (const [index, bitmap] of this.#decoded) {
            if (this.#decoded.size <= SCAN_TILES_KEPT) {
                return;
            }
            if (!this.#wanted.includes(index)) {
                bitmap.close();
                this.#decoded.delete(index);
                this.#asked.delete(index);
            }
        }
    }
}

/** The sharper scan a pane holds: its tiles, their cache and its pixels per scan pixel. */
export interface ShownTiles {
    readonly tiles: ScanTiles;
    readonly cache: TileCache;
    readonly scale: number;
}

/** A pane's view of the scan: where the preview sits, the pane's CSS px, the preview's scale and the screen's device px a CSS px. */
export interface SceneCamera {
    readonly view: ScanView;
    readonly pane: Size;
    readonly previewScale: number;
    readonly ratio: number;
}

/**
 * What to draw of the sharper scan in a pane: nothing until a preview pixel covers more than one device pixel (a HiDPI screen
 * upscales the preview from half the zoom), then the decoded tiles the pane shows.
 */
export function detailScene(shown: ShownTiles | null, { view, pane, previewScale, ratio }: SceneCamera): ScanDetailScene | null {
    if (shown === null || view.scale * ratio <= 1) {
        return null;
    }
    // The pane's corners in the sharper scan's pixels (a turned pane covers their bounding box).
    const corners = [0, pane.width].flatMap((x) => [0, pane.height].map((y) => paneToScan(view, { x, y }, previewScale / shown.scale)));
    const [xs, ys] = [corners.map((corner) => corner.x), corners.map((corner) => corner.y)];
    const box = { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
    return { scale: shown.scale, pieces: shown.cache.show(tilesIn(shown.tiles, box)) };
}

/** The sharper scan a pane has open: what to draw of it for a view, and its end (the decoded tiles closed). */
export interface OpenDetail {
    scene(camera: SceneCamera): ScanDetailScene | null;
    dispose(): void;
}

/** Opens a sharper scan's file; `changed` hears each tile decoded. Null when the file is not a tiles file. */
export async function openDetail(detail: { readonly file: Blob; readonly scale: number }, changed: () => void): Promise<OpenDetail | null> {
    const tiles = await readScanTiles(detail.file);
    if (tiles === null) {
        return null;
    }
    const shown = { tiles, cache: new TileCache(tiles, changed), scale: detail.scale };
    return {
        scene: (camera) => detailScene(shown, camera),
        dispose: () => {
            shown.cache.dispose();
        },
    };
}
