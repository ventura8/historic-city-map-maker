/**
 * Live preview on the admin's map (docs/research/M2c-interfaces.md §5.2): `show` draws a page's saved content (the
 * selected layer, the photos, one vector overlay per POI category); `preview` lets a draft override its own entity, never
 * writing anything, coalesced to one paint per animation frame; `restore` puts that entity back as saved (Discard, a page
 * change). Paint values come from the same `rasterAdjustmentPaint` the viewer uses, through `MapPort`, so what the admin
 * previews is what the viewer shows.
 */
import { conePolygon, DEFAULT_FOV, PHOTOS_OVERLAY_ID, rasterAdjustmentPaint, type LayerAdjustments, type LngLat } from '@hcm/shared';
import type {
    FrameScheduler,
    MapPort,
    PhotoConeFeature,
    PhotoFeatureCollection,
    PhotoPointFeature,
    RasterLayerSpec,
    VectorOverlaySpec,
} from '@hcm/ui/map';

/** Length of a previewed view cone's sides in metres (the viewer's `CONE_LENGTH_M`). */
const PREVIEW_CONE_LENGTH_M = 60;

/** A page's saved content on its map. */
export interface MapContent {
    /** Raster layers, drawn in the `middle` slot. */
    readonly layers?: readonly RasterLayerSpec[];
    readonly photos?: PhotoFeatureCollection;
    /** The photos overlay's opacity, 0..1 (1 when absent). */
    readonly photosOpacity?: number;
    /** One vector overlay per POI category, drawn in the `top` slot. */
    readonly categories?: readonly VectorOverlaySpec[];
}

export type PreviewChange =
    | {
          readonly kind: 'layer';
          readonly id: string;
          readonly opacity?: number;
          readonly visible?: boolean;
          readonly adjustments?: LayerAdjustments;
      }
    | { readonly kind: 'photos-overlay'; readonly opacity: number }
    | { readonly kind: 'poi-category'; readonly id: string; readonly opacity?: number; readonly color?: string; readonly icon?: string }
    | { readonly kind: 'photo'; readonly id: string; readonly location: LngLat; readonly bearing?: number; readonly fov?: number }
    /** A place being edited: the drawing tools show it, so its category's overlay leaves it out meanwhile. */
    | { readonly kind: 'poi'; readonly id: string; readonly category: string };

export type PreviewTarget =
    | { readonly kind: 'layer'; readonly id: string }
    | { readonly kind: 'photos-overlay' }
    | { readonly kind: 'poi-category'; readonly id: string }
    | { readonly kind: 'photo'; readonly id: string }
    | { readonly kind: 'poi'; readonly id: string };

export interface MapPreview {
    show(content: MapContent): void;
    preview(change: PreviewChange): void;
    restore(target: PreviewTarget): void;
}

const NO_PHOTOS: PhotoFeatureCollection = { type: 'FeatureCollection', features: [] };

/** Every overlay of a page's content that has an id of its own (its layers and categories). */
function overlaysOf(content: MapContent): readonly { readonly id: string }[] {
    return [...(content.layers ?? []), ...(content.categories ?? [])];
}

function targetKey(target: PreviewTarget): string {
    return target.kind === 'photos-overlay' ? target.kind : `${target.kind}:${target.id}`;
}

function photoPoint(feature: PhotoPointFeature, change: Extract<PreviewChange, { kind: 'photo' }>): PhotoPointFeature {
    return {
        ...feature,
        geometry: { type: 'Point', coordinates: change.location },
        properties: { ...feature.properties, bearing: change.bearing ?? null },
    };
}

function photoCone(change: Extract<PreviewChange, { kind: 'photo' }>): PhotoConeFeature[] {
    if (change.bearing === undefined) {
        return [];
    }
    const cone = { bearing: change.bearing, fov: change.fov ?? DEFAULT_FOV, distanceM: PREVIEW_CONE_LENGTH_M };
    return [
        {
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [conePolygon(change.location, cone)] },
            properties: { id: change.id },
        },
    ];
}

/** The photos with one photo's marker and cone where the draft puts them. */
export function previewPhotos(photos: PhotoFeatureCollection, change: Extract<PreviewChange, { kind: 'photo' }>): PhotoFeatureCollection {
    const others = photos.features.filter((feature) => feature.properties.id !== change.id);
    const point = photos.features.find(
        (feature): feature is PhotoPointFeature => feature.properties.id === change.id && feature.geometry.type === 'Point',
    );
    const marker: PhotoPointFeature[] = point === undefined ? [] : [photoPoint(point, change)];
    return { type: 'FeatureCollection', features: [...others, ...marker, ...photoCone(change)] };
}

class Preview implements MapPreview {
    readonly #map: MapPort;
    readonly #frames: FrameScheduler;
    readonly #pending = new Map<string, PreviewChange>();
    #content: MapContent = {};
    /** The place a draft is editing: left out of its category's overlay. */
    #editing: { readonly id: string; readonly category: string } | null = null;
    /** A frame is requested for the pending previews. */
    #scheduled = false;

    constructor(map: MapPort, frames: FrameScheduler) {
        this.#map = map;
        this.#frames = frames;
    }

    show(content: MapContent): void {
        const before = this.#content;
        this.#content = content;
        this.#removeGone(before, content);
        this.#drawOverlays(content);
        this.#map.setPhotosData(this.#photos());
        this.#map.setOverlayOpacity(PHOTOS_OVERLAY_ID, content.photosOpacity ?? 1);
        this.#flush();
    }

    #drawOverlays(content: MapContent): void {
        for (const layer of content.layers ?? []) {
            this.#map.addRasterLayer(layer, 'middle');
        }
        for (const category of content.categories ?? []) {
            this.#drawCategory(category);
        }
    }

    #removeGone(before: MapContent, after: MapContent): void {
        const kept = new Set(overlaysOf(after).map((overlay) => overlay.id));
        for (const overlay of overlaysOf(before)) {
            if (!kept.has(overlay.id)) {
                this.#map.removeLayer(overlay.id);
            }
        }
    }

    /** A category's overlay as saved, without the place being edited. */
    #drawCategory(spec: VectorOverlaySpec): void {
        const editing = this.#editing;
        const features =
            editing?.category === spec.id ? spec.features.filter((feature) => feature.properties.id !== editing.id) : spec.features;
        this.#map.addVectorOverlay({ ...spec, features }, 'top');
    }

    preview(change: PreviewChange): void {
        this.#pending.set(targetKey(change), change);
        if (!this.#scheduled) {
            this.#scheduled = true;
            this.#frames.request(() => {
                this.#scheduled = false;
                this.#flush();
            });
        }
    }

    #flush(): void {
        const changes = [...this.#pending.values()];
        this.#pending.clear();
        for (const change of changes) {
            this.#apply(change);
        }
    }

    #apply(change: PreviewChange): void {
        (this.#appliers[change.kind] as (change: PreviewChange) => void)(change);
    }

    readonly #appliers: { readonly [K in PreviewChange['kind']]: (change: Extract<PreviewChange, { kind: K }>) => void } = {
        layer: (change) => {
            this.#applyLayer(change);
        },
        'photos-overlay': (change) => {
            this.#map.setOverlayOpacity(PHOTOS_OVERLAY_ID, change.opacity);
        },
        'poi-category': (change) => {
            this.#applyCategory(change);
        },
        photo: (change) => {
            this.#map.setPhotosData(previewPhotos(this.#photos(), change));
        },
        poi: (change) => {
            this.#edit(change);
        },
    };

    #photos(): PhotoFeatureCollection {
        return this.#content.photos ?? NO_PHOTOS;
    }

    #applyLayer(change: Extract<PreviewChange, { kind: 'layer' }>): void {
        if (change.opacity !== undefined) {
            this.#map.setOverlayOpacity(change.id, change.opacity);
        }
        if (change.visible !== undefined) {
            this.#map.setOverlayVisibility(change.id, change.visible);
        }
        if (change.adjustments !== undefined) {
            this.#map.setLayerPaint(change.id, rasterAdjustmentPaint(change.adjustments));
        }
    }

    #applyCategory(change: Extract<PreviewChange, { kind: 'poi-category' }>): void {
        if (change.color !== undefined || change.icon !== undefined) {
            this.#restyle(change);
        }
        if (change.opacity !== undefined) {
            this.#map.setOverlayOpacity(change.id, change.opacity);
        }
    }

    /** A category drawn again in the draft's colour or icon. */
    #restyle(change: Extract<PreviewChange, { kind: 'poi-category' }>): void {
        const saved = this.#category(change.id);
        if (saved !== undefined) {
            this.#drawCategory({ ...saved, color: change.color ?? saved.color, icon: change.icon ?? saved.icon });
        }
    }

    #edit(change: Extract<PreviewChange, { kind: 'poi' }>): void {
        const previous = this.#editing;
        this.#editing = { id: change.id, category: change.category };
        this.#redraw(previous?.category);
        this.#redraw(change.category);
    }

    #redraw(categoryId: string | undefined): void {
        const saved = categoryId === undefined ? undefined : this.#category(categoryId);
        if (saved !== undefined) {
            this.#drawCategory(saved);
        }
    }

    #category(id: string): VectorOverlaySpec | undefined {
        return this.#content.categories?.find((category) => category.id === id);
    }

    #layer(id: string): RasterLayerSpec | undefined {
        return this.#content.layers?.find((layer) => layer.id === id);
    }

    restore(target: PreviewTarget): void {
        this.#pending.delete(targetKey(target));
        (this.#restorers[target.kind] as (target: PreviewTarget) => void)(target);
    }

    readonly #restorers: { readonly [K in PreviewTarget['kind']]: (target: Extract<PreviewTarget, { kind: K }>) => void } = {
        layer: (target) => {
            this.#restoreLayer(target.id);
        },
        'photos-overlay': () => {
            this.#map.setOverlayOpacity(PHOTOS_OVERLAY_ID, this.#content.photosOpacity ?? 1);
        },
        'poi-category': (target) => {
            this.#restoreCategory(target.id);
        },
        photo: () => {
            this.#map.setPhotosData(this.#photos());
        },
        poi: (target) => {
            this.#restorePlace(target.id);
        },
    };

    #restoreLayer(id: string): void {
        const saved = this.#layer(id);
        if (saved !== undefined) {
            this.#map.setOverlayOpacity(id, saved.opacity);
            this.#map.setOverlayVisibility(id, saved.visible);
            this.#map.setLayerPaint(id, rasterAdjustmentPaint(saved.adjustments ?? {}));
        }
    }

    #restoreCategory(id: string): void {
        const saved = this.#category(id);
        if (saved !== undefined) {
            this.#drawCategory(saved);
            this.#map.setOverlayOpacity(id, saved.opacity);
        }
    }

    #restorePlace(id: string): void {
        const editing = this.#editing;
        if (editing?.id === id) {
            this.#editing = null;
            this.#redraw(editing.category);
        }
    }
}

/** The live preview of `map`; `frames` coalesces the previews of one animation frame. */
export function createMapPreview(map: MapPort, frames: FrameScheduler): MapPreview {
    return new Preview(map, frames);
}
