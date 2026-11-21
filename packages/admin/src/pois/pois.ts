/**
 * The places area (docs/research/M2c-interfaces.md §7; behaviours A32, A33, A34, A38): `#/pois` lists the city's places
 * (category chips, Unpublished, a search of the loaded page) with every one on the map; `#/pois/<id>` opens a place's
 * editor (`PlaceEditor`), a new one included before its first Save. Places are drawn with the map's tools or entered
 * in the vertex list, saved published by default, deleted with Undo, changed in bulk, and imported from or exported to
 * GeoJSON. The store is DOM-free: the page hands it the map's host and the chosen file.
 */
import {
    cityDocSchema,
    FIRESTORE_PATHS,
    isId,
    poiCategoryDocSchema,
    poiDocSchema,
    type CityDoc,
    type PoiCategoryDoc,
    type PoiDoc,
} from '@hcm/shared';

import type { EditorAssists } from '../assist/editor-assists.js';
import type { AreaModule, AreaStore } from '../content/areas.js';
import { LiveDoc } from '../content/doc.js';
import type { LiveList } from '../content/list.js';
import { ownerOnlyOf, type WriteOutcome } from '../content/services.js';
import { Store } from '../state/store.js';
import { LAST_CATEGORY_KEY, PlaceActions } from './actions.js';
import type { BulkAction } from './bulk.js';
import type { PoiContext } from './draft.js';
import { placeAssists, pointDrawn } from './assists.js';
import { PlaceEditor, type PlaceEditorState } from './editor.js';
import { Importer } from './importer.js';
import { liveListOf, livePartsOf } from './live.js';
import { PlacePhotos } from './place-photos.js';
import { mapIntents, PoisMap, UNCATEGORISED_COLOR, type EditTarget } from './map-session.js';
import { categoryItemOf, cityFrameOf, drawLimitsOf, poiItemOf, type CategoryItem, type PoiItem, type PoiValue } from './model.js';
import {
    everyPlace,
    exportFile,
    importOverlays,
    lacksCategory,
    newPlaceCategory,
    newPlaceValue,
    notFound,
    placeOverlays,
    poisQuery,
    shownPlaces,
    type PoisFilter,
} from './places.js';
import {
    INITIAL_POIS_STATE,
    type FileIntent,
    type ListIntent,
    type PoisIntents,
    type PoisServices,
    type PoisState,
    type SavedFile,
} from './state.js';
import { TraceLayers } from './trace-layers.js';
import type { PlaceShape } from './vertices.js';

class PoisStore implements AreaStore<PoisState, PoisIntents> {
    readonly #services: PoisServices;
    readonly #cell: Store<PoisState>;
    readonly #list: LiveList<PoiDoc, PoiItem>;
    readonly #categories: LiveList<PoiCategoryDoc, CategoryItem>;
    readonly #city: LiveDoc<CityDoc>;
    readonly #photos: PlacePhotos;
    readonly #map: PoisMap;
    readonly #importer: Importer;
    readonly #actions: PlaceActions;
    readonly #assists: EditorAssists;
    readonly #trace: TraceLayers;
    /** New places not opened yet (Add place, then the page opens its address). */
    readonly #fresh = new Map<string, PlaceEditor>();
    #editor: PlaceEditor | null = null;
    #clicks = 0;
    readonly intents: PoisIntents;

    constructor(services: PoisServices) {
        this.#services = services;
        this.#cell = new Store<PoisState>(INITIAL_POIS_STATE, services.log);
        this.#list = liveListOf(services, FIRESTORE_PATHS.pois(services.cityId), { schema: poiDocSchema, map: poiItemOf }, (list) => {
            this.#cell.update({ list });
            this.#importer.contextChanged();
            this.#placesChanged();
        });
        const categories = { schema: poiCategoryDocSchema, map: categoryItemOf };
        this.#categories = liveListOf(services, FIRESTORE_PATHS.poiCategories(services.cityId), categories, (categories) => {
            this.#cell.update({ categories });
            this.#importer.contextChanged();
            this.#placesChanged();
            this.#editor?.recheck();
            this.#categoryArrived();
        });
        const ownerOnly = () => ownerOnlyOf(services);
        this.#photos = new PlacePhotos({ ...livePartsOf(services), cityId: services.cityId, ownerOnly }, (patch) => {
            this.#cell.update(patch);
        });
        this.#city = new LiveDoc({
            ...livePartsOf(services),
            schema: cityDocSchema,
            changed: () => {
                this.#cityChanged();
            },
        });
        this.#map = this.#newMap();
        this.#trace = new TraceLayers({ services, map: this.#map, cell: this.#cell });
        this.#importer = new Importer({
            ...{ store: services.store, clock: services.clock, cityId: services.cityId },
            context: () => this.#context(),
            places: () => everyPlace(services),
            changed: (importing) => {
                this.#cell.update({ importing });
                this.#placesChanged();
            },
        });
        this.#actions = new PlaceActions(services, (patch) => {
            this.#cell.update(patch);
        });
        this.#assists = placeAssists({
            ...{ services, value: () => this.#cell.state.editor?.draft?.value ?? null, edit: (patch) => this.#editor?.edit(patch) },
            changed: (assist) => {
                this.#cell.update({ assist });
            },
        });
        this.intents = this.#intents();
    }

    #newMap(): PoisMap {
        return new PoisMap({
            ...{ maps: this.#services.maps ?? null, locale: this.#services.locale, log: this.#services.log },
            status: (map) => {
                this.#cell.update({ map });
            },
            clicked: (id) => {
                this.#clicks += 1;
                this.#cell.update({ clicked: { id, seq: this.#clicks } });
            },
            drawn: (geometry) => {
                this.#editor?.setGeometry(geometry);
                // M4 (CR-M4-4): a point drawn on an untitled place asks for title suggestions.
                pointDrawn(this.#assists, geometry);
            },
            refused: (kind) => {
                this.#editor?.refused(kind);
            },
        });
    }

    get state(): PoisState {
        return this.#cell.state;
    }

    subscribe(listener: (state: PoisState) => void): () => void {
        return this.#cell.subscribe(listener);
    }

    open(params: readonly string[]): void {
        if (!this.#list.active) {
            this.#list.show(poisQuery(this.#cell.state.filter, ownerOnlyOf(this.#services)));
            this.#categories.show({ orderBy: [['order', 'asc']] });
            this.#city.show(FIRESTORE_PATHS.city(this.#services.cityId));
            this.#trace.open();
        }
        this.#select(params[0] ?? null);
    }

    close(): void {
        for (const live of [this.#list, this.#categories, this.#photos, this.#city, this.#trace]) {
            live.stop();
        }
        this.#map.detach();
        this.#select(null);
        this.#actions.dispose();
    }

    hasUnsavedChanges(): boolean {
        return this.#editor?.unsaved === true;
    }

    destroy(): void {
        this.close();
        for (const editor of this.#fresh.values()) {
            editor.close();
        }
        this.#fresh.clear();
    }

    /**
     * What the draft's checks read: the drawing limits once the city is known, the city's categories once the server
     * listed them. A list answered from the cache while offline may be empty (a listener attached again offline finds
     * nothing cached): it does not count, or the open place's category reads as unknown and Save goes off (lesson 146).
     */
    #context(): PoiContext {
        const { frame, categories } = this.#cell.state;
        return {
            limits: frame === null ? null : drawLimitsOf(frame),
            categories: categories.status === 'ready' && !categories.reconnecting ? new Set(categories.items.map((item) => item.id)) : null,
        };
    }

    #cityChanged(): void {
        const doc = this.#city.state.doc;
        if (doc !== null) {
            const frame = cityFrameOf(doc.data);
            this.#cell.update({ frame });
            this.#map.setFrame(frame);
            this.#editor?.recheck();
        }
    }

    #select(id: string | null): void {
        if (id === this.#openId()) {
            return;
        }
        this.#editor?.close();
        this.#assists.reset();
        this.#photos.stopLinked();
        this.#editor = id !== null && isId(id) ? this.#editorFor(id) : null;
        this.#categoryArrived();
        this.#cell.update({ editor: this.#editorState(id) });
        this.#targetChanged();
    }

    /** The id the page shows (a not-found one included). */
    #openId(): string | null {
        return this.#cell.state.editor?.id ?? null;
    }

    #editorState(id: string | null): PlaceEditorState | null {
        if (this.#editor !== null) {
            return this.#editor.state;
        }
        return id === null ? null : notFound(id);
    }

    #editorFor(id: string): PlaceEditor {
        const fresh = this.#fresh.get(id);
        this.#fresh.delete(id);
        return fresh ?? this.#newEditor(id, null);
    }

    #newEditor(id: string, fresh: { readonly value: PoiValue; readonly shape: PlaceShape } | null): PlaceEditor {
        const { store, clock, cityId, people } = this.#services;
        return new PlaceEditor(id, fresh, {
            ...{ store, clock, cityId, people },
            ...{ context: () => this.#context(), locked: () => this.#services.readOnly() },
            reviewed: () => this.#services.cityRole() === 'uploader',
            denied: () => {
                this.#services.denied();
            },
            changed: (editor) => {
                if (this.#editor?.id === editor.id) {
                    this.#cell.update({ editor });
                    this.#targetChanged();
                }
            },
        });
    }

    /** The map's drawing tools and the linked photos' titles follow the open place. */
    #targetChanged(): void {
        const value = this.#cell.state.editor?.draft?.value;
        this.#map.edit(this.#target());
        this.#trace.follow(value);
        this.#photos.showLinked(value?.photoIds ?? []);
    }

    #target(): EditTarget | null {
        const editor = this.#cell.state.editor;
        const value = editor?.draft?.value;
        if (editor === null || value === undefined) {
            return null;
        }
        return {
            id: editor.id,
            category: value.category,
            geometry: value.geometry,
            shape: editor.shape,
            color: this.#colourOf(value.category),
        };
    }

    #colourOf(categoryId: string): string {
        return this.#cell.state.categories.items.find((category) => category.id === categoryId)?.color ?? UNCATEGORISED_COLOR;
    }

    /** Every category's overlay with the places the list shows, and the import's preview. */
    #placesChanged(): void {
        const { list, categories, filter, importing } = this.#cell.state;
        const locale = this.#services.locale() === 'en' ? 'en' : 'ro';
        this.#map.showPlaces([...placeOverlays(categories.items, shownPlaces(list.items, filter), locale), ...importOverlays(importing)]);
    }

    #setFilter(patch: Partial<PoisFilter>): void {
        const before = this.#cell.state.filter;
        const filter = { ...before, ...patch };
        this.#cell.update({ filter });
        if (filter.category !== before.category || filter.unpublished !== before.unpublished) {
            this.#list.show(poisQuery(filter, ownerOnlyOf(this.#services)));
        }
        this.#placesChanged();
    }

    #add(shape: PlaceShape): string {
        const id = this.#services.store.newId();
        this.#fresh.set(id, this.#newEditor(id, { value: newPlaceValue(this.#newCategory()), shape }));
        return id;
    }

    #newCategory(): string {
        return newPlaceCategory(this.#cell.state.categories.items, this.#services.local.get(LAST_CATEGORY_KEY));
    }

    /**
     * A new place added before the categories were listed gets its category once they are (the select showed the first):
     * a default, not the admin's edit, so leaving the place untouched asks nothing (finding 42 of 2026-11-01).
     */
    #categoryArrived(): void {
        const category = lacksCategory(this.#editor?.state.draft) ? this.#newCategory() : '';
        if (category !== '') {
            this.#editor?.prefill({ category });
        }
    }

    async #save(): Promise<WriteOutcome | null> {
        return this.#editor === null ? null : this.#actions.save(this.#editor);
    }

    async #remove(): Promise<WriteOutcome | null> {
        return this.#editor === null || this.#cell.state.busy ? null : this.#actions.remove(this.#editor);
    }

    async #bulk(action: BulkAction): Promise<void> {
        const selection = new Set(this.#cell.state.selection);
        if (selection.size === 0 || this.#cell.state.busy) {
            return;
        }
        const selected = this.#cell.state.list.items.filter((item) => selection.has(item.id));
        if (await this.#actions.bulk(action, selected, selection.size)) {
            this.#cell.update({ selection: [] });
        }
    }

    #toggle(id: string): void {
        const selection = this.#cell.state.selection;
        this.#cell.update({ selection: selection.includes(id) ? selection.filter((selected) => selected !== id) : [...selection, id] });
    }

    async #export(onlySelection: boolean): Promise<SavedFile | null> {
        const { list, selection } = this.#cell.state;
        const chosen = onlySelection ? list.items.filter((item) => selection.includes(item.id)) : await this.#actions.everyPlace();
        return chosen === null
            ? null
            : exportFile(this.#services.cityId, this.#services.clock.now(), chosen, this.#cell.state.categories.items);
    }

    /** Adds a vertex at the map's centre (the city's starting view's without a map: the keyboard path still works). */
    #addAtCentre(): boolean {
        const centre = this.#map.centre();
        return centre !== null && this.#editor?.addAt(centre) === true;
    }

    #selectAll(): void {
        this.#cell.update({ selection: shownPlaces(this.#cell.state.list.items, this.#cell.state.filter).map((item) => item.id) });
    }

    #intents(): PoisIntents {
        return { ...this.#listIntents(), ...this.#editorIntents(), ...this.#fileIntents(), ...this.#assists.intents };
    }

    #listIntents(): Pick<PoisIntents, ListIntent> {
        return {
            setFilter: (patch) => {
                this.#setFilter(patch);
            },
            more: () => {
                this.#list.more();
            },
            retry: () => {
                this.#list.retry();
                this.#categories.retry();
                this.#editor?.retry();
                this.#photos.retry();
                this.#trace.retry();
            },
            add: (shape) => this.#add(shape),
            toggleSelected: (id) => {
                this.#toggle(id);
            },
            selectAll: () => {
                this.#selectAll();
            },
            clearSelection: () => {
                this.#cell.update({ selection: [] });
            },
            bulk: (action) => this.#bulk(action),
            loadPhotos: () => {
                this.#photos.load();
            },
            morePhotos: () => {
                this.#photos.more();
            },
        };
    }

    #editorIntents(): Omit<PoisIntents, ListIntent | FileIntent | keyof EditorAssists['intents']> {
        return {
            edit: (patch) => this.#editor?.edit(patch),
            setTool: (tool) => {
                this.#map.setMode(tool);
            },
            redraw: (shape) => this.#editor?.redraw(shape),
            selectVertex: (index) => this.#editor?.selectVertex(index),
            editVertex: (edit) => this.#editor?.editVertex(edit) === true,
            addAtCentre: () => this.#addAtCentre(),
            undoLastVertex: () => this.#editor?.undoLastVertex() === true,
            save: () => this.#save(),
            discard: () => this.#editor?.discard(),
            keepMine: () => this.#editor?.keepMine(),
            takeTheirs: () => this.#editor?.takeTheirs(),
            remove: () => this.#remove(),
            addStarterCategories: () => this.#actions.addStarters(this.#cell.state.categories.items),
        };
    }

    #fileIntents(): Pick<PoisIntents, FileIntent> {
        return {
            chooseImport: (file) => this.#importer.choose(file, this.#cell.state.filter.category),
            setImportCategory: (category) => {
                this.#importer.setCategory(category);
            },
            commitImport: () => this.#importer.commit(),
            closeImport: () => {
                this.#importer.close();
            },
            exportPlaces: (only) => this.#export(only),
            ...mapIntents(this.#map),
            ...this.#trace.intents,
        };
    }
}

export const POIS_MODULE: AreaModule<PoisState, PoisIntents> = {
    area: 'pois',
    create: (services) => new PoisStore(services),
};
