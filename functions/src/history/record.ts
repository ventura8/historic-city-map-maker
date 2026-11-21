import { runAs } from '../global-options.js';

import {
    BACKGROUND_FUNCTIONS,
    FIRESTORE_PATHS,
    HISTORY_KEEP,
    historyEntryDocSchema,
    historyEntryId,
    parseAuditedDocumentPath,
    timestampFromDate,
    timestampToDate,
    type AuditedDocument,
    type HistoryAction,
    type HistoryEntryDoc,
    type TimestampLike,
} from '@hcm/shared';
import { onDocumentWrittenWithAuthContext } from 'firebase-functions/firestore';

import type { Ports } from '../ports/index.js';
import { emitNotification } from '../api/notification-event.js';
import { changedKeys, isTimestampLike, sameValue, type Fields } from './diff.js';

export type RecordDeps = Pick<Ports, 'documents' | 'log' | 'clock'>;

/** One write of an audited document, as the trigger hands it to {@link recordHistory}. */
export interface DocumentChange {
    /** The document's path (`cities/bucharest/pois/p1`). */
    readonly document: string;
    /** The version before the write; undefined for a create. */
    readonly before: Fields | undefined;
    /** The version after the write; undefined for a delete. */
    readonly after: Fields | undefined;
    readonly eventId: string;
    /** When Firestore committed the write (the event's `time`). */
    readonly time: Date;
    /** The writing principal (`authType`, `authId` of `onDocumentWrittenWithAuthContext`). */
    readonly authType: string;
    readonly authId: string | undefined;
}

/** What {@link recordHistory} did: wrote an entry, skipped `history.revert`'s own write, or met a path it does not audit. */
export type HistoryOutcome = 'recorded' | 'skipped' | 'ignored';

/** How many entries beyond `HISTORY_KEEP` one trigger reads (and trims) at most. */
const TRIM_BATCH = 10;

/**
 * The newest entries come first by their stamp's time. Not by document id, although ids sort by time too: the
 * Firestore emulator refuses descending key scans (`FAILED_PRECONDITION`), so a `__name__ desc` query cannot be tested.
 */
const NEWEST_FIRST = ['updatedAt', 'desc'] as const;

/** `updatedBy` is a uid or a writer identity of at most 128 characters (`uidSchema`). */
const MAX_WRITER = 128;

interface Stamp {
    readonly updatedBy: string;
    readonly updatedAt: TimestampLike;
}

interface ListedEntry {
    readonly id: string;
    readonly path: string;
}

function actionOf(change: DocumentChange): HistoryAction | undefined {
    if (change.before === undefined) {
        return change.after === undefined ? undefined : 'create';
    }
    return change.after === undefined ? 'delete' : 'update';
}

/**
 * Server records that are no version of the document an editor would restore: the city's tab icon (its files are
 * replaced in place; a revert keeps the current one anyway, being server-owned). A write that changes only these is
 * not listed.
 */
const UNLISTED_FIELDS: ReadonlySet<string> = new Set(['icon']);

function unlisted(change: DocumentChange): boolean {
    if (change.before === undefined || change.after === undefined) {
        return false;
    }
    const changed = changedKeys(change.before, change.after);
    return changed.length > 0 && changed.every((key) => UNLISTED_FIELDS.has(key));
}

function isWriter(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_WRITER;
}

/** The stamp the written version carries (the rules make a client stamp its uid and the server time). */
function writtenStamp(after: Fields): Stamp | undefined {
    const { updatedBy, updatedAt } = after;
    return isWriter(updatedBy) && isTimestampLike(updatedAt) ? { updatedBy, updatedAt } : undefined;
}

/**
 * When a delete is recorded: its commit time, never before the version it deleted (a millisecond after that one's
 * stamp). The Firestore emulator's event times have whole seconds, so a delete in the second of the last write sorted
 * before it, and the delete's Undo, which looks for the newest entry, did not find it (`docs/LESSONS.md` 121).
 */
function deletedAt(change: DocumentChange): Date {
    const last = change.before?.['updatedAt'];
    const after = isTimestampLike(last) ? timestampToDate(last).getTime() + 1 : 0;
    return new Date(Math.max(change.time.getTime(), after));
}

/** A delete carries no stamp: the event's principal (`authId`, else `system:<authType>`) and its commit time. */
function principalStamp(change: DocumentChange): Stamp {
    const updatedBy = isWriter(change.authId) ? change.authId : `system:${change.authType}`;
    return { updatedBy: updatedBy.slice(0, MAX_WRITER), updatedAt: timestampFromDate(deletedAt(change)) };
}

function stampOf(change: DocumentChange): Stamp {
    return (change.after === undefined ? undefined : writtenStamp(change.after)) ?? principalStamp(change);
}

/**
 * `history.revert` wrote this version and its own `revert` entry, stamped with the same instant, already: recording
 * the write again would duplicate it. Any listed `revert` entry counts, not only the newest, so an edit recorded in
 * between (triggers run in any order) never makes the revert's write look like an edit.
 */
function isRevertWrite(change: DocumentChange, listed: readonly { data: HistoryEntryDoc }[], stamp: Stamp): boolean {
    return change.after !== undefined && listed.some(({ data }) => data.action === 'revert' && sameValue(data.updatedAt, stamp.updatedAt));
}

function entryOf(audited: AuditedDocument, action: HistoryAction, change: DocumentChange, stamp: Stamp): HistoryEntryDoc {
    return {
        cityId: audited.cityId,
        entity: audited.entity,
        entityId: audited.entityId,
        action,
        previous: change.before ?? null,
        changedFields: changedKeys(change.before ?? {}, change.after ?? {}),
        ...stamp,
    };
}

/** The entries beyond the newest `HISTORY_KEEP` by id (ids sort by time), the one just written included. */
function stalePaths(listed: readonly ListedEntry[], written: ListedEntry): string[] {
    return [written, ...listed.filter((entry) => entry.id !== written.id)]
        .sort((a, b) => b.id.localeCompare(a.id))
        .slice(HISTORY_KEEP)
        .map((entry) => entry.path);
}

/** M13 §7: a new item an uploader added waits: the city's reviewers hear of it once (the event's id is the item's). */
async function tellReviewers(deps: RecordDeps, audited: AuditedDocument, change: DocumentChange): Promise<void> {
    if (change.before !== undefined || change.after?.['reviewStatus'] !== 'pending') {
        return;
    }
    await emitNotification(deps, 'history', {
        kind: 'review.waiting',
        parts: [audited.cityId, audited.entityId],
        link: '#/review',
        cityId: audited.cityId,
    });
}

/**
 * The `history.on*Write` handler (PLAN Addendum 3; `docs/research/M2-interfaces.md` §2.2; S-A23-*): one entry per
 * change in the document's `history` subcollection, id `historyEntryId(time, eventId)` (a redelivered event writes
 * the same entry), `cityId` = the document's city (the admin's recent changes ask one city's entries, CR-M2c-14),
 * `previous` = the whole version before the change (none for a create), `changedFields` = the
 * top-level keys that differ, the stamp = the change's own. A write `history.revert` made (a `revert` entry with the
 * same `updatedAt` is listed) is skipped, as is one that changes only the city's tab icon (`UNLISTED_FIELDS`);
 * afterwards the entries beyond `HISTORY_KEEP` are deleted.
 */
export async function recordHistory(deps: RecordDeps, change: DocumentChange): Promise<HistoryOutcome> {
    const audited = parseAuditedDocumentPath(change.document);
    const action = actionOf(change);
    if (audited === undefined || action === undefined) {
        deps.log.warn('history: not an audited write', { document: change.document });
        return 'ignored';
    }
    if (unlisted(change)) {
        return 'skipped';
    }
    const history = FIRESTORE_PATHS.history(audited);
    const listed = await deps.documents.query(history, historyEntryDocSchema, { orderBy: NEWEST_FIRST, limit: HISTORY_KEEP + TRIM_BATCH });
    const stamp = stampOf(change);
    if (isRevertWrite(change, listed.documents, stamp)) {
        return 'skipped';
    }
    const id = historyEntryId(change.time, change.eventId);
    const path = FIRESTORE_PATHS.historyEntry(audited, id);
    await deps.documents.set(path, historyEntryDocSchema, entryOf(audited, action, change, stamp));
    const stale = stalePaths([...listed.documents, ...listed.invalid], { id, path });
    await Promise.all(stale.map((entry) => deps.documents.delete(entry)));
    await tellReviewers(deps, audited, change);
    return 'recorded';
}

/** The fields of a v2 Firestore write event with auth context that the trigger reads. */
interface WriteEvent {
    readonly id: string;
    readonly time: string;
    readonly document: string;
    readonly authType: string;
    readonly authId?: string;
    readonly data?: { readonly before: Snapshot; readonly after: Snapshot } | undefined;
}

interface Snapshot {
    readonly exists: boolean;
    data(): Fields | undefined;
}

function fieldsOf(snapshot: Snapshot | undefined): Fields | undefined {
    return snapshot?.exists === true ? snapshot.data() : undefined;
}

function changeOf(event: WriteEvent): DocumentChange {
    return {
        document: event.document,
        before: fieldsOf(event.data?.before),
        after: fieldsOf(event.data?.after),
        eventId: event.id,
        time: new Date(event.time),
        authType: event.authType,
        authId: event.authId,
    };
}

export type HistoryTrigger =
    | 'history.onCityWrite'
    | 'history.onLayerWrite'
    | 'history.onPhotoWrite'
    | 'history.onPoiWrite'
    | 'history.onPoiCategoryWrite'
    | 'history.onStoryWrite';

/** The `onDocumentWrittenWithAuthContext` trigger `name` of the registry (`BACKGROUND_FUNCTIONS[name].source`). */
export function historyTrigger(name: HistoryTrigger, getDeps: () => RecordDeps) {
    return onDocumentWrittenWithAuthContext({ document: BACKGROUND_FUNCTIONS[name].source, ...runAs(name) }, (event) =>
        recordHistory(getDeps(), changeOf(event)),
    );
}
