/**
 * Which Mapbox layers draw each overlay, and the live visibility and opacity of every overlay (PLAN Addendum 3). Opacity
 * changes are coalesced to one paint update per animation frame, so a slider dragged at 120 Hz costs one
 * `setPaintProperty` per map layer per frame. Paint property names come only from `overlayOpacityPaint`.
 */
import { clamp, overlayOpacityPaint, type MapLayerType, type OpacityBase, type OpacityProperty, type OverlayKind } from '@hcm/shared';

import type { MapboxMap } from './mapbox-types.js';

/** requestAnimationFrame and cancelAnimationFrame, injected so the node tests drive the frames. */
export interface FrameScheduler {
    request(callback: () => void): number;
    cancel(handle: number): void;
}

/** One Mapbox layer of an overlay, with its designed opacity per paint property (absent: 1). */
export interface MapLayerEntry {
    readonly id: string;
    readonly type: MapLayerType;
    readonly base: OpacityBase;
}

export interface OverlayEntry {
    readonly kind: OverlayKind;
    /** Map layers in drawing order (bottom first). */
    readonly layers: readonly MapLayerEntry[];
    /** The sources these layers read, removed with the overlay. */
    readonly sources: readonly string[];
    readonly visible: boolean;
    readonly opacity: number;
}

/** The opacity paint of one map layer of a `kind` overlay at `opacity`: its own properties only, base applied. */
export function layerOpacityPaint(kind: OverlayKind, layer: MapLayerEntry, opacity: number): Partial<Record<OpacityProperty, number>> {
    const updates = overlayOpacityPaint(kind, opacity, layer.base).filter((update) => update.layerType === layer.type);
    return Object.fromEntries(updates.map((update) => [update.property, update.value]));
}

export function visibilityValue(visible: boolean): 'visible' | 'none' {
    return visible ? 'visible' : 'none';
}

function safeOpacity(opacity: number): number {
    return Number.isFinite(opacity) ? clamp(opacity, 0, 1) : 1;
}

export class OverlayRegistry {
    readonly #map: MapboxMap;
    readonly #frames: FrameScheduler;
    readonly #entries = new Map<string, OverlayEntry>();
    readonly #pending = new Map<string, number>();
    #frame: number | null = null;

    constructor(map: MapboxMap, frames: FrameScheduler) {
        this.#map = map;
        this.#frames = frames;
    }

    get(id: string): OverlayEntry | undefined {
        return this.#entries.get(id);
    }

    entries(): readonly [string, OverlayEntry][] {
        return [...this.#entries];
    }

    /** Registers an overlay whose layers and sources were just added (or replaces its record). */
    set(id: string, entry: OverlayEntry): void {
        this.#pending.delete(id);
        this.#entries.set(id, { ...entry, opacity: safeOpacity(entry.opacity) });
    }

    /** Removes the overlay's layers (top first) and sources from the map; an unknown id does nothing. */
    remove(id: string): void {
        const entry = this.#entries.get(id);
        if (entry === undefined) {
            return;
        }
        for (const layer of entry.layers.toReversed()) {
            this.#map.removeLayer(layer.id);
        }
        for (const source of entry.sources) {
            this.#map.removeSource(source);
        }
        this.#entries.delete(id);
        this.#pending.delete(id);
    }

    /** True when the visibility changed. */
    setVisibility(id: string, visible: boolean): boolean {
        const entry = this.#entries.get(id);
        if (entry === undefined || entry.visible === visible) {
            return false;
        }
        for (const layer of entry.layers) {
            this.#map.setLayoutProperty(layer.id, 'visibility', visibilityValue(visible));
        }
        this.#entries.set(id, { ...entry, visible });
        return true;
    }

    /** Records the opacity and paints it on the next animation frame (the last value of the frame wins). */
    setOpacity(id: string, opacity: number): void {
        if (!this.#entries.has(id)) {
            return;
        }
        this.#pending.set(id, safeOpacity(opacity));
        this.#frame ??= this.#frames.request(() => {
            this.#frame = null;
            this.flush();
        });
    }

    /** Paints every pending opacity now (a removed overlay has no pending opacity left). */
    flush(): void {
        for (const [id, entry] of this.#entries) {
            const opacity = this.#pending.get(id);
            if (opacity !== undefined) {
                this.#paint(id, entry, opacity);
            }
        }
        this.#pending.clear();
    }

    #paint(id: string, entry: OverlayEntry, opacity: number): void {
        for (const layer of entry.layers) {
            for (const [property, value] of Object.entries(layerOpacityPaint(entry.kind, layer, opacity))) {
                this.#map.setPaintProperty(layer.id, property, value);
            }
        }
        this.#entries.set(id, { ...entry, opacity });
    }

    /** Cancels a scheduled frame; nothing is painted any more. */
    destroy(): void {
        if (this.#frame !== null) {
            this.#frames.cancel(this.#frame);
            this.#frame = null;
        }
        this.#pending.clear();
        this.#entries.clear();
    }
}
