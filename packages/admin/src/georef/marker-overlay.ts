/**
 * Canvas badges on the georeferencer's map, painted with the same helpers as the scan (`@hcm/ui/admin/georef/marker-badge`).
 * Clicks pass through to Terra Draw / the map (the ghost's ring too: a click there is the pending pair's place); the canvas redraws on
 * every camera move.
 */
import type { Gcp } from '@hcm/shared';
import {
    badgePaletteOf,
    paintBadgeCross,
    paintGhostBadge,
    paintPairBadge,
    paintSuggestionBadge,
    type BadgeMarker,
    type BadgePalette,
    type BadgeTone,
} from '@hcm/ui/admin/georef/marker-badge';
import type { Unsubscribe } from '@hcm/ui/map';

import type { ProjectableMapPort } from '../map/projection.js';
import type { GeoPosition } from './pairs.js';
import type { SuggestionRow } from './suggestions.js';

export interface MarkerOverlayScene {
    readonly pairs: readonly Gcp[];
    readonly selected: string | null;
    readonly suggestions: readonly SuggestionRow[];
    readonly selectedSuggestion: string | null;
    readonly half: GeoPosition | null;
    /** The pending pair's expected place (`./ghost.ts`), a dashed ring the owner may click onto. */
    readonly ghost: GeoPosition | null;
    readonly crosshair: boolean;
    readonly tones: Readonly<Record<string, BadgeTone>>;
}

/** Transparent hit targets under the badges (Terra Draw still receives drags). */
export const DRAW_HIT_COLOR = 'rgba(0,0,0,.01)';

function pairBadge(pair: Gcp, index: number, tones: Readonly<Record<string, BadgeTone>>): BadgeMarker {
    return { id: pair.id, label: String(index + 1), enabled: pair.enabled, tone: tones[pair.id] ?? 'plain' };
}

function projected(
    port: ProjectableMapPort,
    geo: { readonly lng: number; readonly lat: number },
): { readonly x: number; readonly y: number } | null {
    return port.project([geo.lng, geo.lat]);
}

function paintMarkers(context: CanvasRenderingContext2D, port: ProjectableMapPort, scene: MarkerOverlayScene, palette: BadgePalette): void {
    const { pairs, selected, suggestions, selectedSuggestion, tones } = scene;
    for (const row of suggestions) {
        const at = projected(port, row.pair.geo);
        if (at !== null) {
            paintSuggestionBadge(
                context,
                at,
                { id: row.pair.id, label: row.label, enabled: true },
                {
                    selected: row.pair.id === selectedSuggestion,
                    palette,
                },
            );
        }
    }
    for (const [index, pair] of pairs.entries()) {
        const at = projected(port, pair.geo);
        if (at !== null) {
            paintPairBadge(context, at, pairBadge(pair, index, tones), { selected: pair.id === selected, palette });
        }
    }
}

/** Paints at `geo`'s point of the map, when there is one and it is on the map. */
function paintAt(port: ProjectableMapPort, geo: GeoPosition | null, paint: (at: { readonly x: number; readonly y: number }) => void): void {
    const at = geo === null ? null : projected(port, geo);
    if (at !== null) {
        paint(at);
    }
}

function paintExtras(
    context: CanvasRenderingContext2D,
    port: ProjectableMapPort,
    scene: MarkerOverlayScene,
    look: { readonly palette: BadgePalette; readonly canvas: HTMLCanvasElement },
): void {
    paintAt(port, scene.ghost, (at) => {
        paintGhostBadge(context, at, look.palette);
    });
    paintAt(port, scene.half, (at) => {
        paintBadgeCross(context, at, look.palette.marker);
    });
    if (scene.crosshair) {
        paintBadgeCross(context, { x: look.canvas.clientWidth / 2, y: look.canvas.clientHeight / 2 }, look.palette.outline);
    }
}

function sizedContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
    const ratio = Math.max(globalThis.devicePixelRatio, 1);
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

/** Node fakes may omit `ownerDocument`; typed DOM hosts always have one. */
function documentOf(host: HTMLElement): Document | null {
    return (host as unknown as { readonly ownerDocument?: Document | null }).ownerDocument ?? null;
}

/** Full-size badge canvas on the map host, or null when the host cannot take one. */
function canvasOn(host: HTMLElement): HTMLCanvasElement | null {
    const doc = documentOf(host);
    if (typeof host.append !== 'function' || doc === null) {
        return null;
    }
    const canvas = doc.createElement('canvas');
    canvas.dataset['georefBadges'] = '';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2';
    if (typeof getComputedStyle === 'function' && getComputedStyle(host).position === 'static') {
        host.style.position = 'relative';
    }
    host.append(canvas);
    return canvas;
}

export class GeorefMarkerOverlay {
    #canvas: HTMLCanvasElement | null = null;
    #port: ProjectableMapPort | null = null;
    #stop: Unsubscribe | null = null;
    #scene: MarkerOverlayScene = {
        pairs: [],
        selected: null,
        suggestions: [],
        selectedSuggestion: null,
        half: null,
        ghost: null,
        crosshair: false,
        tones: {},
    };

    /** Puts a full-size canvas over the map host (pointer-events none). No-op in Node tests without a DOM host. */
    attach(host: HTMLElement, port: ProjectableMapPort): void {
        this.detach();
        this.#port = port;
        this.#stop = port.on('move', () => {
            this.paint();
        });
        const canvas = canvasOn(host);
        if (canvas === null) {
            return;
        }
        this.#canvas = canvas;
        this.paint();
    }

    setScene(scene: MarkerOverlayScene): void {
        this.#scene = scene;
        this.paint();
    }

    paint(): void {
        const canvas = this.#canvas;
        const port = this.#port;
        if (canvas === null || port === null) {
            return;
        }
        const context = sizedContext(canvas);
        if (context === null) {
            return;
        }
        const palette = badgePaletteOf(canvas);
        paintMarkers(context, port, this.#scene, palette);
        paintExtras(context, port, this.#scene, { palette, canvas });
    }

    detach(): void {
        this.#stop?.();
        this.#stop = null;
        this.#canvas?.remove();
        this.#canvas = null;
        this.#port = null;
    }
}
