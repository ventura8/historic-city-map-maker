/**
 * The adapter's sprite images, drawn on a canvas and handed to Mapbox with `addImage`: nothing is fetched (no sprite
 * file, no `img-src` for it in the CSP). Mapbox warns when a layer names an image that does not exist, so a transparent
 * placeholder of the final size is added at once and replaced with `updateImage` when the drawing is ready (the font
 * of a POI glyph may still be loading).
 *
 * Photos: a camera marker, the same marker with a pointer that `icon-rotate` turns to the photo's bearing, and a
 * cluster disc behind the count. POIs: one white Material Symbols glyph per bundled icon name, drawn over the
 * category's coloured `circle` layer (so one image serves every colour).
 */
import { ICON_FONT_FAMILY } from '../fonts/font-files.js';

import type { MapImage, MapboxMap } from './mapbox-types.js';

/** Device pixels per CSS pixel of every sprite image (crisp on high-density screens). */
export const ICON_PIXEL_RATIO = 2;

export const PHOTO_CAMERA_ICON = 'hcm-photo-camera';
export const PHOTO_DIRECTION_ICON = 'hcm-photo-direction';
/** An aerial photo (the owner, 2026-11-16): the marker disc with an aeroplane instead of the camera. */
export const PHOTO_AERIAL_ICON = 'hcm-photo-aerial';
export const PHOTO_CLUSTER_ICON = 'hcm-photo-cluster';
const POI_ICON_PREFIX = 'hcm-poi-icon-';

/**
 * The icon font the ui-kit registers (`installFonts`: a subset of Material Symbols Rounded under a namespaced family);
 * the glyph is its ligature. Any other family name would never load and every POI would fall back to a plain dot.
 */
export const SYMBOL_FONT_FAMILY = ICON_FONT_FAMILY;

/** Marker colours: a dark brown disc with a white outline stays readable on aerial imagery and on the Standard style. */
const MARKER_FILL = '#5c3a1e';
const MARKER_STROKE = '#ffffff';

/**
 * Sprite sizes in device pixels (`ICON_PIXEL_RATIO` per CSS pixel): a photo marker is a 22 CSS px disc in a 32 px
 * box (room for the bearing pointer), a cluster a 30 CSS px disc behind its count, both readable over aerial imagery.
 */
const MARKER_SIZE = 64;
const CLUSTER_SIZE = 72;
const CAMERA_GLYPH = 26;

/** "photo_camera" of Material Icons (Apache-2.0), in its 24-unit box. */
const CAMERA_PATH =
    'M9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z' +
    'M12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 1 0 0-6.4z';

export type IconContext = Pick<
    CanvasRenderingContext2D,
    | 'fillStyle'
    | 'strokeStyle'
    | 'lineWidth'
    | 'font'
    | 'textAlign'
    | 'textBaseline'
    | 'beginPath'
    | 'arc'
    | 'moveTo'
    | 'lineTo'
    | 'closePath'
    | 'fill'
    | 'stroke'
    | 'fillText'
    | 'save'
    | 'restore'
    | 'translate'
    | 'scale'
    | 'getImageData'
>;

export interface IconCanvas {
    getContext(kind: '2d'): IconContext | null;
}

/** What drawing needs from the browser; `canvasIconEnv` builds it from `document` and `Path2D`. */
export interface IconEnv {
    readonly createCanvas: (size: number) => IconCanvas;
    readonly createPath: (svgPathData: string) => Path2D;
    /** Resolves true when the font is available (never rejects). */
    readonly loadFont: (font: string) => Promise<boolean>;
}

/** The browser objects `canvasIconEnv` uses (the page's `window`). */
export interface IconScope {
    readonly document: Pick<Document, 'createElement' | 'fonts'>;
    readonly Path2D: new (path: string) => Path2D;
}

export function canvasIconEnv(scope: IconScope): IconEnv {
    return {
        createCanvas: (size) => {
            const canvas = scope.document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            return canvas;
        },
        createPath: (svgPathData) => new scope.Path2D(svgPathData),
        loadFont: async (font) => {
            try {
                return (await scope.document.fonts.load(font)).length > 0;
            } catch {
                return false;
            }
        },
    };
}

interface IconSpec {
    readonly size: number;
    readonly draw: (context: IconContext, env: IconEnv) => Promise<void> | void;
}

function disc(context: IconContext, center: number, radius: number, fill: string): void {
    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.closePath();
    context.fillStyle = fill;
    context.fill();
}

function outlinedDisc(context: IconContext, center: number, radius: number): void {
    disc(context, center, radius, MARKER_FILL);
    context.strokeStyle = MARKER_STROKE;
    context.lineWidth = 3;
    context.stroke();
}

/** The camera glyph, `CAMERA_GLYPH` device px wide, centred in a `size` box. */
function camera(context: IconContext, env: IconEnv, size: number): void {
    context.save();
    context.translate(size / 2 - CAMERA_GLYPH / 2, size / 2 - CAMERA_GLYPH / 2);
    context.scale(CAMERA_GLYPH / 24, CAMERA_GLYPH / 24);
    context.fillStyle = MARKER_STROKE;
    context.fill(env.createPath(CAMERA_PATH));
    context.restore();
}

/** Material Symbols' `flight`, a 24 px path: the glyph of an aerial photo's marker. */
const AEROPLANE_PATH =
    'M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z';

/** The aeroplane glyph, as wide as the camera, centred in a `size` box. */
function aeroplane(context: IconContext, env: IconEnv, size: number): void {
    context.save();
    context.translate(size / 2 - CAMERA_GLYPH / 2, size / 2 - CAMERA_GLYPH / 2);
    context.scale(CAMERA_GLYPH / 24, CAMERA_GLYPH / 24);
    context.fillStyle = MARKER_STROKE;
    context.fill(env.createPath(AEROPLANE_PATH));
    context.restore();
}

/** A pointer at the top edge: with `icon-rotate` it shows where the camera looked. */
function pointer(context: IconContext, size: number): void {
    context.beginPath();
    context.moveTo(size / 2, 1);
    context.lineTo(size / 2 - 10, 16);
    context.lineTo(size / 2 + 10, 16);
    context.closePath();
    context.fillStyle = MARKER_STROKE;
    context.fill();
}

const PHOTO_ICONS: ReadonlyMap<string, IconSpec> = new Map<string, IconSpec>([
    [
        PHOTO_CAMERA_ICON,
        {
            size: MARKER_SIZE,
            draw: (context, env) => {
                outlinedDisc(context, MARKER_SIZE / 2, 22);
                camera(context, env, MARKER_SIZE);
            },
        },
    ],
    [
        PHOTO_DIRECTION_ICON,
        {
            size: MARKER_SIZE,
            draw: (context, env) => {
                pointer(context, MARKER_SIZE);
                outlinedDisc(context, MARKER_SIZE / 2, 20);
                camera(context, env, MARKER_SIZE);
            },
        },
    ],
    [
        PHOTO_AERIAL_ICON,
        {
            size: MARKER_SIZE,
            draw: (context, env) => {
                outlinedDisc(context, MARKER_SIZE / 2, 22);
                aeroplane(context, env, MARKER_SIZE);
            },
        },
    ],
    [
        PHOTO_CLUSTER_ICON,
        {
            size: CLUSTER_SIZE,
            draw: (context) => {
                outlinedDisc(context, CLUSTER_SIZE / 2, 30);
            },
        },
    ],
]);

/** The image id of a POI glyph (`poiIcon(category.icon)`, a bundled Material Symbols name). */
export function poiIconId(name: string): string {
    return `${POI_ICON_PREFIX}${name}`;
}

/** The white glyph of `name`, or a white dot while the symbol font cannot be loaded. */
async function drawGlyph(context: IconContext, env: IconEnv, name: string): Promise<void> {
    const font = `32px "${SYMBOL_FONT_FAMILY}"`;
    const loaded = await env.loadFont(font);
    if (!loaded) {
        disc(context, 24, 5, MARKER_STROKE);
        return;
    }
    context.font = font;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = MARKER_STROKE;
    context.fillText(name, 24, 24);
}

function iconSpec(id: string): IconSpec | undefined {
    if (!id.startsWith(POI_ICON_PREFIX)) {
        return PHOTO_ICONS.get(id);
    }
    const name = id.slice(POI_ICON_PREFIX.length);
    return { size: 48, draw: (context, env) => drawGlyph(context, env, name) };
}

/** A transparent image of `size` × `size` device pixels. */
export function placeholderImage(size: number): MapImage {
    return { width: size, height: size, data: new Uint8ClampedArray(size * size * 4) };
}

/** Draws a sprite image; null when the canvas has no 2D context. */
export async function drawIcon(id: string, env: IconEnv): Promise<MapImage | null> {
    const spec = iconSpec(id);
    const context = spec === undefined ? null : env.createCanvas(spec.size).getContext('2d');
    if (spec === undefined || context === null) {
        return null;
    }
    await spec.draw(context, env);
    return { width: spec.size, height: spec.size, data: context.getImageData(0, 0, spec.size, spec.size).data };
}

/**
 * Makes `id` available on `map` now (a placeholder) and draws it in the background; `isCurrent` turns false once the
 * map was destroyed, and a late drawing is then dropped. An unknown id or an image the map already has does nothing.
 * `updateImage` does not repaint an idle map (Mapbox GL 3.32), so a drawing that lands after the map settled (a POI
 * glyph whose font arrives late) asks for a frame, or the old placeholder stays on screen until the visitor moves.
 */
export function ensureIcon(map: MapboxMap, id: string, env: IconEnv, isCurrent: () => boolean): Promise<void> {
    const spec = iconSpec(id);
    if (spec === undefined || map.hasImage(id)) {
        return Promise.resolve();
    }
    map.addImage(id, placeholderImage(spec.size), { pixelRatio: ICON_PIXEL_RATIO });
    return drawIcon(id, env).then((image) => {
        if (image !== null && isCurrent()) {
            map.updateImage(id, image);
            map.triggerRepaint();
        }
    });
}
