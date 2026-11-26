/**
 * Draws the georeferencer's scan pane (`./hcm-scan-viewer.ts`): the scan preview at the view's scale and offset, the
 * pairs' numbered markers (shared with the map: `./marker-badge.ts`), the half pair's cross, the ghost of a pair begun on the map
 * and, while the pane has the keyboard, the crosshair at its centre; zoomed past the preview's own pixels, the sharper scan's tiles over it.
 */
import {
    badgePaletteOf,
    paintBadgeCross,
    paintGhostBadge,
    paintPairBadge,
    paintSuggestionBadge,
    type BadgeMarker,
    type BadgePalette,
} from './marker-badge.js';
import type { ScanDetailScene } from './scan-tiles.js';
import { scanToPane, type Point, type ScanView } from './scan-view.js';

export interface ScanMarker extends BadgeMarker {
    readonly pixel: Point;
}

export interface ScanScene {
    readonly image: CanvasImageSource | null;
    readonly view: ScanView;
    readonly previewScale: number;
    readonly markers: readonly ScanMarker[];
    readonly selected: string | null;
    readonly half: Point | null;
    readonly crosshair: boolean;
    /** The marker being dragged, at its pointer's place. */
    readonly dragged: ScanMarker | null;
    /** M4: the matcher's suggestions, dashed and hollow, the selected one larger (`docs/research/M4-interfaces.md` §2.5). */
    readonly suggestions?: readonly ScanMarker[];
    readonly selectedSuggestion?: string | null;
    /** The sharper scan's decoded tiles in view and their pixels per scan pixel, drawn over the preview (`./scan-tiles.ts`). */
    readonly detail?: ScanDetailScene | null;
    /** Where the pairs so far expect the pending pair's scan end (a dashed ring, `./marker-badge.ts`). */
    readonly ghost?: Point | null;
}

/** The canvas sized to its box at the device's pixel ratio, cleared; null without a 2D context. */
function sized(canvas: HTMLCanvasElement, ratio: number): CanvasRenderingContext2D | null {
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
    const context = canvas.getContext('2d');
    if (context === null) {
        return null;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    return context;
}

/** The markers as they stand, the dragged one at its pointer. */
function placed(scene: ScanScene): readonly ScanMarker[] {
    const dragged = scene.dragged;
    return dragged === null ? scene.markers : scene.markers.map((item) => (item.id === dragged.id ? dragged : item));
}

/** The canvas transform that draws a picture of `scale` pane px a pixel at the view's offset and angle. */
function place(context: CanvasRenderingContext2D, view: ScanView, scale: number, ratio: number): void {
    const [cos, sin] = [Math.cos(view.angle ?? 0) * ratio * scale, Math.sin(view.angle ?? 0) * ratio * scale];
    context.setTransform(cos, sin, -sin, cos, ratio * view.offset.x, ratio * view.offset.y);
}

/** The scan at the view's scale, offset and angle: the preview, and over it the sharper scan's decoded tiles in view. */
function image(context: CanvasRenderingContext2D, scene: ScanScene, ratio: number): void {
    if (scene.image !== null) {
        place(context, scene.view, scene.view.scale, ratio);
        context.drawImage(scene.image, 0, 0);
    }
    const detail = scene.detail ?? null;
    if (detail !== null) {
        place(context, scene.view, (scene.view.scale * scene.previewScale) / detail.scale, ratio);
        for (const piece of detail.pieces) {
            context.drawImage(piece.image, piece.x, piece.y);
        }
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

/** The suggestions (dashed, under) and the pairs (over them), the dragged one at its pointer. */
function markers(context: CanvasRenderingContext2D, scene: ScanScene, palette: BadgePalette): void {
    for (const item of scene.suggestions ?? []) {
        paintSuggestionBadge(context, scanToPane(scene.view, item.pixel, scene.previewScale), item, {
            selected: item.id === scene.selectedSuggestion,
            palette,
        });
    }
    for (const item of placed(scene)) {
        paintPairBadge(context, scanToPane(scene.view, item.pixel, scene.previewScale), item, {
            selected: item.id === scene.selected,
            palette,
        });
    }
}

export function drawScan(canvas: HTMLCanvasElement, scene: ScanScene): void {
    const ratio = Math.max(globalThis.devicePixelRatio, 1);
    const context = sized(canvas, ratio);
    if (context === null) {
        return;
    }
    const palette = badgePaletteOf(canvas);
    image(context, scene, ratio);
    markers(context, scene, palette);
    pending(context, scene, palette);
    if (scene.crosshair) {
        paintBadgeCross(context, { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, palette.outline);
    }
}

/** The pending pair: the ghost of one begun on the map, the cross of one begun here. */
function pending(context: CanvasRenderingContext2D, scene: ScanScene, palette: BadgePalette): void {
    const ghost = scene.ghost ?? null;
    if (ghost !== null) {
        paintGhostBadge(context, scanToPane(scene.view, ghost, scene.previewScale), palette);
    }
    if (scene.half !== null) {
        paintBadgeCross(context, scanToPane(scene.view, scene.half, scene.previewScale), palette.marker);
    }
}
