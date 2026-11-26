/**
 * The overlays' defaults (`docs/research/M2c-interfaces.md` §8.5, section `overlays`; behaviour A36): every overlay the
 * visitor's Layers panel lists, in its order (historical layers by year, then the photos, then the POI categories), with
 * the opacity the viewer opens with and, for a historical layer only, whether it is shown at start (CR-M2c-10: the other
 * rows have no switch). Each change previews live on the page's map; one Save writes every changed document in one
 * batch: the layers' `opacity` and `defaultVisible`, `photosOverlay.defaultOpacity` of the city, the categories'
 * `defaultOpacity`. A visitor's own `op=` in a link still wins in the viewer (S-A36-BAD-LINK-STILL-WINS).
 */
import { DEFAULT_PHOTOS_OPACITY, FIRESTORE_PATHS, PHOTOS_OVERLAY_ID, translate, type OverlayKind } from '@hcm/shared';

import type { BatchWrite } from '../content/services.js';
import type { LayerItem } from '../layers/model.js';
import type { PreviewChange } from '../layers/preview.js';
import type { CategoryItem } from './categories.js';

/** What the defaults are now: the live layers and categories, and the city's photos overlay. */
export interface OverlayBase {
    readonly layers: readonly LayerItem[];
    readonly categories: readonly CategoryItem[];
    /** `cities/{city}.photosOverlay.defaultOpacity` (absent: fully opaque). */
    readonly photos: number;
}

interface LayerEdit {
    readonly opacity?: number;
    readonly defaultVisible?: boolean;
}

/** The admin's changes, by overlay; a value equal to the saved one is no change. */
export interface OverlayEdits {
    readonly layers: Readonly<Record<string, LayerEdit>>;
    readonly categories: Readonly<Record<string, number>>;
    readonly photos: number | null;
}

export const NO_EDITS: OverlayEdits = { layers: {}, categories: {}, photos: null };

export interface OverlayRow {
    readonly id: string;
    readonly kind: OverlayKind;
    readonly label: { readonly ro: string; readonly en?: string | undefined };
    readonly visible: boolean;
    readonly opacity: number;
    /** Only a historical layer has "Shown at start". */
    readonly toggleable: boolean;
    readonly color?: string;
    readonly icon?: string;
}

/** The photos row's label: the viewer's own name of the overlay (`layers.photos`). */
const PHOTOS_LABEL = { ro: translate('ro', 'layers.photos'), en: translate('en', 'layers.photos') };

function layerRow(layer: LayerItem, edit: LayerEdit | undefined): OverlayRow {
    return {
        ...{ id: layer.id, kind: 'raster', label: layer.label, toggleable: true },
        ...{ visible: edit?.defaultVisible ?? layer.defaultVisible, opacity: edit?.opacity ?? layer.opacity },
    };
}

function categoryRow(category: CategoryItem, edit: number | undefined): OverlayRow {
    return {
        ...{ id: category.id, kind: 'poi', label: category.label, visible: true, opacity: edit ?? category.defaultOpacity },
        ...{ toggleable: false, color: category.color, icon: category.icon },
    };
}

/** The rows in the viewer's order: layers by year (top first within a year), the photos, the categories. */
export function overlayRows(base: OverlayBase, edits: OverlayEdits): OverlayRow[] {
    const layers = base.layers.toSorted((a, b) => a.year - b.year || b.order - a.order);
    const categories = base.categories.toSorted((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    const photos: OverlayRow = {
        ...{ id: PHOTOS_OVERLAY_ID, kind: 'photos', label: PHOTOS_LABEL, visible: true },
        ...{ opacity: edits.photos ?? base.photos, toggleable: false },
    };
    return [
        ...layers.map((layer) => layerRow(layer, edits.layers[layer.id])),
        photos,
        ...categories.map((category) => categoryRow(category, edits.categories[category.id])),
    ];
}

/** The edits with an opacity changed on the row `id` of `kind`. */
export function withOpacity(edits: OverlayEdits, kind: OverlayKind, id: string, opacity: number): OverlayEdits {
    if (kind === 'photos') {
        return { ...edits, photos: opacity };
    }
    if (kind === 'poi') {
        return { ...edits, categories: { ...edits.categories, [id]: opacity } };
    }
    return { ...edits, layers: { ...edits.layers, [id]: { ...edits.layers[id], opacity } } };
}

export function withShownAtStart(edits: OverlayEdits, id: string, defaultVisible: boolean): OverlayEdits {
    return { ...edits, layers: { ...edits.layers, [id]: { ...edits.layers[id], defaultVisible } } };
}

function changedOpacity(layer: LayerItem, edit: LayerEdit | undefined): { readonly opacity?: number } {
    const opacity = edit?.opacity ?? layer.opacity;
    return opacity === layer.opacity ? {} : { opacity };
}

function changedVisibility(layer: LayerItem, edit: LayerEdit | undefined): { readonly defaultVisible?: boolean } {
    const defaultVisible = edit?.defaultVisible ?? layer.defaultVisible;
    return defaultVisible === layer.defaultVisible ? {} : { defaultVisible };
}

function layerUpdate(layer: LayerItem, edit: LayerEdit | undefined): Readonly<Record<string, unknown>> | null {
    const fields = { ...changedOpacity(layer, edit), ...changedVisibility(layer, edit) };
    return Object.keys(fields).length === 0 ? null : fields;
}

function categoryUpdate(category: CategoryItem, edit: number | undefined): Readonly<Record<string, unknown>> | null {
    return edit === undefined || edit === category.defaultOpacity ? null : { defaultOpacity: edit };
}

function photosUpdate(base: OverlayBase, edits: OverlayEdits): Readonly<Record<string, unknown>> | null {
    return edits.photos === null || edits.photos === base.photos ? null : { photosOverlay: { defaultOpacity: edits.photos } };
}

/** Every document the edits change, one update each (nothing for an edit back to the saved value). */
export function overlayWrites(cityId: string, base: OverlayBase, edits: OverlayEdits): BatchWrite[] {
    const writes: BatchWrite[] = [];
    const add = (path: string, fields: Readonly<Record<string, unknown>> | null): void => {
        if (fields !== null) {
            writes.push({ kind: 'update', path, fields });
        }
    };
    for (const layer of base.layers) {
        add(FIRESTORE_PATHS.layer(cityId, layer.id), layerUpdate(layer, edits.layers[layer.id]));
    }
    add(FIRESTORE_PATHS.city(cityId), photosUpdate(base, edits));
    for (const category of base.categories) {
        add(FIRESTORE_PATHS.poiCategory(cityId, category.id), categoryUpdate(category, edits.categories[category.id]));
    }
    return writes;
}

/** What the map shows for the edits: each changed overlay at its new opacity (and a layer at its start visibility). */
export function overlayPreviews(base: OverlayBase, edits: OverlayEdits): PreviewChange[] {
    return overlayRows(base, edits).map((row): PreviewChange => {
        if (row.kind === 'photos') {
            return { kind: 'photos-overlay', opacity: row.opacity };
        }
        return row.kind === 'poi'
            ? { kind: 'poi-category', id: row.id, opacity: row.opacity }
            : { kind: 'layer', id: row.id, opacity: row.opacity, visible: row.visible };
    });
}

/** The photos overlay's saved default of a city (`DEFAULT_PHOTOS_OPACITY` when it has none). */
export function photosOpacityOf(city: { readonly photosOverlay?: { readonly defaultOpacity: number } | undefined } | null): number {
    return city?.photosOverlay?.defaultOpacity ?? DEFAULT_PHOTOS_OPACITY;
}
