/**
 * A small PMTiles v3 writer for the tests (`docs/research/M12-own-tiles.md`): it knows only the specification, none of the reader's code, so
 * the reader's tests read what a stranger wrote. It runs in the browser project and in Node (`CompressionStream` in both). The same `data`
 * object given to many tiles is stored once, so a solid-colour pyramid stays small however many tiles it names.
 */
export interface ArchiveTile {
    readonly z: number;
    readonly x: number;
    readonly y: number;
    readonly data: Uint8Array;
}

export interface ArchiveOptions {
    /** `[west, south, east, north]`. */
    readonly bounds?: readonly [number, number, number, number];
    readonly minzoom?: number;
    readonly maxzoom?: number;
    /** Entries per leaf directory: the root then points at leaves, as a large archive's does. */
    readonly perLeaf?: number;
}

interface Entry {
    readonly id: number;
    readonly offset: number;
    readonly length: number;
    readonly run: number;
}

const HEADER_BYTES = 127;
const E7 = 1e7;
const GZIP = 2;
const NONE = 1;
const WEBP = 4;

/** The Hilbert id of the specification's reference implementation. */
export function archiveTileId(z: number, x: number, y: number): number {
    let acc = (4 ** z - 1) / 3;
    let [column, row] = [x, y];
    const size = 2 ** z;
    for (let half = size / 2; half >= 1; half /= 2) {
        const rx = Math.floor(column / half) % 2;
        const ry = Math.floor(row / half) % 2;
        acc += half * half * ((3 * rx) ^ ry);
        if (ry === 0) {
            [column, row] = rx === 1 ? [size - 1 - row, size - 1 - column] : [row, column];
        }
    }
    return acc;
}

function varint(out: number[], value: number): void {
    let rest = value;
    while (rest >= 0x80) {
        out.push((rest % 0x80) + 0x80);
        rest = Math.floor(rest / 0x80);
    }
    out.push(rest);
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([bytes.slice()]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

function follows(entries: readonly Entry[], index: number): boolean {
    const before = entries[index - 1];
    const entry = entries[index];
    return before !== undefined && entry?.offset === before.offset + before.length;
}

function directory(entries: readonly Entry[]): Promise<Uint8Array> {
    const out: number[] = [];
    varint(out, entries.length);
    entries.forEach((entry, index) => {
        varint(out, entry.id - (entries[index - 1]?.id ?? 0));
    });
    for (const entry of entries) {
        varint(out, entry.run);
    }
    for (const entry of entries) {
        varint(out, entry.length);
    }
    entries.forEach((entry, index) => {
        varint(out, follows(entries, index) ? 0 : entry.offset + 1);
    });
    return gzip(new Uint8Array(out));
}

function joined(parts: readonly Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }
    return out;
}

/** Every tile in Hilbert order, the same `data` object stored once. */
function entriesOf(tiles: readonly ArchiveTile[]): { readonly entries: readonly Entry[]; readonly blobs: readonly Uint8Array[] } {
    const stored = new Map<Uint8Array, number>();
    const blobs: Uint8Array[] = [];
    let end = 0;
    const entries = [...tiles]
        .map((tile) => ({ ...tile, id: archiveTileId(tile.z, tile.x, tile.y) }))
        .sort((a, b) => a.id - b.id)
        .map((tile) => {
            let offset = stored.get(tile.data);
            if (offset === undefined) {
                offset = end;
                stored.set(tile.data, offset);
                blobs.push(tile.data);
                end += tile.data.length;
            }
            return { id: tile.id, offset, length: tile.data.length, run: 1 };
        });
    return { entries, blobs };
}

async function leavesOf(entries: readonly Entry[], perLeaf: number): Promise<{ readonly root: Uint8Array; readonly leaves: Uint8Array }> {
    const parts: Uint8Array[] = [];
    const pointers: Entry[] = [];
    let at = 0;
    for (let start = 0; start < entries.length; start += perLeaf) {
        const part = entries.slice(start, start + perLeaf);
        const leaf = await directory(part);
        pointers.push({ id: part[0]?.id ?? 0, offset: at, length: leaf.length, run: 0 });
        parts.push(leaf);
        at += leaf.length;
    }
    return { root: await directory(pointers), leaves: joined(parts) };
}

function header(
    sizes: { readonly root: number; readonly leaves: number; readonly tiles: number; readonly count: number },
    options: ArchiveOptions,
): Uint8Array {
    const bytes = new Uint8Array(HEADER_BYTES);
    const view = new DataView(bytes.buffer);
    bytes.set(new TextEncoder().encode('PMTiles'));
    view.setUint8(7, 3);
    const numbers = [HEADER_BYTES, sizes.root, HEADER_BYTES + sizes.root, 0, HEADER_BYTES + sizes.root, sizes.leaves];
    numbers.push(HEADER_BYTES + sizes.root + sizes.leaves, sizes.tiles, sizes.count, sizes.count, sizes.count);
    numbers.forEach((value, index) => {
        view.setBigUint64(8 + index * 8, BigInt(value), true);
    });
    [1, GZIP, NONE, WEBP, options.minzoom ?? 0, options.maxzoom ?? 0].forEach((value, index) => {
        view.setUint8(96 + index, value);
    });
    (options.bounds ?? [0, 0, 0, 0]).forEach((value, index) => {
        view.setInt32(102 + index * 4, Math.round(value * E7), true);
    });
    return bytes;
}

export async function pmtilesArchive(tiles: readonly ArchiveTile[], options: ArchiveOptions = {}): Promise<Uint8Array> {
    const { entries, blobs } = entriesOf(tiles);
    const { root, leaves } =
        options.perLeaf === undefined
            ? { root: await directory(entries), leaves: new Uint8Array() }
            : await leavesOf(entries, options.perLeaf);
    const data = joined(blobs);
    const sizes = { root: root.length, leaves: leaves.length, tiles: data.length, count: entries.length };
    return joined([header(sizes, options), root, leaves, data]);
}

/** A byte-range server for the tests: `206` and the range asked for, as Cloud Storage answers. */
export function rangeResponse(
    archive: Uint8Array,
    range: string | null,
): { readonly status: number; readonly body: Uint8Array; readonly range: string | null } {
    const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? '');
    if (match === null) {
        return { status: 200, body: archive, range: null };
    }
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), archive.length - 1);
    return { status: 206, body: archive.slice(start, end + 1), range: `bytes ${String(start)}-${String(end)}/${String(archive.length)}` };
}
