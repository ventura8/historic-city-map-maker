/**
 * What the georeferencer's map pane shows under the pairs (`docs/research/M3-interfaces.md` §10.4): the reference (OpenStreetMap, the
 * base map itself, or the Sentinel-2 picture) or one of the city's published layers, so a 1914 plan is aligned on the 1911 one. The
 * layers are the same `cities/{city}/layers` documents the layer editor draws, on the page's one map (no second map, never Mapbox
 * Satellite), at full opacity; the warped preview is raised above the layer chosen. The choice is kept while the admin is open.
 */
import { FIRESTORE_PATHS, layerDocSchema, MAX_LAYERS, type LayerDoc } from '@hcm/shared';
import type { RasterLayerSpec } from '@hcm/ui/map';

import { LiveList, type ListState } from '../content/list.js';
import type { ContentServices, Stored } from '../content/services.js';
import { rasterOf } from '../layers/map-session.js';
import type { Store } from '../state/store.js';
import type { BaseLayerItem, GeorefState } from './state.js';

interface Entry {
    readonly item: BaseLayerItem;
    readonly spec: RasterLayerSpec;
}

export interface BaseHost {
    readonly services: Pick<ContentServices, 'store' | 'clock' | 'cityId' | 'denied'>;
    readonly cell: Store<GeorefState>;
    readonly map: { showBase(spec: RasterLayerSpec | null): void };
    /** A layer went on the map: the warped preview is drawn again, above it. */
    readonly raised: () => void;
}

/** A published layer as the pane's choice and as the map draws it (opaque: it is the ground the pairs are placed on). */
function entryOf(doc: Stored<LayerDoc>): Entry | null {
    const { published, label, year } = doc.data;
    return published ? { item: { id: doc.id, label, year }, spec: { ...rasterOf(doc.id, doc.data), opacity: 1 } } : null;
}

export class BaseLayers {
    readonly #host: BaseHost;
    readonly #list: LiveList<LayerDoc, Entry | null>;
    #entries: readonly Entry[] = [];

    constructor(host: BaseHost) {
        this.#host = host;
        const { store, clock, cityId, denied } = host.services;
        this.#list = new LiveList({
            ...{ store, clock, denied, collection: FIRESTORE_PATHS.layers(cityId), schema: layerDocSchema, pageSize: MAX_LAYERS },
            map: entryOf,
            changed: (list) => {
                this.#changed(list);
            },
        });
    }

    open(): void {
        this.#list.show({});
    }

    close(): void {
        this.#list.stop();
        this.#entries = [];
    }

    /** The owner's choice: a published layer's id, or null for the reference alone. */
    choose(id: string | null): void {
        this.#host.cell.update({ base: id });
        this.#show();
    }

    #changed(list: ListState<Entry | null>): void {
        this.#entries = list.items.flatMap((entry) => (entry === null ? [] : [entry])).toSorted((a, b) => a.item.year - b.item.year);
        const base = this.#host.cell.state.base;
        // A layer chosen before that is no longer published: back to the reference.
        const gone = list.status === 'ready' && base !== null && this.#specOf(base) === null;
        this.#host.cell.update({ baseLayers: this.#entries.map((entry) => entry.item), ...(gone ? { base: null } : {}) });
        this.#show();
    }

    #specOf(id: string | null): RasterLayerSpec | null {
        return this.#entries.find((entry) => entry.item.id === id)?.spec ?? null;
    }

    #show(): void {
        this.#host.map.showBase(this.#specOf(this.#host.cell.state.base));
        this.#host.raised();
    }
}
