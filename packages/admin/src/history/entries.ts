/**
 * History entries as the History page shows them (`docs/research/M2c-interfaces.md` §9.2): which document an entry
 * belongs to, who changed what and when, and the fields of the selected entry before and after the change. The values
 * stay raw here; the page renders them as text (`@hcm/ui/admin`, `history/describe.ts`).
 */
import {
    HISTORY_ENTITIES,
    isId,
    parseAuditedDocumentPath,
    type AuditedDocument,
    type HistoryAction,
    type HistoryEntity,
    type HistoryEntryDoc,
} from '@hcm/shared';

import { isoOf } from '../content/list.js';
import type { ContentQuery, Stored } from '../content/services.js';

/** The actions' filter: every change, or one action (`delete` is the **Deleted** filter, each with Restore). */
type HistoryActionFilter = 'all' | HistoryAction;

type HistoryEntityFilter = HistoryEntity | 'all';

export interface HistoryFilter {
    readonly entity: HistoryEntityFilter;
    readonly action: HistoryActionFilter;
}

/** A document's own name as it was (a title, a label, a city's name), for the list; null when it has none. */
export interface LocalizedName {
    readonly ro: string;
    readonly en?: string;
}

export interface HistoryItem {
    readonly entryId: string;
    /** The entry's own path (`cities/<city>/pois/<id>/history/<entry>`). */
    readonly path: string;
    readonly entity: HistoryEntity;
    readonly entityId: string;
    readonly action: HistoryAction;
    readonly changedFields: readonly string[];
    /** A uid, or a server writer (`system:photos`). */
    readonly by: string;
    readonly at: string;
    readonly revertOf: string | null;
    /** The whole document before the change (none for a creation). */
    readonly previous: Readonly<Record<string, unknown>> | null;
    readonly name: LocalizedName | null;
}

/** One field of the selected entry: its value before the change and after it (undefined: the field was absent). */
export interface FieldChange {
    readonly field: string;
    readonly before: unknown;
    readonly after: unknown;
}

function nameIn(value: unknown): LocalizedName | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }
    const { ro, en } = value as { readonly ro?: unknown; readonly en?: unknown };
    if (typeof ro !== 'string') {
        return null;
    }
    return typeof en === 'string' ? { ro, en } : { ro };
}

/** The name a snapshot carries: a photo's or a place's title, a layer's or a category's label, the city's name. */
export function nameOf(snapshot: Readonly<Record<string, unknown>> | null): LocalizedName | null {
    if (snapshot === null) {
        return null;
    }
    return nameIn(snapshot['title']) ?? nameIn(snapshot['label']) ?? nameIn(snapshot['name']);
}

export function historyItemOf(doc: Stored<HistoryEntryDoc>): HistoryItem {
    const entry = doc.data;
    return {
        ...{
            entryId: doc.id,
            path: doc.path,
            entity: entry.entity,
            entityId: entry.entityId,
            action: entry.action,
            changedFields: entry.changedFields,
        },
        ...{ by: entry.updatedBy, at: isoOf(entry.updatedAt), revertOf: entry.revertOf ?? null },
        ...{ previous: entry.previous, name: nameOf(entry.previous) },
    };
}

/**
 * The city's recent changes: a collection-group query of `history` kept to the city's entries by the `cityId` each
 * entry carries (CR-M2c-14), newest first, with the filters as further equality conditions (the composite indexes at
 * collection-group scope, CR-M2c-6). Other cities' entries never reach the page, so they neither take its rows nor
 * make it offer Show more.
 */
export function recentQuery(cityId: string, filter: HistoryFilter): ContentQuery {
    const where: [string, '==', unknown][] = [['cityId', '==', cityId]];
    if (filter.entity !== 'all') {
        where.push(['entity', '==', filter.entity]);
    }
    if (filter.action !== 'all') {
        where.push(['action', '==', filter.action]);
    }
    return { where, orderBy: [['updatedAt', 'desc']], group: true };
}

/** A document's own entries, newest first. */
export const DOCUMENT_QUERY: ContentQuery = { orderBy: [['updatedAt', 'desc']] };

function isEntity(value: string): value is HistoryEntity {
    return (HISTORY_ENTITIES as readonly string[]).includes(value);
}

/** The audited document `#/history/<entity>/<id>` names, or null when the address names none of the city's. */
export function documentOf(cityId: string, entity: string, entityId: string): AuditedDocument | null {
    if (!isEntity(entity) || !isId(entityId)) {
        return null;
    }
    return entity !== 'city' || entityId === cityId ? { entity, cityId, entityId } : null;
}

/** The audited document an entry's path names (its parent's parent), or null. */
export function documentOfEntryPath(path: string): AuditedDocument | null {
    return parseAuditedDocumentPath(path.split('/').slice(0, -2).join('/')) ?? null;
}

function afterOf(
    entries: readonly HistoryItem[],
    index: number,
    current: Readonly<Record<string, unknown>> | null,
): Readonly<Record<string, unknown>> | null {
    return index === 0 ? current : (entries[index - 1]?.previous ?? null);
}

/** The fields an entry lists; an entry that lists none (an older trigger's) shows every field it knows. */
function fieldsOf(entry: HistoryItem, after: Readonly<Record<string, unknown>> | null): readonly string[] {
    return entry.changedFields.length > 0 ? entry.changedFields : Object.keys(entry.previous ?? after ?? {});
}

/**
 * The fields the entry changed, each before and after the change: before is the entry's `previous`; after is the
 * version the next newer entry kept, or the document as it is now for the newest entry (null when it is deleted).
 */
export function changesOf(
    entries: readonly HistoryItem[],
    index: number,
    current: Readonly<Record<string, unknown>> | null,
): readonly FieldChange[] {
    const entry = entries[index];
    if (entry === undefined) {
        return [];
    }
    const after = entry.action === 'delete' ? null : afterOf(entries, index, current);
    return fieldsOf(entry, after).map((field) => ({ field, before: entry.previous?.[field], after: after?.[field] }));
}

/** A creation has nothing to restore; every other entry can be reverted (a deletion's revert restores the document). */
export function canRevert(item: HistoryItem): boolean {
    return item.action !== 'create';
}
