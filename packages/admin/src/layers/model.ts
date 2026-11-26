/**
 * The historical layers as the admin lists and orders them (`docs/research/M2c-interfaces.md` §8.1): top first, as the
 * viewer draws them (the highest `order` on top), each with its status, whether it is published and whether it was
 * linked to a tileset that existed before (`layers.link`) or made by the raster pipeline. A reorder (a drag, or Move up
 * and Move down from the keyboard) rewrites the `order` of the layers it moved, and of no other, in one batch.
 */
import { clamp, type LayerDoc, type LayerSource } from '@hcm/shared';

import type { Stored } from '../content/services.js';

export interface LayerItem {
    readonly id: string;
    readonly label: LayerDoc['label'];
    readonly year: number;
    readonly status: LayerDoc['status'];
    readonly published: boolean;
    readonly order: number;
    /** 0 to 1: the viewer's default (the editor's slider shows it in percent). */
    readonly opacity: number;
    readonly defaultVisible: boolean;
    readonly sourceType: LayerSource['type'];
    /**
     * Linked by an admin (nothing the raster pipeline made): deleting it leaves the tileset in the Mapbox account. A layer on its own tiles
     * (M12) has no `mapbox` block but has its version: it is the pipeline's, never linked (the rehearsal of 2026-11-07).
     */
    readonly linked: boolean;
    /** The version read (`updatedAt`): a reorder is refused when another admin changed the layer meanwhile. */
    readonly version: string;
}

export function layerItemOf(doc: Stored<LayerDoc>): LayerItem {
    const layer = doc.data;
    return {
        ...{ id: doc.id, label: layer.label, year: layer.year, status: layer.status, published: layer.published, order: layer.order },
        ...{
            opacity: layer.opacity,
            defaultVisible: layer.defaultVisible,
            sourceType: layer.source.type,
            linked: layer.mapbox === undefined && layer.currentVersion === undefined,
        },
        version: doc.version,
    };
}

/** Top first: the highest `order`, then the newest year, then the id (a stable order for equal values). */
export function topFirst<T extends Pick<LayerItem, 'id' | 'order' | 'year'>>(items: readonly T[]): T[] {
    return items.toSorted((a, b) => b.order - a.order || b.year - a.year || a.id.localeCompare(b.id));
}

/** A 0–100 % slider position as the stored opacity (whole percents; a broken number is fully opaque). */
export function opacityFromPercent(percent: number): number {
    return Number.isFinite(percent) ? clamp(Math.round(percent), 0, 100) / 100 : 1;
}

export type MoveDirection = 'up' | 'down';

/** Where Move up and Move down take the layer `id` in a top-first list (its own index at either end). */
export function moveTarget(items: readonly Pick<LayerItem, 'id'>[], id: string, direction: MoveDirection): number {
    const index = items.findIndex((item) => item.id === id);
    const target = direction === 'up' ? index - 1 : index + 1;
    return Math.min(Math.max(target, 0), items.length - 1);
}

/** The top-first list with `id` moved to `target` (clamped); the same list when `id` is unknown. */
export function moved<T extends Pick<LayerItem, 'id'>>(items: readonly T[], id: string, target: number): T[] {
    const item = items.find((candidate) => candidate.id === id);
    if (item === undefined) {
        return [...items];
    }
    const rest = items.filter((candidate) => candidate !== item);
    const at = Math.min(Math.max(target, 0), rest.length);
    return [...rest.slice(0, at), item, ...rest.slice(at)];
}

export interface OrderChange {
    readonly id: string;
    readonly order: number;
    readonly version: string;
}

function distinct(values: readonly number[]): boolean {
    return new Set(values).size === values.length;
}

/**
 * The `order` writes that make `after` (top first) the drawing order. The values the layers hold already are handed
 * out again from the top, so only the layers whose place changed are written; layers that share a value are numbered
 * again from `length - 1` down to 0.
 */
export function orderChanges(before: readonly LayerItem[], after: readonly LayerItem[]): OrderChange[] {
    const held = before.map((item) => item.order).toSorted((a, b) => b - a);
    const values = distinct(held) ? held : after.map((_item, index) => after.length - 1 - index);
    return after.flatMap((item, index) => {
        const order = values[index] ?? item.order;
        return order === item.order ? [] : [{ id: item.id, order, version: item.version }];
    });
}
