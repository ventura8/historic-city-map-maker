/**
 * The places page's map (docs/research/M2c-interfaces.md §3.5, §4.4, §5.2, §7.1): one map per page visit, created when
 * the page shows its map host and the city's bounds are known, destroyed when the page goes. It draws every loaded place
 * in its category's overlay (a click on one selects it), and the open place with the drawing tools in its category's
 * colour: drawn once (`draw-<shape>`) for a new place, then moved and edited in `select`. Its category's overlay leaves
 * the open place out meanwhile (`MapPreview`). Nothing here writes: finished shapes go to the editor's draft.
 */
import { bboxCenter, bboxOf, geometryPositions, poiIcon, type Geometry, type LngLat, type UiLocale, type Logger } from '@hcm/shared';
import type { RasterLayerSpec, VectorOverlaySpec } from '@hcm/ui/map';
import type { DrawChange, DrawRefusal, MapDrawPort } from '@hcm/ui/map/draw';

import type { Unsubscribe } from '../app/ports.js';
import type { AdminMapFactory, AdminMapHandle, AdminMapResult } from '../map/factory.js';
import { drawLimitsOf, type CityFrame } from './model.js';
import type { PlaceShape } from './vertices.js';

export type MapStatus = 'none' | 'loading' | 'ready' | 'no-token' | 'no-webgl' | 'failed';

/** The place the drawing tools show (null: none open). */
export interface EditTarget {
    readonly id: string;
    readonly category: string;
    readonly geometry: Geometry | null;
    readonly shape: PlaceShape;
    readonly color: string;
}

export interface PoisMapDeps {
    readonly maps: AdminMapFactory | null;
    readonly locale: () => UiLocale;
    readonly log: Logger;
    readonly status: (status: MapStatus) => void;
    /** A place's shape on the map was clicked. */
    readonly clicked: (poiId: string) => void;
    /** The drawing tools finished a shape or an edit of the open place. */
    readonly drawn: (geometry: Geometry) => void;
    readonly refused: (kind: DrawRefusal['kind']) => void;
}

/** The colour of a place without a known category. */
export const UNCATEGORISED_COLOR = '#6f5b4b';

function same(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/** The geometry the drawing tools hold for `id`, or null. */
function heldGeometry(draw: MapDrawPort, id: string): Geometry | null {
    return draw.snapshot().find((feature) => feature.id === id)?.geometry ?? null;
}

/** The tools load the target's geometry when it is not what they hold already (a drawn shape is not loaded back). */
function reloadIfChanged(draw: MapDrawPort, target: EditTarget): void {
    if (!same(heldGeometry(draw, target.id), target.geometry)) {
        draw.load(target.geometry === null ? [] : [{ id: target.id, geometry: target.geometry, shape: target.shape }]);
    }
}

/** Where the tools go for a target: draw the missing shape, else edit it. */
function modeFor(target: EditTarget): 'select' | `draw-${PlaceShape}` {
    return target.geometry === null ? `draw-${target.shape}` : 'select';
}

export class PoisMap {
    readonly #deps: PoisMapDeps;
    #container: HTMLElement | null = null;
    #frame: CityFrame | null = null;
    #handle: AdminMapHandle | null = null;
    #draw: MapDrawPort | null = null;
    #stops: Unsubscribe[] = [];
    /** Bumped by every attach and detach: a slower create of an older one is dropped. */
    #generation = 0;
    #overlays: readonly VectorOverlaySpec[] = [];
    /** M27: the old map the open place is traced on, under the drawing (null: none). */
    #layer: RasterLayerSpec | null = null;
    #target: EditTarget | null = null;
    /** The target the tools were last set up for (its id and colour). */
    #shown: { readonly id: string; readonly color: string } | null = null;

    constructor(deps: PoisMapDeps) {
        this.#deps = deps;
    }

    get port(): AdminMapHandle['port'] | null {
        return this.#handle?.port ?? null;
    }

    /** The page shows its map host. */
    attach(container: HTMLElement): void {
        if (container === this.#container) {
            return;
        }
        this.detach();
        this.#container = container;
        void this.#create();
    }

    /** The city's bounds and view (the map waits for them). */
    setFrame(frame: CityFrame): void {
        const first = this.#frame === null;
        this.#frame = frame;
        if (first) {
            void this.#create();
        }
    }

    async #create(): Promise<void> {
        const request = this.#request();
        if (request === null) {
            return;
        }
        this.#generation += 1;
        const generation = this.#generation;
        this.#deps.status('loading');
        const { container, frame, maps } = request;
        const result = await maps.create(container, { bounds: frame.bounds, view: frame.view, locale: this.#deps.locale() });
        this.#created(result, frame, generation);
    }

    /** What a new map needs, once the page shows the host and the city is known; null before (or with a map already). */
    #request(): { readonly container: HTMLElement; readonly frame: CityFrame; readonly maps: AdminMapFactory } | null {
        const container = this.#container;
        const frame = this.#frame;
        if (container === null || frame === null || this.#handle !== null) {
            return null;
        }
        const maps = this.#deps.maps;
        if (maps === null) {
            this.#deps.status('failed');
            return null;
        }
        return { container, frame, maps };
    }

    #created(result: AdminMapResult, frame: CityFrame, generation: number): void {
        if (generation !== this.#generation) {
            if (result.ok) {
                result.map.destroy();
            }
            return;
        }
        if (result.ok) {
            void this.#ready(result.map, frame, generation);
        } else {
            this.#deps.status(result.reason);
        }
    }

    async #ready(handle: AdminMapHandle, frame: CityFrame, generation: number): Promise<void> {
        this.#handle = handle;
        this.#stops.push(
            handle.port.onPoiClick((id) => {
                this.#deps.clicked(id);
            }),
        );
        this.#showContent();
        const draw = await handle.draw();
        if (generation !== this.#generation) {
            return;
        }
        draw.attach(handle.port, { ...drawLimitsOf(frame), color: this.#target?.color ?? UNCATEGORISED_COLOR });
        this.#stops.push(
            draw.on('change', (change) => {
                this.#changed(change);
            }),
            draw.on('refused', (refusal) => {
                this.#deps.refused(refusal.kind);
            }),
        );
        this.#draw = draw;
        this.#shown = null;
        this.#applyTarget();
        this.#deps.status('ready');
    }

    #changed(change: DrawChange): void {
        const target = this.#target;
        const feature = target === null ? undefined : change.features.find((drawn) => drawn.id === target.id);
        if (change.final && feature !== undefined) {
            this.#deps.drawn(feature.geometry);
        }
    }

    /** Every category's overlay with its loaded places. */
    showPlaces(overlays: readonly VectorOverlaySpec[]): void {
        this.#overlays = overlays;
        this.#showContent();
    }

    /** M27: the old map a street is traced on, under the drawing, at its spec's opacity (null: none). */
    showLayer(spec: RasterLayerSpec | null): void {
        this.#layer = spec;
        this.#showContent();
    }

    /** M27: the traced-on map's opacity, 0..1 (the admin fades it to compare with today's streets). */
    setLayerOpacity(opacity: number): void {
        const layer = this.#layer;
        if (layer !== null) {
            this.#layer = { ...layer, opacity };
            this.#handle?.preview.preview({ kind: 'layer', id: layer.id, opacity });
        }
    }

    #showContent(): void {
        this.#handle?.preview.show({ categories: this.#overlays, layers: this.#layer === null ? [] : [this.#layer] });
    }

    /** The open place (null: none): drawn with the tools, left out of its category's overlay. */
    edit(target: EditTarget | null): void {
        const previous = this.#target;
        this.#target = target;
        if (previous !== null && previous.id !== target?.id) {
            this.#handle?.preview.restore({ kind: 'poi', id: previous.id });
        }
        this.#applyTarget();
    }

    /** The drawing tools to `mode` for the open place (Draw continues its shape, Select edits it). */
    setMode(mode: 'select' | 'draw'): void {
        const target = this.#target;
        if (target !== null) {
            this.#draw?.setMode(mode === 'select' ? 'select' : `draw-${target.shape}`, target.id);
        }
    }

    #applyTarget(): void {
        const draw = this.#draw;
        const target = this.#target;
        if (draw === null) {
            return;
        }
        if (target === null) {
            this.#clear(draw);
            return;
        }
        this.#handle?.preview.preview({ kind: 'poi', id: target.id, category: target.category });
        this.#show(draw, target);
    }

    /** No place open: the tools hold nothing (once; they start empty). */
    #clear(draw: MapDrawPort): void {
        if (this.#shown !== null) {
            this.#shown = null;
            draw.load([]);
            draw.setMode('static');
        }
    }

    #show(draw: MapDrawPort, target: EditTarget): void {
        const fresh = this.#shown?.id !== target.id;
        this.#recolour(draw, target.color);
        reloadIfChanged(draw, target);
        // A shape not drawn yet is set to be drawn again only when the tools are elsewhere: the same target applied again
        // (a new colour, a category that arrived) wiped the first clicks of a line or an area (lesson 114).
        const mode = modeFor(target);
        if (fresh || (target.geometry === null && draw.mode !== mode)) {
            draw.setMode(mode, target.id);
        }
        this.#reveal(fresh, target.geometry);
        this.#shown = { id: target.id, color: target.color };
    }

    /**
     * A place just opened with a shape is brought into view: the camera centres on its bounding box (its zoom kept, no
     * animation). A place of the list may lie outside the city's starting view; an edit of the open place moves nothing.
     */
    #reveal(fresh: boolean, geometry: Geometry | null): void {
        if (!fresh || geometry === null) {
            return;
        }
        const box = bboxOf(geometryPositions(geometry));
        if (box !== null) {
            this.#handle?.port.flyTo({ center: bboxCenter(box) }, { animate: false });
        }
    }

    #recolour(draw: MapDrawPort, color: string): void {
        if (this.#shown?.color !== color) {
            draw.setColor(color);
        }
    }

    /** The map's centre (Add at map centre); without a map the city's starting view's, so the keyboard path still works. */
    centre(): LngLat | null {
        return this.#handle?.port.getView().center ?? this.#frame?.view.center ?? null;
    }

    zoomBy(delta: number): void {
        const port = this.#handle?.port;
        port?.flyTo({ zoom: port.getView().zoom + delta });
    }

    detach(): void {
        this.#generation += 1;
        for (const stop of this.#stops.splice(0)) {
            stop();
        }
        this.#handle?.destroy();
        this.#handle = null;
        this.#draw = null;
        this.#shown = null;
        this.#container = null;
        this.#deps.status('none');
    }
}

/** A category's overlay on the admin's map (every place shown, at the category's default opacity). */
export function overlayOf(
    category: { readonly id: string; readonly color: string; readonly icon: string; readonly defaultOpacity: number },
    places: readonly { readonly id: string; readonly geometry: Geometry; readonly title: string }[],
): VectorOverlaySpec {
    return {
        id: category.id,
        kind: 'poi',
        features: places.map((place) => ({ type: 'Feature', geometry: place.geometry, properties: { id: place.id, title: place.title } })),
        color: category.color,
        icon: poiIcon(category.icon),
        visible: true,
        opacity: category.defaultOpacity,
    };
}

/** The page's hold on the area's map. */
export function mapIntents(map: PoisMap): {
    attachMap(container: HTMLElement): void;
    detachMap(): void;
    zoomBy(delta: number): void;
} {
    return {
        attachMap: (container) => {
            map.attach(container);
        },
        detachMap: () => {
            map.detach();
        },
        zoomBy: (delta) => {
            map.zoomBy(delta);
        },
    };
}
