/**
 * Mapbox glyph ranges (`/fonts/v1/<owner>/<fontstack>/<start>-<end>.pbf`), generated instead of vendored: every
 * printable code point is the same box, drawn as a signed distance field, so labels and cluster counts render as rows
 * of boxes with a stable advance. No font file, no licence question, byte-identical on every run.
 *
 * Protocol buffer layout (mapbox/glyph-pbf-composite): `glyphs { repeated fontstack stacks = 1 }`,
 * `fontstack { name = 1, range = 2, repeated glyph glyphs = 3 }`,
 * `glyph { id = 1, bitmap = 2, width = 3, height = 4, left = 5 (sint32), top = 6 (sint32), advance = 7 }`.
 */

/** Glyph box size in pixels at Mapbox's 24 px SDF size, and the SDF border every bitmap carries on each side. */
const BOX_WIDTH = 12;
const BOX_HEIGHT = 16;
const BORDER = 3;
const ADVANCE = 14;
const TOP = -6;
/** Mapbox SDF encoding: 192 (of 255) on the outline, 8 px of distance across the ramp. */
const SDF_CUTOFF = 0.25;
const SDF_RADIUS = 8;
export const RANGE_SIZE = 256;

const WIRE_VARINT = 0;
const WIRE_BYTES = 2;

function varint(value: number): number[] {
    const bytes: number[] = [];
    let rest = value;
    while (rest > 0x7f) {
        bytes.push((rest & 0x7f) | 0x80);
        rest = Math.floor(rest / 128);
    }
    bytes.push(rest);
    return bytes;
}

function zigzag(value: number): number {
    return value < 0 ? -2 * value - 1 : 2 * value;
}

function key(field: number, wire: number): number[] {
    return varint((field << 3) | wire);
}

function numberField(field: number, value: number): number[] {
    return [...key(field, WIRE_VARINT), ...varint(value)];
}

function bytesField(field: number, bytes: readonly number[] | Uint8Array): number[] {
    return [...key(field, WIRE_BYTES), ...varint(bytes.length), ...bytes];
}

function textField(field: number, text: string): number[] {
    return bytesField(field, new TextEncoder().encode(text));
}

/** Signed distance from a pixel centre to the box (negative inside). */
function distanceToBox(x: number, y: number): number {
    const dx = Math.max(BORDER - x, 0, x - (BORDER + BOX_WIDTH));
    const dy = Math.max(BORDER - y, 0, y - (BORDER + BOX_HEIGHT));
    const outside = Math.hypot(dx, dy);
    const inside = Math.min(x - BORDER, BORDER + BOX_WIDTH - x, y - BORDER, BORDER + BOX_HEIGHT - y);
    return outside > 0 ? outside : -inside;
}

function boxBitmap(): Uint8Array {
    const width = BOX_WIDTH + 2 * BORDER;
    const height = BOX_HEIGHT + 2 * BORDER;
    const bitmap = new Uint8Array(width * height);
    for (let index = 0; index < bitmap.length; index += 1) {
        const distance = distanceToBox((index % width) + 0.5, Math.floor(index / width) + 0.5);
        bitmap[index] = Math.max(0, Math.min(255, Math.round(255 - 255 * (distance / SDF_RADIUS + SDF_CUTOFF))));
    }
    return bitmap;
}

const BOX = boxBitmap();

/** Control characters and whitespace have no box; whitespace still advances. */
function isDrawn(codePoint: number): boolean {
    return codePoint > 0x20 && !(codePoint >= 0x7f && codePoint <= 0xa0);
}

function glyph(codePoint: number): number[] {
    const box = isDrawn(codePoint);
    const fields = [
        ...numberField(1, codePoint),
        ...(box ? bytesField(2, BOX) : []),
        ...numberField(3, box ? BOX_WIDTH : 0),
        ...numberField(4, box ? BOX_HEIGHT : 0),
        ...numberField(5, zigzag(box ? 1 : 0)),
        ...numberField(6, zigzag(TOP)),
        ...numberField(7, codePoint === 0x20 || box ? ADVANCE : 0),
    ];
    return bytesField(3, fields);
}

/** The PBF of one 256-code-point range (`start` a multiple of 256) of `fontstack`. */
export function glyphRange(fontstack: string, start: number): Uint8Array {
    const glyphs = Array.from({ length: RANGE_SIZE }, (_, offset) => glyph(start + offset));
    const stack = [...textField(1, fontstack), ...textField(2, `${String(start)}-${String(start + RANGE_SIZE - 1)}`), ...glyphs.flat()];
    return Uint8Array.from(bytesField(1, stack));
}
