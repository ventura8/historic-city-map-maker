/**
 * `FakeMapDraw` (docs/research/M2c-interfaces.md §4.7): a recording `MapDrawPort` for the admin's area modules, which
 * are tested by what they ask the drawing tools to do. `emitChange`, `emitSelect`, `emitRefused` and `resolvePick` play
 * the map's side (a finished shape, a drag, a selection, a refused position, the click of a pick).
 */
import type { LngLat } from '@hcm/shared';

import type {
    DrawChange,
    DrawMode,
    DrawnFeature,
    DrawnFeatureInput,
    DrawOptions,
    DrawRefusal,
    GeometryInput,
    MapDrawPort,
} from '../../ui/src/map/draw/draw-port.js';
import type { MapPort, Unsubscribe } from '../../ui/src/map/map-port.js';
import type { RecordedCall } from './fake-map.js';

interface DrawHandlers {
    readonly change: Set<(change: DrawChange) => void>;
    readonly select: Set<(id: string | null) => void>;
    readonly refused: Set<(refusal: DrawRefusal) => void>;
}

/** A mutable copy of a geometry (`load` takes read-only positions). */
function copyGeometry(geometry: GeometryInput): DrawnFeature['geometry'] {
    return JSON.parse(JSON.stringify(geometry)) as DrawnFeature['geometry'];
}

export class FakeMapDraw implements MapDrawPort {
    readonly calls: RecordedCall[] = [];
    mode: DrawMode = 'static';
    /** The `drawId` of the last `setMode`. */
    drawId: string | null = null;
    /** What `load` set, or the last final change. */
    features: readonly DrawnFeature[] = [];
    selected: string | null = null;
    attached: { readonly map: MapPort; readonly options: DrawOptions } | null = null;
    color: string | null = null;
    #pick: ((position: LngLat | null) => void) | null = null;
    readonly #handlers: DrawHandlers = { change: new Set(), select: new Set(), refused: new Set() };

    /** The calls of one method, oldest first. */
    callsOf(method: string): readonly (readonly unknown[])[] {
        return this.calls.filter((call) => call.method === method).map((call) => call.args);
    }

    #record(method: string, ...args: readonly unknown[]): void {
        this.calls.push({ method, args });
    }

    attach(map: MapPort, options: DrawOptions): void {
        this.#record('attach', map, options);
        this.attached = { map, options };
        this.color = options.color;
    }

    setMode(mode: DrawMode, drawId?: string): void {
        this.#record('setMode', mode, drawId);
        this.cancelPick();
        this.mode = mode;
        this.drawId = drawId ?? null;
    }

    load(features: readonly DrawnFeatureInput[]): void {
        this.#record('load', features);
        this.features = features.map((feature) => ({ ...feature, geometry: copyGeometry(feature.geometry) }));
    }

    snapshot(): readonly DrawnFeature[] {
        return this.features;
    }

    select(id: string | null): void {
        this.#record('select', id);
        this.emitSelect(id);
    }

    deleteSelected(): void {
        this.#record('deleteSelected');
        const selected = this.selected;
        if (selected !== null) {
            this.emitSelect(null);
            this.emitChange(this.features.filter((feature) => feature.id !== selected));
        }
    }

    pick(): Promise<LngLat | null> {
        this.#record('pick');
        this.cancelPick();
        return new Promise((resolve) => {
            this.#pick = resolve;
        });
    }

    cancelPick(): void {
        this.resolvePick(null);
    }

    setColor(color: string): void {
        this.#record('setColor', color);
        this.color = color;
    }

    on(event: 'change', handler: (change: DrawChange) => void): Unsubscribe;
    on(event: 'select', handler: (id: string | null) => void): Unsubscribe;
    on(event: 'refused', handler: (refusal: DrawRefusal) => void): Unsubscribe;
    on(event: keyof DrawHandlers, handler: (payload: never) => void): Unsubscribe {
        const handlers = this.#handlers[event] as Set<(payload: never) => void>;
        handlers.add(handler);
        return () => {
            handlers.delete(handler);
        };
    }

    detach(): void {
        this.#record('detach');
        this.cancelPick();
        this.attached = null;
    }

    /** Whether a `pick` waits for its click. */
    get picking(): boolean {
        return this.#pick !== null;
    }

    /** How many subscribers are listening. */
    get listenerCount(): number {
        return this.#handlers.change.size + this.#handlers.select.size + this.#handlers.refused.size;
    }

    /** A finished shape or edit (`final`), or a drag's frame; a final change becomes the snapshot. */
    emitChange(features: readonly DrawnFeature[], final = true): void {
        if (final) {
            this.features = [...features];
        }
        for (const handler of this.#handlers.change) {
            handler({ features, final });
        }
    }

    emitSelect(id: string | null): void {
        this.selected = id;
        for (const handler of this.#handlers.select) {
            handler(id);
        }
    }

    emitRefused(refusal: DrawRefusal): void {
        for (const handler of this.#handlers.refused) {
            handler(refusal);
        }
    }

    /** The map click a pending `pick` waits for (null: Esc); nothing without one. */
    resolvePick(position: LngLat | null): void {
        const resolve = this.#pick;
        this.#pick = null;
        resolve?.(position);
    }
}
