/**
 * The New city flow's map (`docs/research/M5-interfaces.md` §1.6): one admin map per page visit (`AreaMap`), opened on
 * the current city's start view and free to roam the world from zoom 3, the dragged rectangle shown on it as the drawing
 * tools draw a rectangle (adjustable by its corners once Terra Draw is there; shown only with the click-only tools).
 */
import { FIRESTORE_PATHS, cityDocSchema, type BBox, type CityBounds, type LngLat } from '@hcm/shared';
import type { MapDrawPort } from '@hcm/ui/map/draw';

import type { ContentServices } from '../content/services.js';
import { AreaMap, frameOf, type MapStatus } from '../layers/map-session.js';
import { PreviewLayer } from '../layers/preview.js';
import { boundsOfShape, dragBounds, type ScreenPoint, type ScreenSize } from './area-drag.js';

/** The whole world the map may show (Web Mercator stops near the poles). */
const WORLD: BBox = [
    [-180, -80],
    [180, 80],
];
/** The New city map zooms out to the countries around (other pages stay on their city from zoom 9). */
const NEW_CITY_MIN_ZOOM = 3;
/** Where a project without a readable city starts: Europe, zoomed out. */
const FALLBACK_VIEW = { center: [15, 48] as const, zoom: 4, bearing: 0 };
const AREA_ID = 'city-area';
/** Room around a found city's rectangle when the map flies to it. */
const FIT_PADDING_PX = 24;
const AREA_COLOR = '#6750a4';

export interface NewCityMapDeps {
    readonly services: Pick<ContentServices, 'store' | 'cityId' | 'locale' | 'maps'>;
    readonly status: (status: MapStatus) => void;
    /** The rectangle moved on the map (a corner dragged with the drawing tools). */
    readonly moved: (bounds: CityBounds) => void;
}

function ringOf(bounds: CityBounds): LngLat[] {
    const { west, south, east, north } = bounds;
    return [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
    ];
}

export class NewCityMap {
    readonly #deps: NewCityMapDeps;
    readonly #map: AreaMap;
    #stopFrame: (() => void) | null = null;
    #draw: MapDrawPort | null = null;

    constructor(deps: NewCityMapDeps) {
        this.#deps = deps;
        this.#map = new AreaMap({
            maps: deps.services.maps ?? null,
            locale: deps.services.locale,
            preview: new PreviewLayer(),
            status: deps.status,
        });
    }

    /** The page shows its map host: the map opens on the current city's start view (read once). */
    attach(container: HTMLElement): void {
        this.#map.attach(container);
        this.#stopFrame ??= this.#deps.services.store.watchDoc(
            FIRESTORE_PATHS.city(this.#deps.services.cityId),
            cityDocSchema,
            (city) => {
                const view = city === null ? FALLBACK_VIEW : frameOf(city.data).view;
                this.#map.setFrame({ bounds: WORLD, view, minZoom: NEW_CITY_MIN_ZOOM });
            },
            () => {
                this.#map.setFrame({ bounds: WORLD, view: FALLBACK_VIEW, minZoom: NEW_CITY_MIN_ZOOM });
            },
        );
    }

    /** The rectangle a drag (or two clicks) makes on the map as it shows now; null before the map is drawn. */
    boundsOf(from: ScreenPoint, to: ScreenPoint, size: ScreenSize): CityBounds | null {
        const port = this.#map.port;
        return port === null ? null : dragBounds(port.getView(), size, from, to);
    }

    /** Moves the map to `bounds` (a city found by its name); nothing before the map is drawn. */
    frame(bounds: CityBounds): void {
        const corners: BBox = [
            [bounds.west, bounds.south],
            [bounds.east, bounds.north],
        ];
        this.#map.port?.fitBounds(corners, { padding: FIT_PADDING_PX });
    }

    /** Shows `bounds` on the map (none: nothing). */
    async show(bounds: CityBounds | null): Promise<void> {
        const draw = await this.#tools();
        draw?.load(
            bounds === null ? [] : [{ id: AREA_ID, geometry: { type: 'Polygon', coordinates: [ringOf(bounds)] }, shape: 'rectangle' }],
        );
        draw?.setMode(bounds === null ? 'static' : 'select');
    }

    /** The map's zoom buttons (`hcm-zoom`). */
    zoomBy(delta: number): void {
        this.#map.zoomBy(delta);
    }

    detach(): void {
        this.#stopFrame?.();
        this.#stopFrame = null;
        this.#draw = null;
        this.#map.detach();
    }

    async #tools(): Promise<MapDrawPort | null> {
        if (this.#draw !== null) {
            return this.#draw;
        }
        const drawing = await this.#map.drawing();
        if (drawing === null) {
            return null;
        }
        drawing.draw.attach(drawing.port, { limits: drawing.bounds, maxVertices: 5, maxRings: 1, color: AREA_COLOR });
        drawing.draw.on('change', (change) => {
            const bounds = change.final ? boundsOfShape(change.features[0]?.geometry) : null;
            if (bounds !== null) {
                this.#deps.moved(bounds);
            }
        });
        this.#draw = drawing.draw;
        return drawing.draw;
    }
}
