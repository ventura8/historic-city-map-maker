import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';

/**
 * The e2e's own ZIP reader (M5, `docs/research/M5-interfaces.md` §5.4, §5.7), apart from the writer it checks
 * (`functions/src/export/zip.ts`): it trusts the central directory and the local headers only, as `unzip` does, checks
 * every entry's CRC-32 and size, and inflates with `zlib.inflateRawSync`. The admin tier reads the archive the browser
 * downloaded (S-A53-HAPPY) with it; the starter-kit tier unpacks an export into a folder the site server serves (V28).
 */

export interface ZipFile {
    readonly name: string;
    /** 8: DEFLATE, 0: stored as it is. */
    readonly method: number;
    readonly bytes: Buffer;
}

const END_OF_DIRECTORY = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const CENTRAL_HEADER = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;

function entryAt(zip: Buffer, central: number): { readonly file: ZipFile; readonly next: number } {
    if (zip.readUInt32LE(central) !== CENTRAL_HEADER) {
        throw new Error(`the archive has no central header at ${String(central)}`);
    }
    const method = zip.readUInt16LE(central + 10);
    const crc = zip.readUInt32LE(central + 16);
    const compressed = zip.readUInt32LE(central + 20);
    const size = zip.readUInt32LE(central + 24);
    const nameLength = zip.readUInt16LE(central + 28);
    const local = zip.readUInt32LE(central + 42);
    const name = zip.toString('utf8', central + 46, central + 46 + nameLength);
    if (zip.readUInt32LE(local) !== LOCAL_HEADER) {
        throw new Error(`${name}: no local header where the directory says`);
    }
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const stored = zip.subarray(start, start + compressed);
    const bytes = method === 8 ? inflateRawSync(stored) : Buffer.from(stored);
    if (bytes.length !== size || crc32(bytes) !== crc) {
        throw new Error(`${name}: its size or its CRC-32 is not the directory's`);
    }
    const next = central + 46 + nameLength + zip.readUInt16LE(central + 30) + zip.readUInt16LE(central + 32);
    return { file: { name, method, bytes }, next };
}

/** Every file of the archive, in its central directory's order. */
export function unzip(zip: Buffer): ZipFile[] {
    const end = zip.lastIndexOf(END_OF_DIRECTORY);
    if (end < 0) {
        throw new Error('not a zip archive: no end of central directory');
    }
    const files: ZipFile[] = [];
    let central = zip.readUInt32LE(end + 16);
    for (let index = 0; index < zip.readUInt16LE(end + 10); index += 1) {
        const { file, next } = entryAt(zip, central);
        files.push(file);
        central = next;
    }
    return files;
}

/** Unpacks the archive into `folder` (an entry that would land outside it throws). */
export async function unzipInto(zip: Buffer, folder: string): Promise<string[]> {
    const root = normalize(folder);
    const files = unzip(zip);
    for (const file of files) {
        const target = normalize(join(root, file.name));
        if (!target.startsWith(`${root}${sep}`)) {
            throw new Error(`${file.name} would land outside ${folder}`);
        }
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.bytes);
    }
    return files.map((file) => file.name);
}
