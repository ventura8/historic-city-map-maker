/**
 * `MapDrawPort` on Terra Draw (docs/research/M2c-interfaces.md §4, DECISIONS-for-review.md §34g), the only module that
 * imports it (dependency-cruiser `only-the-draw-adapter-imports-terra-draw`): `loadTerraDraw` fetches Terra Draw and its
 * Mapbox GL adapter on the first `AdminMapHandle.draw()` (a lazy chunk of the admin's own), and `createTerraDrawPort`
 * drives them.
 *
 * - Terra Draw shows every shape and, in `select`, drags the selected feature, a vertex, or a midpoint (which inserts a
 *   vertex); a right click on a vertex removes it. A new shape is drawn by clicks exactly as with the click tools
 *   (`click-growth.ts`: a point is one click, a line and an area grow with every click, Save works at any time), so the
 *   input budgets and the single-pointer way stay; a click on the map moves a selected point (WCAG 2.5.7), and the
 *   vertex list stays the keyboard's way.
 * - Our ids live in Terra Draw's own store (an id strategy that accepts them); Terra Draw's own ids, styles and events
 *   never leave this module.
 * - The limits are checked twice: Terra Draw's `validation` refuses a position outside them (or past the vertex count)
 *   while dragging, and every finished edit is checked whole (`checkGeometry`); a refused edit snaps back to the last
 *   accepted geometry. `refused` fires once per kind until the gesture ends.
 * - Every geometry is rounded to `DRAW_DECIMALS` places before it leaves; `snapshot()` is the accepted state. A polygon with
 *   holes, which Terra Draw cannot hold, is shown by its outer ring and edited in the vertex list only.
 */
import type { LngLat } from '@hcm/shared';

import { Listeners } from '../listeners.js';
import type { MapPort, Unsubscribe } from '../map-port.js';
import { nativeMap } from '../mapbox-adapter.js';
import { growByClick, shapeOfMode, sketchGeometry, type Position } from './click-growth.js';
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
import { SELECT_MODE, STATIC_MODE } from './mode-names.js';
import { checkGeometry, checkPositions, DRAW_DECIMALS, roundGeometry, roundPosition } from './rules.js';
import { geometryOf, outerOnly, positionsOf, shapeOf, tdFeature, wholeRefusal } from './terra-draw-features.js';
import { drawModes, modeStyles } from './terra-draw-modes.js';
import type { TdFeature, TdFeatureId, TdInstance, TdValidationResult, TerraDrawModules } from './terra-draw-types.js';

const VALID: TdValidationResult = { valid: true };

/** The feature that shows a line's or an area's first clicks, before it is a shape. */
export const SKETCH_ID = 'hcm-draw-sketch';

/** A click this close to the selected point (CSS px, its handle and ring) selects or drags it, never moves it. */
const ON_POINT_PX = 16;

/** A subscriber that throws is the subscriber's problem: drawing goes on. */
const ignore = (): void => undefined;

/** What `attach` set up; null while detached. */
interface Session {
    readonly draw: TdInstance;
    readonly map: MapPort;
    options: DrawOptions;
    readonly cleanups: (() => void)[];
}

/** One of our features as accepted and as Terra Draw holds it right now (a drag in progress included). */
interface Held {
    readonly accepted: DrawnFeature;
    readonly current: DrawnFeature;
}

class TerraDrawPort implements MapDrawPort {
    readonly #modules: TerraDrawModules;
    readonly #changes = new Listeners<[DrawChange]>(ignore);
    readonly #selections = new Listeners<[string | null]>(ignore);
    readonly #refusals = new Listeners<[DrawRefusal]>(ignore);
    /** The accepted features, by our id: what `snapshot` answers and where a refused edit snaps back to. */
    readonly #good = new Map<string, DrawnFeature>();
    #session: Session | null = null;
    #mode: DrawMode = 'static';
    #drawId: string | null = null;
    /** The positions of a line or an area that is not one yet. */
    #sketch: Position[] = [];
    #selected: string | null = null;
    #pick: ((position: LngLat | null) => void) | null = null;
    #lastRefusal: DrawRefusal['kind'] | null = null;
    #ids = 0;

    constructor(modules: TerraDrawModules) {
        this.#modules = modules;
    }

    get mode(): DrawMode {
        return this.#mode;
    }

    attach(map: MapPort, options: DrawOptions): void {
        const native = nativeMap(map);
        if (native === null) {
            throw new Error('draw needs a mounted Mapbox map');
        }
        this.detach();
        const modules = this.#modules;
        const draw = new modules.TerraDraw({
            adapter: new modules.TerraDrawMapboxGLAdapter({ map: native, coordinatePrecision: DRAW_DECIMALS }),
            modes: drawModes(modules, options.color, (feature, context) => this.#validate(feature, context.updateType)),
            idStrategy: { isValidId: (id) => String(id).length > 0, getId: () => this.#newId() },
        });
        const session: Session = { draw, map, options, cleanups: [] };
        this.#listen(session);
        draw.start();
        draw.setMode(STATIC_MODE);
        this.#session = session;
        this.#mode = 'static';
        for (const feature of this.#good.values()) {
            this.#store(session, feature);
        }
        session.cleanups.push(
            map.onMapClick((position) => {
                this.#onClick(session, roundPosition(position));
            }),
        );
        this.#watchEscape(session, native.getCanvas());
    }

    #newId(): string {
        return `hcm-draw-${String(++this.#ids)}`;
    }

    #listen(session: Session): void {
        session.draw.on('change', (ids, type, context) => {
            // Only a drag moves a shape: the port's own updates (a load, a click) and a selection's marks are not reported.
            if (context?.origin !== 'api' && context?.target !== 'properties') {
                this.#onChange(session, ids, type);
            }
        });
        session.draw.on('finish', () => {
            this.#settle(session);
            this.#lastRefusal = null;
        });
        session.draw.on('select', (id) => {
            this.#onSelect(String(id));
        });
        session.draw.on('deselect', () => {
            this.#onSelect(null);
        });
    }

    #watchEscape(session: Session, canvas: HTMLElement): void {
        const onKey = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                this.cancelPick();
            }
        };
        canvas.addEventListener('keydown', onKey);
        session.cleanups.push(() => {
            canvas.removeEventListener('keydown', onKey);
        });
    }

    /** Terra Draw's validation hook: positions while a feature is added or dragged, the whole shape once finished. */
    #validate(feature: TdFeature, updateType: string | undefined): TdValidationResult {
        const options = this.#session?.options;
        if (options === undefined) {
            return VALID;
        }
        const refusal =
            updateType === 'finish' ? wholeRefusal(feature, options) : checkPositions(positionsOf(feature.geometry.coordinates), options);
        if (refusal === null) {
            return VALID;
        }
        this.#refuse(refusal);
        return { valid: false, reason: refusal.kind };
    }

    #refuse(refusal: DrawRefusal): void {
        if (refusal.kind !== this.#lastRefusal) {
            this.#lastRefusal = refusal.kind;
            this.#refusals.emit(refusal);
        }
    }

    /** A map click: grows the shape being drawn, or moves the selected point there. */
    #onClick(session: Session, position: Position): void {
        if (this.#pick !== null) {
            return;
        }
        const shape = shapeOfMode(this.#mode);
        const refusal = checkPositions([position], session.options);
        if (refusal !== null) {
            this.#refuseClick(shape !== null, refusal);
        } else if (shape === null) {
            this.#moveSelectedPoint(session, position);
        } else {
            this.#grow(session, shape, position);
        }
    }

    /** A click outside the limits is refused where a click does something: a drawing tool, or a point to move. */
    #refuseClick(drawing: boolean, refusal: DrawRefusal): void {
        if (drawing || this.#selectedPoint() !== null) {
            this.#refusals.emit(refusal);
        }
    }

    #grow(session: Session, shape: DrawShape, position: Position): void {
        const id = this.#drawId ?? this.#newId();
        this.#drawId = id;
        const growth = growByClick({ id, shape, drawn: this.#good.get(id), sketch: this.#sketch, position, options: session.options });
        if (growth.kind === 'sketch') {
            this.#showSketch(session, growth.positions);
        } else if (growth.kind === 'shape') {
            this.#keepDrawn(session, growth.feature, growth.finished);
        } else {
            this.#refusals.emit(growth.refusal);
        }
    }

    /** The first clicks of a line or an area, shown as a point, then a line. */
    #showSketch(session: Session, positions: readonly Position[]): void {
        this.#clearSketch(session);
        this.#sketch = [...positions];
        const geometry = sketchGeometry(positions);
        if (geometry !== null) {
            session.draw.addFeatures([tdFeature(SKETCH_ID, geometry, geometry.type === 'Point' ? 'point' : 'linestring')]);
        }
    }

    #clearSketch(session: Session): void {
        if (this.#sketch.length > 0) {
            this.#sketch = [];
            session.draw.removeFeatures([SKETCH_ID]);
        }
    }

    #keepDrawn(session: Session, feature: DrawnFeature, finished: boolean): void {
        this.#clearSketch(session);
        this.#put(feature);
        this.#changes.emit({ features: this.snapshot(), final: true });
        if (finished) {
            this.setMode('select', feature.id);
        }
    }

    /** The selected feature while the tools select and it is a point; null otherwise. */
    #selectedPoint(): DrawnFeature | null {
        const selected = this.#mode === 'select' && this.#selected !== null ? this.#good.get(this.#selected) : undefined;
        return selected?.geometry.type === 'Point' ? selected : null;
    }

    /** In `select`, the selected point goes where the map was clicked (a click on the point itself only selects it). */
    #moveSelectedPoint(session: Session, position: Position): void {
        const point = this.#selectedPoint();
        const [lng, lat] = position;
        const near = session.draw.getFeaturesAtLngLat({ lng, lat }, { pointerDistance: ON_POINT_PX });
        if (point === null || near.some((feature) => String(feature.id) === point.id)) {
            return;
        }
        this.#put({ ...point, geometry: { type: 'Point', coordinates: position } });
        this.#changes.emit({ features: this.snapshot(), final: true });
    }

    /** Our features in Terra Draw's store, with the geometry it holds now (those shown by their outer ring stay as they are). */
    #held(session: Session): Held[] {
        return session.draw.getSnapshot().flatMap((feature) => {
            const accepted = this.#good.get(String(feature.id));
            const geometry = accepted === undefined || feature.properties['mode'] === STATIC_MODE ? null : geometryOf(feature);
            return accepted === undefined || geometry === null ? [] : [{ accepted, current: { ...accepted, geometry } }];
        });
    }

    #onChange(session: Session, ids: readonly TdFeatureId[], type: string): void {
        const moved = type === 'update' && ids.some((id) => this.#good.has(String(id)));
        if (moved && this.#mode === 'select') {
            this.#changes.emit({ features: this.#held(session).map(({ current }) => current), final: false });
        }
    }

    /** An edit ended: every feature is checked whole; a refused one snaps back. */
    #settle(session: Session): void {
        for (const { accepted, current } of this.#held(session)) {
            const refusal = checkGeometry(current.geometry, session.options);
            if (refusal === null) {
                this.#good.set(current.id, current);
            } else {
                this.#refuse(refusal);
                this.#put(accepted);
            }
        }
        this.#changes.emit({ features: this.snapshot(), final: true });
    }

    /** Adds (or replaces) a feature in the accepted state and in Terra Draw's store. */
    #put(feature: DrawnFeature): void {
        this.#good.set(feature.id, feature);
        const session = this.#session;
        if (session !== null) {
            this.#store(session, feature);
        }
    }

    /** Terra Draw holds `feature`: its geometry updated in place (a selection stays), else added afresh. */
    #store(session: Session, feature: DrawnFeature): void {
        if (!this.#updatedInPlace(session.draw, feature)) {
            this.#addAfresh(session.draw, feature);
        }
    }

    /** True when Terra Draw held the feature and took its new geometry; one it refuses (another type) is removed. */
    #updatedInPlace(draw: TdInstance, feature: DrawnFeature): boolean {
        if (!draw.hasFeature(feature.id)) {
            return false;
        }
        try {
            draw.updateFeatureGeometry(feature.id, feature.geometry);
            return true;
        } catch {
            draw.removeFeatures([feature.id]);
            return false;
        }
    }

    /** Added under its shape's mode; a polygon with holes, which no mode holds, is shown by its outer ring only. */
    #addAfresh(draw: TdInstance, feature: DrawnFeature): void {
        const [added] = draw.addFeatures([tdFeature(feature.id, feature.geometry, shapeOf(feature))]);
        if (added?.valid !== true) {
            draw.addFeatures([tdFeature(feature.id, outerOnly(feature.geometry), STATIC_MODE)]);
        }
    }

    #onSelect(id: string | null): void {
        const ours = this.#ours(id);
        if (ours !== this.#selected) {
            this.#selected = ours;
            this.#selections.emit(ours);
        }
    }

    setMode(mode: DrawMode, drawId?: string): void {
        this.cancelPick();
        this.#mode = mode;
        this.#drawId = drawId ?? null;
        this.#lastRefusal = null;
        const session = this.#session;
        if (session !== null) {
            this.#applyMode(session, mode, drawId);
        }
    }

    /** Terra Draw's mode for ours (`select`, else `static`: a new shape is drawn by clicks); `select` with an id selects it. */
    #applyMode(session: Session, mode: DrawMode, drawId: string | undefined): void {
        this.#clearSketch(session);
        session.draw.setMode(mode === 'select' ? SELECT_MODE : STATIC_MODE);
        if (mode === 'select' && drawId !== undefined) {
            this.select(drawId);
        }
    }

    load(features: readonly DrawnFeatureInput[]): void {
        const rounded = features.map((feature) => ({ ...feature, geometry: roundGeometry(feature.geometry) }));
        const accepted = rounded.filter((feature) => this.#accepts(feature));
        const kept = new Set(accepted.map((feature) => feature.id));
        this.#session?.draw.removeFeatures([...this.#good.keys()].filter((id) => !kept.has(id)));
        this.#good.clear();
        for (const feature of accepted) {
            this.#put(feature);
        }
        this.#onSelect(this.#selected);
    }

    #accepts(feature: DrawnFeature): boolean {
        const options = this.#session?.options;
        const refusal = options === undefined ? null : checkGeometry(feature.geometry, options);
        if (refusal !== null) {
            this.#refuse(refusal);
        }
        return refusal === null;
    }

    snapshot(): readonly DrawnFeature[] {
        return [...this.#good.values()];
    }

    select(id: string | null): void {
        const draw = this.#session?.draw;
        if (draw === undefined) {
            return;
        }
        const ours = this.#ours(id);
        if (ours === null) {
            this.#deselect(draw);
            return;
        }
        if (this.#mode !== 'select') {
            this.setMode('select');
        }
        draw.selectFeature(ours);
    }

    /** `id` when it names one of our features, else null. */
    #ours(id: string | null): string | null {
        return id !== null && this.#good.has(id) ? id : null;
    }

    #deselect(draw: TdInstance): void {
        const selected = this.#selected;
        if (selected !== null) {
            draw.deselectFeature(selected);
        }
    }

    deleteSelected(): void {
        const session = this.#session;
        const selected = this.#selected;
        if (session === null || selected === null) {
            return;
        }
        this.#deselect(session.draw);
        session.draw.removeFeatures([selected]);
        this.#good.delete(selected);
        this.#onSelect(null);
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

    /** The edited item's new colour: every mode's styles in it, nothing redrawn from scratch (a selection stays). */
    setColor(color: string): void {
        const session = this.#session;
        if (session === null || session.options.color === color) {
            return;
        }
        session.options = { ...session.options, color };
        for (const [mode, styles] of modeStyles(color)) {
            session.draw.setModeStyles(mode, styles);
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
        this.#selected = null;
        this.#sketch = [];
        session?.draw.stop();
        for (const cleanup of session?.cleanups ?? []) {
            cleanup();
        }
    }
}

/** The drawing tools on the Terra Draw constructors `loadTerraDraw` loaded (`AdminMapHandle.draw()`). */
export function createTerraDrawPort(modules: TerraDrawModules): MapDrawPort {
    return new TerraDrawPort(modules);
}

/**
 * Terra Draw 1.38.0 and its Mapbox GL adapter 1.5.0, imported on first use: the admin's bundler makes them a chunk of
 * their own (DECISIONS-for-review.md §34b), which the public viewer never loads. The port is written to the structural
 * types of `terra-draw-types.ts`, which the real constructors' options are wider than (the adapter takes Mapbox's own
 * map type), so they are handed over as those types; the browser test drives the real ones through the port
 * (`packages/ui/test/map/draw/terra-draw-real.test.ts`).
 */
export async function loadTerraDraw(): Promise<TerraDrawModules> {
    // Each import destructured where it is awaited, so the bundler keeps only the modes named here: Terra Draw's other
    // modes (circle, freehand, sector, sensor, angled rectangle) left the chunk (DECISIONS-for-review.md §100b).
    const { TerraDraw, TerraDrawRenderMode, TerraDrawSelectMode, TerraDrawPointMode } = await import('terra-draw');
    const { TerraDrawLineStringMode, TerraDrawPolygonMode, TerraDrawRectangleMode } = await import('terra-draw');
    const { TerraDrawMapboxGLAdapter } = await import('terra-draw-mapbox-gl-adapter');
    const modes = { TerraDrawRenderMode, TerraDrawSelectMode, TerraDrawPointMode, TerraDrawLineStringMode, TerraDrawPolygonMode };
    const modules = { TerraDraw, ...modes, TerraDrawRectangleMode, TerraDrawMapboxGLAdapter };
    return modules as unknown as TerraDrawModules;
}
