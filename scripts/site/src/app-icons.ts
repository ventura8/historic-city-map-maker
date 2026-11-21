import { crc32, deflateSync } from 'node:zlib';

import { APP_ICON_FILES } from '@hcm/shared/app';
import { MAP_GLYPH_PATH, MAP_ICON_GEOMETRY } from '@hcm/shared/tab-icon';

/**
 * The installable app's icons (`docs/ENGINE_API.md` → *Installable app*): the tab icon's design (`mapIconSvg`: the Layers
 * panel's map glyph, white on a rounded square of the page's theme colour) drawn as PNGs by the build itself, with no
 * image library, so a site build stays synchronous and needs nothing the repository does not pin. Chrome installs an
 * app only with a raster icon of 144 px or more, and Android's home screen wants a maskable one.
 *
 * - `app-icon-192.png`, `app-icon-512.png`: the tab icon's rounded square (`MAP_ICON_GEOMETRY`), transparent corners;
 * - `app-icon-maskable-512.png`: the colour to every edge and the glyph smaller (`MASKABLE_SCALE`), inside the maskable
 *   safe circle (80 % of the side), so any shape the system cuts keeps the whole glyph.
 *
 * Drawing: the glyph's outline (`MAP_GLYPH_PATH`: M, L, Q and Z in font units, y up) is flattened to line segments and
 * filled by the non-zero rule, the square by its rounded-corner test, each at `SAMPLES`² points per pixel, so the edges
 * are smooth. The PNG is 8-bit RGBA, unfiltered rows, zlib's deflate and CRC-32 (`node:zlib`).
 */

/** Points per pixel side (16 per pixel). */
const SAMPLES = 4;
/** Segments per quadratic curve of the glyph. */
const CURVE_STEPS = 8;
/** The maskable icon's glyph scale: the glyph's 720 units fill half the side, well inside the safe circle. */
const MASKABLE_SCALE = 0.66;

type Point = readonly [number, number];
type Edge = readonly [number, number, number, number];
type Rgb = readonly [number, number, number];

/** One icon to draw. */
interface IconShape {
    readonly size: number;
    /** The square's corner radius in font units; 0: the colour to every edge. */
    readonly radius: number;
    /** The glyph's scale around the centre. */
    readonly scale: number;
}

function quadratic(from: Point, control: Point, to: Point): Point[] {
    return Array.from({ length: CURVE_STEPS }, (_unused, index) => {
        const t = (index + 1) / CURVE_STEPS;
        const u = 1 - t;
        return [u * u * from[0] + 2 * u * t * control[0] + t * t * to[0], u * u * from[1] + 2 * u * t * control[1] + t * t * to[1]];
    });
}

function numbers(text: string): number[] {
    return text
        .trim()
        .split(/[\s,]+/)
        .filter((part) => part !== '')
        .map(Number);
}

/** The number at `index` (the caller stays within the command's numbers). */
function valueAt(values: readonly number[], index: number): number {
    return Number(values[index]);
}

/** One command's points after `last`: a move or line's own, a curve's flattened. */
function commandPoints(command: string, values: readonly number[], last: Point): Point[] {
    const step = command === 'Q' ? 4 : 2;
    const points: Point[] = [];
    for (let index = 0; index + step <= values.length; index += step) {
        const pair = (offset: number): Point => [valueAt(values, index + offset), valueAt(values, index + offset + 1)];
        points.push(...(command === 'Q' ? quadratic(points.at(-1) ?? last, pair(0), pair(2)) : [pair(0)]));
    }
    return points;
}

/** The last point of an outline, the origin before its first. */
function lastPoint(points: readonly Point[]): Point {
    return points.at(-1) ?? [0, 0];
}

/** The glyph's closed outlines in font units (y up). */
export function glyphOutlines(path: string = MAP_GLYPH_PATH): Point[][] {
    const outlines: Point[][] = [];
    let current: Point[] = [];
    for (const match of path.matchAll(/([MLQZ])([^MLQZ]*)/g)) {
        const command = String(match[1]);
        if (command === 'M' || command === 'Z') {
            outlines.push(current);
            current = [];
        }
        current.push(...commandPoints(command, numbers(String(match[2])), lastPoint(current)));
    }
    outlines.push(current);
    return outlines.filter((outline) => outline.length > 2);
}

/** The glyph's edges in pixels of an icon of `size`, scaled by `scale` around the centre and turned y down. */
function glyphEdges(size: number, scale: number): Edge[] {
    const half = MAP_ICON_GEOMETRY.em / 2;
    const unit = size / MAP_ICON_GEOMETRY.em;
    const place = ([x, y]: Point): Point => [(half + scale * (x - half)) * unit, (half - scale * (y - half)) * unit];
    // Each point joins the one before it, the first the last: the outline is closed.
    return glyphOutlines().flatMap((outline) => {
        let previous = place(lastPoint(outline));
        return outline.map((point) => {
            const at = place(point);
            const edge = [previous[0], previous[1], at[0], at[1]] as const;
            previous = at;
            return edge;
        });
    });
}

/** Where `edge` crosses the line `y`, with its direction (1 down, -1 up), or null where it does not. */
function crossing([x0, y0, x1, y1]: Edge, y: number): readonly [number, number] | null {
    const crosses = y0 !== y1 && y >= Math.min(y0, y1) && y < Math.max(y0, y1);
    return crosses ? [x0 + ((y - y0) * (x1 - x0)) / (y1 - y0), Math.sign(y1 - y0)] : null;
}

/** The x positions where `edges` cross the line `y`, each with its direction, in order. */
function crossings(edges: readonly Edge[], y: number): (readonly [number, number])[] {
    return edges
        .map((edge) => crossing(edge, y))
        .filter((found): found is readonly [number, number] => found !== null)
        .sort((a, b) => a[0] - b[0]);
}

/** A run of samples on one row of samples, between two x positions in pixels. */
interface Span {
    readonly row: number;
    readonly from: number;
    readonly to: number;
}

/** Adds the samples of `span` to `counts`. */
function addSpan(counts: Uint8Array, size: number, { row, from, to }: Span): void {
    const first = Math.max(0, Math.ceil(from * SAMPLES - 0.5));
    const last = Math.min(size * SAMPLES, Math.ceil(to * SAMPLES - 0.5));
    const base = Math.floor(row / SAMPLES) * size;
    for (let sample = first; sample < last; sample += 1) {
        const pixel = base + Math.floor(sample / SAMPLES);
        Atomics.add(counts, pixel, 1);
    }
}

/** The samples of each pixel inside the glyph (non-zero rule), 0…`SAMPLES`². */
function glyphCoverage(size: number, scale: number): Uint8Array {
    const counts = new Uint8Array(size * size);
    const edges = glyphEdges(size, scale);
    for (let row = 0; row < size * SAMPLES; row += 1) {
        let winding = 0;
        let start = 0;
        for (const [x, direction] of crossings(edges, (row + 0.5) / SAMPLES)) {
            if (winding === 0) {
                start = x;
            }
            winding += direction;
            if (winding === 0) {
                addSpan(counts, size, { row, from: start, to: x });
            }
        }
    }
    return counts;
}

/** Whether the point (in font units) lies in the square whose corners have `radius`. */
function inSquare(x: number, y: number, radius: number): boolean {
    const em = MAP_ICON_GEOMETRY.em;
    const dx = Math.max(radius - x, x - (em - radius), 0);
    const dy = Math.max(radius - y, y - (em - radius), 0);
    return dx * dx + dy * dy <= radius * radius;
}

/** The samples of each pixel inside the rounded square, 0…`SAMPLES`². */
function squareCoverage(size: number, radius: number): Uint8Array {
    const counts = new Uint8Array(size * size);
    const unit = MAP_ICON_GEOMETRY.em / (size * SAMPLES);
    for (let row = 0; row < size * SAMPLES; row += 1) {
        for (let column = 0; column < size * SAMPLES; column += 1) {
            if (inSquare((column + 0.5) * unit, (row + 0.5) * unit, radius)) {
                const pixel = Math.floor(row / SAMPLES) * size + Math.floor(column / SAMPLES);
                Atomics.add(counts, pixel, 1);
            }
        }
    }
    return counts;
}

function rgb(hex: string): Rgb {
    const value = Number.parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** The icon's RGBA pixels: the glyph in white over the square in `color`. */
function pixels(shape: IconShape, color: string): Uint8Array {
    const full = SAMPLES * SAMPLES;
    const square = squareCoverage(shape.size, shape.radius);
    const glyph = glyphCoverage(shape.size, shape.scale);
    const fill = rgb(color);
    const out = new Uint8Array(shape.size * shape.size * 4);
    square.forEach((count, pixel) => {
        const white = Math.min(Atomics.load(glyph, pixel), full) / full;
        fill.forEach((channel, index) => {
            out[pixel * 4 + index] = Math.round(channel + (255 - channel) * white);
        });
        out[pixel * 4 + 3] = Math.round((count / full) * 255);
    });
    return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
}

/** An RGBA image of `size` × `size` as PNG bytes. */
export function encodePng(size: number, rgba: Uint8Array): Uint8Array {
    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    view.setUint32(0, size);
    view.setUint32(4, size);
    header.set([8, 6, 0, 0, 0], 8);
    const rows = new Uint8Array(size * (size * 4 + 1));
    for (let row = 0; row < size; row += 1) {
        rows.set(rgba.subarray(row * size * 4, (row + 1) * size * 4), row * (size * 4 + 1) + 1);
    }
    const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const parts = [signature, chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', new Uint8Array(0))];
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

const SHAPES: Readonly<Record<keyof typeof APP_ICON_FILES, IconShape>> = {
    small: { size: 192, radius: MAP_ICON_GEOMETRY.radius, scale: MAP_ICON_GEOMETRY.scale },
    large: { size: 512, radius: MAP_ICON_GEOMETRY.radius, scale: MAP_ICON_GEOMETRY.scale },
    maskable: { size: 512, radius: 0, scale: MASKABLE_SCALE },
};

/** The three icon files in `color` (`#RRGGBB`), named as the manifest names them. */
export function appIconFiles(color: string): { readonly to: string; readonly content: Uint8Array }[] {
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
        throw new RangeError(`not an icon colour: ${JSON.stringify(color)}`);
    }
    return (Object.keys(SHAPES) as (keyof typeof APP_ICON_FILES)[]).map((key) => ({
        to: APP_ICON_FILES[key],
        content: encodePng(SHAPES[key].size, pixels(SHAPES[key], color)),
    }));
}
