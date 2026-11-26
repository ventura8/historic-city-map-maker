import sharp from 'sharp';

import type { Rgb } from '../fixtures/world.js';

/**
 * Synthetic raster tiles, generated at run time (no committed binaries): one solid colour per layer, so a pixel probe
 * on the map knows exactly what it must read, plus the tile's `z/x/y` in a 3×5 pixel font in the top-left corner for
 * people reading a screenshot. Lossless WebP or PNG, encoded by sharp.
 */

export type TileFormat = 'png' | 'webp';

/** 3×5 bitmaps, row by row from the top, most significant bit on the left. */
const FONT: Readonly<Record<string, number>> = {
    '0': 0b111_101_101_101_111,
    '1': 0b010_110_010_010_111,
    '2': 0b111_001_111_100_111,
    '3': 0b111_001_111_001_111,
    '4': 0b101_101_111_001_001,
    '5': 0b111_100_111_001_111,
    '6': 0b111_100_111_101_111,
    '7': 0b111_001_001_001_001,
    '8': 0b111_101_111_101_111,
    '9': 0b111_101_111_001_111,
    '/': 0b001_001_010_100_100,
};

const GLYPH_WIDTH = 3;
const GLYPH_HEIGHT = 5;
const MARGIN = 4;
const CHANNELS = 3;

/** Black on light tiles, white on dark ones. */
function inkFor([red, green, blue]: Rgb): Rgb {
    return 0.299 * red + 0.587 * green + 0.114 * blue > 128 ? [0, 0, 0] : [255, 255, 255];
}

function paint(pixels: Buffer, size: number, x: number, y: number, colour: Rgb): void {
    pixels.set(colour, (y * size + x) * CHANNELS);
}

function drawCharacter(pixels: Buffer, size: number, origin: readonly [number, number], bits: number, ink: Rgb): void {
    const scale = Math.max(1, Math.floor(size / 128));
    for (let cell = 0; cell < GLYPH_WIDTH * GLYPH_HEIGHT; cell += 1) {
        if (((bits >> (GLYPH_WIDTH * GLYPH_HEIGHT - 1 - cell)) & 1) === 1) {
            const column = origin[0] + (cell % GLYPH_WIDTH) * scale;
            const row = origin[1] + Math.floor(cell / GLYPH_WIDTH) * scale;
            for (let dy = 0; dy < scale; dy += 1) {
                for (let dx = 0; dx < scale; dx += 1) {
                    paint(pixels, size, column + dx, row + dy, ink);
                }
            }
        }
    }
}

function drawLabel(pixels: Buffer, size: number, label: string, ink: Rgb): void {
    const scale = Math.max(1, Math.floor(size / 128));
    // Labels are ASCII digits and slashes, so one UTF-16 unit is one character.
    for (let index = 0; index < label.length; index += 1) {
        const bits = FONT[label.charAt(index)] ?? 0;
        drawCharacter(pixels, size, [MARGIN + index * (GLYPH_WIDTH + 1) * scale, MARGIN], bits, ink);
    }
}

/** A `size`×`size` tile filled with `colour`, labelled `z/x/y`. */
export async function rasterTile(colour: Rgb, label: string, size: number, format: TileFormat): Promise<Buffer> {
    const pixels = Buffer.alloc(size * size * CHANNELS);
    for (let offset = 0; offset < pixels.length; offset += CHANNELS) {
        pixels.set(colour, offset);
    }
    drawLabel(pixels, size, label, inkFor(colour));
    const image = sharp(pixels, { raw: { width: size, height: size, channels: CHANNELS } });
    return (format === 'webp' ? image.webp({ lossless: true }) : image.png()).toBuffer();
}

/** A 1×1 transparent PNG (the empty sprite sheet). */
export async function transparentPixel(): Promise<Buffer> {
    return sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .png()
        .toBuffer();
}
