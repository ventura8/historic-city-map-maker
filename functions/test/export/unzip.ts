/**
 * A small ZIP reader for the export's tests, independent of the writer under test: it trusts only the central directory
 * and the local headers (as `unzip` does), checks every CRC-32 and size, and inflates with `zlib.inflateRawSync`.
 */
import { crc32, inflateRawSync } from 'node:zlib';

export interface ZipFile {
    readonly name: string;
    readonly method: number;
    readonly flags: number;
    readonly date: number;
    readonly bytes: Buffer;
}

function endOfDirectory(zip: Buffer): number {
    const at = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (at < 0) {
        throw new Error('no end of central directory');
    }
    return at;
}

function fileAt(zip: Buffer, central: number): { readonly file: ZipFile; readonly next: number } {
    if (zip.readUInt32LE(central) !== 0x02014b50) {
        throw new Error(`no central header at ${String(central)}`);
    }
    const method = zip.readUInt16LE(central + 10);
    const crc = zip.readUInt32LE(central + 16);
    const compressed = zip.readUInt32LE(central + 20);
    const size = zip.readUInt32LE(central + 24);
    const nameLength = zip.readUInt16LE(central + 28);
    const local = zip.readUInt32LE(central + 42);
    const name = zip.toString('utf8', central + 46, central + 46 + nameLength);
    if (zip.readUInt32LE(local) !== 0x04034b50 || zip.toString('utf8', local + 30, local + 30 + nameLength) !== name) {
        throw new Error(`the local header of ${name} does not match`);
    }
    const start = local + 30 + nameLength + zip.readUInt16LE(local + 28);
    const stored = zip.subarray(start, start + compressed);
    const bytes = method === 8 ? inflateRawSync(stored) : Buffer.from(stored);
    if (bytes.length !== size || crc32(bytes) !== crc) {
        throw new Error(`${name}: its size or CRC-32 does not match`);
    }
    const file = { name, method, flags: zip.readUInt16LE(central + 8), date: zip.readUInt16LE(central + 14), bytes };
    return { file, next: central + 46 + nameLength + zip.readUInt16LE(central + 30) + zip.readUInt16LE(central + 32) };
}

/** Every file of `zip` in central-directory order. */
export function unzip(zip: Buffer): ZipFile[] {
    const end = endOfDirectory(zip);
    const count = zip.readUInt16LE(end + 10);
    let central = zip.readUInt32LE(end + 16);
    const files: ZipFile[] = [];
    for (let index = 0; index < count; index += 1) {
        const { file, next } = fileAt(zip, central);
        files.push(file);
        central = next;
    }
    return files;
}

/** The files of `zip` by name, as text. */
export function zipTexts(zip: Buffer): Record<string, string> {
    return Object.fromEntries(unzip(zip).map((file) => [file.name, file.bytes.toString('utf8')]));
}
