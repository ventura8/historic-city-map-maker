/**
 * The layer editor's Crop (`docs/research/M3-interfaces.md` §10.5, §9.1 `imagery.crop`; CR-M3-7), in the lazy
 * `layer-geometry` chunk: the admin draws the area to keep as a polygon on the editor's map with the drawing tools (a
 * click per corner, or the keyboard's way: pan the map with the arrow keys and add a corner at its centre), may drag its
 * corners or draw it again, and Save sends
 * its outer ring to `imagery.crop`, which renders the layer's current version again inside it as a new version.
 */
import { bboxExpand, PHOTO_LOCATION_SLACK_DEG, type CropRing, type LngLat } from '@hcm/shared';
import type { MapPort } from '@hcm/ui/map';
import type { DrawChange, DrawnFeature, MapDrawPort } from '@hcm/ui/map/draw';

import type { Unsubscribe } from '../../app/ports.js';
import { callImagery, refusalOf } from '../../imagery/api.js';
import type { CropState, CropTool, CropToolDeps, CropToolFactory } from './types.js';

/** The drawn polygon's id in the drawing tools. */
export const CROP_DRAW_ID = 'crop';
/** The polygon's colour: magenta, apart from the layers' own colours and the basemap. */
const CROP_COLOR = '#d81b60';
/** `cropRingSchema`'s cap. */
const CROP_MAX_VERTICES = 500;

/** The first polygon's outer ring, or none. */
function outerRing(features: readonly DrawnFeature[]): readonly LngLat[] {
    for (const { geometry } of features) {
        if (geometry.type === 'Polygon') {
            return geometry.coordinates[0] ?? [];
        }
    }
    return [];
}

/** A GeoJSON ring repeats its first position last. */
function closed(ring: readonly LngLat[]): boolean {
    return ring.length > 1 && String(ring[0]) === String(ring.at(-1));
}

/** The drawn polygon's corners as `imagery.crop` takes them, or null with fewer than three. */
export function cropRingOf(features: readonly DrawnFeature[]): CropRing | null {
    const ring = outerRing(features);
    const corners = closed(ring) ? ring.slice(0, -1) : ring;
    return corners.length < 3 ? null : corners.map(([lng, lat]) => ({ lat, lng }));
}

/** A ring's corners as the drawing tools load a polygon (closed: the first corner again at the end). */
function polygonOf(ring: CropRing): readonly (readonly LngLat[])[] {
    const corners = ring.map(({ lat, lng }): LngLat => [lng, lat]);
    return [[...corners, ...corners.slice(0, 1)]];
}

class MapCropTool implements CropTool {
    readonly #deps: CropToolDeps;
    #state: CropState = { phase: 'loading', vertices: 0, refusal: null };
    #draw: MapDrawPort | null = null;
    #port: MapPort | null = null;
    #ring: CropRing | null = null;
    /** The corners added at the map's centre. */
    #corners: CropRing = [];
    readonly #listeners: Unsubscribe[] = [];
    #closed = false;

    constructor(deps: CropToolDeps) {
        this.#deps = deps;
    }

    async start(): Promise<void> {
        const drawing = await this.#deps.map.drawing().catch(() => null);
        if (this.#closed) {
            return;
        }
        if (drawing === null) {
            this.#set({ phase: 'no-map', vertices: 0, refusal: null });
            return;
        }
        const { draw, port, bounds } = drawing;
        draw.attach(port, {
            limits: bboxExpand(bounds, PHOTO_LOCATION_SLACK_DEG),
            color: CROP_COLOR,
            maxVertices: CROP_MAX_VERTICES,
            maxRings: 1,
        });
        this.#draw = draw;
        this.#port = port;
        this.#listeners.push(
            draw.on('change', (change) => {
                this.#changed(change);
            }),
        );
        this.redraw();
    }

    redraw(): void {
        const draw = this.#draw;
        if (draw === null) {
            return;
        }
        this.#ring = null;
        this.#corners = [];
        draw.load([]);
        draw.setMode('draw-polygon', CROP_DRAW_ID);
        this.#set({ phase: 'drawing', vertices: 0, refusal: null });
    }

    addCorner(): void {
        const draw = this.#draw;
        const port = this.#port;
        if (draw === null || port === null) {
            return;
        }
        const [lng, lat] = port.getView().center;
        const corners = [...this.#corners, { lat, lng }];
        this.#corners = corners;
        if (corners.length < 3) {
            this.#set({ phase: 'drawing', vertices: corners.length, refusal: null });
            return;
        }
        draw.load([{ id: CROP_DRAW_ID, geometry: { type: 'Polygon', coordinates: polygonOf(corners) } }]);
        draw.setMode('select');
        this.#ring = corners;
        this.#set({ phase: 'drawn', vertices: corners.length, refusal: null });
    }

    async save(): Promise<boolean> {
        const ring = this.#ring;
        const { services, layerId } = this.#deps;
        if (ring === null || this.#state.phase !== 'drawn' || services.readOnly()) {
            return false;
        }
        this.#set({ ...this.#state, phase: 'saving' });
        try {
            await callImagery(services.callables, 'imagery.crop', { cityId: services.cityId, layerId, ring });
        } catch (error) {
            this.#set({ ...this.#state, phase: 'drawn', refusal: refusalOf(error) });
            return false;
        }
        services.notify({ key: 'adminContent.imagery.layer.cropStarted' });
        this.#deps.done();
        return true;
    }

    close(): void {
        this.#closed = true;
        for (const stop of this.#listeners.splice(0)) {
            stop();
        }
        this.#draw?.detach();
        this.#draw = null;
        this.#port = null;
    }

    #changed(change: DrawChange): void {
        if (!change.final) {
            return;
        }
        const ring = cropRingOf(change.features);
        this.#ring = ring;
        this.#set(
            ring === null ? { phase: 'drawing', vertices: 0, refusal: null } : { phase: 'drawn', vertices: ring.length, refusal: null },
        );
    }

    #set(state: CropState): void {
        this.#state = state;
        if (!this.#closed) {
            this.#deps.changed(state);
        }
    }
}

export const createCropTool: CropToolFactory = (deps) => new MapCropTool(deps);
