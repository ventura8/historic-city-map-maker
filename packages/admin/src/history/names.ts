/**
 * The name of a created document in History's recent changes (the live manual test of 2026-11-01, finding 38: creations
 * read "Place W1DLFHuhMZpHW6UzReWl" while the changes beside them read "AreaOne"). A creation entry stores no version
 * (`previous` is null), so its name comes from the version the creation made: the `previous` of the next entry of the
 * same document when the list holds one (it is that version exactly), else the document as it is now, read once per
 * document. A document that is gone, or a version without a title, label or name, keeps the kind and the id.
 */
import { auditedDocumentPath } from '@hcm/shared';
import { z } from 'zod';

import type { ContentStore } from '../content/services.js';
import { nameOf, type HistoryItem, type LocalizedName } from './entries.js';

/** Any audited document: only its title, label or name is read. */
const ANY_DOCUMENT = z.record(z.string(), z.unknown());

function sameDocument(a: HistoryItem, b: HistoryItem): boolean {
    return a.entity === b.entity && a.entityId === b.entityId;
}

/** A creation the entry itself cannot name. */
function unnamedCreation(item: HistoryItem): boolean {
    return item.action === 'create' && item.name === null;
}

/** The name of the version right after `items[index]`: the nearest newer entry's `previous` (the list is newest first). */
function newerName(items: readonly HistoryItem[], index: number, item: HistoryItem): LocalizedName | null {
    const newer = items.slice(0, index).findLast((candidate) => sameDocument(candidate, item));
    return newer === undefined ? null : nameOf(newer.previous);
}

/**
 * Names History's creation entries as their documents were made. Each document still to name is read once (its listener
 * stops at the first answer); `changed` asks the page to draw the names that arrived.
 */
export class CreatedNames {
    readonly #store: Pick<ContentStore, 'watchDoc'>;
    readonly #cityId: string;
    readonly #changed: () => void;
    /** A document's name now, by its path (null: gone or unnamed); absent while being read. */
    readonly #now = new Map<string, LocalizedName | null>();
    readonly #reading = new Map<string, () => void>();

    constructor(store: Pick<ContentStore, 'watchDoc'>, cityId: string, changed: () => void) {
        this.#store = store;
        this.#cityId = cityId;
        this.#changed = changed;
    }

    /** `items` with every creation named as its document was made (or as it is now), reading what is still unknown. */
    named(items: readonly HistoryItem[]): HistoryItem[] {
        return items.map((item, index) => (unnamedCreation(item) ? { ...item, name: this.#nameOf(items, index, item) } : item));
    }

    #nameOf(items: readonly HistoryItem[], index: number, item: HistoryItem): LocalizedName | null {
        const newer = newerName(items, index, item);
        if (newer !== null) {
            return newer;
        }
        const path = auditedDocumentPath({ entity: item.entity, cityId: this.#cityId, entityId: item.entityId });
        if (!this.#now.has(path)) {
            this.#read(path);
        }
        return this.#now.get(path) ?? null;
    }

    #read(path: string): void {
        if (this.#reading.has(path)) {
            return;
        }
        const answer = (name: LocalizedName | null): void => {
            this.#now.set(path, name);
            this.#stopReading(path);
            this.#changed();
        };
        this.#reading.set(path, () => undefined);
        const stop = this.#store.watchDoc(
            path,
            ANY_DOCUMENT,
            (doc) => {
                answer(nameOf(doc?.data ?? null));
            },
            () => {
                answer(null);
            },
        );
        if (this.#now.has(path)) {
            stop();
        } else {
            this.#reading.set(path, stop);
        }
    }

    #stopReading(path: string): void {
        this.#reading.get(path)?.();
        this.#reading.delete(path);
    }

    /** Stops every read still waiting (the page closed); what was read is kept. */
    stop(): void {
        for (const path of [...this.#reading.keys()]) {
            this.#stopReading(path);
        }
    }
}
