/**
 * The scan pane's view (`docs/research/M3-interfaces.md` §10.4): where the scan preview sits in the pane, zoomed from
 * "fit" up to 32×, panned and turned (each pane rotates on its own, 2026-11-12), and the conversions between the pane's CSS pixels, the preview's pixels and the
 * full-resolution scan's (`pixel × previewScale` is the preview's: §6.1). Pure, so the element only draws and listens.
 */
import { clamp } from '@hcm/shared';

import { PAIR_HIT_RADIUS } from './marker-badge.js';

export interface Point {
    readonly x: number;
    readonly y: number;
}

export interface Size {
    readonly width: number;
    readonly height: number;
}

/** How far the admin may zoom in, beyond the scale that fits the whole preview. */
export const MAX_ZOOM = 32;

export interface ScanView {
    /** CSS pixels per preview pixel. */
    readonly scale: number;
    /** Where the preview's origin is in the pane (CSS pixels). */
    readonly offset: Point;
    /** How far the scan is turned in the pane, in radians clockwise about its origin (absent or 0: upright). */
    readonly angle?: number;
}

/** A vector turned by `angle` radians clockwise (the pane's y axis points down). */
function turned(vector: Point, angle = 0): Point {
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    return { x: vector.x * cos - vector.y * sin, y: vector.x * sin + vector.y * cos };
}

/** The whole preview in the pane, centred. */
export function fitView(pane: Size, image: Size): ScanView {
    const scale = Math.min(pane.width / Math.max(image.width, 1), pane.height / Math.max(image.height, 1));
    return { scale, offset: { x: (pane.width - image.width * scale) / 2, y: (pane.height - image.height * scale) / 2 } };
}

/**
 * The view that shows `box` (full-resolution scan pixels) as large as the pane holds, centred (admin sweep 2026-11-14, bug 6: a whole
 * Corona strip opened fitted, the city a few pixels); within fit … fit × `MAX_ZOOM`.
 */
function boxView(pane: Size, box: { readonly x: number; readonly y: number } & Size, previewScale: number, fit: ScanView): ScanView {
    const across = Math.min(pane.width / Math.max(box.width, 1), pane.height / Math.max(box.height, 1));
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    return centredView(pane, { centre, scale: across }, previewScale, fit);
}

/** The full-resolution scan pixel at the pane's centre; the scan's middle when the pane was never shown. */
export function paneCentre(view: ScanView, pane: Size, scan: Size, previewScale: number): Point {
    if (pane.width === 0 || pane.height === 0) {
        return { x: scan.width / 2, y: scan.height / 2 };
    }
    return paneToScan(view, { x: pane.width / 2, y: pane.height / 2 }, previewScale);
}

/** The first view: on `opening` (where the city likely lies) once the pane is shown, else the whole scan (`fit`). */
export function openedView(
    pane: Size,
    opening: ({ readonly x: number; readonly y: number } & Size) | null,
    previewScale: number,
    fit: ScanView,
): ScanView {
    return opening === null || pane.width === 0 ? fit : boxView(pane, opening, previewScale, fit);
}

/** The view zoomed by `factor` about the pane point `at`, within fit … fit × `MAX_ZOOM`. */
export function zoomView(view: ScanView, factor: number, at: Point, fit: ScanView): ScanView {
    const scale = clamp(view.scale * factor, fit.scale, fit.scale * MAX_ZOOM);
    const kept = scale / view.scale;
    return { ...view, scale, offset: { x: at.x - (at.x - view.offset.x) * kept, y: at.y - (at.y - view.offset.y) * kept } };
}

/**
 * The view with the full-resolution `camera.centre` at the pane's centre, `camera.scale` CSS px a scan pixel (within fit … fit ×
 * `MAX_ZOOM`), turned by `camera.angle` (absent: upright).
 */
export function centredView(
    pane: Size,
    camera: { readonly centre: Point; readonly scale: number; readonly angle?: number | undefined },
    previewScale: number,
    fit: ScanView,
): ScanView {
    const zoom = clamp(camera.scale / previewScale, fit.scale, fit.scale * MAX_ZOOM);
    const across = previewScale * zoom;
    const centre = turned({ x: camera.centre.x * across, y: camera.centre.y * across }, camera.angle);
    const offset = { x: pane.width / 2 - centre.x, y: pane.height / 2 - centre.y };
    return camera.angle === undefined ? { scale: zoom, offset } : { scale: zoom, offset, angle: camera.angle };
}

/** The view turned by `delta` radians clockwise about the pane point `about` (the pane's centre: what is there stays there). */
export function rotateView(view: ScanView, delta: number, about: Point): ScanView {
    const arm = turned({ x: view.offset.x - about.x, y: view.offset.y - about.y }, delta);
    return { scale: view.scale, offset: { x: about.x + arm.x, y: about.y + arm.y }, angle: (view.angle ?? 0) + delta };
}

/**
 * The view after the pane went from `before` to `after` (a scrollbar came, the window changed): still the whole preview when it showed
 * the whole preview (or the pane had never been shown), else the same zoom with the same scan point at the pane's centre, so a pair
 * added below never throws the owner's zoom away (2026-11-12).
 */
export function resizedView(view: ScanView, before: Size, after: Size, image: Size): ScanView {
    if (before.width === 0 || before.height === 0 || view.scale <= fitView(before, image).scale) {
        return fitView(after, image);
    }
    return panView(view, (after.width - before.width) / 2, (after.height - before.height) / 2);
}

export function panView(view: ScanView, dx: number, dy: number): ScanView {
    return { ...view, offset: { x: view.offset.x + dx, y: view.offset.y + dy } };
}

/** A pane point as a full-resolution scan pixel. */
export function paneToScan(view: ScanView, at: Point, previewScale: number): Point {
    const upright = turned({ x: at.x - view.offset.x, y: at.y - view.offset.y }, -(view.angle ?? 0));
    return { x: upright.x / view.scale / previewScale, y: upright.y / view.scale / previewScale };
}

/** A full-resolution scan pixel as a pane point. */
export function scanToPane(view: ScanView, pixel: Point, previewScale: number): Point {
    const across = previewScale * view.scale;
    const drawn = turned({ x: pixel.x * across, y: pixel.y * across }, view.angle);
    return { x: view.offset.x + drawn.x, y: view.offset.y + drawn.y };
}

/** The pair under a pane point (the nearest within `HIT_RADIUS`), or null. */
export function hitPair<P extends { readonly id: string; readonly pixel: Point }>(
    view: ScanView,
    pairs: readonly P[],
    at: Point,
    previewScale: number,
): P | null {
    let best: P | null = null;
    let distance = PAIR_HIT_RADIUS;
    for (const pair of pairs) {
        const point = scanToPane(view, pair.pixel, previewScale);
        const here = Math.hypot(point.x - at.x, point.y - at.y);
        if (here <= distance) {
            best = pair;
            distance = here;
        }
    }
    return best;
}
