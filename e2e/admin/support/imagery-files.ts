import { writeFile } from 'node:fs/promises';

import type { Bounds } from './imagery-geometry.js';

/**
 * The files an e2e admin uploads to the Imagery area (docs/research/M3-interfaces.md §8.1, scenarios A14), generated at
 * test time into the test's output folder, never committed: a GeoTIFF with its own georeference (ModelPixelScale,
 * ModelTiepoint and a GeoKeyDirectory for WGS84 over the city), the same scan without one (a plain TIFF), a large TIFF for
 * the resumable upload, and a PNG named `.tif` (refused by its first bytes). A baseline little-endian TIFF: 8-bit grey,
 * uncompressed, one strip, written here so no image library decides what the tags say.
 */

const TYPE = { SHORT: 3, LONG: 4, DOUBLE: 12 } as const;
const TYPE_SIZE: Readonly<Record<number, number>> = { [TYPE.SHORT]: 2, [TYPE.LONG]: 4, [TYPE.DOUBLE]: 8 };

interface Tag {
    readonly tag: number;
    readonly type: (typeof TYPE)[keyof typeof TYPE];
    readonly values: readonly number[];
}

/** The GeoKeyDirectory of a WGS84 raster, area pixels (GeoTIFF 1.1: model type geographic, EPSG:4326). */
const WGS84_KEYS = [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326];

function geoTags(bounds: Bounds, width: number, height: number): Tag[] {
    return [
        { tag: 33550, type: TYPE.DOUBLE, values: [(bounds.east - bounds.west) / width, (bounds.north - bounds.south) / height, 0] },
        { tag: 33922, type: TYPE.DOUBLE, values: [0, 0, 0, bounds.west, bounds.north, 0] },
        { tag: 34735, type: TYPE.SHORT, values: WGS84_KEYS },
    ];
}

function writeValue(view: DataView, offset: number, type: number, value: number): void {
    if (type === TYPE.SHORT) {
        view.setUint16(offset, value, true);
    } else if (type === TYPE.LONG) {
        view.setUint32(offset, value, true);
    } else {
        view.setFloat64(offset, value, true);
    }
}

/** A greyscale pattern: soft diagonal bands, so the picture is not one flat colour. */
function pixels(width: number, height: number): Uint8Array {
    const data = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            data[y * width + x] = 96 + ((x + 2 * y) % 64);
        }
    }
    return data;
}

/** A baseline TIFF of `width` × `height` grey pixels with `extra` tags (the GeoTIFF ones). */
function tiffBytes(width: number, height: number, extra: readonly Tag[] = []): Uint8Array {
    const image = pixels(width, height);
    const tags: Tag[] = [
        { tag: 256, type: TYPE.LONG, values: [width] },
        { tag: 257, type: TYPE.LONG, values: [height] },
        { tag: 258, type: TYPE.SHORT, values: [8] },
        { tag: 259, type: TYPE.SHORT, values: [1] },
        { tag: 262, type: TYPE.SHORT, values: [1] },
        { tag: 273, type: TYPE.LONG, values: [8] },
        { tag: 277, type: TYPE.SHORT, values: [1] },
        { tag: 278, type: TYPE.LONG, values: [height] },
        { tag: 279, type: TYPE.LONG, values: [image.length] },
        ...extra,
    ].sort((left, right) => left.tag - right.tag);
    const ifdOffset = 8 + image.length + (image.length % 2);
    const dataOffset = ifdOffset + 2 + tags.length * 12 + 4;
    const outside = tags.filter((entry) => entry.values.length * (TYPE_SIZE[entry.type] ?? 4) > 4);
    const size = dataOffset + outside.reduce((sum, entry) => sum + entry.values.length * (TYPE_SIZE[entry.type] ?? 4), 0);
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    bytes.set([0x49, 0x49, 0x2a, 0x00]);
    view.setUint32(4, ifdOffset, true);
    bytes.set(image, 8);
    view.setUint16(ifdOffset, tags.length, true);
    let next = dataOffset;
    tags.forEach((entry, index) => {
        const at = ifdOffset + 2 + index * 12;
        const width = TYPE_SIZE[entry.type] ?? 4;
        view.setUint16(at, entry.tag, true);
        view.setUint16(at + 2, entry.type, true);
        view.setUint32(at + 4, entry.values.length, true);
        const inline = entry.values.length * width <= 4;
        const target = inline ? at + 8 : next;
        if (!inline) {
            view.setUint32(at + 8, next, true);
            next += entry.values.length * width;
        }
        entry.values.forEach((value, position) => {
            writeValue(view, target + position * width, entry.type, value);
        });
    });
    return bytes;
}

/** A GeoTIFF of the city (its own georeference: the pipeline's `inspect` finds it, method `embedded`). */
export function georeferencedTiff(bounds: Bounds, width = 320, height = 240): Uint8Array {
    return tiffBytes(width, height, geoTags(bounds, width, height));
}

/** A scan without georeference (the job waits for points). */
export function plainScanTiff(width = 320, height = 240): Uint8Array {
    return tiffBytes(width, height);
}

/** The start of a PNG (its signature and header): not a TIFF, whatever its name says. */
export const NOT_A_TIFF = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
    0x00, 0x01, 0x08, 0x00, 0x00, 0x00, 0x00, 0x3a, 0x7e, 0x9b, 0x55,
]);

/** Writes `bytes` to `path` (a test's output folder) and returns the path, for a file chooser. */
export async function writeUpload(path: string, bytes: Uint8Array): Promise<string> {
    await writeFile(path, bytes);
    return path;
}
