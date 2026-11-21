import sharp from 'sharp';

import {
    imagePixelOf,
    scanPixelOf,
    SCAN_PREVIEW_SCALE,
    SCAN_SIZE,
    worldFeatures,
    type Bounds,
    type Feature,
    type FeatureKind,
    type Pixel,
} from './imagery-geometry.js';

/**
 * The images the stand-in runner writes for a layer version (docs/research/M3-interfaces.md §2.7, §13), generated with
 * sharp from the synthetic world (imagery-geometry.ts), never committed and never downloaded: the scan's preview (grey
 * film: the world through the scan's transform), the two references (OpenStreetMap's lines on transparency, a
 * Sentinel-2-like true colour), the warped preview the approval card lays on the map, and small TIFFs where the
 * pipeline writes a COG, a scan or the Studio file (the publisher only streams them to the fake MTS). Each image is
 * made once per window and kept.
 */

type Project = (place: { readonly lat: number; readonly lng: number }) => Pixel;

interface Palette {
    /** A colour, or `none` for transparency. */
    readonly background: string;
    /** The background's opacity (1 when absent). */
    readonly opacity?: number;
    readonly lines: Readonly<Record<FeatureKind, string>>;
}

const WIDTHS: Readonly<Record<FeatureKind, number>> = { road: 3, river: 7, rail: 2, water: 2 };

function points(feature: Feature, project: Project): string {
    return feature.points
        .map(project)
        .map((pixel) => `${pixel.x.toFixed(1)},${pixel.y.toFixed(1)}`)
        .join(' ');
}

function shape(feature: Feature, project: Project, palette: Palette, scale: number): string {
    const colour = palette.lines[feature.kind];
    const width = (WIDTHS[feature.kind] * scale).toFixed(1);
    return feature.kind === 'water'
        ? `<polygon points="${points(feature, project)}" fill="${colour}" stroke="${colour}" stroke-width="${width}"/>`
        : `<polyline points="${points(feature, project)}" fill="none" stroke="${colour}" stroke-width="${width}" stroke-linejoin="round"/>`;
}

/** An SVG of the world's features over a background (`none`: transparent). */
function svg(size: { readonly width: number; readonly height: number }, project: Project, palette: Palette, scale = 1): Buffer {
    const shapes = worldFeatures()
        .map((feature) => shape(feature, project, palette, scale))
        .join('');
    const opacity = String(palette.opacity ?? 1);
    const background =
        palette.background === 'none' ? '' : `<rect width="100%" height="100%" fill="${palette.background}" fill-opacity="${opacity}"/>`;
    const { width, height } = size;
    return Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}">${background}${shapes}</svg>`,
    );
}

const FILM: Palette = { background: '#8f8f8f', lines: { road: '#d9d9d9', river: '#3c3c3c', rail: '#262626', water: '#4a4a4a' } };
const OSM: Palette = { background: 'none', lines: { road: '#e8a33d', river: '#3f7fd6', rail: '#5a5a5a', water: '#7fb0e6' } };
const SENTINEL: Palette = { background: '#7d8c5a', lines: { road: '#c9c2b1', river: '#2e4a5c', rail: '#6b6157', water: '#33566b' } };
const WARPED: Palette = {
    background: '#b5a27f',
    opacity: 0.7,
    lines: { road: '#efe6d2', river: '#4d3f2b', rail: '#3a3226', water: '#5a4a33' },
};

/** The images of one window, made once. */
const made = new Map<string, Promise<Buffer>>();

function once(key: string, make: () => Promise<Buffer>): Promise<Buffer> {
    const image = made.get(key) ?? make();
    made.set(key, image);
    return image;
}

const keyOf = (name: string, bounds: Bounds): string => `${name}:${[bounds.west, bounds.south, bounds.east, bounds.north].join(',')}`;

/** `scan-preview.jpg`: the scan at `SCAN_PREVIEW_SCALE` (800 × 600), the world as the film shows it. */
export function scanPreviewJpeg(bounds: Bounds): Promise<Buffer> {
    return scanJpeg(bounds, SCAN_PREVIEW_SCALE);
}

/** The stand-in's tile side: the 1600 × 1200 sharper scan is four columns by three rows (the pipeline's is `SCAN_TILE_PX`). */
export const SCAN_TILE = 400;

/**
 * `scan-tiles.bin`: the georeferencer's sharper scan, the same world at the scan's own pixels (1600 × 1200) as JPEG tiles in the
 * pipeline's layout (`pipeline/src/hcm_pipeline/scan_tiles.py`).
 */
export function scanTilesFile(bounds: Bounds): Promise<Buffer> {
    return once(keyOf('scan-tiles', bounds), async () => {
        const whole = await scanJpeg(bounds, 1);
        const tiles: Buffer[] = [];
        for (let top = 0; top < SCAN_SIZE.height; top += SCAN_TILE) {
            for (let left = 0; left < SCAN_SIZE.width; left += SCAN_TILE) {
                const box = {
                    left,
                    top,
                    width: Math.min(SCAN_TILE, SCAN_SIZE.width - left),
                    height: Math.min(SCAN_TILE, SCAN_SIZE.height - top),
                };
                tiles.push(await sharp(whole).extract(box).jpeg({ quality: 80 }).toBuffer());
            }
        }
        const head = Buffer.alloc(24 + 4 * (tiles.length + 1));
        head.write('HCMT', 0, 'latin1');
        [1, SCAN_TILE, SCAN_SIZE.width, SCAN_SIZE.height, tiles.length].forEach((value, index) => head.writeUInt32LE(value, 4 + 4 * index));
        let offset = head.length;
        for (const [index, tile] of tiles.entries()) {
            head.writeUInt32LE(offset, 24 + 4 * index);
            offset += tile.length;
        }
        head.writeUInt32LE(offset, 24 + 4 * tiles.length);
        return Buffer.concat([head, ...tiles]);
    });
}

/** The scan at `scale` of its own pixels. */
function scanJpeg(bounds: Bounds, scale: number): Promise<Buffer> {
    const size = { width: SCAN_SIZE.width * scale, height: SCAN_SIZE.height * scale };
    const project: Project = (place) => {
        const pixel = scanPixelOf(place, bounds);
        return { x: pixel.x * scale, y: pixel.y * scale };
    };
    return once(keyOf(`scan@${String(scale)}`, bounds), () =>
        sharp(svg(size, project, FILM))
            .grayscale()
            .jpeg({ quality: 80 })
            .toBuffer(),
    );
}

/** The size of the reference images and of the warped preview (north up over their bounds). */
const REFERENCE_SIZE = { width: 1000, height: 750 } as const;
const PREVIEW_SIZE = { width: 512, height: 384 } as const;

/** `reference-osm.png`: OpenStreetMap's lines over the window, on transparency. */
export function referenceOsmPng(bounds: Bounds): Promise<Buffer> {
    return once(keyOf('osm', bounds), () =>
        sharp(svg(REFERENCE_SIZE, (place) => imagePixelOf(place, bounds, REFERENCE_SIZE), OSM))
            .png()
            .toBuffer(),
    );
}

/** `reference-s2.jpg`: a Sentinel-2-like true colour of the window. */
export function referenceS2Jpeg(bounds: Bounds): Promise<Buffer> {
    return once(keyOf('s2', bounds), () =>
        sharp(svg(REFERENCE_SIZE, (place) => imagePixelOf(place, bounds, REFERENCE_SIZE), SENTINEL))
            .jpeg({ quality: 80 })
            .toBuffer(),
    );
}

/** `preview.png`: the warped layer over its output bounds, sepia and translucent, as the approval card shows it. */
export function warpedPreviewPng(bounds: Bounds): Promise<Buffer> {
    return once(keyOf('preview', bounds), () =>
        sharp(svg(PREVIEW_SIZE, (place) => imagePixelOf(place, bounds, PREVIEW_SIZE), WARPED, 0.6))
            .png()
            .toBuffer(),
    );
}

/** A small grey TIFF where the pipeline writes a large one (`scan.tif`, `cog.tif`, `studio.tif`): the bytes are what counts. */
export function smallTiff(shade: number): Promise<Buffer> {
    return once(`tiff:${String(shade)}`, () =>
        sharp({ create: { width: 64, height: 48, channels: 3, background: { r: shade, g: shade, b: shade } } })
            .tiff({ compression: 'deflate' })
            .toBuffer(),
    );
}
