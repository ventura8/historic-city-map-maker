/**
 * `MapDrawPort` on `MapPort` alone: the admin's drawing tools while Terra Draw is not loaded or fails to load
 * (docs/research/M2c-interfaces.md §4.2; Terra Draw is installed since DECISIONS-for-review.md §34g). Drawing is by
 * clicks only, as with the Terra Draw tools (`click-growth.ts`):
 *
 * - a point is one click; a rectangle two corners; both then switch to `select`;
 * - a line exists from its second click, an area from its third; every further click adds a vertex at the end, until the
 *   editor picks another tool, so Save works at any time and the input budget holds (n clicks for n vertices);
 * - in `select`, a click on the map moves the selected point there (a photo's pin, a point place): the single-pointer way
 *   to place it (WCAG 2.5.7), within the same limits;
 * - nothing is dragged: vertices are moved, inserted and removed in the vertex list, which `load`s the result.
 *
 * The shapes are drawn as one vector overlay whose clicks pass through to the map, in the editor's colour. The same
 * limits as Terra Draw's are checked (`rules.ts`); positions are rounded to `DRAW_DECIMALS` places.
 */
import { DEFAULT_POI_ICON, type Geometry, type LngLat } from '@hcm/shared';

import { Listeners } from '../listeners.js';
import type { MapPort, PoiFeature, Unsubscribe } from '../map-port.js';
import type {
    DrawChange,
    DrawMode,
    DrawnFeature,
    DrawnFeatureInput,
    DrawOptions,
    DrawRefusal,
    DrawShape,
    MapDrawPort,
} from './draw-port.js';
import { growByClick, shapeOfMode, sketchGeometry, type Position } from './click-growth.js';
import { checkGeometry, checkPositions, roundGeometry, roundPosition } from './rules.js';

export { drawnPositions, shapeGeometry } from './click-growth.js';

/** The overlay the shapes are drawn in (clicks pass through it). */
export const CLICK_DRAW_OVERLAY_ID = 'hcm-draw';

/** A subscriber that throws is the subscriber's problem: drawing goes on. */
const ignore = (): void => undefined;

interface Session {
    readonly map: MapPort;
    readonly options: DrawOptions;
    readonly stop: Unsubscribe;
}

class ClickDrawPort implements MapDrawPort {
    readonly #changes = new Listeners<[DrawChange]>(ignore);
    readonly #selections = new Listeners<[string | null]>(ignore);
    readonly #refusals = new Listeners<[DrawRefusal]>(ignore);
    readonly #good = new Map<string, DrawnFeature>();
    #session: Session | null = null;
    #mode: DrawMode = 'static';
    #drawId: string | null = null;
    /** The positions of a shape that is not one yet (a line's first click, an area's first two). */
    #sketch: Position[] = [];
    #selected: string | null = null;
    #pick: ((position: LngLat | null) => void) | null = null;
    #ids = 0;

    get mode(): DrawMode {
        return this.#mode;
    }

    attach(map: MapPort, options: DrawOptions): void {
        this.detach();
        const stop = map.onMapClick((position) => {
            this.#onClick(roundPosition(position));
        });
        this.#session = { map, options, stop };
        this.#render();
    }

    #onClick(position: Position): void {
        const session = this.#session;
        if (session === null || this.#pick !== null) {
            return;
        }
        const refusal = checkPositions([position], session.options);
        if (refusal !== null) {
            this.#refuseIfActive(refusal);
            return;
        }
        const shape = shapeOfMode(this.#mode);
        if (shape === null) {
            this.#moveSelectedPoint(position);
        } else {
            this.#add(session, shape, position);
        }
    }

    /** A click outside the limits is refused where a click does something: a drawing tool, or a point to move. */
    #refuseIfActive(refusal: DrawRefusal): void {
        if (shapeOfMode(this.#mode) !== null || this.#selectedPoint() !== null) {
            this.#refusals.emit(refusal);
        }
    }

    /** The selected feature while the tools select and it is a point; null otherwise. */
    #selectedPoint(): DrawnFeature | null {
        const selected = this.#mode === 'select' && this.#selected !== null ? this.#good.get(this.#selected) : undefined;
        return selected?.geometry.type === 'Point' ? selected : null;
    }

    /** In `select`, the selected point goes where the map was clicked. */
    #moveSelectedPoint(position: Position): void {
        const point = this.#selectedPoint();
        if (point === null) {
            return;
        }
        this.#good.set(point.id, { ...point, geometry: { type: 'Point', coordinates: position } });
        this.#render();
        this.#changes.emit({ features: this.snapshot(), final: true });
    }

    #add(session: Session, shape: DrawShape, position: Position): void {
        const id = this.#drawId ?? this.#newId();
        this.#drawId = id;
        const growth = growByClick({ id, shape, drawn: this.#good.get(id), sketch: this.#sketch, position, options: session.options });
        if (growth.kind === 'sketch') {
            this.#sketch = [...growth.positions];
            this.#render();
        } else if (growth.kind === 'shape') {
            this.#keep(growth.feature, growth.finished);
        } else {
            this.#refusals.emit(growth.refusal);
        }
    }

    #keep(feature: DrawnFeature, finished: boolean): void {
        this.#sketch = [];
        this.#good.set(feature.id, feature);
        this.#render();
        this.#changes.emit({ features: this.snapshot(), final: true });
        if (finished) {
            this.setMode('select');
            this.select(feature.id);
        }
    }

    #newId(): string {
        this.#ids += 1;
        return `hcm-draw-${String(this.#ids)}`;
    }

    /** The overlay: every shape, and the sketch (a point, then a line) while one is being started. */
    #render(): void {
        const session = this.#session;
        if (session === null) {
            return;
        }
        const features: PoiFeature[] = [...this.#good.values()].map((feature) => this.#feature(feature.id, feature.geometry));
        const sketch = sketchGeometry(this.#sketch);
        if (sketch !== null) {
            features.push(this.#feature('sketch', sketch));
        }
        session.map.addVectorOverlay(
            {
                ...{ id: CLICK_DRAW_OVERLAY_ID, kind: 'poi', features, color: session.options.color },
                ...{ icon: DEFAULT_POI_ICON, visible: true, opacity: 1, clickable: false },
            },
            'top',
        );
    }

    #feature(id: string, geometry: Geometry): PoiFeature {
        return { type: 'Feature', geometry, properties: { id: `${CLICK_DRAW_OVERLAY_ID}:${id}`, title: '' } };
    }

    setMode(mode: DrawMode, drawId?: string): void {
        this.cancelPick();
        this.#mode = mode;
        this.#drawId = drawId ?? null;
        if (this.#sketch.length > 0) {
            this.#sketch = [];
            this.#render();
        }
    }

    load(features: readonly DrawnFeatureInput[]): void {
        this.#good.clear();
        for (const feature of features) {
            this.#loadOne(feature);
        }
        this.#render();
        this.select(this.#selected);
    }

    #loadOne(feature: DrawnFeatureInput): void {
        const geometry = roundGeometry(feature.geometry);
        const options = this.#session?.options;
        const refusal = options === undefined ? null : checkGeometry(geometry, options);
        if (refusal === null) {
            this.#good.set(feature.id, { ...feature, geometry });
        } else {
            this.#refusals.emit(refusal);
        }
    }

    snapshot(): readonly DrawnFeature[] {
        return [...this.#good.values()];
    }

    select(id: string | null): void {
        const ours = id !== null && this.#good.has(id) ? id : null;
        if (ours !== this.#selected) {
            this.#selected = ours;
            this.#selections.emit(ours);
        }
    }

    deleteSelected(): void {
        const selected = this.#selected;
        if (selected === null) {
            return;
        }
        this.#good.delete(selected);
        this.select(null);
        this.#render();
        this.#changes.emit({ features: this.snapshot(), final: true });
    }

    pick(): Promise<LngLat | null> {
        this.cancelPick();
        const map = this.#session?.map;
        if (map === undefined) {
            return Promise.resolve(null);
        }
        return new Promise((resolve) => {
            const stop = map.onMapClick((position) => {
                finish(roundPosition(position));
            });
            const finish = (position: LngLat | null): void => {
                stop();
                this.#pick = null;
                resolve(position);
            };
            this.#pick = finish;
        });
    }

    cancelPick(): void {
        this.#pick?.(null);
    }

    setColor(color: string): void {
        const session = this.#session;
        if (session !== null) {
            this.#session = { ...session, options: { ...session.options, color } };
            this.#render();
        }
    }

    on(event: 'change', handler: (change: DrawChange) => void): Unsubscribe;
    on(event: 'select', handler: (id: string | null) => void): Unsubscribe;
    on(event: 'refused', handler: (refusal: DrawRefusal) => void): Unsubscribe;
    on(event: 'change' | 'select' | 'refused', handler: (payload: never) => void): Unsubscribe {
        const lists = { change: this.#changes, select: this.#selections, refused: this.#refusals };
        return (lists[event] as Listeners<[unknown]>).add(handler as (payload: unknown) => void);
    }

    detach(): void {
        this.cancelPick();
        const session = this.#session;
        this.#session = null;
        this.#mode = 'static';
        this.#sketch = [];
        session?.stop();
        session?.map.removeLayer(CLICK_DRAW_OVERLAY_ID);
    }
}

/** The click-only drawing tools on `MapPort` (the admin's fallback while Terra Draw is not loaded). */
export function createClickDrawPort(): MapDrawPort {
    return new ClickDrawPort();
}
