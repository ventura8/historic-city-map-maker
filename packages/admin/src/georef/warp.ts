/**
 * The georeferencer's live warped preview (`docs/research/M3-interfaces.md` §10.4): the scan preview drawn through the
 * current fit into a canvas over the box the fitted scan covers, which the map shows as a canvas source. The box is
 * regular in EPSG:3857 (the canvas maps linearly onto the map), cut into `previewMesh`'s quads; each quad is two
 * triangles from the decoded preview into the canvas (`triangleCanvasTransform`). Its own lazy chunk (`./georef-warp.ts`).
 */
import { geoToMercator, previewMesh, scanBounds, type BBox, type FittedTransform, type MeshQuad, type PlanePoint } from '@hcm/shared';

import type { PictureTriangle } from '../imagery/files.js';

/** The warped canvas's long side, in pixels: as long as the scan preview it is drawn from (3072 until 2026-11-12, a blur). */
export const WARP_MAX_SIDE = 4096;

/** ... and on a window narrower than `WARP_SMALL_WINDOW` CSS px (a phone, a small tablet): 16 MiB of canvas instead of up to 64. */
export const WARP_SMALL_SIDE = 2048;
export const WARP_SMALL_WINDOW = 840;

/** The warped canvas's long side for a window `width` CSS px across (unknown, as under Node: the large one). */
export function warpSideFor(width: number | undefined): number {
    return width !== undefined && width < WARP_SMALL_WINDOW ? WARP_SMALL_SIDE : WARP_MAX_SIDE;
}

/** Quads per side of the mesh: enough to bend through a second-order fit or a spline. */
export const WARP_CELLS = 16;

export interface WarpFrame {
    readonly bounds: BBox;
    readonly width: number;
    readonly height: number;
}

interface Size {
    readonly width: number;
    readonly height: number;
}

/** The canvas over the box the fitted scan covers, `side` px on its long side. */
export function warpFrame(transform: FittedTransform, scan: Size, side = WARP_MAX_SIDE): WarpFrame {
    const bounds = scanBounds(transform, scan);
    const [[west, south], [east, north]] = bounds;
    const low = geoToMercator({ lat: south, lng: west });
    const high = geoToMercator({ lat: north, lng: east });
    const across = Math.max(high.x - low.x, 1e-9);
    const up = Math.max(high.y - low.y, 1e-9);
    const scale = side / Math.max(across, up);
    return { bounds, width: Math.max(1, Math.round(across * scale)), height: Math.max(1, Math.round(up * scale)) };
}

type Triangle = readonly [PlanePoint, PlanePoint, PlanePoint];

/** A place of the frame's box as a pixel of its canvas (y down from the north). */
function canvasPoint(frame: WarpFrame, geo: MeshQuad['geo'][number]): PlanePoint {
    const [[west, south], [east, north]] = frame.bounds;
    const low = geoToMercator({ lat: south, lng: west });
    const high = geoToMercator({ lat: north, lng: east });
    const at = geoToMercator(geo);
    return { x: ((at.x - low.x) / (high.x - low.x)) * frame.width, y: ((high.y - at.y) / (high.y - low.y)) * frame.height };
}

type CanvasTransform = readonly [number, number, number, number, number, number];

/** The source triangle's spread below which it is flat (squared preview pixels): it draws nothing. */
const FLAT = 1e-9;

/**
 * The canvas's `setTransform` `[a, b, c, d, e, f]` that carries the triangle `from` onto `to` (`x' = a·x + c·y + e`, `y' = b·x + d·y + f`),
 * solved in closed form (as `@hcm/shared`'s `triangleTransform` by its matrices, which would share its solver with the `georef`
 * chunk's fit and so move it into `editor-shared`); null for a flat triangle.
 */
export function triangleCanvasTransform(from: Triangle, to: Triangle): CanvasTransform | null {
    const [p0, p1, p2] = from;
    const [x1, y1, x2, y2] = [p1.x - p0.x, p1.y - p0.y, p2.x - p0.x, p2.y - p0.y];
    const det = x1 * y2 - x2 * y1;
    if (Math.abs(det) <= FLAT) {
        return null;
    }
    const along = (u0: number, u1: number, u2: number): readonly [number, number, number] => {
        const across = ((u1 - u0) * y2 - (u2 - u0) * y1) / det;
        const down = ((u2 - u0) * x1 - (u1 - u0) * x2) / det;
        return [across, down, u0 - across * p0.x - down * p0.y];
    };
    const [a, c, e] = along(to[0].x, to[1].x, to[2].x);
    const [b, d, f] = along(to[0].y, to[1].y, to[2].y);
    return [a, b, c, d, e, f];
}

function triangle(source: Triangle, target: Triangle): PictureTriangle | null {
    const transform = triangleCanvasTransform(source, target);
    return transform === null
        ? null
        : {
              clip: [
                  [target[0].x, target[0].y],
                  [target[1].x, target[1].y],
                  [target[2].x, target[2].y],
              ],
              transform,
          };
}

type Four = readonly [PlanePoint, PlanePoint, PlanePoint, PlanePoint];

/** The two triangles of one quad (north-west, north-east, south-east; north-west, south-east, south-west). */
function quadTriangles(quad: MeshQuad, frame: WarpFrame, scale: PlanePoint): (PictureTriangle | null)[] {
    const target = quad.geo.map((geo) => canvasPoint(frame, geo)) as unknown as Four;
    const source = quad.pixel.map((pixel) => ({ x: pixel.x * scale.x, y: pixel.y * scale.y })) as unknown as Four;
    return [
        triangle([source[0], source[1], source[2]], [target[0], target[1], target[2]]),
        triangle([source[0], source[2], source[3]], [target[0], target[2], target[3]]),
    ];
}

/** The triangles that draw a `source`-sized decoding of a `scan`-sized scan into the frame. */
export function warpTriangles(transform: FittedTransform, frame: WarpFrame, scan: Size, source: Size): PictureTriangle[] {
    const scale = { x: source.width / scan.width, y: source.height / scan.height };
    return previewMesh(transform, frame.bounds, WARP_CELLS)
        .flatMap((quad) => quadTriangles(quad, frame, scale))
        .filter((part): part is PictureTriangle => part !== null);
}
