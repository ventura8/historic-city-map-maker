/**
 * Deterministic `.tgz` files for the install bundle (`docs/research/M6-interfaces.md` §1.3): POSIX ustar entries sorted
 * by path, every file mode 0644 (0755 for an executable), owner 0, one fixed time for every entry, gzip without a name or
 * time, written with Node's `zlib` (no dependency). Two builds of one commit give the same bytes, so the manifest's
 * SHA-256 names the content. Files only: `tar -x` makes their folders.
 */
import { gzipSync } from 'node:zlib';

export interface TarEntry {
    /** `/`-separated, relative, no `..`. */
    readonly path: string;
    readonly content: Uint8Array;
    readonly executable?: boolean;
}

const BLOCK = 512;
/** A record of 20 blocks, the size `tar` pads an archive to. */
const RECORD = BLOCK * 20;
const NAME_LENGTH = 100;
const PREFIX_LENGTH = 155;

const encoder = new TextEncoder();

function octal(value: number, width: number): string {
    return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

function bytes(text: string): number {
    return encoder.encode(text).length;
}

/** Refuses a path that is empty, absolute or climbs out of the archive. */
function checkRelative(path: string): void {
    if (path === '' || path.startsWith('/') || path.split('/').includes('..')) {
        throw new RangeError(`not a relative path: ${JSON.stringify(path)}`);
    }
}

/** Whether `path` split at the `/` at `at` fits ustar's `prefix` and `name`. */
function fitsAt(path: string, at: number): boolean {
    return bytes(path.slice(at + 1)) <= NAME_LENGTH && bytes(path.slice(0, at)) <= PREFIX_LENGTH;
}

/** `path` as ustar's `name` and `prefix` (a long path is split at a `/`); throws when it cannot fit. */
export function splitPath(path: string): { readonly name: string; readonly prefix: string } {
    checkRelative(path);
    if (bytes(path) <= NAME_LENGTH) {
        return { name: path, prefix: '' };
    }
    for (let at = path.lastIndexOf('/'); at > 0; at = path.lastIndexOf('/', at - 1)) {
        if (fitsAt(path, at)) {
            return { name: path.slice(at + 1), prefix: path.slice(0, at) };
        }
    }
    throw new RangeError(`a path too long for a tar entry: ${path}`);
}

function put(header: Uint8Array, offset: number, text: string): void {
    header.set(encoder.encode(text), offset);
}

/** One entry's 512-byte header. */
function header(entry: TarEntry, mtime: number): Uint8Array {
    const block = new Uint8Array(BLOCK);
    const { name, prefix } = splitPath(entry.path);
    put(block, 0, name);
    put(block, 100, octal(entry.executable === true ? 0o755 : 0o644, 8));
    put(block, 108, octal(0, 8));
    put(block, 116, octal(0, 8));
    put(block, 124, octal(entry.content.length, 12));
    put(block, 136, octal(mtime, 12));
    put(block, 148, '        ');
    put(block, 156, '0');
    put(block, 257, 'ustar\0');
    put(block, 263, '00');
    put(block, 345, prefix);
    const sum = block.reduce((total, byte) => total + byte, 0);
    put(block, 148, `${sum.toString(8).padStart(6, '0')}\0 `);
    return block;
}

function padded(length: number, to: number): number {
    return Math.ceil(length / to) * to;
}

/** Byte order, so the archive never depends on a locale. */
function byPath(left: TarEntry, right: TarEntry): number {
    if (left.path === right.path) {
        throw new RangeError(`the same path twice: ${left.path}`);
    }
    return left.path < right.path ? -1 : 1;
}

/** The uncompressed archive of `entries` (sorted by path), every entry dated `mtime` (seconds since the epoch). */
export function tarArchive(entries: readonly TarEntry[], mtime: number): Uint8Array {
    const sorted = [...entries].sort(byPath);
    const size = sorted.reduce((total, entry) => total + BLOCK + padded(entry.content.length, BLOCK), 0);
    const archive = new Uint8Array(padded(size + 2 * BLOCK, RECORD));
    let offset = 0;
    for (const entry of sorted) {
        archive.set(header(entry, mtime), offset);
        archive.set(entry.content, offset + BLOCK);
        offset += BLOCK + padded(entry.content.length, BLOCK);
    }
    return archive;
}

/** The `.tgz` of `entries`: the archive gzipped at the best level, with no name and no time in the gzip header. */
export function tgz(entries: readonly TarEntry[], mtime: number): Uint8Array {
    return new Uint8Array(gzipSync(tarArchive(entries, mtime), { level: 9 }));
}
