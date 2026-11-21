/**
 * The POI categories of the city settings (`docs/research/M2c-interfaces.md` §8.5, section `categories`; behaviour
 * A39): listed in the order the viewer's Places group shows them (ascending `order`), reordered by a drag or Move up and
 * Move down, at most `MAX_POI_CATEGORIES`. A category has a label in both languages, a Material Symbols icon from
 * `POI_ICONS` (an icon outside the bundle is kept and drawn as the pin: S-A39-BAD-UNBUNDLED-ICON), a colour the white
 * glyph reads on (3:1: S-A39-BAD-LOW-CONTRAST-COLOUR) and a default opacity. A new category's id is the slug of its
 * Romanian label, free in the overlay namespace (S-A39-BAD-ID-CLASH). A category in use is deleted only after its places
 * move to another one, in batches, the category last (S-A33-BAD-CATEGORY-IN-USE).
 */
import {
    DEFAULT_POI_ICON,
    FIRESTORE_PATHS,
    freeOverlayId,
    MAX_POI_CATEGORIES,
    POI_ICONS,
    poiCategoryDocSchema,
    type PoiCategoryDoc,
    type ValidationIssue,
} from '@hcm/shared';

import { MAX_BATCH_WRITES, type BatchWrite, type Stored } from '../content/services.js';
import { readsWithWhite } from './colour.js';

/** The route of a category not saved yet (`#/settings/categories/_new`): a slug never holds `_`. */
export const NEW_CATEGORY = '_new';

/** A new category's colour: the city's sepia, which the white glyph reads on. */
const DEFAULT_CATEGORY_COLOR = '#8b5e3c';

/** The fields of the category editor (`CLIENT_WRITES.poiCategory.update` without the order and the stamp). */
// M27: whether it starts hidden, whether it is pinned to the Layers panel's top strip, and its data's credit.
export const CATEGORY_EDITABLE = [
    'label',
    'icon',
    'color',
    'defaultOpacity',
    'defaultVisible',
    'pinned',
    'attribution',
] as const satisfies readonly (keyof PoiCategoryDoc)[];

export interface CategoryItem {
    readonly id: string;
    readonly label: PoiCategoryDoc['label'];
    readonly icon: string;
    /** The icon is one of `POI_ICONS` (else the viewer draws the pin). */
    readonly bundled: boolean;
    readonly color: string;
    readonly defaultOpacity: number;
    readonly order: number;
    readonly version: string;
}

export function isBundledIcon(icon: string): boolean {
    return (POI_ICONS as readonly string[]).includes(icon);
}

export function categoryItemOf(doc: Stored<PoiCategoryDoc>): CategoryItem {
    const category = doc.data;
    return {
        ...{ id: doc.id, label: category.label, icon: category.icon, bundled: isBundledIcon(category.icon), color: category.color },
        ...{ defaultOpacity: category.defaultOpacity, order: category.order, version: doc.version },
    };
}

/** The viewer's order: ascending `order`, then the id. */
export function inOrder<T extends Pick<CategoryItem, 'id' | 'order'>>(items: readonly T[]): T[] {
    return items.toSorted((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Whether another category may be added. */
export function canAdd(count: number): boolean {
    return count < MAX_POI_CATEGORIES;
}

/** A category before its first Save: the store adds the stamp and `createdAt` when it creates the document. */
export type NewCategory = Omit<PoiCategoryDoc, 'updatedBy' | 'updatedAt' | 'createdAt'>;

/** What a new category must pass before it is created (the stamp is the store's). */
export const newCategorySchema = poiCategoryDocSchema.omit({ updatedBy: true, updatedAt: true, createdAt: true });

/** A new category's draft, last in the list. */
export function newCategory(items: readonly Pick<CategoryItem, 'order'>[]): NewCategory {
    const order = items.reduce((last, item) => Math.max(last, item.order + 1), 0);
    return { label: { ro: '' }, icon: DEFAULT_POI_ICON, color: DEFAULT_CATEGORY_COLOR, defaultOpacity: 1, order };
}

/** The id a new category takes: free among the layers', the categories' and `photos`. */
export function newCategoryId(label: string, taken: Iterable<string>): string {
    return freeOverlayId(label, new Set(taken), 'category');
}

/** A colour the glyph does not read on cannot be saved (the page proposes the nearest tone that does). */
export function categoryIssues(category: Pick<PoiCategoryDoc, 'color'>): ValidationIssue[] {
    return /^#[0-9a-f]{6}$/i.test(category.color) && !readsWithWhite(category.color) ? [{ path: 'color', code: 'validation.value' }] : [];
}

export interface OrderWrite {
    readonly id: string;
    readonly order: number;
}

/** The `order` writes that make `after` (first shown first) the list's order: the values held are handed out again. */
export function ascendingOrderChanges(before: readonly CategoryItem[], after: readonly CategoryItem[]): OrderWrite[] {
    const held = before.map((item) => item.order).toSorted((a, b) => a - b);
    const values = new Set(held).size === held.length ? held : after.map((_item, index) => index);
    return after.flatMap((item, index) => {
        const order = values[index] ?? item.order;
        return order === item.order ? [] : [{ id: item.id, order }];
    });
}

/**
 * The writes that delete category `id` of `cityId` once its places (`poiIds`) move to `target`, in batches of at most
 * `MAX_BATCH_WRITES`; the category's own delete is the last write of the last batch, so a failure part-way leaves it
 * with the places not moved yet.
 */
export function deletionBatches(cityId: string, id: string, poiIds: readonly string[], target: string | null): BatchWrite[][] {
    const moves: BatchWrite[] =
        target === null
            ? []
            : poiIds.map((poiId) => ({ kind: 'update', path: FIRESTORE_PATHS.poi(cityId, poiId), fields: { category: target } }));
    const writes: BatchWrite[] = [...moves, { kind: 'delete', path: FIRESTORE_PATHS.poiCategory(cityId, id) }];
    const batches: BatchWrite[][] = [];
    for (let start = 0; start < writes.length; start += MAX_BATCH_WRITES) {
        batches.push(writes.slice(start, start + MAX_BATCH_WRITES));
    }
    return batches;
}
