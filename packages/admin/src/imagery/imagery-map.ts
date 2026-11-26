/**
 * The Imagery page's map (`docs/research/M3-interfaces.md` §10.2): one map per page visit (the layers area's `AreaMap`),
 * always Mapbox Standard, **never Satellite**, at the city's own view. Find draws the city's boundary and exactly one
 * footprint, the open scene's (outlined, lightly filled), with its browse image over its corners: nearly every frame
 * covers the whole city and the long strips cross the region, so every result's footprint at once buried the basemap
 * under fills, then under dozens of crossing lines (finding 51 of 2026-11-01). The boundary takes the city theme's light
 * primary, the scene its light tertiary (the admin's basemap is Standard's day look), else fixed colours. A version's
 * page draws what it would publish (M12, `docs/research/M12-own-tiles.md`): its own tiles at full zoom, through the source the public
 * viewer uses, or its small preview until they exist, with the opacity slider's value, the city's outline, and what the image misses
 * of the city shaded. The pictures are canvas sources (`./overlay.ts`).
 */
import type { BBox, LngLat, UiLocale, Theme } from '@hcm/shared';
import type { PoiFeature, RasterLayerSpec, VectorOverlaySpec } from '@hcm/ui/map';

import { AreaMap, type CityFrame, type MapStatus } from '../layers/map-session.js';
import { PreviewLayer } from '../layers/preview.js';
import type { AdminMapFactory } from '../map/factory.js';
import type { FilePort, Picture, PicturePort } from './files.js';
import type { SceneItem } from './model.js';
import type { VersionView } from './version-view.js';
import { cornersOfBox, PictureOverlays, type Corners } from './overlay.js';

export const CITY_OVERLAY = 'imagery-city';
export const SELECTED_OVERLAY = 'imagery-selected';
/** M12: the version's own tiles, and what the image misses of the city. */
export const TILES_LAYER = 'version-tiles';
export const UNCOVERED_OVERLAY = 'imagery-uncovered';
/** The ids of the map's pictures. */
export const BROWSE_PICTURE = 'browse';
export const PREVIEW_PICTURE = 'preview';

/** A browse image or a preview is decoded at most this long (a canvas texture). */
const PICTURE_MAX_SIDE = 2048;

/** The city boundary's colour and the open scene's. */
export interface FootprintColors {
    readonly outline: string;
    readonly selected: string;
}

const FIXED_COLORS: FootprintColors = { outline: '#3949ab', selected: '#c2185b' };

const HEX = /^#[\da-f]{6}$/i;

/** The theme's light-scheme token when it is a `#rrggbb` colour, else `fallback`. */
function tokenOr(theme: Theme | undefined, token: string, fallback: string): string {
    const value = theme?.tokens.light[token] ?? '';
    return HEX.test(value) ? value : fallback;
}

/** The footprints' colours from the city's theme (its light primary and tertiary), else the fixed ones. */
export function footprintColorsOf(theme: Theme | undefined): FootprintColors {
    return {
        outline: tokenOr(theme, '--md-sys-color-primary', FIXED_COLORS.outline),
        selected: tokenOr(theme, '--md-sys-color-tertiary', FIXED_COLORS.selected),
    };
}

export interface ImageryMapDeps {
    readonly maps: AdminMapFactory | null;
    readonly locale: () => UiLocale;
    readonly files: FilePort;
    readonly pictures: PicturePort | null;
    readonly status: (status: MapStatus) => void;
    /** M12: a tile of the version's archive failed (the address ran out, the network went). */
    readonly tilesFailed?: () => void;
}

/** A closed ring of `[lng, lat]` points as the map's feature: a line (an outline), or the area it encloses. */
function ringFeature(id: string, title: string, points: readonly LngLat[], filled: boolean): PoiFeature {
    const ring = [...points, ...points.slice(0, 1)].map((point): [number, number] => [point[0], point[1]]);
    const geometry = filled ? { type: 'Polygon' as const, coordinates: [ring] } : { type: 'LineString' as const, coordinates: ring };
    return { type: 'Feature', geometry, properties: { id, title } };
}

/** One ring on the map, not clickable (the list opens the scenes): the city's outline, or the open scene's filled area. */
function overlay(id: string, feature: PoiFeature, color: string): VectorOverlaySpec {
    const filled = feature.geometry.type === 'Polygon';
    return {
        id,
        kind: 'poi',
        features: [feature],
        color,
        icon: 'satellite_alt',
        visible: true,
        opacity: filled ? 0.6 : 0.8,
        clickable: false,
    };
}

/** The city's bounds as a ring (west-south, east-south, east-north, west-north). */
function boundsRing([[west, south], [east, north]]: BBox): LngLat[] {
    return [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
    ];
}

/** A place on the map, kept inside the city's bounds: the shaded part's hole must lie inside its ring. */
function insideBounds([[west, south], [east, north]]: BBox, [lng, lat]: LngLat): LngLat {
    return [Math.min(east, Math.max(west, lng)), Math.min(north, Math.max(south, lat))];
}

/** The city with the image's measured edge cut out of it: what the image misses (null: nothing to shade, or not measured). */
function uncoveredFeature(bounds: BBox, output: Pick<NonNullable<VersionView['output']>, 'outline' | 'coveragePct'>): PoiFeature | null {
    if (output.outline === null || output.coveragePct === 100) {
        return null;
    }
    const closed = (ring: readonly LngLat[]): [number, number][] =>
        [...ring, ...ring.slice(0, 1)].map((point): [number, number] => [point[0], point[1]]);
    const hole = output.outline.map((place) => insideBounds(bounds, place));
    return {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [closed(boundsRing(bounds)), closed(hole)] },
        properties: { id: 'uncovered', title: '' },
    };
}

/** The four corners a scene's picture goes on: its metadata's, else its footprint's box. */
export function sceneCorners(scene: SceneItem): Corners {
    if (scene.corners !== null) {
        return scene.corners;
    }
    const lngs = scene.footprint.map((point) => point[0]);
    const lats = scene.footprint.map((point) => point[1]);
    return cornersOfBox([
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
    ]);
}

/** The version's archive as the map draws a layer. */
function tilesLayer(output: NonNullable<VersionView['output']>, url: string, opacity: number): RasterLayerSpec {
    return {
        id: TILES_LAYER,
        source: { type: 'pmtiles', url },
        ...{ minzoom: output.minzoom, maxzoom: output.maxzoom, bounds: output.bounds, visible: true, opacity },
        ...{ order: 0, attribution: '', sharpFrom: output.maxzoom - 1 },
    };
}

export class ImageryMap {
    readonly #deps: ImageryMapDeps;
    readonly #area: AreaMap;
    readonly overlays: PictureOverlays;
    /** Bumped by every picture asked for: a slower decode of an older one is dropped. */
    #request = 0;
    #colors = FIXED_COLORS;
    #bounds: BBox | null = null;
    /** The version on the map: the city's frame or colours may be read after it, and a fit may be asked before the map exists. */
    #version: { output: NonNullable<VersionView['output']>; url: string | null; opacity: number } | null = null;
    #fit: readonly [LngLat, LngLat] | null = null;

    constructor(deps: ImageryMapDeps) {
        this.#deps = deps;
        this.#area = new AreaMap({
            ...{ maps: deps.maps, locale: deps.locale, preview: new PreviewLayer() },
            status: (status) => {
                this.#watchTiles(status);
                deps.status(status);
            },
        });
        this.overlays = new PictureOverlays(() => this.#area.port);
    }

    attach(container: HTMLElement): void {
        this.#area.attach(container);
    }

    setFrame(frame: CityFrame): void {
        this.#bounds = frame.bounds;
        this.#area.setFrame(frame);
        this.#redrawVersion();
    }

    zoomBy(delta: number): void {
        this.#area.zoomBy(delta);
    }

    detach(): void {
        this.overlays.clear();
        this.#area.detach();
    }

    /** The colours of the next `showScenes` (the city's theme was read). */
    setColors(colors: FootprintColors): void {
        this.#colors = colors;
        this.#redrawVersion();
    }

    /** Find: the city's boundary and the open scene's footprint (null: none), at the city's view. */
    showScenes(selected: SceneItem | null): void {
        const colors = this.#colors;
        const city =
            this.#bounds === null ? [] : [overlay(CITY_OVERLAY, ringFeature('city', '', boundsRing(this.#bounds), false), colors.outline)];
        const scene =
            selected === null
                ? []
                : [overlay(SELECTED_OVERLAY, ringFeature(selected.id, selected.displayId, selected.footprint, true), colors.selected)];
        this.#area.showContent({ categories: [...city, ...scene] });
    }

    /**
     * A version's page: what it would publish. `url` is its archive (null: its small picture stands in, drawn apart), under the same
     * opacity; from 1:1 on its pixels stay square, so the owner sees where the detail ends.
     */
    showVersion(output: NonNullable<VersionView['output']>, url: string | null, opacity: number): void {
        this.#version = { output, url, opacity };
        const bounds = this.#bounds;
        const uncovered = bounds === null ? null : uncoveredFeature(bounds, output);
        const city =
            bounds === null ? [] : [overlay(CITY_OVERLAY, ringFeature('city', '', boundsRing(bounds), false), this.#colors.outline)];
        const shaded = uncovered === null ? [] : [overlay(UNCOVERED_OVERLAY, uncovered, this.#colors.selected)];
        this.overlays.remove(PREVIEW_PICTURE);
        this.#area.showContent({ layers: url === null ? [] : [tilesLayer(output, url, opacity)], categories: [...city, ...shaded] });
    }

    /** The version left the map (a scene's page draws its own, a version with no output yet nothing). */
    clearVersion(): void {
        this.#version = null;
        this.#fit = null;
        this.#area.showContent({});
    }

    /** The version again, with what was read since. */
    #redrawVersion(): void {
        if (this.#version !== null) {
            this.showVersion(this.#version.output, this.#version.url, this.#version.opacity);
        }
    }

    /** The slider's value on whichever is shown: the version's tiles, or its small picture. */
    setVersionOpacity(opacity: number): void {
        if (this.#version !== null) {
            this.#version.opacity = opacity;
        }
        this.#area.port?.setOverlayOpacity(TILES_LAYER, opacity);
        this.overlays.setOpacity(PREVIEW_PICTURE, opacity);
    }

    /** Actual pixels: one tile pixel on one screen pixel (a 256 px tile of `maxzoom` is 1:1 at `maxzoom - 1`). */
    actualPixels(maxzoom: number): void {
        this.#area.port?.flyTo({ zoom: maxzoom - 1 });
    }

    /** A picture of the bucket over `corners` (the selected scene's browse image, a version's preview). */
    async showPicture(id: string, path: string, corners: Corners, opacity: number): Promise<void> {
        this.#request += 1;
        const request = this.#request;
        const picture = await this.#decode(path, request);
        if (picture !== null && request === this.#request) {
            this.overlays.show({ id, picture, corners, opacity });
        }
    }

    /** No pictures (the selection or the page changed). */
    clearPictures(): void {
        this.#request += 1;
        this.overlays.clear();
    }

    /** A version's page: its preview's box on the map. */
    fitBox(box: readonly [LngLat, LngLat]): void {
        this.#fit = box;
        this.#area.port?.fitBounds(box, { padding: 32 });
    }

    /** The map's errors come from the moment it is drawn, and go with it (`MapPort.destroy`). */
    #watchTiles(status: MapStatus): void {
        if (status === 'ready') {
            if (this.#fit !== null) {
                this.#area.port?.fitBounds(this.#fit, { padding: 32 });
            }
            this.#area.port?.on('error', (event) => {
                if (event.layerId === TILES_LAYER) {
                    this.#deps.tilesFailed?.();
                }
            });
        }
    }

    /** In the pictures' queue; one asked for since then is what the map shows, so an older turn reads nothing. */
    async #decode(path: string, request: number): Promise<Picture | null> {
        const read = (): Promise<Blob | null> => (request === this.#request ? this.#deps.files.read(path) : Promise.resolve(null));
        return (await this.#deps.pictures?.decode(read, PICTURE_MAX_SIDE)) ?? null;
    }
}
