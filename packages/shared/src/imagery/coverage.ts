/**
 * How much of a city a USGS frame covers (`docs/research/M3-interfaces.md` §3.2): the frame's footprint, clipped to the
 * city's bounds, against the bounds' own area. Areas use an equal-area approximation good enough for a city: longitudes
 * are scaled by the cosine of the bounds' middle latitude, latitudes are kept. Pure: the harvest (functions) writes the
 * value, the admin's Imagery area could compute the same live. A KH-9 panoramic frame's footprint is its corners' box, whose
 * middle the film does not reach: its coverage goes through the camera's own outline (`panoramicRing`).
 */
import type { BoundsRecord } from '../geo/bbox.js';
import { clamp, toRadians } from '../geo/math.js';
import type { Sensor, UsgsSceneDoc } from '../schemas/usgs-scene.js';

/** A vertex of a footprint, as the scene document stores it. */
export interface FootprintVertex {
    readonly lat: number;
    readonly lng: number;
}

/** At most this many vertices per stored footprint (`usgsSceneDocSchema`). */
export const MAX_FOOTPRINT_VERTICES = 64;

/** One side of the clip window: which vertices are inside, and where an edge crosses it. */
interface ClipEdge {
    inside(vertex: FootprintVertex): boolean;
    cross(from: FootprintVertex, to: FootprintVertex): FootprintVertex;
}

/** The point at `t` along `from` → `to`. */
function along(from: FootprintVertex, to: FootprintVertex, t: number): FootprintVertex {
    return { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t };
}

function lngEdge(limit: number, keep: (lng: number) => boolean): ClipEdge {
    return {
        inside: (vertex) => keep(vertex.lng),
        cross: (from, to) => along(from, to, (limit - from.lng) / (to.lng - from.lng)),
    };
}

function latEdge(limit: number, keep: (lat: number) => boolean): ClipEdge {
    return {
        inside: (vertex) => keep(vertex.lat),
        cross: (from, to) => along(from, to, (limit - from.lat) / (to.lat - from.lat)),
    };
}

function edgesOf(bounds: BoundsRecord): readonly ClipEdge[] {
    return [
        lngEdge(bounds.west, (lng) => lng >= bounds.west),
        lngEdge(bounds.east, (lng) => lng <= bounds.east),
        latEdge(bounds.south, (lat) => lat >= bounds.south),
        latEdge(bounds.north, (lat) => lat <= bounds.north),
    ];
}

/** What one vertex contributes to the clipped ring (Sutherland–Hodgman), given the vertex before it. */
function clipStep(edge: ClipEdge, previous: FootprintVertex, current: FootprintVertex): FootprintVertex[] {
    const [wasIn, isIn] = [edge.inside(previous), edge.inside(current)];
    if (isIn) {
        return wasIn ? [current] : [edge.cross(previous, current), current];
    }
    return wasIn ? [edge.cross(previous, current)] : [];
}

/** Each vertex of an open ring with the one after it (the last with the first): the ring's edges. */
function successors(ring: readonly FootprintVertex[]): (readonly [FootprintVertex, FootprintVertex])[] {
    const next = [...ring.slice(1), ...ring.slice(0, 1)];
    return ring
        .map((vertex, index) => [vertex, next[index]] as const)
        .filter((edge): edge is readonly [FootprintVertex, FootprintVertex] => edge[1] !== undefined);
}

/** The part of an open ring on the inner side of one edge (the window is convex, the ring need not be). */
function clipRing(ring: readonly FootprintVertex[], edge: ClipEdge): FootprintVertex[] {
    return successors(ring).flatMap(([previous, current]) => clipStep(edge, previous, current));
}

/** The area of an open ring in square degrees, longitudes scaled by `scale` (the shoelace formula). */
function ringArea(ring: readonly FootprintVertex[], scale: number): number {
    const twice = successors(ring).reduce(
        (sum, [current, next]) => sum + current.lng * scale * next.lat - next.lng * scale * current.lat,
        0,
    );
    return Math.abs(twice) / 2;
}

/** The scene fields that tell which outline a frame's coverage uses. */
export interface FrameCamera {
    readonly sensor: Sensor;
    readonly corners?: UsgsSceneDoc['corners'];
}

/** Half of the KH-9 panoramic camera's scan across the flight: the frame's ends lie this far from straight down. */
const PANORAMIC_HALF_SCAN = toRadians(60.5);
/** The scan angles sampled along the frame: an odd count, so the waist itself is one of them. */
const PANORAMIC_SAMPLES = 41;

/** A frame's four corners, in ring order. */
type Quad = readonly [FootprintVertex, FootprintVertex, FootprintVertex, FootprintVertex];

/** Two opposite long sides of a frame, the same way round. */
type Rails = readonly [readonly [FootprintVertex, FootprintVertex], readonly [FootprintVertex, FootprintVertex]];

/** A side's length with its longitudes scaled by the cosine of its latitude (the frame's long sides are told from its ends). */
function sideLength(from: FootprintVertex, to: FootprintVertex): number {
    return Math.hypot((to.lng - from.lng) * Math.cos(toRadians(from.lat)), to.lat - from.lat);
}

/** The long sides of the four-cornered ring `a, b, c, d`. */
function railsOf([a, b, c, d]: Quad): Rails {
    return sideLength(a, b) >= sideLength(b, c)
        ? [
              [a, b],
              [d, c],
          ]
        : [
              [b, c],
              [a, d],
          ];
}

/** The two edges of the film at one scan angle: on the ground it lies at `tan` along the frame, and is `1 / cos` wide. */
function filmEdges([left, right]: Rails, theta: number): readonly [FootprintVertex, FootprintVertex] {
    const position = (1 + Math.tan(theta) / Math.tan(PANORAMIC_HALF_SCAN)) / 2;
    const [leftEnd, rightEnd] = [along(left[0], left[1], position), along(right[0], right[1], position)];
    const middle = along(leftEnd, rightEnd, 0.5);
    const narrowed = Math.cos(PANORAMIC_HALF_SCAN) / Math.cos(theta);
    return [along(middle, leftEnd, narrowed), along(middle, rightEnd, narrowed)];
}

/**
 * The bow tie a KH-9 panoramic frame really covers, as an open ring (the same model as the pipeline's). The film is a strip
 * of constant width swept through the scan angle theta, so its width on the ground follows the slant range, `1 / cos(theta)`:
 * USGS's four corners give the width at the frame's ends (theta 60.5 degrees), and straight down it is cos(60.5) of that,
 * about half. Sampled along the frame; the coverage clip takes a ring that is not convex.
 *
 * The figure is an estimate. On the measured frame D3C1202-200149F039 the shape holds to 0.24 km, but the true frame sits
 * about 7 km from where its USGS corners say, a constant shift nothing here can know: the model gives 53 % of Bucharest
 * (bounds 25.9 to 26.3, 44.3 to 44.6) where the frame was measured to cover about 51 %, and USGS's corners alone give 97 %.
 */
function panoramicRing(corners: Quad): FootprintVertex[] {
    const rails = railsOf(corners);
    const step = (2 * PANORAMIC_HALF_SCAN) / (PANORAMIC_SAMPLES - 1);
    const edges = Array.from({ length: PANORAMIC_SAMPLES }, (_sample, index) => filmEdges(rails, index * step - PANORAMIC_HALF_SCAN));
    return [...edges.map((pair) => pair[0]), ...edges.map((pair) => pair[1]).toReversed()];
}

/** A ring of just four corners (the sides of a footprint USGS draws otherwise cannot be told apart). */
function isQuad(ring: readonly FootprintVertex[]): ring is Quad {
    return ring.length === 4;
}

/** A ring's longitudes on the side of `middleLng`: a frame over longitude 180 is one piece around a city, never the world's width. */
function aroundLng(ring: readonly FootprintVertex[], middleLng: number): FootprintVertex[] {
    return ring.map((vertex) => ({ lat: vertex.lat, lng: vertex.lng + 360 * Math.round((middleLng - vertex.lng) / 360) }));
}

/**
 * The outline a frame's coverage uses, around `middleLng` (the city's): only the KH-9 panoramic camera's differs from the stored
 * footprint.
 */
export function coverageRing(
    footprint: readonly FootprintVertex[],
    camera: FrameCamera | undefined,
    middleLng: number,
): readonly FootprintVertex[] {
    const plain = aroundLng(footprint, middleLng);
    if (camera?.sensor !== 'KH-9-pan') {
        return plain;
    }
    const { corners } = camera;
    const ring = corners === undefined ? plain : aroundLng([corners.nw, corners.ne, corners.se, corners.sw], middleLng);
    return isQuad(ring) ? panoramicRing(ring) : plain;
}

/** The share of `bounds` that `footprint` (an open ring) of a frame of `camera` covers, 0 to 1. */
export function footprintCoverage(footprint: readonly FootprintVertex[], bounds: BoundsRecord, camera?: FrameCamera): number {
    const outline = coverageRing(footprint, camera, (bounds.west + bounds.east) / 2);
    const clipped = edgesOf(bounds).reduce<readonly FootprintVertex[]>((ring, edge) => clipRing(ring, edge), outline);
    const scale = Math.cos(toRadians((bounds.south + bounds.north) / 2));
    const whole = (bounds.east - bounds.west) * scale * (bounds.north - bounds.south);
    return clamp(ringArea(clipped, scale) / whole, 0, 1);
}

/** A ring of two or more positions whose last one repeats its first (GeoJSON's closing vertex). */
function isClosed(ring: readonly (readonly [number, number])[]): boolean {
    const [first, last] = [ring[0], ring.at(-1)];
    return ring.length > 1 && String(first) === String(last);
}

/**
 * An M2M `spatialCoverage` ring (`[lng, lat]` pairs, usually closed) as the scene document stores it: `{lat, lng}`
 * vertices, open, at most {@link MAX_FOOTPRINT_VERTICES} (evenly thinned when longer). Undefined for fewer than three
 * distinct vertices.
 */
export function footprintOf(ring: readonly (readonly [number, number])[]): FootprintVertex[] | undefined {
    const vertices = ring.map(([lng, lat]) => ({ lat, lng }));
    const open = isClosed(ring) ? vertices.slice(0, -1) : vertices;
    if (open.length < 3) {
        return undefined;
    }
    const step = Math.ceil(open.length / MAX_FOOTPRINT_VERTICES);
    return open.filter((_vertex, index) => index % step === 0);
}
