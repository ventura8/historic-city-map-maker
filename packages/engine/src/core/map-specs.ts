/**
 * The manifest as the map draws it: raster layer specs, photo points and cones, POI overlays per category and the map
 * options. Pure; titles are resolved to the current language (English falls back to Romanian) and relative asset
 * URLs to the manifest's address.
 */
import {
    isPhotoNearYear,
    conePolygon,
    DEFAULT_FOV,
    findOverlay,
    isHttpsUrl,
    localized,
    poiIcon,
    poiInYear,
    type Basemap,
    type Layer,
    type LayerSource,
    type ViewerLocale,
    type Manifest,
    type MapView,
    type Overlay,
    type Photo,
    type Poi,
    type PoiCategory,
} from '@hcm/shared';
import { localizedCredit } from '@hcm/shared/credits';
import { basemapLabels, MAP_LABEL_CONFIG, MAP_LABEL_KINDS, TRANSIT_LABELS, transitLabels, type MapLabels } from '@hcm/shared/map-labels';
import type {
    MapOptions,
    PhotoConeFeature,
    PhotoFeatureCollection,
    PhotoPointFeature,
    PoiFeature,
    RasterLayerSpec,
    VectorOverlaySpec,
} from '@hcm/ui/map';

/** Standard's configuration property of the basemap's light. */
export const LIGHT_PRESET = 'lightPreset';

/** Length of a view cone's sides on the map, in metres (a drawing choice, `ViewCone.distanceM`). */
export const CONE_LENGTH_M = 60;

/** `url` as the browser must load it: https stays, a relative path is resolved against the manifest's address. */
export function resolveAssetUrl(url: string, base: string | undefined): string {
    if (isHttpsUrl(url) || base === undefined || !URL.canParse(url, base)) {
        return url;
    }
    return new URL(url, base).href;
}

function resolvedSource(source: LayerSource, base: string | undefined): LayerSource {
    return source.type === 'pmtiles' ? { ...source, url: resolveAssetUrl(source.url, base) } : source;
}

/** The optional parts of a layer's spec, present only when the manifest has them. */
function rasterExtras(layer: Layer): Pick<RasterLayerSpec, 'bounds' | 'adjustments'> {
    const bounds = layer.bounds === undefined ? {} : { bounds: layer.bounds };
    return layer.adjustments === undefined ? bounds : { ...bounds, adjustments: layer.adjustments };
}

/**
 * A layer as its overlay shows it now (the manifest defaults without one); its credit in `locale` when given (Mapbox GL's
 * attribution line, which draws each distinct credit once: `localizedCredit`).
 */
export function rasterSpec(layer: Layer, overlay: Overlay | undefined, base: string | undefined, locale?: ViewerLocale): RasterLayerSpec {
    const state = overlay ?? { visible: layer.defaultVisible, opacity: layer.opacity };
    return {
        id: layer.id,
        source: resolvedSource(layer.source, base),
        minzoom: layer.minzoom,
        maxzoom: layer.maxzoom,
        visible: state.visible,
        opacity: state.opacity,
        // Layers stack by date, the newest on top, whatever the admin's `order` (the owner 2026-11-09); `MapSync` lifts the
        // timeline's layer above them (V15, `stack.ts`).
        order: layer.year,
        attribution: locale === undefined ? layer.attribution : localizedCredit(layer.attribution, locale),
        ...rasterExtras(layer),
    };
}

function photoPoint(photo: Photo, locale: ViewerLocale): PhotoPointFeature {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [photo.location.lng, photo.location.lat] },
        properties: {
            id: photo.id,
            title: localized(photo.title, locale),
            year: photo.year ?? null,
            bearing: photo.bearing ?? null,
            ...(photo.kind === 'aerial' ? { aerial: true } : {}),
        },
    };
}

function photoCone(photo: Photo): PhotoConeFeature[] {
    if (photo.bearing === undefined) {
        return [];
    }
    const cone = { bearing: photo.bearing, fov: photo.fov ?? DEFAULT_FOV, distanceM: CONE_LENGTH_M };
    const ring = conePolygon([photo.location.lng, photo.location.lat], cone);
    return [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { id: photo.id } }];
}

/**
 * Which photos the map draws (the owner, 2026-11-15): `all` (the default) whatever the timeline year, or `near-year`, the
 * photos within `window` years of the selected stop (every photo at "today"). The photo's year stays in its details.
 */
export type PhotosScope = { readonly kind: 'all' } | { readonly kind: 'near-year'; readonly window: number };

/** The default scope: every photo. */
export const ALL_PHOTOS: PhotosScope = { kind: 'all' };

/** The scope of `photosNear` (the viewer's state): every photo, or those within that many years. */
export function photosScope(photosNear: number | null): PhotosScope {
    return photosNear === null ? ALL_PHOTOS : { kind: 'near-year', window: photosNear };
}

/** The photos `scope` shows at `year`, as markers plus a cone for each photo with a bearing. */
export function photoFeatures(
    photos: readonly Photo[],
    locale: ViewerLocale,
    year: number | null = null,
    scope: PhotosScope = ALL_PHOTOS,
): PhotoFeatureCollection {
    const shown = scope.kind === 'all' || year === null ? photos : photos.filter((photo) => isPhotoNearYear(photo, year, scope.window));
    return { type: 'FeatureCollection', features: [...shown.map((photo) => photoPoint(photo, locale)), ...shown.flatMap(photoCone)] };
}

function poiFeature(poi: Poi, locale: ViewerLocale): PoiFeature {
    return { type: 'Feature', geometry: poi.geometry, properties: { id: poi.id, title: localized(poi.title, locale) } };
}

function poiSpec(category: PoiCategory, pois: readonly Poi[], overlay: Overlay | undefined, locale: ViewerLocale): VectorOverlaySpec {
    return {
        id: category.id,
        kind: 'poi',
        features: pois.filter((poi) => poi.category === category.id).map((poi) => poiFeature(poi, locale)),
        color: category.color,
        icon: poiIcon(category.icon),
        visible: overlay?.visible ?? true,
        opacity: overlay?.opacity ?? category.defaultOpacity,
    };
}

/** One vector overlay per POI category, with the POIs the timeline shows at `year` (`poiInYear`). */
export function poiSpecs(
    manifest: Manifest,
    overlays: readonly Overlay[],
    locale: ViewerLocale,
    year: number | null,
): readonly VectorOverlaySpec[] {
    const shown = (manifest.pois ?? []).filter((poi) => poiInYear(poi, year));
    return (manifest.poiCategories ?? []).map((category) => poiSpec(category, shown, findOverlay(overlays, category.id), locale));
}

/** What a map is mounted with besides the manifest: the moment's view, language, motion and basemap labels. */
export interface MapMoment {
    readonly view: MapView;
    readonly locale: ViewerLocale;
    readonly reducedMotion: boolean;
    readonly labels: MapLabels;
    /** The light the theme asks of the basemap (`map-light.ts`), null when the city's basemap sets its own. */
    readonly light: 'day' | 'night' | null;
}

/**
 * The city's `basemap.config` with the labels the visitor chose where they differ from it, so a shared link never flashes
 * the labels it turned off (transit stations with the points of interest), and a dark theme's night, so a dark page never
 * flashes day (day is Standard's own default, and `MapSync` writes it where a style's differs). Mapbox ignores a property
 * the style does not have.
 */
function basemapConfig(basemap: Basemap, labels: MapLabels, light: MapMoment['light']): MapOptions['config'] {
    const defaults = basemapLabels(basemap);
    const changed = MAP_LABEL_KINDS.filter((kind) => labels[kind] !== defaults[kind]).map((kind) => [MAP_LABEL_CONFIG[kind], labels[kind]]);
    const night = light === 'night' ? { [LIGHT_PRESET]: light } : {};
    const transit = transitLabels(basemap.config, labels.pois) ? {} : { [TRANSIT_LABELS]: false };
    const config = { ...basemap.config, ...night, ...Object.fromEntries(changed), ...transit } as NonNullable<MapOptions['config']>;
    return Object.keys(config).length === 0 ? undefined : config;
}

/** The map of a city: its basemap, token, zoom range and bounds. */
export function mapOptions(manifest: Manifest, { view, locale, reducedMotion, labels, light }: MapMoment): MapOptions {
    const { city } = manifest;
    const config = basemapConfig(city.basemap, labels, light);
    return {
        style: city.basemap.style,
        ...(config === undefined ? {} : { config }),
        accessToken: city.mapbox.publicToken,
        view,
        minZoom: city.minZoom,
        maxZoom: city.maxZoom,
        maxBounds: city.bounds,
        locale,
        reducedMotion,
    };
}
