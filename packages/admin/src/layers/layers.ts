/**
 * The layers area (`docs/research/M2c-interfaces.md` §8.1–§8.4; behaviours A15, A33, A35, A36): `#/layers` lists the
 * city's historical layers top first, with Move up and Move down (and a drag) that rewrite the `order` of the layers
 * they moved; `#/layers/<layerId>` opens the layer editor: texts in both languages, attribution, year and date, Shown at
 * start, the default opacity and the four image adjustments, each previewed live on the page's map and written by Save
 * only. Delete asks first and calls `layers.delete`, which queues the tileset's deletion after the grace period; Link
 * adds a layer over a tileset or tile server that already exists (`layers.link`).
 */
import {
    FIRESTORE_PATHS,
    MAX_LAYERS,
    cityDocSchema,
    layerDocSchema,
    normalizeAdjustments,
    withAdjustment,
    type CityDoc,
    type LayerAdjustmentName,
    type LayerDoc,
} from '@hcm/shared';

import type { EditorAssists } from '../assist/editor-assists.js';
import type { AreaModule, AreaStore } from '../content/areas.js';
import { LiveDoc, type DocState } from '../content/doc.js';
import { LiveList } from '../content/list.js';
import type { ContentServices, WriteOutcome } from '../content/services.js';
import { Store } from '../state/store.js';
import { layerAssists } from './assists.js';
import { CropSlot } from './crop-slot.js';
import { EditDraft, EMPTY_DRAFT, type DraftState } from './draft.js';
import { LayerDeletion } from './deletion.js';
import { layerFieldPatch, type LayerTextField } from './fields.js';
import { LayerLinker } from './linker.js';
import type { LinkForm } from './link.js';
import { AreaMap, frameOf, rasterOf } from './map-session.js';
import { layerItemOf, moved, moveTarget, opacityFromPercent, orderChanges, topFirst, type LayerItem } from './model.js';
import { PreviewLayer } from './preview.js';
import {
    INITIAL,
    LAYER_EDITABLE,
    LOADING_EDITOR_DOC,
    missing,
    publishCheck,
    REFUSED,
    type LayerPatch,
    type LayersIntents,
    type LayersState,
} from './state.js';

class LayersStore implements AreaStore<LayersState, LayersIntents> {
    readonly #services: ContentServices;
    readonly #cell: Store<LayersState>;
    readonly #list: LiveList<LayerDoc, LayerItem>;
    readonly #doc: LiveDoc<LayerDoc>;
    readonly #preview = new PreviewLayer();
    readonly #city: LiveDoc<CityDoc>;
    readonly #map: AreaMap;
    readonly #deletion: LayerDeletion;
    readonly #linker: LayerLinker;
    readonly #crop: CropSlot;
    readonly #assists: EditorAssists;
    #draft: EditDraft<LayerDoc> | null = null;
    /** The saved version the map shows (`<id>@<version>`, '' for none). */
    #shown = '';
    readonly intents: LayersIntents;

    constructor(services: ContentServices) {
        this.#services = services;
        this.#cell = new Store<LayersState>(INITIAL, services.log);
        const { store, clock, cityId } = services;
        const denied = (): void => {
            services.denied();
        };
        this.#list = new LiveList({
            ...{ store, clock, denied, collection: FIRESTORE_PATHS.layers(cityId), schema: layerDocSchema },
            ...{ map: layerItemOf, pageSize: MAX_LAYERS },
            changed: (list) => {
                this.#cell.update({ list });
            },
        });
        this.#doc = new LiveDoc({
            store,
            clock,
            denied,
            schema: layerDocSchema,
            changed: (state) => {
                this.#docChanged(state);
            },
        });
        this.#city = new LiveDoc({
            ...{ store, clock, denied, schema: cityDocSchema },
            changed: (city) => {
                this.#cityChanged(city);
            },
        });
        this.#map = new AreaMap({
            ...{ maps: services.maps ?? null, locale: services.locale, preview: this.#preview },
            status: (map) => {
                this.#cell.update({ map });
            },
        });
        this.#deletion = new LayerDeletion(services, (deletion) => {
            this.#cell.update({ deletion });
        });
        this.#linker = new LayerLinker(services, (link) => {
            this.#cell.update({ link });
        });
        this.#crop = new CropSlot({
            ...{ services, map: this.#map },
            changed: (crop) => {
                this.#cell.update({ crop });
            },
        });
        this.#assists = layerAssists({
            services,
            value: () => this.#value(),
            edit: (patch) => this.#draft?.edit(patch),
            changed: (assist) => {
                this.#cell.update({ assist });
            },
        });
        this.intents = { ...this.#intents(), ...this.#cropIntents(), ...this.#assists.intents };
    }

    get state(): LayersState {
        return this.#cell.state;
    }

    subscribe(listener: (state: LayersState) => void): () => void {
        return this.#cell.subscribe(listener);
    }

    open(params: readonly string[]): void {
        if (!this.#list.active) {
            this.#list.show({ orderBy: [['order', 'desc']] });
            this.#city.show(FIRESTORE_PATHS.city(this.#services.cityId));
        }
        this.#select(params[0] ?? null);
    }

    close(): void {
        this.#list.stop();
        this.#city.stop();
        this.#select(null);
        this.#linker.close();
        this.#map.detach();
    }

    hasUnsavedChanges(): boolean {
        return this.#draft?.unsaved ?? false;
    }

    destroy(): void {
        this.close();
        this.#preview.attach(null);
    }

    #intents(): Omit<LayersIntents, 'crop' | 'redrawCrop' | 'addCropCorner' | 'saveCrop' | 'closeCrop' | keyof EditorAssists['intents']> {
        return {
            ...{
                retry: () => {
                    this.#retry();
                },
                edit: (patch: LayerPatch) => this.#draft?.edit(patch),
            },
            setField: (field, text) => {
                this.#setField(field, text);
            },
            setOpacity: (percent) => this.#draft?.edit({ opacity: opacityFromPercent(percent) }),
            setAdjustment: (name, percent) => {
                this.#adjust(name, percent);
            },
            resetAdjustments: () => this.#draft?.edit({ adjustments: undefined }),
            save: () => this.#save(),
            ...{
                discard: () => this.#draft?.discard(),
                keepMine: () => this.#draft?.keepMine(),
                takeTheirs: () => this.#draft?.takeTheirs(),
            },
            move: (id, direction) => this.#reorder(id, (items) => moveTarget(items, id, direction)),
            moveTo: (id, index) => this.#reorder(id, () => index),
            ...{
                askDelete: () => {
                    this.#deletion.ask(this.#openLayer());
                },
                cancelDelete: () => {
                    this.#deletion.cancel();
                },
            },
            confirmDelete: () => this.#deletion.confirm(),
            ...{
                openLink: () => {
                    this.#linker.open();
                },
                editLink: (patch: Partial<LinkForm>) => {
                    this.#linker.edit(patch);
                },
            },
            ...{
                closeLink: () => {
                    this.#linker.close();
                },
                submitLink: () => this.#linker.submit(),
                checkLink: () => this.#linker.check(),
            },
            attachPreview: (sink) => {
                this.#preview.attach(sink);
            },
            attachMap: (container) => {
                this.#map.attach(container);
            },
            zoomBy: (delta) => {
                this.#map.zoomBy(delta);
            },
        };
    }

    /** M3 (CR-M3-7): the open layer's Crop, through its slot. */
    #cropIntents(): Pick<LayersIntents, 'crop' | 'redrawCrop' | 'addCropCorner' | 'saveCrop' | 'closeCrop'> {
        const slot = this.#crop;
        return {
            crop: async () => {
                const id = this.#editorId();
                await (id === null ? Promise.resolve() : slot.open(id));
            },
            redrawCrop: () => {
                slot.redraw();
            },
            addCropCorner: () => {
                slot.addCorner();
            },
            saveCrop: () => slot.save(),
            closeCrop: () => {
                slot.close();
            },
        };
    }

    /** The open layer's id and Romanian label (the delete dialog names it), or null. */
    #openLayer(): { readonly id: string; readonly label: string } | null {
        const editor = this.#cell.state.editor;
        const value = editor?.draft.base?.data;
        return editor === null || value === undefined ? null : { id: editor.id, label: value.label.ro };
    }

    #adjust(name: LayerAdjustmentName, percent: number): void {
        const value = this.#value();
        if (value !== null) {
            this.#draft?.edit({ adjustments: normalizeAdjustments(withAdjustment(value.adjustments ?? {}, name, percent)) });
        }
    }

    #setField(field: LayerTextField, text: string): void {
        const value = this.#value();
        if (value !== null) {
            this.#draft?.edit(layerFieldPatch(value, field, text));
        }
    }

    /** The open layer's draft value (null: no layer open, or not read yet). */
    #value(): LayerDoc | null {
        return this.#draft === null ? null : this.#draft.state.value;
    }

    async #save(): Promise<WriteOutcome | null> {
        const outcome = (await this.#draft?.save()) ?? null;
        this.#report(outcome, 'adminContent.layers.saved');
        return outcome;
    }

    #report(outcome: WriteOutcome | null, saved: 'adminContent.layers.saved' | 'adminContent.layers.reordered'): void {
        if (outcome === null) {
            return;
        }
        if (outcome.ok) {
            this.#services.notify({ key: saved });
            return;
        }
        if (outcome.reason === 'denied') {
            this.#services.denied();
        }
        this.#services.notify({ key: REFUSED[outcome.reason] });
    }

    async #reorder(id: string, target: (items: readonly LayerItem[]) => number): Promise<WriteOutcome | null> {
        const before = topFirst(this.#cell.state.list.items);
        const changes = orderChanges(before, moved(before, id, target(before)));
        if (changes.length === 0 || this.#cell.state.reordering) {
            return null;
        }
        this.#cell.update({ reordering: true });
        const { store, cityId } = this.#services;
        const outcome = await store.batch(
            changes.map((change) => ({ kind: 'update', path: FIRESTORE_PATHS.layer(cityId, change.id), fields: { order: change.order } })),
        );
        this.#cell.update({ reordering: false });
        this.#report(outcome, 'adminContent.layers.reordered');
        return outcome;
    }

    #select(id: string | null): void {
        if (id === this.#editorId()) {
            return;
        }
        this.#doc.stop();
        this.#preview.clear();
        this.#deletion.cancel();
        this.#crop.close();
        this.#assists.reset();
        this.#draft = null;
        this.#shown = '';
        this.#map.show([]);
        this.#cell.update({ editor: null });
        if (id !== null) {
            this.#edit(id);
        }
    }

    #editorId(): string | null {
        return this.#cell.state.editor?.id ?? null;
    }

    /** Opens the editor of layer `id`: its draft, then its document's listener. */
    #edit(id: string): void {
        const path = FIRESTORE_PATHS.layer(this.#services.cityId, id);
        this.#cell.update({ editor: { id, doc: LOADING_EDITOR_DOC, notFound: false, draft: EMPTY_DRAFT } });
        this.#draft = new EditDraft(
            { path, schema: layerDocSchema, editable: LAYER_EDITABLE, check: publishCheck },
            {
                store: this.#services.store,
                locked: () => this.#services.readOnly(),
                changed: (draft) => {
                    if (draft.conflict !== null) {
                        this.#services.people();
                    }
                    this.#draftChanged(id, draft);
                },
            },
        );
        this.#doc.show(path);
    }

    #docChanged(state: DocState<LayerDoc>): void {
        if (state.status === 'ready') {
            this.#draft?.load(state.doc);
        }
        // Read after the load: the draft's own update of the editor must not be overwritten.
        const editor = this.#cell.state.editor;
        if (editor !== null) {
            const { status, reconnecting, failure } = state;
            this.#cell.update({ editor: { ...editor, doc: { status, reconnecting, failure }, notFound: missing(state, editor) } });
        }
    }

    #draftChanged(id: string, draft: DraftState<LayerDoc>): void {
        const editor = this.#cell.state.editor;
        if (editor?.id !== id) {
            return;
        }
        this.#cell.update({ editor: { ...editor, draft } });
        this.#showSaved(id, draft);
        const value = draft.value;
        if (value !== null) {
            this.#preview.show({ kind: 'layer', id, opacity: value.opacity, visible: true, adjustments: value.adjustments ?? {} });
        }
    }

    /** The open layer as saved, on the map, once per saved version (the draft's look is a preview over it). */
    #showSaved(id: string, draft: DraftState<LayerDoc>): void {
        const base = draft.base;
        const key = base === null ? '' : `${id}@${base.version}`;
        if (key !== this.#shown) {
            this.#shown = key;
            this.#map.show(base === null ? [] : [rasterOf(id, base.data)]);
        }
    }

    #cityChanged(city: DocState<CityDoc>): void {
        if (city.doc !== null) {
            this.#map.setFrame(frameOf(city.doc.data));
        }
    }

    #retry(): void {
        this.#list.retry();
        if (this.#doc.path !== '') {
            this.#doc.retry();
        }
    }
}

/** The layers area's module (registered in `packages/admin/src/index.ts`, section layers). */
export const layersModule: AreaModule<LayersState, LayersIntents> = {
    area: 'layers',
    create: (services) => new LayersStore(services),
};
