/**
 * A streaming ZIP writer over Node's own `zlib` (M5, `docs/research/M5-interfaces.md` §5.4; no dependency): each entry
 * is a local header with a data descriptor (its CRC-32 and sizes follow the data, so nothing is held in memory), DEFLATE
 * for text and STORE for files that are compressed already (WebP, GeoTIFF, WOFF2), the entries in name order with the
 * export's day as their time, then the central directory. No ZIP64: `EXPORT_LIMITS.maxBytes` keeps every size and
 * offset under 4 GiB, and a larger one throws (`ZipLimitError`) instead of writing a broken archive.
 */
import { Readable } from 'node:stream';
import { crc32, createDeflateRaw } from 'node:zlib';

/** How an entry's bytes are stored: DEFLATE (8) or as they are (0). */
export type ZipMethod = 'deflate' | 'store';

export interface ZipEntry {
    /** The path inside the archive: `/`-separated, relative, no `..`, no backslash. */
    readonly name: string;
    readonly method: ZipMethod;
    /** Opened when the writer reaches the entry, so only one entry's source is open at a time. */
    readonly body: () => AsyncIterable<Uint8Array>;
}

/** An archive would need ZIP64 (an entry or the archive over 4 GiB, or more than 65 535 entries). */
export class ZipLimitError extends Error {
    constructor(what: string) {
        super(`zip limit exceeded: ${what}`);
        this.name = 'ZipLimitError';
    }
}

const LOCAL_HEADER = 0x04034b50;
const DATA_DESCRIPTOR = 0x08074b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
/** Version 2.0: DEFLATE and data descriptors. */
const VERSION = 20;
/** Bit 3: CRC and sizes in the data descriptor; bit 11: names are UTF-8. */
const FLAGS = 0x0008 | 0x0800;
const METHOD_CODES: Readonly<Record<ZipMethod, number>> = { store: 0, deflate: 8 };
const MAX_32 = 0xffffffff;
const MAX_ENTRIES = 0xffff;

/** Extensions whose files are compressed already: DEFLATE would only cost time. */
const STORED_EXTENSIONS = ['.webp', '.tif', '.tiff', '.woff2', '.png', '.jpg', '.jpeg', '.zip'];

/** STORE for a file that is compressed already, DEFLATE for everything else. */
export function zipMethodFor(name: string): ZipMethod {
    const lower = name.toLowerCase();
    return STORED_EXTENSIONS.some((extension) => lower.endsWith(extension)) ? 'store' : 'deflate';
}

const UNSAFE_NAME = /(?:^\/|\\|(?:^|\/)\.\.(?:\/|$)|\/\/|\/$|^$)/;

function checkedName(name: string): Buffer {
    if (UNSAFE_NAME.test(name)) {
        throw new RangeError(`not a safe zip entry name: ${JSON.stringify(name)}`);
    }
    return Buffer.from(name, 'utf8');
}

/** The MS-DOS time and date of `at`'s UTC day at midnight: every entry of one export carries the same, fixed value. */
export function dosDateOf(at: Date): { readonly time: number; readonly date: number } {
    const year = Math.max(at.getUTCFullYear(), 1980) - 1980;
    return { time: 0, date: (year << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate() };
}

interface Written {
    readonly name: Buffer;
    readonly method: ZipMethod;
    readonly offset: number;
    readonly crc: number;
    readonly compressed: number;
    readonly size: number;
}

interface Tally {
    crc: number;
    size: number;
    compressed: number;
}

function within32(value: number, what: string): number {
    if (value > MAX_32) {
        throw new ZipLimitError(what);
    }
    return value;
}

function localHeader(name: Buffer, method: ZipMethod, stamp: { readonly time: number; readonly date: number }): Buffer {
    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL_HEADER, 0);
    header.writeUInt16LE(VERSION, 4);
    header.writeUInt16LE(FLAGS, 6);
    header.writeUInt16LE(METHOD_CODES[method], 8);
    header.writeUInt16LE(stamp.time, 10);
    header.writeUInt16LE(stamp.date, 12);
    // CRC-32 and both sizes stay zero here: the data descriptor after the data carries them (bit 3).
    header.writeUInt16LE(name.length, 26);
    return Buffer.concat([header, name]);
}

function dataDescriptor(tally: Tally): Buffer {
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(DATA_DESCRIPTOR, 0);
    descriptor.writeUInt32LE(tally.crc, 4);
    descriptor.writeUInt32LE(within32(tally.compressed, 'entry size'), 8);
    descriptor.writeUInt32LE(within32(tally.size, 'entry size'), 12);
    return descriptor;
}

function centralHeader(entry: Written, stamp: { readonly time: number; readonly date: number }): Buffer {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(CENTRAL_HEADER, 0);
    header.writeUInt16LE(VERSION, 4);
    header.writeUInt16LE(VERSION, 6);
    header.writeUInt16LE(FLAGS, 8);
    header.writeUInt16LE(METHOD_CODES[entry.method], 10);
    header.writeUInt16LE(stamp.time, 12);
    header.writeUInt16LE(stamp.date, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.compressed, 20);
    header.writeUInt32LE(entry.size, 24);
    header.writeUInt16LE(entry.name.length, 28);
    header.writeUInt32LE(within32(entry.offset, 'archive size'), 42);
    return Buffer.concat([header, entry.name]);
}

function endOfCentralDirectory(count: number, size: number, offset: number): Buffer {
    const end = Buffer.alloc(22);
    end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
    end.writeUInt16LE(count, 8);
    end.writeUInt16LE(count, 10);
    end.writeUInt32LE(within32(size, 'archive size'), 12);
    end.writeUInt32LE(within32(offset, 'archive size'), 16);
    return end;
}

/** The source's chunks as they pass, adding each to the entry's CRC-32 and uncompressed size. */
async function* counted(source: AsyncIterable<Uint8Array>, tally: Tally): AsyncGenerator<Uint8Array> {
    for await (const chunk of source) {
        tally.crc = crc32(chunk, tally.crc);
        tally.size += chunk.length;
        yield chunk;
    }
}

/** The entry's stored bytes: the source itself (STORE), or its raw DEFLATE stream. */
async function* storedBytes(entry: ZipEntry, tally: Tally): AsyncGenerator<Uint8Array> {
    const source = counted(entry.body(), tally);
    if (entry.method === 'store') {
        yield* source;
        return;
    }
    const input = Readable.from(source, { objectMode: false });
    const deflate = createDeflateRaw({ level: 9 });
    input.on('error', (error) => deflate.destroy(error));
    try {
        yield* input.pipe(deflate) as AsyncIterable<Uint8Array>;
    } finally {
        input.destroy();
        deflate.destroy();
    }
}

/** One entry: its local header, its data, its data descriptor; returns what the central directory needs. */
async function* entryBytes(entry: ZipEntry, offset: number, stamp: ReturnType<typeof dosDateOf>): AsyncGenerator<Uint8Array, Written> {
    const name = checkedName(entry.name);
    const header = localHeader(name, entry.method, stamp);
    yield header;
    const tally: Tally = { crc: 0, size: 0, compressed: 0 };
    for await (const chunk of storedBytes(entry, tally)) {
        tally.compressed += chunk.length;
        yield chunk;
    }
    yield dataDescriptor(tally);
    return { name, method: entry.method, offset, crc: tally.crc, compressed: tally.compressed, size: tally.size };
}

function byName(a: ZipEntry, b: ZipEntry): number {
    if (a.name === b.name) {
        throw new RangeError(`two zip entries named ${JSON.stringify(a.name)}`);
    }
    return a.name < b.name ? -1 : 1;
}

/**
 * The archive of `entries` (sorted by name; two with one name throw) as a stream of chunks, every entry dated at
 * `madeAt`'s UTC day. The consumer pulls: an entry's source is opened only when the writer reaches it.
 */
export async function* zipStream(entries: readonly ZipEntry[], madeAt: Date): AsyncGenerator<Uint8Array> {
    if (entries.length > MAX_ENTRIES) {
        throw new ZipLimitError('entry count');
    }
    const stamp = dosDateOf(madeAt);
    const written: Written[] = [];
    let offset = 0;
    for (const entry of [...entries].sort(byName)) {
        const bytes = entryBytes(entry, offset, stamp);
        let step = await bytes.next();
        while (step.done !== true) {
            offset += step.value.length;
            yield step.value;
            step = await bytes.next();
        }
        written.push(step.value);
    }
    const central = Buffer.concat(written.map((entry) => centralHeader(entry, stamp)));
    yield central;
    yield endOfCentralDirectory(written.length, central.length, offset);
}
