import { crc32, deflateSync } from 'node:zlib';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GREY = 0;
const DEPTH = 8;

function chunk(name: string, data: Buffer): Buffer {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const named = Buffer.concat([Buffer.from(name, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(named));
    return Buffer.concat([head, named, crc]);
}

/**
 * A grey PNG of any shape (`packages/test-support`'s `solidPng` is square and for tiles): a browse image as long as USGS's
 * panoramic frames, whose pixels compress to almost nothing. Run in Node, as the upload past the rules is.
 */
export function greyPng(width: number, height: number): Uint8Array {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([DEPTH, GREY], 8);
    const rows = Buffer.alloc((width + 1) * height, 128);
    for (let row = 0; row < height; row += 1) {
        rows[row * (width + 1)] = 0;
    }
    return Buffer.concat([Buffer.from(SIGNATURE), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
