/**
 * The lightbox's zoom and pan (scenario V08): a scale between 1 and `MAX_SCALE` and an offset that never shows
 * more than the image's edge. Pure, so the gestures (pinch, wheel, keys, drag) are tested apart from the element.
 */

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;

/** One key press multiplies or divides the scale by this. */
export const KEY_ZOOM_STEP = 1.25;

/** A double tap zooms in to this scale, at the tapped point (the Pixel 9 Pro review, P6). */
export const DOUBLE_TAP_SCALE = 2.5;

/** Wheel sensitivity: a typical 100 px notch zooms by about 22 %. */
const WHEEL_FACTOR = 0.002;

export interface Point {
    readonly x: number;
    readonly y: number;
}

export interface ZoomState {
    readonly scale: number;
    /** The image's translation in CSS px, applied before the scale. */
    readonly offset: Point;
}

export const ZOOM_RESET: ZoomState = { scale: MIN_SCALE, offset: { x: 0, y: 0 } };

export function clampScale(scale: number): number {
    return Number.isFinite(scale) ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)) : MIN_SCALE;
}

function clampAxis(value: number, scale: number, size: number): number {
    const limit = ((scale - 1) * size) / 2 / scale;
    // Adding 0 turns a clamped -0 into 0, so a resting image reads (and transforms) as exactly 0.
    return Math.min(limit, Math.max(-limit, value)) + 0;
}

/** Keeps the image covering its box: at scale 1 the offset is 0, at scale s at most (s - 1) / 2 of the box. */
export function clampOffset(offset: Point, scale: number, box: Point): Point {
    return { x: clampAxis(offset.x, scale, box.x), y: clampAxis(offset.y, scale, box.y) };
}

/** A new scale (clamped), keeping the offset inside the box. */
export function zoomTo(state: ZoomState, scale: number, box: Point): ZoomState {
    const next = clampScale(scale);
    return { scale: next, offset: clampOffset(state.offset, next, box) };
}

/** A wheel turn: up (negative `deltaY`) zooms in. */
export function wheelScale(scale: number, deltaY: number): number {
    return clampScale(scale * Math.exp(-deltaY * WHEEL_FACTOR));
}

export function distance(a: Point, b: Point): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The scale while pinching: the start scale times how much the fingers spread (a zero start distance changes nothing). */
export function pinchScale(startScale: number, startDistance: number, currentDistance: number): number {
    return startDistance > 0 ? clampScale((startScale * currentDistance) / startDistance) : clampScale(startScale);
}

/** Moves the image by a drag of `delta` screen px (divided by the scale, because the offset is applied before it). */
export function panBy(state: ZoomState, delta: Point, box: Point): ZoomState {
    const offset = { x: state.offset.x + delta.x / state.scale, y: state.offset.y + delta.y / state.scale };
    return { scale: state.scale, offset: clampOffset(offset, state.scale, box) };
}

/**
 * A new scale (clamped) that keeps the image's point under `at` where it is: `at` is in screen px from the centre of the
 * box (the image's transform origin). The image shows `centre + scale × (point + offset)`, so the offset moves by
 * `at / next - at / scale`; then it is kept inside the box.
 */
export function zoomAt(state: ZoomState, scale: number, at: Point, box: Point): ZoomState {
    const next = clampScale(scale);
    const offset = { x: state.offset.x + at.x / next - at.x / state.scale, y: state.offset.y + at.y / next - at.y / state.scale };
    return { scale: next, offset: clampOffset(offset, next, box) };
}

/** A double tap: zoomed in at the tapped point, or back to the whole image when it was already zoomed. */
export function doubleTapZoom(state: ZoomState, at: Point, box: Point): ZoomState {
    return state.scale > MIN_SCALE ? ZOOM_RESET : zoomAt(state, DOUBLE_TAP_SCALE, at, box);
}

/** Two taps this close in time (ms) and place (px) are a double tap. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP_PX = 24;
/** A press that moved further than this (px) was a drag, not a tap. */
const TAP_SLOP_PX = 10;

/** A finished tap: where (screen px) and when (the event's time stamp, ms). */
export interface Tap {
    readonly x: number;
    readonly y: number;
    readonly time: number;
}

/** Whether a press from `down` to `up` was a tap (it did not drag). */
export function isTap(down: Point, up: Point): boolean {
    return distance(down, up) <= TAP_SLOP_PX;
}

/** Whether `tap` completes a double tap begun by `previous`. */
export function isDoubleTap(previous: Tap | null, tap: Tap): boolean {
    return previous !== null && tap.time - previous.time <= DOUBLE_TAP_MS && distance(previous, tap) <= DOUBLE_TAP_SLOP_PX;
}
