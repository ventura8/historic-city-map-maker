/**
 * One open place (`#/pois/<id>`, docs/research/M2c-interfaces.md §7.2): its live document, its draft, and its shape as the
 * vertex list edits it (§4.6). A new place (Add place) starts from a fresh draft before its document exists; any other id
 * waits for its document and says "not found" without one. The geometry comes from the map's drawing tools
 * (`setGeometry`) or from the vertex list (`editVertex`, Add at map centre); positions added before the shape exists are
 * the sketch. Every geometry is checked against the city's limits before it reaches the draft.
 */
import { FIRESTORE_PATHS, latestPlaceYear, poiDocSchema, type Geometry, type LngLat, type PoiDoc } from '@hcm/shared';
import { checkGeometry, checkPositions, roundGeometry, roundPosition, type DrawRefusal } from '@hcm/ui/map/draw';

import type { Clock } from '../app/ports.js';
import { LiveDoc } from '../content/doc.js';
import type { ContentStore, Stored, StoreFailure, WriteOutcome } from '../content/services.js';
import { PoiDraft, type PoiContext, type PoiDraftState } from './draft.js';
import type { PoiPatch, PoiValue } from './model.js';
import { editedPositions, geometryFrom, listedPositions, placeShapeOf, type PlaceShape, type VertexEdit } from './vertices.js';

type Position = [number, number];

export interface PlaceEditorState {
    readonly id: string;
    /** `not-found`: an id without a document (and without a draft of a new place). */
    readonly status: 'loading' | 'ready' | 'not-found' | 'error';
    readonly failure: StoreFailure | null;
    readonly reconnecting: boolean;
    readonly draft: PoiDraftState | null;
    readonly shape: PlaceShape;
    /** Positions added before the shape exists (a line's first, an area's first two). */
    readonly sketch: readonly Position[];
    /** The vertex the list has selected (Add at map centre adds after it), or null. */
    readonly vertex: number | null;
    /** The last limit a geometry broke, announced once; null after the next accepted change. */
    readonly refusal: DrawRefusal['kind'] | null;
}

export interface PlaceEditorDeps {
    readonly store: ContentStore;
    readonly clock: Clock;
    readonly cityId: string;
    readonly denied: () => void;
    readonly context: () => PoiContext;
    readonly changed: (state: PlaceEditorState) => void;
    /** The admin's access was removed: the draft takes no edit (`DECISIONS-for-review.md` §42d). */
    readonly locked?: () => boolean;
    /** M13 §2: the admin is an uploader: their new places wait for review. */
    readonly reviewed?: () => boolean;
    /** A conflict appeared: the shell learns the admins' names, so the banner names who saved (§42c). */
    readonly people?: () => void;
}

/** A new place: its first value and the shape the admin chose. */
export interface FreshPlace {
    readonly value: PoiValue;
    readonly shape: PlaceShape;
}

export class PlaceEditor {
    readonly #deps: PlaceEditorDeps;
    readonly #doc: LiveDoc<PoiDoc>;
    #draft: PoiDraft | null = null;
    #state: PlaceEditorState;

    constructor(id: string, fresh: FreshPlace | null, deps: PlaceEditorDeps) {
        this.#deps = deps;
        this.#state = {
            ...{ id, status: fresh === null ? 'loading' : 'ready', failure: null, reconnecting: false, draft: null },
            ...{ shape: fresh?.shape ?? 'point', sketch: [], vertex: null, refusal: null },
        };
        if (fresh !== null) {
            this.#draft = this.#newDraft({ value: fresh.value });
            this.#state = { ...this.#state, draft: this.#draft.state };
        }
        const { store, clock, denied } = deps;
        this.#doc = new LiveDoc({
            ...{ store, clock, denied, schema: poiDocSchema },
            changed: () => {
                this.#docChanged();
            },
        });
        this.#doc.show(FIRESTORE_PATHS.poi(deps.cityId, id));
    }

    get state(): PlaceEditorState {
        return this.#state;
    }

    get id(): string {
        return this.#state.id;
    }

    /** Whether leaving now would lose an edit: a changed draft, or positions placed of a shape not finished yet. */
    get unsaved(): boolean {
        const changed = this.#draft?.unsaved === true || this.#state.sketch.length > 0;
        return changed && this.#draft?.state.gone !== true;
    }

    /** The positions the vertex list shows. */
    get positions(): readonly Position[] {
        const geometry = this.#state.draft?.value.geometry ?? null;
        return geometry === null ? this.#state.sketch : listedPositions(geometry);
    }

    #newDraft(start: { readonly base: Stored<PoiDoc> } | { readonly value: PoiValue }): PoiDraft {
        const { store, cityId, context, locked, clock } = this.#deps;
        return new PoiDraft(this.#state.id, start, {
            // A year after next year is refused by the clock (`placeYearIssues`), as the import does (`Importer`).
            ...{ store, cityId, context: () => ({ ...context(), latestYear: latestPlaceYear(clock.now()) }) },
            ...(locked === undefined ? {} : { locked }),
            ...(this.#deps.reviewed === undefined ? {} : { reviewed: this.#deps.reviewed }),
            changed: (draft) => {
                if (draft.conflict !== null) {
                    this.#deps.people?.();
                }
                this.#set({ draft });
            },
        });
    }

    #set(patch: Partial<PlaceEditorState>): void {
        this.#state = { ...this.#state, ...patch };
        this.#deps.changed(this.#state);
    }

    #docChanged(): void {
        const doc = this.#doc.state;
        if (doc.status === 'error') {
            this.#set({ status: this.#draft === null ? 'error' : this.#state.status, failure: doc.failure });
            return;
        }
        this.#set({ reconnecting: doc.reconnecting, failure: doc.failure });
        if (doc.status === 'ready') {
            this.#arrived(doc.doc);
        }
    }

    #arrived(stored: Stored<PoiDoc> | null): void {
        const draft = this.#draft;
        if (draft !== null) {
            draft.rebase(stored);
            return;
        }
        if (stored === null) {
            this.#set({ status: 'not-found' });
            return;
        }
        this.#draft = this.#newDraft({ base: stored });
        const geometry = this.#draft.state.value.geometry;
        this.#set({ status: 'ready', draft: this.#draft.state, shape: geometry === null ? 'point' : placeShapeOf(geometry) });
    }

    retry(): void {
        this.#doc.retry();
    }

    /** The checks again (the city or its categories arrived). */
    recheck(): void {
        this.#draft?.recheck();
    }

    edit(patch: PoiPatch): void {
        this.#draft?.edit(patch);
    }

    /** A default filled in after the start (a new place's category): no edit (`PoiDraft.prefill`). */
    prefill(patch: PoiPatch): void {
        this.#draft?.prefill(patch);
    }

    /** A geometry the map's drawing tools finished (already checked and rounded by them). */
    setGeometry(geometry: Geometry): void {
        this.#draft?.edit({ geometry: roundGeometry(geometry) });
        this.#set({ sketch: [], refusal: null });
    }

    /** The map refused a position or a shape. */
    refused(kind: DrawRefusal['kind']): void {
        this.#set({ refusal: kind });
    }

    selectVertex(index: number | null): void {
        this.#set({ vertex: index });
    }

    /** A vertex list edit: refused when it leaves too few positions or breaks a limit. */
    editVertex(edit: VertexEdit): boolean {
        const positions = editedPositions(this.#state.shape, this.positions, edit);
        if (positions === null) {
            return false;
        }
        const previous = this.#state.draft?.value.geometry ?? null;
        const geometry = geometryFrom(this.#state.shape, positions, previous);
        return geometry === null ? this.#sketched(positions) : this.#placed(geometry, edit);
    }

    #sketched(positions: readonly Position[]): boolean {
        const limits = this.#deps.context().limits;
        const refusal = limits === null ? null : checkPositions(positions, limits);
        if (refusal !== null) {
            this.#set({ refusal: refusal.kind });
            return false;
        }
        this.#clearGeometry();
        this.#set({ sketch: positions, refusal: null });
        return true;
    }

    /** The draft loses its geometry (its positions went back to a sketch). */
    #clearGeometry(): void {
        const draft = this.#draft;
        if (draft !== null && draft.state.value.geometry !== null) {
            draft.edit({ geometry: null });
        }
    }

    #placed(geometry: Geometry, edit: VertexEdit): boolean {
        const limits = this.#deps.context().limits;
        const refusal = limits === null ? null : checkGeometry(geometry, limits);
        if (refusal !== null) {
            this.#set({ refusal: refusal.kind });
            return false;
        }
        this.#draft?.edit({ geometry });
        this.#set({ sketch: [], refusal: null, vertex: vertexAfter(edit, this.#state.vertex) });
        return true;
    }

    /** Adds a vertex where the map's centre is, after the selected one (at the end without a selection). */
    addAt(position: LngLat): boolean {
        const index = this.#state.vertex ?? this.positions.length - 1;
        return this.editVertex({ kind: 'add', index, position: roundPosition(position) });
    }

    /** Removes the last vertex (a point keeps its one). */
    undoLastVertex(): boolean {
        return this.editVertex({ kind: 'remove', index: this.positions.length - 1 });
    }

    /** Starts the shape again as `shape` (the page asked first when that loses a drawn geometry). */
    redraw(shape: PlaceShape): void {
        this.#draft?.edit({ geometry: null });
        this.#set({ shape, sketch: [], vertex: null, refusal: null });
    }

    save(): Promise<WriteOutcome> {
        return this.#draft === null ? Promise.resolve({ ok: false, reason: 'gone' }) : this.#draft.save();
    }

    discard(): void {
        const draft = this.#draft;
        draft?.discard();
        const geometry = draft?.state.value.geometry ?? null;
        this.#set({ sketch: [], vertex: null, refusal: null, ...(geometry === null ? {} : { shape: placeShapeOf(geometry) }) });
    }

    keepMine(): void {
        this.#draft?.keepMine();
    }

    takeTheirs(): void {
        this.#draft?.takeTheirs();
    }

    close(): void {
        this.#doc.stop();
    }
}

type VertexAfter = (edit: VertexEdit, selected: number | null) => number | null;

const VERTEX_AFTER: {
    readonly [K in VertexEdit['kind']]: (edit: Extract<VertexEdit, { kind: K }>, selected: number | null) => number | null;
} = {
    add: (edit) => edit.index + 1,
    move: (edit) => edit.index + edit.by,
    remove: (edit, selected) => (selected === null ? null : Math.max(0, edit.index - 1)),
    set: (edit) => edit.index,
};

/** The vertex selected after an edit: the added one, the moved one, or the one before a removed one. */
function vertexAfter(edit: VertexEdit, selected: number | null): number | null {
    return (VERTEX_AFTER[edit.kind] as VertexAfter)(edit, selected);
}
