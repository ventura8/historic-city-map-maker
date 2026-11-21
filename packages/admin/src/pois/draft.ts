/**
 * A place's draft (docs/research/M2c-interfaces.md §5.1, §5.3, §7.2; behaviour A38 for places): every edit changes the
 * draft only (the page's map shows it), Save writes it in one transaction: a new place is created (published by default,
 * §5.4), a stored one updated with the changed fields only, refused when another admin changed it meanwhile. A snapshot
 * that arrives while editing merges the fields the draft does not change; one that changed a field the draft changed too
 * raises the conflict the admin resolves (keep mine, take theirs), never a silent overwrite. The whole document is
 * validated with `poiDocSchema`, the geometry against the city's limits, the category against the city's categories and
 * the years with `placeYearIssues` (one year at least, none after next year: a place stored without one opens, and Save
 * asks for it), before anything is sent.
 *
 * A new place counts as unsaved only once the admin changed it (finding 42 of `docs/research/manual-test-2026-10-25.md`):
 * typed text, a drawn shape, a field moved from its default. Its first value and a default the page fills in later
 * (`prefill`: the category once the categories are listed) are no edit, so leaving an untouched new place asks nothing.
 */
import {
    FIRESTORE_PATHS,
    placeYearIssues,
    poiDocSchema,
    validate,
    type PoiDoc,
    type ValidationCode,
    type ValidationIssue,
} from '@hcm/shared';
import { checkGeometry, type DrawLimits, type DrawRefusal } from '@hcm/ui/map/draw';

import type { ContentStore, Stored, WriteOutcome } from '../content/services.js';
import {
    docFieldsOf,
    patched,
    POI_EDITABLE,
    UPLOADER_POI_FIELDS,
    valueOf,
    type PoiEditable,
    type PoiPatch,
    type PoiValue,
} from './model.js';

/** What the checks beyond the schema read: the drawing limits and the city's categories (null while not read yet). */
export interface PoiContext {
    readonly limits: DrawLimits | null;
    readonly categories: ReadonlySet<string> | null;
    /** The latest year a place may name (`latestPlaceYear`: next year); absent or null, only a missing year is checked. */
    readonly latestYear?: number | null;
}

interface PoiConflict {
    readonly by: string;
    /** When the other admin saved (the snapshot's version, ISO). */
    readonly at: string;
    readonly fields: readonly PoiEditable[];
}

export interface PoiDraftState {
    readonly id: string;
    /** No document yet: Save creates it. */
    readonly isNew: boolean;
    readonly base: Stored<PoiDoc> | null;
    readonly value: PoiValue;
    readonly dirty: readonly PoiEditable[];
    readonly issues: readonly ValidationIssue[];
    readonly saving: boolean;
    readonly conflict: PoiConflict | null;
    /** Deleted elsewhere while open: Save is off. */
    readonly gone: boolean;
}

export interface PoiDraftDeps {
    readonly store: Pick<ContentStore, 'update' | 'create'>;
    readonly cityId: string;
    readonly context: () => PoiContext;
    readonly changed: (state: PoiDraftState) => void;
    /** True while the admin's access is removed (§35e, `DECISIONS-for-review.md` §42d): `edit` changes nothing. */
    readonly locked?: () => boolean;
    /** M13 §2: the admin is an uploader: their new places wait for review. */
    readonly reviewed?: () => boolean;
}

/** A stand-in stamp: the schema checks the document as stored, and the store stamps the real write. */
const DRAFT_STAMP = { updatedBy: 'draft', updatedAt: { seconds: 0, nanoseconds: 0 } };

const REFUSAL_CODES: Readonly<Record<DrawRefusal['kind'], ValidationCode>> = {
    outside: 'validation.outsideCity',
    'too-many-vertices': 'validation.tooBig',
    'too-many-rings': 'validation.tooBig',
    'self-intersection': 'validation.invalid',
    'zero-area': 'validation.invalid',
};

function same(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/** The fields where two values differ. */
export function changedFields(value: PoiValue, other: PoiValue | null): PoiEditable[] {
    return POI_EDITABLE.filter((field) => other === null || !same(value[field], other[field]));
}

function geometryIssues(value: PoiValue, limits: DrawLimits | null): ValidationIssue[] {
    if (value.geometry === null) {
        return [{ path: 'geometry', code: 'validation.required' }];
    }
    const refusal = limits === null ? null : checkGeometry(value.geometry, limits);
    return refusal === null ? [] : [{ path: 'geometry', code: REFUSAL_CODES[refusal.kind] }];
}

function categoryIssues(value: PoiValue, categories: ReadonlySet<string> | null): ValidationIssue[] {
    return categories === null || categories.has(value.category) ? [] : [{ path: 'category', code: 'validation.reference' }];
}

/** Every problem of the place as it would be stored. */
export function draftIssues(value: PoiValue, context: PoiContext): readonly ValidationIssue[] {
    const fields =
        value.geometry === null ? docFieldsOf({ ...value, geometry: { type: 'Point', coordinates: [0, 0] } }) : docFieldsOf(value);
    const result = validate(poiDocSchema, { ...fields, ...DRAFT_STAMP });
    return [
        ...geometryIssues(value, context.limits),
        ...(result.ok ? [] : result.issues),
        ...placeYearIssues(value, context.latestYear ?? null),
        ...categoryIssues(value, context.categories),
    ];
}

export class PoiDraft {
    readonly #deps: PoiDraftDeps;
    /** What Discard returns to for a new place, and what its edits are measured against (with its prefilled defaults). */
    #initial: PoiValue;
    /** The snapshot a conflict is about. */
    #theirs: Stored<PoiDoc> | null = null;
    #state: PoiDraftState;

    constructor(id: string, start: { readonly base: Stored<PoiDoc> } | { readonly value: PoiValue }, deps: PoiDraftDeps) {
        this.#deps = deps;
        const base = 'base' in start ? start.base : null;
        this.#initial = 'base' in start ? valueOf(start.base.data) : start.value;
        this.#state = this.#checked({
            ...{ id, isNew: base === null, base, value: this.#initial, dirty: base === null ? changedFields(this.#initial, null) : [] },
            ...{ issues: [], saving: false, conflict: null, gone: false },
        });
    }

    get state(): PoiDraftState {
        return this.#state;
    }

    /** The admin changed something that Save would write: for a new place, anything that differs from its start. */
    get unsaved(): boolean {
        return this.#state.isNew ? changedFields(this.#state.value, this.#initial).length > 0 : this.#state.dirty.length > 0;
    }

    #checked(state: PoiDraftState): PoiDraftState {
        return { ...state, issues: draftIssues(state.value, this.#deps.context()) };
    }

    #set(patch: Partial<PoiDraftState>): void {
        this.#state = this.#checked({ ...this.#state, ...patch });
        this.#deps.changed(this.#state);
    }

    /** The checks again (the categories or the city's bounds arrived). */
    recheck(): void {
        this.#set({});
    }

    /**
     * A default the page fills in after the start (a new place's category once the categories are listed): it changes the
     * value and the start alike, so it is no edit. Nothing for a stored place.
     */
    prefill(patch: PoiPatch): void {
        if (!this.#state.isNew || this.#deps.locked?.() === true) {
            return;
        }
        this.#initial = patched(this.#initial, patch);
        const value = patched(this.#state.value, patch);
        this.#set({ value, dirty: this.#dirtyOf(value) });
    }

    edit(patch: PoiPatch): void {
        if (this.#deps.locked?.() === true) {
            return;
        }
        const value = patched(this.#state.value, patch);
        this.#set({ value, dirty: this.#dirtyOf(value) });
    }

    #dirtyOf(value: PoiValue): PoiEditable[] {
        const base = this.#state.base;
        return changedFields(value, base === null ? null : valueOf(base.data));
    }

    discard(): void {
        const base = this.#state.base;
        this.#theirs = null;
        this.#set({
            value: base === null ? this.#initial : valueOf(base.data),
            dirty: base === null ? this.#state.dirty : [],
            conflict: null,
        });
    }

    /** A new snapshot of the document (null: it is gone). */
    rebase(remote: Stored<PoiDoc> | null): void {
        if (remote === null) {
            this.#set({ gone: !this.#state.isNew });
            return;
        }
        if (remote.version === this.#state.base?.version) {
            return;
        }
        this.#merge(remote);
    }

    #merge(remote: Stored<PoiDoc>): void {
        const { base, dirty, value } = this.#state;
        const theirs = valueOf(remote.data);
        const changed = changedFields(theirs, base === null ? null : valueOf(base.data));
        const overlap = dirty.filter((field) => changed.includes(field) && !same(value[field], theirs[field]));
        const mine = Object.fromEntries(dirty.map((field) => [field, value[field]])) as PoiPatch;
        const merged = patched(theirs, mine);
        this.#theirs = overlap.length === 0 ? null : remote;
        this.#set({
            ...{ base: remote, isNew: false, gone: false, value: merged },
            ...{
                dirty: changedFields(merged, theirs),
                conflict: overlap.length === 0 ? null : { by: remote.data.updatedBy, at: remote.version, fields: overlap },
            },
        });
    }

    /** The conflict ends with the draft's values over the other admin's version. */
    keepMine(): void {
        this.#theirs = null;
        this.#set({ conflict: null });
    }

    /** The conflict ends with the other admin's values of the conflicting fields. */
    takeTheirs(): void {
        const theirs = this.#theirs;
        const conflict = this.#state.conflict;
        if (theirs === null || conflict === null) {
            return;
        }
        const remote = valueOf(theirs.data);
        const patch = Object.fromEntries(conflict.fields.map((field) => [field, remote[field]])) as PoiPatch;
        this.#theirs = null;
        const value = patched(this.#state.value, patch);
        this.#set({ value, dirty: this.#dirtyOf(value), conflict: null });
    }

    /** Validates, then creates or updates the document; the outcome says why nothing was written. */
    async save(): Promise<WriteOutcome> {
        const state = this.#state;
        if (state.issues.length > 0) {
            return { ok: false, reason: 'invalid', issues: state.issues };
        }
        this.#set({ saving: true });
        const outcome = await this.#write(state);
        this.#set({ saving: false, ...(outcome.ok ? this.#saved(state) : {}) });
        return outcome;
    }

    #write(state: PoiDraftState): Promise<WriteOutcome> {
        const path = FIRESTORE_PATHS.poi(this.#deps.cityId, state.id);
        const fields = docFieldsOf(state.value);
        if (state.base === null) {
            const created = this.#deps.reviewed?.() === true ? { ...fields, ...UPLOADER_POI_FIELDS } : fields;
            return this.#deps.store.create(path, created, { withCreator: true });
        }
        // A cleared optional field travels as `undefined`: the store deletes it (CR-M2c-16 of M2c-interfaces §13).
        const changed = Object.fromEntries(state.dirty.map((field) => [field, fields[field]]));
        return this.#deps.store.update(path, changed, state.base.version);
    }

    /** After a write: nothing is unsaved until the next edit (the snapshot that follows becomes the base). */
    #saved(state: PoiDraftState): Partial<PoiDraftState> {
        return state.base === null ? { isNew: false, dirty: [] } : { dirty: [] };
    }
}
