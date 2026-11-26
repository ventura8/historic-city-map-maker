/**
 * One document's draft for the layer editor and the city settings' sections (`docs/research/M2c-interfaces.md` §5.1,
 * §5.3; behaviour A38): every edit changes the draft only (the page's map previews it), Save writes the changed fields in
 * one transaction that refuses a document another admin changed meanwhile. The value is validated as it changes (its
 * issues are shown at their fields and Save is off while there is any). A snapshot that arrives while editing merges
 * the fields the draft does not change; one that changed a field the draft changed too raises the conflict, which the
 * admin resolves (keep mine or take theirs), never a silent overwrite. The document is validated with its schema, and
 * the spec's own check, before anything is sent. The editing kit's generic `DraftEditor` (ops-screens) may replace this
 * class once it lands; the behaviour is the contract's.
 */
import { validate, type Schema, type ValidationIssue } from '@hcm/shared';

import type { ContentStore, Stored, WriteOutcome } from '../content/services.js';

export interface DraftSpec<T extends object> {
    /** The document's path (`FIRESTORE_PATHS`). */
    readonly path: string;
    readonly schema: Schema<T>;
    /** The fields the editor changes (a subset of `CLIENT_WRITES[entity].update`, without the stamp). */
    readonly editable: readonly (keyof T & string)[];
    /** Checks the schema cannot make (a field against another document): issues at their fields. */
    readonly check?: (value: T) => readonly ValidationIssue[];
}

export interface DraftConflict {
    /** Who saved the other version (`updatedBy`: a uid or `system:<writer>`). */
    readonly by: string;
    /** That version (`updatedAt`, ISO). */
    readonly at: string;
    readonly fields: readonly string[];
}

export interface DraftState<T> {
    /** The document as last read (null before the first snapshot and once it is gone). */
    readonly base: Stored<T> | null;
    /** What the editor shows: the base with the edits (null before the first snapshot). */
    readonly value: T | null;
    /** The editable fields that differ from the base. */
    readonly dirty: readonly string[];
    /** What the document's schema and the spec's check find in the value, kept up to date (Save is off while any). */
    readonly issues: readonly ValidationIssue[];
    readonly saving: boolean;
    readonly conflict: DraftConflict | null;
    /** The document was deleted while open: Save is off. */
    readonly gone: boolean;
}

export const EMPTY_DRAFT: DraftState<never> = {
    base: null,
    value: null,
    dirty: [],
    issues: [],
    saving: false,
    conflict: null,
    gone: false,
};

/** A JSON replacer that sorts object keys, so `{ro, en}` and `{en, ro}` give the same text. */
function sortedKeys(_key: string, field: unknown): unknown {
    return typeof field === 'object' && field !== null && !Array.isArray(field)
        ? Object.fromEntries(Object.entries(field).sort(([a], [b]) => a.localeCompare(b)))
        : field;
}

/** A value as JSON with its object keys sorted (`undefined`, an absent field, as its own word). */
function stableJson(value: unknown): string {
    return value === undefined ? 'undefined' : JSON.stringify(value, sortedKeys);
}

export function sameValue(a: unknown, b: unknown): boolean {
    return stableJson(a) === stableJson(b);
}

function field(value: object, key: string): unknown {
    return (value as Readonly<Record<string, unknown>>)[key];
}

/** Who saved a version (`updatedBy`), as text ('' when it names nobody). */
function writerOf(value: object): string {
    const writer = field(value, 'updatedBy');
    return typeof writer === 'string' ? writer : '';
}

/** The editable fields whose values differ between `a` and `b`. */
export function changedFields<T extends object>(editable: readonly string[], a: T, b: T): string[] {
    return editable.filter((key) => !sameValue(field(a, key), field(b, key)));
}

/** `value` with `fields` taken from `from`. */
function withFields<T extends object>(value: T, from: T, fields: readonly string[]): T {
    return { ...value, ...Object.fromEntries(fields.map((key) => [key, field(from, key)])) };
}

export interface DraftDeps<T> {
    readonly store: ContentStore;
    readonly changed: (state: DraftState<T>) => void;
    /** True while the admin's access is removed (§35e, `DECISIONS-for-review.md` §42d): `edit` changes nothing. */
    readonly locked?: () => boolean;
}

export class EditDraft<T extends object> {
    readonly #spec: DraftSpec<T>;
    readonly #deps: DraftDeps<T>;
    #state: DraftState<T> = EMPTY_DRAFT;
    /** The snapshot that raised the conflict, until the admin resolves it. */
    #theirs: Stored<T> | null = null;
    /** The value the last Save wrote: until the snapshot that follows becomes the base, nothing is unsaved. */
    #written: T | null = null;

    constructor(spec: DraftSpec<T>, deps: DraftDeps<T>) {
        this.#spec = spec;
        this.#deps = deps;
    }

    get state(): DraftState<T> {
        return this.#state;
    }

    get path(): string {
        return this.#spec.path;
    }

    /**
     * Whether leaving now would lose an edit: not right after a Save, while the written value waits for its snapshot
     * (leaving then asked about changes already stored, `docs/LESSONS.md` 122).
     */
    get unsaved(): boolean {
        return this.#state.dirty.length > 0 && this.#state.value !== this.#written;
    }

    /** A snapshot of the document (null: missing or deleted): the first one starts the draft, later ones rebase it. */
    load(remote: Stored<T> | null): void {
        const { base, value } = this.#state;
        if (remote === null) {
            this.#set({ ...this.#state, base: null, gone: base !== null, conflict: null });
        } else if (base === null || value === null || this.#state.dirty.length === 0) {
            this.#set({ ...EMPTY_DRAFT, base: remote, value: remote.data });
        } else {
            this.#rebase(base, value, remote);
        }
    }

    edit(patch: Partial<T>): void {
        const value = this.#state.value;
        if (value === null || this.#deps.locked?.() === true) {
            return;
        }
        this.#set({ ...this.#state, value: { ...value, ...patch } });
    }

    /** Back to the document as read. */
    discard(): void {
        const base = this.#state.base;
        this.#theirs = null;
        this.#set(base === null ? EMPTY_DRAFT : { ...EMPTY_DRAFT, base, value: base.data });
    }

    /** The conflict: the other version becomes the base, the draft keeps every field it changed. */
    keepMine(): void {
        this.#resolve((theirs, value) => withFields(theirs.data, value, this.#state.dirty));
    }

    /** The conflict: the other version's values win where both changed; the draft keeps its other edits. */
    takeTheirs(): void {
        const conflicting = new Set(this.#state.conflict?.fields ?? []);
        this.#resolve((theirs, value) =>
            withFields(
                theirs.data,
                value,
                this.#state.dirty.filter((key) => !conflicting.has(key)),
            ),
        );
    }

    /** Validates the whole document, then writes the changed fields guarded by the version read. */
    async save(): Promise<WriteOutcome | null> {
        const { base, value } = this.#state;
        if (base === null || value === null || this.#blocked()) {
            return null;
        }
        const issues = this.#state.issues;
        return issues.length > 0 ? { ok: false, reason: 'invalid', issues } : this.#write(base, value);
    }

    /** Nothing to save, a conflict to resolve first, a deleted document, or a save under way. */
    #blocked(): boolean {
        const { dirty, conflict, gone, saving } = this.#state;
        return dirty.length === 0 || conflict !== null || gone || saving;
    }

    async #write(base: Stored<T>, value: T): Promise<WriteOutcome> {
        this.#set({ ...this.#state, saving: true });
        const outcome = await this.#deps.store.update(this.#spec.path, this.#fieldsOf(value, this.#state.dirty), base.version);
        this.#written = outcome.ok ? value : this.#written;
        this.#set({ ...this.#state, saving: false });
        return outcome;
    }

    #issuesOf(value: T): readonly ValidationIssue[] {
        const result = validate(this.#spec.schema, value);
        return [...(result.ok ? [] : result.issues), ...(this.#spec.check?.(value) ?? [])];
    }

    /** The changed fields as written; a field set to `undefined` is removed from the document. */
    #fieldsOf(value: T, dirty: readonly string[]): Readonly<Record<string, unknown>> {
        return Object.fromEntries(dirty.map((key) => [key, field(value, key)]));
    }

    #rebase(base: Stored<T>, value: T, remote: Stored<T>): void {
        const editable = this.#spec.editable;
        const theirs = changedFields(editable, base.data, remote.data);
        const mine = new Set(this.#state.dirty);
        const clashing = theirs.filter((key) => mine.has(key) && !sameValue(field(remote.data, key), field(value, key)));
        if (clashing.length > 0) {
            this.#theirs = remote;
            this.#set({ ...this.#state, conflict: { by: writerOf(remote.data), at: remote.version, fields: clashing } });
            return;
        }
        this.#rebased(remote, withFields(remote.data, value, this.#state.dirty));
    }

    #resolve(merge: (theirs: Stored<T>, value: T) => T): void {
        const theirs = this.#theirs;
        const value = this.#state.value;
        if (theirs === null || value === null) {
            return;
        }
        this.#theirs = null;
        this.#rebased(theirs, merge(theirs, value));
    }

    #rebased(base: Stored<T>, value: T): void {
        const dirty = changedFields(this.#spec.editable, base.data, value);
        this.#set({ ...this.#state, base, value, dirty, conflict: null, gone: false });
    }

    #set(state: DraftState<T>): void {
        const value = state.value;
        const base = state.base;
        const dirty = value === null || base === null ? state.dirty : changedFields(this.#spec.editable, base.data, value);
        this.#state = { ...state, dirty, issues: value === null ? [] : this.#issuesOf(value) };
        this.#deps.changed(this.#state);
    }
}
