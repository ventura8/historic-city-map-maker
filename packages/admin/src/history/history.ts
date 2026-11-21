/**
 * The history area (`docs/research/M2c-interfaces.md` §9.2; behaviour A23). `#/history` lists the city's recent changes
 * newest first (a collection-group query of the city's `history` entries, by their `cityId`, filtered by entity and by
 * action; the **Deleted** filter lists deleted documents, each with Restore); `#/history/<entity>/<id>` lists one
 * document's versions with the selected entry's fields before and after. **Revert** (and Restore) calls `history.revert`; a refusal is kept as an alert and
 * changes nothing. Who made a change is named from `admins.list` (read once), "you", or the server's own writers. A
 * creation is named as its document was made (`names.ts`), never by its id while the document has a title.
 */
import {
    auditedDocumentPath,
    FIRESTORE_PATHS,
    historyEntryDocSchema,
    type AuditedDocument,
    type HistoryEntryDoc,
    type RevertResponse,
} from '@hcm/shared';
import { z } from 'zod';

import { outcomeOf } from '../app/services.js';
import type { AreaModule, AreaStore } from '../content/areas.js';
import { LiveDoc, LOADING_DOC, type DocState } from '../content/doc.js';
import { LiveList, LOADING_LIST, type ListState } from '../content/list.js';
import type { ContentServices } from '../content/services.js';
import type { NoticeInput } from '../state/state.js';
import { Store } from '../state/store.js';
import {
    changesOf,
    DOCUMENT_QUERY,
    documentOf,
    historyItemOf,
    recentQuery,
    type FieldChange,
    type HistoryFilter,
    type HistoryItem,
} from './entries.js';
import { CreatedNames } from './names.js';

/** Any audited document as it is now: shown as text field by field, never validated as one entity. */
const currentDocumentSchema = z.record(z.string(), z.unknown());

type CurrentDocument = Readonly<Record<string, unknown>>;

export interface HistoryDocumentView {
    /** The route's `<entity>/<id>`, as typed. */
    readonly key: string;
    /** Null when the address names no document of the city (not found at once). */
    readonly document: AuditedDocument | null;
    /** The document now (`doc` null: deleted, or never existed). */
    readonly current: DocState<CurrentDocument>;
    readonly entries: ListState<HistoryItem>;
}

export interface HistoryState {
    readonly filter: HistoryFilter;
    /** `#/history`: the city's recent changes. */
    readonly recent: ListState<HistoryItem>;
    /** `#/history/<entity>/<id>`, or null on the recent changes. */
    readonly document: HistoryDocumentView | null;
    /** The entry whose changes show (page state: kept over a language switch, not a reload); null: the newest. */
    readonly selected: string | null;
    /** The shown entry's fields before and after (`#/history/<entity>/<id>` only). */
    readonly changes: readonly FieldChange[];
    /** The entry being reverted. */
    readonly reverting: string | null;
    /** The last refused revert, shown as an alert until the next action. */
    readonly refusal: NoticeInput | null;
    /** Admins' names by uid (`admins.list`), for "who". */
    readonly people: Readonly<Record<string, string>>;
}

export interface HistoryIntents {
    setFilter(filter: Partial<HistoryFilter>): void;
    more(): void;
    retry(): void;
    select(entryId: string | null): void;
    /** Reverts (or, for a deletion, restores) the entry's document; resolves true when the server restored it. */
    revert(item: HistoryItem): Promise<boolean>;
    dismissRefusal(): void;
}

const INITIAL: HistoryState = {
    filter: { entity: 'all', action: 'all' },
    recent: LOADING_LIST,
    document: null,
    selected: null,
    changes: [],
    reverting: null,
    refusal: null,
    people: {},
};

/** A document's view before its listeners answer; an address that names no document is not found at once. */
function viewOf(key: string, document: AuditedDocument | null): HistoryDocumentView {
    return document === null
        ? { key, document, current: NOT_FOUND_DOC, entries: NO_ENTRIES }
        : { key, document, current: LOADING_DOC, entries: LOADING_LIST };
}

/** The changes of the selected entry (the newest without a selection) of a document's view. */
export function changesFor(view: HistoryDocumentView | null, selected: string | null): readonly FieldChange[] {
    if (view === null) {
        return [];
    }
    const entries = view.entries.items;
    const index = Math.max(
        0,
        entries.findIndex((entry) => entry.entryId === selected),
    );
    return changesOf(entries, index, view.current.doc?.data ?? null);
}

const NOT_FOUND_DOC: DocState<never> = { ...LOADING_DOC, status: 'ready' };
const NO_ENTRIES: ListState<never> = { ...LOADING_LIST, status: 'ready' };

class HistoryStore implements AreaStore<HistoryState, HistoryIntents> {
    readonly #services: ContentServices;
    readonly #cell: Store<HistoryState>;
    readonly #recent: LiveList<HistoryEntryDoc, HistoryItem>;
    readonly #current: LiveDoc<CurrentDocument>;
    readonly #entries: LiveList<HistoryEntryDoc, HistoryItem>;
    /** The recent changes' creations, named as their documents were made (finding 38 of 2026-11-01). */
    readonly #names: CreatedNames;
    #peopleAsked = false;
    readonly intents: HistoryIntents;

    constructor(services: ContentServices) {
        this.#services = services;
        this.#cell = new Store<HistoryState>(INITIAL, services.log);
        const { store, clock } = services;
        const denied = (): void => {
            services.denied();
        };
        const common = { store, clock, denied, schema: historyEntryDocSchema, map: historyItemOf };
        this.#names = new CreatedNames(store, services.cityId, () => {
            this.#recentChanged(this.#recent.list);
        });
        this.#recent = new LiveList({
            ...common,
            collection: 'history',
            changed: (recent) => {
                this.#recentChanged(recent);
            },
        });
        const changed = (): void => {
            this.#documentChanged();
        };
        this.#current = new LiveDoc({ store, clock, denied, schema: currentDocumentSchema, changed });
        this.#entries = new LiveList({ ...common, collection: '', changed });
        this.intents = this.#intents();
    }

    get state(): HistoryState {
        return this.#cell.state;
    }

    subscribe(listener: (state: HistoryState) => void): () => void {
        return this.#cell.subscribe(listener);
    }

    open(params: readonly string[]): void {
        void this.#askPeople();
        const [entity, id] = params;
        if (entity === undefined || id === undefined) {
            this.#showRecent();
            return;
        }
        this.#showDocument(entity, id);
    }

    /** The recent changes, each creation named by the version it made. */
    #recentChanged(recent: ListState<HistoryItem>): void {
        this.#cell.update({ recent: { ...recent, items: this.#names.named(recent.items) } });
    }

    close(): void {
        this.#names.stop();
        this.#recent.stop();
        this.#stopDocument();
        this.#cell.update({ document: null });
    }

    hasUnsavedChanges(): boolean {
        return false;
    }

    destroy(): void {
        this.close();
    }

    #intents(): HistoryIntents {
        return {
            setFilter: (filter) => {
                this.#setFilter(filter);
            },
            more: () => {
                this.#more();
            },
            retry: () => {
                this.#retry();
            },
            select: (selected) => {
                this.#cell.update({ selected, refusal: null, changes: changesFor(this.#cell.state.document, selected) });
            },
            revert: (item) => this.#revert(item),
            dismissRefusal: () => {
                this.#cell.update({ refusal: null });
            },
        };
    }

    #showRecent(): void {
        this.#stopDocument();
        this.#cell.update({ document: null, changes: [] });
        if (!this.#recent.active) {
            this.#recent.show(recentQuery(this.#services.cityId, this.#cell.state.filter));
        }
    }

    #showDocument(entity: string, id: string): void {
        const key = `${entity}/${id}`;
        if (this.#cell.state.document?.key === key) {
            return;
        }
        this.#recent.stop();
        this.#stopDocument();
        const document = documentOf(this.#services.cityId, entity, id);
        this.#cell.update({ document: viewOf(key, document), changes: [], refusal: null });
        if (document !== null) {
            this.#current.show(auditedDocumentPath(document));
            this.#entries.showIn(FIRESTORE_PATHS.history(document), DOCUMENT_QUERY);
        }
    }

    #stopDocument(): void {
        this.#current.stop();
        this.#entries.stop();
    }

    #documentChanged(): void {
        const view = this.#cell.state.document;
        if (view !== null) {
            const document = { ...view, current: this.#current.state, entries: this.#entries.list };
            this.#cell.update({ document, changes: changesFor(document, this.#cell.state.selected) });
        }
    }

    #setFilter(filter: Partial<HistoryFilter>): void {
        const next = { ...this.#cell.state.filter, ...filter };
        this.#cell.update({ filter: next, selected: null });
        this.#recent.show(recentQuery(this.#services.cityId, next));
    }

    #more(): void {
        if (this.#cell.state.document === null) {
            this.#recent.more();
            return;
        }
        this.#entries.more();
    }

    #retry(): void {
        if (this.#cell.state.document === null) {
            this.#recent.retry();
            return;
        }
        this.#current.retry();
        this.#entries.retry();
    }

    async #askPeople(): Promise<void> {
        if (this.#peopleAsked) {
            return;
        }
        this.#peopleAsked = true;
        const outcome = await outcomeOf(() => this.#services.callables.call('admins.list', { cityId: this.#services.cityId }));
        if (outcome.ok) {
            const people = Object.fromEntries(outcome.value.admins.map((admin) => [admin.uid, admin.displayName ?? admin.email ?? '']));
            this.#cell.update({ people: Object.fromEntries(Object.entries(people).filter(([, name]) => name !== '')) });
        }
    }

    async #revert(item: HistoryItem): Promise<boolean> {
        if (this.#cell.state.reverting !== null) {
            return false;
        }
        this.#cell.update({ reverting: item.entryId, refusal: null });
        const request = { cityId: this.#services.cityId, entity: item.entity, entityId: item.entityId, entryId: item.entryId };
        const outcome = await outcomeOf<RevertResponse>(() => this.#services.callables.call('history.revert', request));
        this.#cell.update({ reverting: null, refusal: outcome.ok ? null : outcome.error });
        if (outcome.ok) {
            const key = item.action === 'delete' ? 'adminContent.history.restored' : 'adminContent.history.reverted';
            this.#services.notify({ key, params: { count: String(outcome.value.restoredFields.length) } });
        }
        return outcome.ok;
    }
}

export const HISTORY_MODULE: AreaModule<HistoryState, HistoryIntents> = {
    area: 'history',
    create: (services) => new HistoryStore(services),
};
