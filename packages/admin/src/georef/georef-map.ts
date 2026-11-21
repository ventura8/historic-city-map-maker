/**
 * The georeferencer's reference map (`docs/research/M3-interfaces.md` §10.4): one map per page visit, Mapbox Standard
 * (**never Satellite**), with the version's reference image (OpenStreetMap lines or Sentinel-2) and the live warped
 * preview as canvas pictures (`../imagery/overlay.ts`). Pair places stay Terra Draw hit targets (transparent); badges
 * are painted on a canvas overlay identical to the scan (owner, 2026-11-11; `./marker-overlay.ts`).
 */
import {
    bboxCenter,
    bboxExpand,
    MAX_GEOMETRY_VERTICES,
    MAX_POLYGON_RINGS,
    PHOTO_LOCATION_SLACK_DEG,
    roundTo,
    type Gcp,
    type LngLat,
    type UiLocale,
    type Logger,
    type MapView,
} from '@hcm/shared';
import { PAIR_HIT_RADIUS, type BadgeTone } from '@hcm/ui/admin/georef/marker-badge';
import type { RasterLayerSpec, Unsubscribe } from '@hcm/ui/map';
import type { DrawChange, MapDrawPort } from '@hcm/ui/map/draw';

import { PictureOverlays } from '../imagery/overlay.js';
import type { CityFrame, MapStatus } from '../layers/map-session.js';
import type { AdminMapFactory, AdminMapHandle, AdminMapResult } from '../map/factory.js';
import type { ProjectableMapPort } from '../map/projection.js';
import { DRAW_HIT_COLOR, GeorefMarkerOverlay } from './marker-overlay.js';
import { roundGeo, type GeoPosition } from './pairs.js';
import type { MapCamera } from './linked-views.js';
import type { GeorefVersion, MapTarget } from './state.js';
import type { SuggestionRow } from './suggestions.js';

/** The reference's box as the map's frame. */
export function referenceFrame(version: GeorefVersion | null): CityFrame | null {
    const bounds = version?.reference?.bounds ?? null;
    return bounds === null ? null : { bounds, view: { center: bboxCenter(bounds), zoom: 13, bearing: 0 } };
}

export interface GeorefMapDeps {
    readonly maps: AdminMapFactory | null;
    readonly locale: () => UiLocale;
    readonly log: Logger;
    readonly status: (status: MapStatus) => void;
    /** A click on the map (the place of the next pair while adding). */
    readonly clicked: (geo: GeoPosition) => void;
    /** A pair's place was dragged (once the drag ends). */
    readonly moved: (id: string, geo: GeoPosition) => void;
    /** A pair's point was selected on the map (null: none). */
    readonly selected: (id: string | null) => void;
    /** The map's camera moved (the linked views). */
    readonly viewed: (view: MapView) => void;
    /** The map is made and shows `view` (the linked views' camera before the owner's first move). */
    readonly shown: (view: MapView) => void;
}

export class GeorefMap {
    readonly #deps: GeorefMapDeps;
    readonly overlays: PictureOverlays;
    readonly #badges = new GeorefMarkerOverlay();
    #container: HTMLElement | null = null;
    #frame: CityFrame | null = null;
    #handle: AdminMapHandle | null = null;
    #draw: MapDrawPort | null = null;
    #listeners: Unsubscribe[] = [];
    #pairs: readonly Gcp[] = [];
    #selected: string | null = null;
    #suggestions: readonly SuggestionRow[] = [];
    #selectedSuggestion: string | null = null;
    #half: GeoPosition | null = null;
    #ghost: GeoPosition | null = null;
    #crosshair = false;
    #tones: Readonly<Record<string, BadgeTone>> = {};
    #adding = false;
    /** The published layer under the pairs (null: none). */
    #base: RasterLayerSpec | null = null;
    /** A point of the map is being dragged (Terra Draw's change not yet settled): the linked views stand still. */
    dragging = false;
    /** Bumped by every attach and detach: a slower create of an older host is dropped. */
    #generation = 0;

    constructor(deps: GeorefMapDeps) {
        this.#deps = deps;
        this.overlays = new PictureOverlays(() => this.#handle?.port ?? null);
    }

    attach(container: HTMLElement): void {
        if (container !== this.#container) {
            this.detach();
            this.#container = container;
            void this.#create();
        }
    }

    /** Where the map opens: the reference's box, else the city's. */
    setFrame(frame: CityFrame): void {
        const first = this.#frame === null;
        this.#frame = frame;
        if (first) {
            void this.#create();
        }
    }

    /** The map's centre (the keyboard's crosshair), or null without a map. */
    get centre(): GeoPosition | null {
        const view = this.#handle?.port.getView();
        return view === undefined ? null : { lat: view.center[1], lng: view.center[0] };
    }

    /** The place under a point of the map's box (CSS px) and the pair drawn within the panes' hit radius; null without a map. */
    targetAt(point: { readonly x: number; readonly y: number }): MapTarget | null {
        const port = this.#handle?.port;
        return port === undefined ? null : this.#targetOn(port, point);
    }

    #targetOn(port: ProjectableMapPort, point: { readonly x: number; readonly y: number }): MapTarget | null {
        const at = port.unproject(point);
        return at === null ? null : { geo: { lat: at[1], lng: at[0] }, hit: this.#hitAt(port, point) };
    }

    /** The nearest pair drawn within `PAIR_HIT_RADIUS` of `point`, or null. */
    #hitAt(port: ProjectableMapPort, point: { readonly x: number; readonly y: number }): string | null {
        let best: string | null = null;
        let distance = PAIR_HIT_RADIUS;
        for (const pair of this.#pairs) {
            const drawn = port.project([pair.geo.lng, pair.geo.lat]);
            const here = drawn === null ? Number.POSITIVE_INFINITY : Math.hypot(drawn.x - point.x, drawn.y - point.y);
            if (here <= distance) {
                best = pair.id;
                distance = here;
            }
        }
        return best;
    }

    /** The linked views: the map jumps to `camera` (its `move` comes back at once, which the link drops). */
    follow(camera: MapCamera): void {
        this.#handle?.port.flyTo(camera, { animate: false });
    }

    /** The map's bearing in degrees (0 without a map). */
    get bearing(): number {
        return this.#handle?.port.getView().bearing ?? 0;
    }

    /** Turns the map by `degrees` clockwise on the screen (its bearing falls); null: north up. */
    rotateBy(degrees: number | null): void {
        // A jump, as the linked views move it: an animated turn would keep turning the scan after the owner's next press.
        this.#handle?.port.flyTo({ bearing: degrees === null ? 0 : this.bearing - degrees }, { animate: false });
    }

    zoomBy(delta: number): void {
        const port = this.#handle?.port;
        if (port !== undefined) {
            port.flyTo({ zoom: roundTo(port.getView().zoom + delta, 2) });
        }
    }

    /** Residual tones for both panes' badges. */
    setTones(tones: Readonly<Record<string, BadgeTone>>): void {
        this.#tones = tones;
        this.#paintBadges();
    }

    /** Half pair started on the map (a `+` at that place). */
    setHalf(half: GeoPosition | null): void {
        this.#half = half;
        this.#paintBadges();
    }

    /** Where the pairs so far expect a half pair started on the scan (a dashed ring; the map itself never moves to it). */
    setGhost(ghost: GeoPosition | null): void {
        this.#ghost = ghost;
        this.#paintBadges();
    }

    /** Keyboard focus on the map pane: crosshair at the centre. */
    setCrosshair(on: boolean): void {
        this.#crosshair = on;
        this.#paintBadges();
    }

    /**
     * Nudge the selected pair by screen CSS px (1 / 10 with Shift), mirroring the scan pane. Returns false when there is
     * no selected pair or no map.
     */
    nudgeSelected(dx: number, dy: number): boolean {
        const moved = this.#nudgedGeo(dx, dy);
        if (moved === null) {
            return false;
        }
        this.#deps.moved(moved.id, moved.geo);
        return true;
    }

    #nudgedGeo(dx: number, dy: number): { readonly id: string; readonly geo: GeoPosition } | null {
        const id = this.#selected;
        const port = this.#handle?.port;
        if (id === null || port === undefined) {
            return null;
        }
        const pair = this.#pairs.find((item) => item.id === id);
        if (pair === undefined) {
            return null;
        }
        return this.#shiftPair(id, pair, port, { dx, dy });
    }

    #shiftPair(
        id: string,
        pair: Gcp,
        port: ProjectableMapPort,
        delta: { readonly dx: number; readonly dy: number },
    ): { readonly id: string; readonly geo: GeoPosition } | null {
        const at = port.project([pair.geo.lng, pair.geo.lat]);
        if (at === null) {
            return null;
        }
        const next = port.unproject({ x: at.x + delta.dx, y: at.y + delta.dy });
        return next === null ? null : { id, geo: { lng: next[0], lat: next[1] } };
    }

    /** The pairs' places, the selected one selected. */
    showPairs(pairs: readonly Gcp[], selected: string | null): void {
        this.#pairs = pairs;
        this.#selected = selected;
        this.#loadPairs();
        this.#paintBadges();
    }

    /** The suggestions still to decide, the selected one first so its label is drawn on top. */
    showSuggestions(rows: readonly SuggestionRow[], selected: string | null): void {
        this.#suggestions = rows.toSorted((a, b) => Number(b.pair.id === selected) - Number(a.pair.id === selected));
        this.#selectedSuggestion = selected;
        this.#paintBadges();
    }

    /** The map pane's choice: a published layer under the pairs and the pictures (null: none), on this one map. */
    showBase(spec: RasterLayerSpec | null): void {
        this.#base = spec;
        this.#handle?.preview.show({ layers: spec === null ? [] : [spec] });
    }

    /**
     * While adding pairs a click on the map is a place, not a selection: the points stand still, and the selected pair is
     * the drawing tools' selection again only once adding ends (selecting would switch them to `select`, where a click moves it).
     */
    setAdding(adding: boolean): void {
        this.#adding = adding;
        const draw = this.#draw;
        if (draw === null) {
            return;
        }
        draw.setMode(adding ? 'static' : 'select');
        if (!adding) {
            draw.select(this.#selected);
        }
    }

    detach(): void {
        this.#generation += 1;
        this.#container = null;
        for (const stop of this.#listeners.splice(0)) {
            stop();
        }
        this.#badges.detach();
        this.overlays.clear();
        this.#draw = null;
        this.dragging = false;
        this.#handle?.destroy();
        this.#handle = null;
        this.#deps.status('none');
    }

    #paintBadges(): void {
        this.#badges.setScene({
            pairs: this.#pairs,
            selected: this.#selected,
            suggestions: this.#suggestions,
            selectedSuggestion: this.#selectedSuggestion,
            half: this.#half,
            ghost: this.#ghost,
            crosshair: this.#crosshair,
            tones: this.#tones,
        });
    }

    #loadPairs(): void {
        const draw = this.#draw;
        if (draw !== null) {
            draw.load(this.#pairs.map((pair) => ({ id: pair.id, geometry: { type: 'Point', coordinates: [pair.geo.lng, pair.geo.lat] } })));
            // Terra Draw's `select` switches the tools to `select` mode, where the next map click would move the pair just made
            // (the owner's pin 1 km off, 2026-11-12): while adding, the badges show the selection alone.
            if (!this.#adding) {
                draw.select(this.#selected);
            }
        }
    }

    async #create(): Promise<void> {
        const request = this.#request();
        if (request === null) {
            return;
        }
        const { container, frame, maps } = request;
        const generation = this.#generation;
        this.#deps.status('loading');
        const result = await maps.create(container, { bounds: frame.bounds, view: frame.view, locale: this.#deps.locale() });
        await this.#created(result, frame, generation);
    }

    /** What a new map needs, once the page shows the host and the frame is known; null before (or with a map already). */
    #request(): { readonly container: HTMLElement; readonly frame: CityFrame; readonly maps: AdminMapFactory } | null {
        const container = this.#container;
        const frame = this.#frame;
        if (container === null || frame === null || this.#handle !== null) {
            return null;
        }
        const { maps } = this.#deps;
        if (maps === null) {
            this.#deps.status('failed');
            return null;
        }
        return { container, frame, maps };
    }

    async #created(result: AdminMapResult, frame: CityFrame, generation: number): Promise<void> {
        if (generation !== this.#generation) {
            if (result.ok) {
                result.map.destroy();
            }
            return;
        }
        if (!result.ok) {
            this.#deps.status(result.reason);
            return;
        }
        this.#handle = result.map;
        // Before the pictures (the status brings them): they stay above the layer.
        this.showBase(this.#base);
        this.#deps.status('ready');
        this.#listeners.push(
            result.map.port.onMapClick(([lng, lat]) => {
                this.#deps.clicked({ lat, lng });
            }),
            result.map.port.on('move', this.#deps.viewed),
        );
        this.#deps.shown(result.map.port.getView());
        const host = this.#container;
        if (host !== null) {
            this.#badges.attach(host, result.map.port);
        }
        await this.#tools(result.map, frame, generation);
    }

    /** The drawing tools for the pairs' places, once loaded. */
    async #tools(handle: AdminMapHandle, frame: CityFrame, generation: number): Promise<void> {
        const draw = await handle.draw();
        if (generation !== this.#generation) {
            return;
        }
        const limits = bboxExpand(frame.bounds, PHOTO_LOCATION_SLACK_DEG);
        draw.attach(handle.port, { limits, color: DRAW_HIT_COLOR, maxVertices: MAX_GEOMETRY_VERTICES, maxRings: MAX_POLYGON_RINGS });
        this.#draw = draw;
        this.#listeners.push(
            draw.on('change', (change) => {
                this.#changed(change);
            }),
            draw.on('select', (id) => {
                this.#deps.selected(id);
            }),
        );
        draw.setMode(this.#adding ? 'static' : 'select');
        this.#loadPairs();
        this.#paintBadges();
    }

    #changed(change: DrawChange): void {
        this.dragging = !change.final;
        if (!change.final) {
            return;
        }
        // Terra Draw's settle emits every point; only a place that moved is an edit (else one drag burns one Undo per pair).
        for (const feature of change.features) {
            this.#movedFeature(feature);
        }
    }

    /** A settled point whose place differs from the pair's: one Undo step. */
    #movedFeature(feature: DrawChange['features'][number]): void {
        const pair = this.#pairs.find((item) => item.id === feature.id);
        if (pair === undefined || feature.geometry.type !== 'Point') {
            return;
        }
        const [lng, lat] = feature.geometry.coordinates as LngLat;
        const geo = roundGeo({ lat, lng });
        if (geo.lat !== pair.geo.lat || geo.lng !== pair.geo.lng) {
            this.#deps.moved(feature.id, geo);
        }
    }
}
