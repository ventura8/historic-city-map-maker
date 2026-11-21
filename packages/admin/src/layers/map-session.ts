/**
 * The layers page's map (`docs/research/M2c-interfaces.md` §3.5, §5.2, §8.1): one map per page visit, created when the
 * page shows its map host (`hcm-admin-map`) and the city's frame is known, destroyed when the page goes. It draws the
 * open layer above the Standard basemap as saved, and the editor's draft overrides it live through the map's preview
 * (`PreviewLayer`): opacity and image adjustments, never a write. The admin map is always Standard: Satellite is never
 * loaded (§3.4). The settings page's map is one too (`../settings/settings-map.ts`): it shows the whole saved content
 * (`showContent`: the layers, the photos, the places by category) and reads the map itself (`port`: its clicks and view).
 */
import { bboxCenter, bboxFromRecord, roundTo, type BBox, type CityDoc, type LayerDoc, type UiLocale, type MapView } from '@hcm/shared';
import type { MapPort, RasterLayerSpec } from '@hcm/ui/map';
import type { MapDrawPort } from '@hcm/ui/map/draw';

import type { AdminMapFactory, AdminMapHandle, AdminMapResult } from '../map/factory.js';
import type { MapContent } from '../map/preview.js';
import type { PreviewLayer } from './preview.js';

export type MapStatus = 'none' | 'loading' | 'ready' | 'no-token' | 'no-webgl' | 'failed';

/** What a new map needs of the city: its bounds and its start view. */
export interface CityFrame {
    readonly bounds: BBox;
    readonly view: MapView;
    /** M5's New city map zooms further out than a city's pages (the factory's own minimum otherwise). */
    readonly minZoom?: number;
}

/** The manifest's default start zoom for a city without one. */
const DEFAULT_ZOOM = 13;

export function frameOf(city: CityDoc): CityFrame {
    const bounds = bboxFromRecord(city.bounds);
    const center = city.center === undefined ? bboxCenter(bounds) : ([city.center.lng, city.center.lat] as const);
    return { bounds, view: { center, zoom: city.zoom ?? DEFAULT_ZOOM, bearing: 0 } };
}

/** The open layer as the map draws it (shown, whatever its "shown at start"; the draft's look comes as a preview). */
export function rasterOf(id: string, layer: LayerDoc): RasterLayerSpec {
    return {
        id,
        source: layer.source,
        minzoom: layer.minzoom,
        maxzoom: layer.maxzoom,
        ...(layer.bounds === undefined ? {} : { bounds: bboxFromRecord(layer.bounds) }),
        visible: true,
        opacity: layer.opacity,
        ...(layer.adjustments === undefined ? {} : { adjustments: layer.adjustments }),
        order: layer.order,
        attribution: layer.attribution ?? '',
    };
}

export interface AreaMapDeps {
    readonly maps: AdminMapFactory | null;
    readonly locale: () => UiLocale;
    readonly preview: PreviewLayer;
    readonly status: (status: MapStatus) => void;
}

export class AreaMap {
    readonly #deps: AreaMapDeps;
    #container: HTMLElement | null = null;
    #frame: CityFrame | null = null;
    #handle: AdminMapHandle | null = null;
    #content: MapContent = {};
    /** Bumped by every attach and detach: a slower create of an older host is dropped. */
    #generation = 0;

    constructor(deps: AreaMapDeps) {
        this.#deps = deps;
    }

    /** The page shows its map host (a new host replaces the old map). */
    attach(container: HTMLElement): void {
        if (container !== this.#container) {
            this.detach();
            this.#container = container;
            void this.#create();
        }
    }

    /** The city's bounds and view (the map waits for them). */
    setFrame(frame: CityFrame): void {
        const first = this.#frame === null;
        this.#frame = frame;
        if (first) {
            void this.#create();
        }
    }

    /** The saved layers the map draws (the open one; none on the list alone). */
    show(layers: readonly RasterLayerSpec[]): void {
        this.showContent({ layers });
    }

    /** The saved content the map draws: layers, photos, places by category. */
    showContent(content: MapContent): void {
        this.#content = content;
        this.#handle?.preview.show(content);
    }

    /**
     * The drawing tools on the drawn map, with the map and the city's bounds (their limits), else null: the layer
     * editor's Crop (M3, CR-M3-7) draws its polygon with them.
     */
    async drawing(): Promise<{ readonly draw: MapDrawPort; readonly port: MapPort; readonly bounds: BBox } | null> {
        const handle = this.#handle;
        const frame = this.#frame;
        if (handle === null || frame === null) {
            return null;
        }
        return { draw: await handle.draw(), port: handle.port, bounds: frame.bounds };
    }

    /** The map itself once it is drawn (its clicks and its view), else null. */
    get port(): MapPort | null {
        return this.#handle?.port ?? null;
    }

    zoomBy(delta: number): void {
        const port = this.#handle?.port;
        if (port !== undefined) {
            const view = port.getView();
            port.flyTo({ zoom: roundTo(view.zoom + delta, 2) });
        }
    }

    /** The page went: the map is destroyed, the previews forgotten. */
    detach(): void {
        this.#generation += 1;
        this.#container = null;
        this.#deps.preview.attach(null);
        this.#handle?.destroy();
        this.#handle = null;
        this.#deps.status('none');
    }

    async #create(): Promise<void> {
        const request = this.#request();
        if (request === null) {
            return;
        }
        const generation = this.#generation;
        this.#deps.status('loading');
        const { container, frame, maps } = request;
        const options = { bounds: frame.bounds, view: frame.view, locale: this.#deps.locale() };
        this.#created(
            await maps.create(container, frame.minZoom === undefined ? options : { ...options, minZoom: frame.minZoom }),
            generation,
        );
    }

    /** What a new map needs, once the page shows the host and the city is known; null before (or with a map already). */
    #request(): { readonly container: HTMLElement; readonly frame: CityFrame; readonly maps: AdminMapFactory } | null {
        const { maps } = this.#deps;
        const container = this.#container;
        const frame = this.#frame;
        if (container === null || frame === null || this.#handle !== null) {
            return null;
        }
        if (maps === null) {
            this.#deps.status('failed');
            return null;
        }
        return { container, frame, maps };
    }

    #created(result: AdminMapResult, generation: number): void {
        if (generation !== this.#generation) {
            this.#discard(result);
            return;
        }
        if (!result.ok) {
            this.#deps.status(result.reason);
            return;
        }
        this.#handle = result.map;
        result.map.preview.show(this.#content);
        this.#deps.preview.attach(result.map.preview);
        this.#deps.status('ready');
    }

    #discard(result: AdminMapResult): void {
        if (result.ok) {
            result.map.destroy();
        }
    }
}
