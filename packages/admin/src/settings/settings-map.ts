/**
 * The settings page's map (`docs/research/M2c-interfaces.md` §8.5; behaviours A19 and A36; `DECISIONS-for-review.md`
 * §42a): one map per page visit (`AreaMap`), shown by the area and overlays sections. It draws the city's saved content
 * as the visitors see it (the layers, the published photos, the published places in their categories) so the overlay
 * defaults preview live on it (`PreviewLayer`, never a write), and the area section's bounds as a rectangle. **Draw the
 * area** takes two clicks on the map, two opposite corners, and hands the rectangle to the draft; **Use this view** hands
 * the map's centre and zoom over. The four number fields stay the keyboard's way to the same bounds (WCAG 2.1.1).
 * Its lists listen only while the map is attached.
 */
import {
    FIRESTORE_PATHS,
    MAX_LAYERS,
    MAX_POI_CATEGORIES,
    layerDocSchema,
    photoDocSchema,
    poiCategoryDocSchema,
    poiDocSchema,
    type BoundsRecord,
    type CityDoc,
    type LayerDoc,
    type LngLat,
    type MapView,
    type PhotoDoc,
    type PoiCategoryDoc,
    type PoiDoc,
} from '@hcm/shared';
import type { RasterLayerSpec, VectorOverlaySpec } from '@hcm/ui/map';

import { LiveList } from '../content/list.js';
import type { ContentServices, Stored } from '../content/services.js';
import { AreaMap, frameOf, rasterOf, type MapStatus } from '../layers/map-session.js';
import type { PreviewLayer } from '../layers/preview.js';
import { photoFeatures, type MapPhoto } from '../photos/map.js';
import { overlayOf } from '../pois/map-session.js';
import { categoryItemOf, poiItemOf, type CategoryItem, type PoiItem } from '../pois/model.js';
import { roundedBounds } from './area.js';
import { photosOpacityOf } from './overlays.js';

/** Where a rectangle being drawn is: waiting for its first corner, or for the opposite one. */
type BoundsDrawing = 'first' | 'second' | null;

export interface SettingsMapState {
    readonly status: MapStatus;
    readonly drawing: BoundsDrawing;
}

export const NO_SETTINGS_MAP: SettingsMapState = { status: 'none', drawing: null };

export interface SettingsMapDeps {
    readonly services: Pick<ContentServices, 'store' | 'clock' | 'denied' | 'cityId' | 'maps' | 'locale'>;
    /** The settings area's previews (the overlay defaults, a category's opacity): drawn on this map once it exists. */
    readonly preview: PreviewLayer;
    readonly changed: (state: SettingsMapState) => void;
    /** Two corners were clicked: the rectangle they make. */
    readonly drawn: (bounds: BoundsRecord) => void;
}

/** The overlay that draws the bounds being edited (no category can take this id: it is not a slug). */
export const BOUNDS_OVERLAY_ID = '_bounds';

/** The rectangle's outline and fill (the M3 baseline primary: the map has no theme). */
const BOUNDS_COLOR = '#6750a4';

/** How many photos and places the map draws at most (more than a city of this kind holds). */
const MAP_ITEMS = 1000;

function mapPhotoOf(doc: Stored<PhotoDoc>): MapPhoto[] {
    const { title, year, location, bearing, fov } = doc.data;
    return location === undefined
        ? []
        : [{ id: doc.id, title: title.ro, year: year ?? null, location, bearing: bearing ?? null, fov: fov ?? null }];
}

/** A place on its category's overlay, its title in the admin's language. */
function placeOf(place: PoiItem, locale: string): { readonly id: string; readonly geometry: PoiItem['geometry']; readonly title: string } {
    return { id: place.id, geometry: place.geometry, title: locale === 'en' ? (place.title.en ?? place.title.ro) : place.title.ro };
}

/** The rectangle of two opposite corners. */
export function boundsOf(first: LngLat, second: LngLat): BoundsRecord {
    return roundedBounds({
        west: Math.min(first[0], second[0]),
        east: Math.max(first[0], second[0]),
        south: Math.min(first[1], second[1]),
        north: Math.max(first[1], second[1]),
    });
}

function rectangle(bounds: BoundsRecord): VectorOverlaySpec {
    const ring: [number, number][] = [
        [bounds.west, bounds.south],
        [bounds.east, bounds.south],
        [bounds.east, bounds.north],
        [bounds.west, bounds.north],
        [bounds.west, bounds.south],
    ];
    return {
        id: BOUNDS_OVERLAY_ID,
        kind: 'poi',
        features: [
            { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { id: BOUNDS_OVERLAY_ID, title: '' } },
        ],
        color: BOUNDS_COLOR,
        icon: 'crop_free',
        visible: true,
        opacity: 0.6,
        clickable: false,
    };
}

export class SettingsMap {
    readonly #deps: SettingsMapDeps;
    readonly #area: AreaMap;
    readonly #layers: LiveList<LayerDoc, RasterLayerSpec>;
    readonly #photos: LiveList<PhotoDoc, MapPhoto[]>;
    readonly #places: LiveList<PoiDoc, PoiItem>;
    readonly #categories: LiveList<PoiCategoryDoc, CategoryItem>;
    #state: SettingsMapState = NO_SETTINGS_MAP;
    #city: CityDoc | null = null;
    #bounds: BoundsRecord | null = null;
    #corner: LngLat | null = null;
    #stopClicks: (() => void) | null = null;

    constructor(deps: SettingsMapDeps) {
        this.#deps = deps;
        const { store, clock, cityId, maps, locale } = deps.services;
        const denied = (): void => {
            deps.services.denied();
        };
        const changed = (): void => {
            this.#showContent();
        };
        const lists = { store, clock, denied, changed };
        this.#layers = new LiveList({
            ...lists,
            ...{ collection: FIRESTORE_PATHS.layers(cityId), schema: layerDocSchema, pageSize: MAX_LAYERS },
            map: (doc) => rasterOf(doc.id, doc.data),
        });
        this.#photos = new LiveList({
            ...lists,
            collection: FIRESTORE_PATHS.photos(cityId),
            schema: photoDocSchema,
            pageSize: MAP_ITEMS,
            map: mapPhotoOf,
        });
        this.#places = new LiveList({
            ...lists,
            collection: FIRESTORE_PATHS.pois(cityId),
            schema: poiDocSchema,
            pageSize: MAP_ITEMS,
            map: poiItemOf,
        });
        this.#categories = new LiveList({
            ...lists,
            ...{ collection: FIRESTORE_PATHS.poiCategories(cityId), schema: poiCategoryDocSchema, pageSize: MAX_POI_CATEGORIES },
            map: categoryItemOf,
        });
        this.#area = new AreaMap({
            ...{ maps: maps ?? null, locale, preview: deps.preview },
            status: (status) => {
                this.#statusChanged(status);
            },
        });
    }

    get state(): SettingsMapState {
        return this.#state;
    }

    /** The page shows its map host: the map is created into it, its lists start listening. */
    attach(container: HTMLElement): void {
        if (!this.#layers.active) {
            this.#layers.show({});
            this.#photos.show({ where: [['published', '==', true]] });
            this.#places.show({ where: [['published', '==', true]] });
            this.#categories.show({});
        }
        this.#area.attach(container);
    }

    /** The city as saved: the map's frame (it waits for it) and the photos overlay's default. */
    setCity(city: CityDoc): void {
        this.#city = city;
        this.#area.setFrame(frameOf(city));
        this.#showContent();
    }

    /** The bounds the area section's draft holds (null: no rectangle). */
    showBounds(bounds: BoundsRecord | null): void {
        this.#bounds = bounds;
        this.#drawBounds();
    }

    zoomBy(delta: number): void {
        this.#area.zoomBy(delta);
    }

    /** The map's centre and zoom, or null without a map. */
    view(): Pick<MapView, 'center' | 'zoom'> | null {
        return this.#area.port?.getView() ?? null;
    }

    /** Draw the area: the next two clicks on the map are two opposite corners (again: stop drawing). */
    toggleDrawing(): void {
        const port = this.#area.port;
        if (this.#state.drawing !== null || port === null) {
            this.#stopDrawing();
            return;
        }
        this.#stopClicks = port.onMapClick((position) => {
            const corner = this.#corner;
            if (corner === null) {
                this.#first(position);
            } else {
                this.#second(corner, position);
            }
        });
        this.#set({ drawing: 'first' });
    }

    /** The page went: the map is destroyed, the lists stop. */
    detach(): void {
        this.#stopDrawing();
        this.#area.detach();
        this.#layers.stop();
        this.#photos.stop();
        this.#places.stop();
        this.#categories.stop();
    }

    #first(position: LngLat): void {
        this.#corner = position;
        this.#set({ drawing: 'second' });
    }

    #second(first: LngLat, position: LngLat): void {
        this.#stopDrawing();
        this.#deps.drawn(boundsOf(first, position));
    }

    #stopDrawing(): void {
        this.#stopClicks?.();
        this.#stopClicks = null;
        this.#corner = null;
        this.#set({ drawing: null });
    }

    #statusChanged(status: MapStatus): void {
        this.#set({ status });
        if (status === 'ready') {
            this.#drawBounds();
        }
    }

    #showContent(): void {
        const places = this.#places.list.items;
        const locale = this.#deps.services.locale();
        this.#area.showContent({
            layers: this.#layers.list.items,
            photos: photoFeatures(this.#photos.list.items.flat()),
            photosOpacity: photosOpacityOf(this.#city),
            categories: this.#categories.list.items.map((category) =>
                overlayOf(
                    category,
                    places.filter((place) => place.category === category.id).map((place) => placeOf(place, locale)),
                ),
            ),
        });
        this.#drawBounds();
    }

    /** The rectangle on the map (or none), once the map is drawn. */
    #drawBounds(): void {
        const port = this.#area.port;
        if (port === null) {
            return;
        }
        if (this.#bounds === null) {
            port.removeLayer(BOUNDS_OVERLAY_ID);
            return;
        }
        port.addVectorOverlay(rectangle(this.#bounds), 'top');
    }

    #set(patch: Partial<SettingsMapState>): void {
        this.#state = { ...this.#state, ...patch };
        this.#deps.changed(this.#state);
    }
}
