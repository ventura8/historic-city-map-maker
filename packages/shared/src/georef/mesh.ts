/**
 * The georeferencer's live warped preview (`docs/research/M3-interfaces.md` §6.2, §10.4): a grid of quads over the
 * output bounds, regular in EPSG:3857 (so on the map's canvas they are rectangles), each corner with the scan pixel the
 * inverse fit gives it; the page draws the scan preview into each quad as two triangles (`triangleTransform` is the
 * canvas's `setTransform` of one). `scanBounds` is the box the fitted scan covers, from points along its border.
 */
import type { BBox } from '../geo/bbox.js';
import type { LngLat } from '../geo/math.js';
import type { FittedTransform, PixelPoint } from './fit.js';
import { Matrix, solve } from './matrix.js';
import { geoToMercator, mercatorToGeo, type GeoPoint, type PlanePoint } from './mercator.js';

type Four<T> = readonly [T, T, T, T];

export interface MeshQuad {
    /** The quad's corners on the ground: north-west, north-east, south-east, south-west. */
    readonly geo: Four<GeoPoint>;
    /** The same corners in scan pixels (the preview's are these times its `previewScale`). */
    readonly pixel: Four<PixelPoint>;
}

interface MeshCorner {
    readonly geo: GeoPoint;
    readonly pixel: PixelPoint;
}

/** The grid: the box's north-west `from` and south-east `to` in EPSG:3857, and its cells per side. */
interface Grid {
    readonly from: PlanePoint;
    readonly to: PlanePoint;
    readonly cells: number;
}

function cornerAt(transform: FittedTransform, grid: Grid, col: number, row: number): MeshCorner {
    const { from, to, cells } = grid;
    const geo = mercatorToGeo({ x: from.x + ((to.x - from.x) * col) / cells, y: from.y + ((to.y - from.y) * row) / cells });
    return { geo, pixel: transform.toPixel(geo) };
}

function quadAt(transform: FittedTransform, grid: Grid, col: number, row: number): MeshQuad {
    const corners = [
        cornerAt(transform, grid, col, row),
        cornerAt(transform, grid, col + 1, row),
        cornerAt(transform, grid, col + 1, row + 1),
        cornerAt(transform, grid, col, row + 1),
    ] as const;
    return {
        geo: [corners[0].geo, corners[1].geo, corners[2].geo, corners[3].geo],
        pixel: [corners[0].pixel, corners[1].pixel, corners[2].pixel, corners[3].pixel],
    };
}

/** A grid of `cells × cells` quads of the output bounds with their scan pixels: the warped preview's texture mesh. */
export function previewMesh(transform: FittedTransform, bounds: BBox, cells: number): readonly MeshQuad[] {
    const count = Math.max(1, Math.round(cells));
    const [[west, south], [east, north]] = bounds;
    const grid = { from: geoToMercator({ lat: north, lng: west }), to: geoToMercator({ lat: south, lng: east }), cells: count };
    return Array.from({ length: count * count }, (_quad, index) => quadAt(transform, grid, index % count, Math.floor(index / count)));
}

/** Points along the border of a `width × height` scan, `perSide` on each side. */
function borderPixels(width: number, height: number, perSide: number): PixelPoint[] {
    return Array.from({ length: perSide }, (_step, step) => step / perSide).flatMap((share) => [
        { x: share * width, y: 0 },
        { x: width, y: share * height },
        { x: width - share * width, y: height },
        { x: 0, y: height - share * height },
    ]);
}

/** The box (`[[west, south], [east, north]]`) the fitted scan covers. */
export function scanBounds(transform: FittedTransform, size: { readonly width: number; readonly height: number }, perSide = 8): BBox {
    const places: LngLat[] = borderPixels(size.width, size.height, Math.max(1, perSide)).map((pixel) => {
        const geo = transform.toGeo(pixel);
        return [geo.lng, geo.lat];
    });
    const lngs = places.map((place) => place[0]);
    const lats = places.map((place) => place[1]);
    return [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
    ];
}

/** The 2D canvas transform `[a, b, c, d, e, f]` that maps the triangle `from` onto `to`; null for a flat triangle. */
export function triangleTransform(
    from: readonly [PlanePoint, PlanePoint, PlanePoint],
    to: readonly [PlanePoint, PlanePoint, PlanePoint],
): readonly [number, number, number, number, number, number] | null {
    const solved = solve(Matrix.of(from.map((point) => [point.x, point.y, 1])), Matrix.of(to.map((point) => [point.x, point.y])));
    if (solved === null) {
        return null;
    }
    return [solved.get(0, 0), solved.get(0, 1), solved.get(1, 0), solved.get(1, 1), solved.get(2, 0), solved.get(2, 1)];
}
