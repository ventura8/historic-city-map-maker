/**
 * A solid-colour PNG, encoded without a native library so the fakes stay environment-neutral (Node, the browser tests,
 * the e2e mock APIs): the published tiles of the fake MTS (mapbox-tiles.ts). Truecolour, 8 bits, one IDAT compressed
 * with the platform's `CompressionStream('deflate')` (zlib, as PNG wants).
 */

export type Rgb = readonly [red: number, green: number, blue: number];

/** Bytes on a plain `ArrayBuffer` (what `Blob`, `Response` and `fetch` take). */
export type Bytes = Uint8Array<ArrayBuffer>;

const CRC_TABLE: readonly number[] = Array.from({ length: 256 }, (_unused, index) => {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc & 1) === 1 ? 0xed_b8_83_20 ^ (crc >>> 1) : crc >>> 1;
    }
    return crc >>> 0;
});

function crc32(bytes: Bytes): number {
    let crc = 0xff_ff_ff_ff;
    for (const byte of bytes) {
        crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
    }
    return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

function uint32(value: number): Bytes {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value);
    return bytes;
}

function concat(parts: readonly Bytes[]): Bytes {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

function chunk(type: string, data: Bytes): Bytes {
    const typed = concat([new TextEncoder().encode(type), data]);
    return concat([uint32(data.length), typed, uint32(crc32(typed))]);
}

async function deflate(bytes: Bytes): Promise<Bytes> {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A `size` × `size` PNG filled with `colour`. */
export async function solidPng(size: number, colour: Rgb): Promise<Bytes> {
    const header = concat([uint32(size), uint32(size), new Uint8Array([8, 2, 0, 0, 0])]);
    const row = new Uint8Array(1 + size * 3);
    for (let pixel = 0; pixel < size; pixel += 1) {
        row.set(colour, 1 + pixel * 3);
    }
    const raw = new Uint8Array(row.length * size);
    for (let line = 0; line < size; line += 1) {
        raw.set(row, line * row.length);
    }
    return concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array(0))]);
}
