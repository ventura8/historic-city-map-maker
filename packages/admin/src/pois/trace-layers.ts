/**
 * M27 "Disappeared streets": the city's old maps a place can be traced on. The places area lists the city's layers that have
 * tiles to show (every layer document has a `source`; a `retired` frame, replaced by its date's join, is left out), sorted by
 * year; the open place's `sourceLayer` puts that layer under the drawing on the places map, at the opacity the admin chose
 * (100 % by default, faded to compare with today's streets). Nothing here writes: the choice is the draft's `sourceLayer`.
 */
import { FIRESTORE_PATHS, layerDocSchema, MAX_LAYERS, type LayerDoc } from '@hcm/shared';
import type { RasterLayerSpec } from '@hcm/ui/map';

import { LiveList, type ListState } from '../content/list.js';
import type { ContentServices, Stored } from '../content/services.js';
import { rasterOf } from '../layers/map-session.js';
import type { PoiText } from './model.js';

/** A layer as the editor's "Traced on map" select offers it. */
export interface TraceLayerItem {
    readonly id: string;
    readonly label: PoiText;
    readonly year: number;
}

/** The old map's opacity the select starts with, in percent. */
export const DEFAULT_TRACE_OPACITY = 100;

interface Entry {
    readonly item: TraceLayerItem;
    readonly spec: RasterLayerSpec;
}

export interface TraceHost {
    readonly services: Pick<ContentServices, 'store' | 'clock' | 'cityId' | 'denied'>;
    /** The places area's state: the listed maps and the opacity go there. */
    readonly cell: { update(patch: { readonly traceLayers?: readonly TraceLayerItem[]; readonly traceOpacity?: number }): void };
    readonly map: { showLayer(spec: RasterLayerSpec | null): void; setLayerOpacity(opacity: number): void };
}

/** A layer with tiles to show, as the select offers it and the map draws it; null for a retired one. */
export function traceEntryOf(doc: Stored<LayerDoc>): Entry | null {
    const { label, year, retired } = doc.data;
    const text = label.en === undefined ? { ro: label.ro } : { ro: label.ro, en: label.en };
    return retired === undefined ? { item: { id: doc.id, label: text, year }, spec: rasterOf(doc.id, doc.data) } : null;
}

/** A percent between 0 and 100 (a stray value is clamped, a non-number is the default). */
export function clampPercent(value: number): number {
    return Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : DEFAULT_TRACE_OPACITY;
}

export class TraceLayers {
    readonly #host: TraceHost;
    readonly #list: LiveList<LayerDoc, Entry | null>;
    #entries: readonly Entry[] = [];
    #chosen: string | null = null;
    #opacity = DEFAULT_TRACE_OPACITY;

    constructor(host: TraceHost) {
        this.#host = host;
        const { store, clock, cityId, denied } = host.services;
        this.#list = new LiveList({
            ...{ store, clock, denied, collection: FIRESTORE_PATHS.layers(cityId), schema: layerDocSchema, pageSize: MAX_LAYERS },
            map: traceEntryOf,
            changed: (list) => {
                this.#changed(list);
            },
        });
    }

    open(): void {
        if (!this.#list.active) {
            this.#list.show({});
        }
    }

    stop(): void {
        this.#list.stop();
        this.#entries = [];
    }

    retry(): void {
        this.#list.retry();
    }

    /** The open place's value (undefined: no place open): the map its `sourceLayer` names goes under the drawing. */
    follow(value: { readonly sourceLayer?: string } | undefined): void {
        const chosen = value?.sourceLayer ?? null;
        if (chosen !== this.#chosen) {
            this.#chosen = chosen;
            this.#show();
        }
    }

    readonly intents = {
        /** The admin's opacity, in percent. */
        setTraceOpacity: (percent: number): void => {
            this.#opacity = clampPercent(percent);
            this.#host.map.setLayerOpacity(this.#opacity / 100);
            this.#host.cell.update({ traceOpacity: this.#opacity });
        },
    };

    #changed(list: ListState<Entry | null>): void {
        this.#entries = list.items.flatMap((entry) => (entry === null ? [] : [entry])).toSorted((a, b) => a.item.year - b.item.year);
        this.#host.cell.update({ traceLayers: this.#entries.map((entry) => entry.item) });
        this.#show();
    }

    #show(): void {
        const spec = this.#entries.find((entry) => entry.item.id === this.#chosen)?.spec ?? null;
        this.#host.map.showLayer(spec === null ? null : { ...spec, visible: true, opacity: this.#opacity / 100 });
    }
}
