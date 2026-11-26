/**
 * One POI category's editor (`#/settings/categories/<id>`; behaviour A39): label in both languages, icon, colour and
 * default opacity, previewed live on the page's map (the category's overlay), written by Save. A new category
 * (`#/settings/categories/_new`) is created by its first Save under the id its Romanian label gives, free in the overlay
 * namespace; an existing one is a draft guarded by the version read. Until the admin picks an icon, a new category's icon
 * follows its label (`guessCategoryIcon`: "Fântâni" gives water), so the common case needs no click in the picker. A
 * colour the white glyph does not read on cannot be saved: the editor proposes the nearest tone that reads (one click
 * takes it).
 */
import { FIRESTORE_PATHS, poiCategoryDocSchema, validate, type PoiCategoryDoc, type ValidationIssue } from '@hcm/shared';

import type { ContentServices, Stored, WriteOutcome } from '../content/services.js';
import { EditDraft, EMPTY_DRAFT, type DraftConflict, type DraftState } from '../layers/draft.js';
import type { PreviewLayer } from '../layers/preview.js';
import {
    CATEGORY_EDITABLE,
    categoryIssues,
    NEW_CATEGORY,
    newCategory,
    newCategoryId,
    newCategorySchema,
    type CategoryItem,
    type NewCategory,
} from './categories.js';
import { nearestTone, readsWithWhite } from './colour.js';
import { guessCategoryIcon } from './icon-guess.js';

export interface CategoryEditorState {
    /** The category's id, or `NEW_CATEGORY` before its first Save. */
    readonly id: string;
    readonly isNew: boolean;
    /** Read, and no such category. */
    readonly notFound: boolean;
    readonly value: NewCategory | null;
    readonly dirty: boolean;
    readonly issues: readonly ValidationIssue[];
    readonly saving: boolean;
    readonly conflict: DraftConflict | null;
    readonly gone: boolean;
    /** The nearest tone of the colour that the white glyph reads on, when the colour itself does not (null: it does). */
    readonly proposedColor: string | null;
}

/** `undefined` removes an optional field (M27: an emptied credit). */
/** A new category's value without the fields a patch removed (Firestore refuses an `undefined` field). */
function withoutUndefined<T extends object>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}

export type CategoryPatch = Partial<Pick<PoiCategoryDoc, 'label' | 'icon' | 'color' | 'defaultOpacity'>> & {
    readonly defaultVisible?: boolean | undefined;
    readonly pinned?: boolean | undefined;
    readonly attribution?: string | undefined;
};

/** The colour proposal of a value: the nearest tone that reads, when the colour does not. */
function proposalOf(value: NewCategory | null): string | null {
    const color = value?.color ?? '';
    return /^#[0-9a-f]{6}$/i.test(color) && !readsWithWhite(color) ? nearestTone(color, readsWithWhite) : null;
}

/** What a new category's value lacks (its schema without the stamp, and a colour the glyph reads on). */
function newIssues(value: NewCategory): ValidationIssue[] {
    const result = validate(newCategorySchema, value);
    return [...(result.ok ? [] : result.issues), ...categoryIssues(value)];
}

function stateOf(id: string, draft: DraftState<PoiCategoryDoc>, notFound: boolean): CategoryEditorState {
    return {
        ...{ id, isNew: false, notFound, value: draft.value, dirty: draft.dirty.length > 0, issues: draft.issues, saving: draft.saving },
        ...{ conflict: draft.conflict, gone: draft.gone, proposedColor: proposalOf(draft.value) },
    };
}

export interface CategoryEditorDeps {
    readonly services: ContentServices;
    readonly preview: PreviewLayer;
    readonly changed: (state: CategoryEditorState) => void;
    /** The ids a new category may not take: every layer's and category's. */
    readonly taken: () => Iterable<string>;
    /** The categories as listed (a new one goes last). */
    readonly categories: () => readonly CategoryItem[];
}

export class CategoryEditor {
    readonly #deps: CategoryEditorDeps;
    readonly #draft: EditDraft<PoiCategoryDoc> | null;
    #state: CategoryEditorState;
    /** A new category's icon was picked by the admin: the label no longer chooses it. */
    #iconPicked = false;

    constructor(id: string, deps: CategoryEditorDeps) {
        this.#deps = deps;
        if (id === NEW_CATEGORY) {
            this.#draft = null;
            const value = newCategory(deps.categories());
            this.#state = { ...stateOf(id, EMPTY_DRAFT, false), isNew: true, value };
        } else {
            const path = FIRESTORE_PATHS.poiCategory(deps.services.cityId, id);
            const spec = { path, schema: poiCategoryDocSchema, editable: CATEGORY_EDITABLE, check: categoryIssues };
            this.#draft = new EditDraft(spec, {
                store: deps.services.store,
                locked: () => deps.services.readOnly(),
                changed: (draft) => {
                    if (draft.conflict !== null) {
                        deps.services.people();
                    }
                    this.#set(stateOf(id, draft, false));
                },
            });
            this.#state = stateOf(id, EMPTY_DRAFT, false);
        }
    }

    get state(): CategoryEditorState {
        return this.#state;
    }

    get unsaved(): boolean {
        return this.#state.dirty;
    }

    /** The category's document (existing categories only): null once read means not found. */
    load(doc: Stored<PoiCategoryDoc> | null): void {
        if (this.#draft === null) {
            return;
        }
        const missing = doc === null && this.#draft.state.base === null;
        this.#draft.load(doc);
        this.#set({ ...this.#state, notFound: missing });
    }

    edit(patch: CategoryPatch): void {
        if (this.#draft !== null) {
            this.#draft.edit(patch);
            return;
        }
        if (!this.#deps.services.readOnly()) {
            this.#editNew(patch);
        }
    }

    /** A category not saved yet: its value is the editor's own (no draft); a revoked admin's page takes no edit (§42d). */
    #editNew(patch: CategoryPatch): void {
        const value = this.#state.value;
        if (value !== null) {
            this.#iconPicked ||= patch.icon !== undefined;
            const edited = withoutUndefined({ ...value, ...patch });
            const next = this.#iconPicked ? edited : { ...edited, icon: guessCategoryIcon(edited.label) };
            this.#set({ ...this.#state, value: next, dirty: true, issues: newIssues(next), proposedColor: proposalOf(next) });
        }
    }

    /** Takes the proposed colour. */
    useProposedColor(): void {
        const color = this.#state.proposedColor;
        if (color !== null) {
            this.edit({ color });
        }
    }

    discard(): void {
        this.#draft?.discard();
        if (this.#draft === null) {
            this.#iconPicked = false;
            this.#set({ ...this.#state, value: newCategory(this.#deps.categories()), dirty: false, issues: [], proposedColor: null });
        }
    }

    keepMine(): void {
        this.#draft?.keepMine();
    }

    takeTheirs(): void {
        this.#draft?.takeTheirs();
    }

    /** Saves; the category's id once it is written (a new one's new id), else null. */
    async save(): Promise<{ readonly outcome: WriteOutcome; readonly id: string } | null> {
        if (this.#draft !== null) {
            const outcome = await this.#draft.save();
            return outcome === null ? null : { outcome, id: this.#state.id };
        }
        return this.#create();
    }

    /** Takes the category's overlay back to its saved look. */
    stop(): void {
        this.#deps.preview.clear();
    }

    async #create(): Promise<{ readonly outcome: WriteOutcome; readonly id: string } | null> {
        const value = this.#state.value;
        if (value === null || this.#state.saving) {
            return null;
        }
        const issues = this.#state.issues;
        if (issues.length > 0) {
            return { outcome: { ok: false, reason: 'invalid', issues }, id: NEW_CATEGORY };
        }
        const id = newCategoryId(value.label.ro, this.#deps.taken());
        this.#set({ ...this.#state, saving: true });
        const outcome = await this.#deps.services.store.create(FIRESTORE_PATHS.poiCategory(this.#deps.services.cityId, id), value);
        this.#set({ ...this.#state, saving: false, dirty: !outcome.ok });
        return { outcome, id };
    }

    #set(state: CategoryEditorState): void {
        this.#state = state;
        const value = state.value;
        if (value !== null && state.id !== NEW_CATEGORY) {
            this.#deps.preview.show({
                kind: 'poi-category',
                id: state.id,
                opacity: value.defaultOpacity,
                color: value.color,
                icon: value.icon,
            });
        }
        this.#deps.changed(state);
    }
}
