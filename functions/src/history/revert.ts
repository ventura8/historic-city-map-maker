import '../global-options.js';

import {
    CLIENT_WRITES,
    FIRESTORE_PATHS,
    auditedDocumentPath,
    cityDocSchema,
    historyEntryDocSchema,
    hasPlaceYear,
    historyEntryId,
    isStaffRole,
    layerDocSchema,
    photoDocSchema,
    poiCategoryDocSchema,
    poiDocSchema,
    storyDocSchema,
    timestampFromDate,
    validate,
    type AuditedDocument,
    type CallableRequest,
    type CallableResponse,
    type HistoryEntity,
    type HistoryEntryDoc,
    type Schema,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { changedKeys, type Fields } from './diff.js';
import { cancelLayerDeletes, reprocessIfSwept, requireLayerTiles, waitingLayerDeletes, type RestoreDeps } from './restore.js';

export type RevertDeps = Pick<Ports, 'documents' | 'clock' | 'log'> & RestoreDeps;

/** Each audited entity's document schema: a restored version must pass today's schema before it is written. */
const SCHEMAS: Readonly<Record<HistoryEntity, Schema<Fields>>> = {
    city: cityDocSchema,
    layer: layerDocSchema,
    photo: photoDocSchema,
    poi: poiDocSchema,
    poiCategory: poiCategoryDocSchema,
    story: storyDocSchema,
};

const STAMP_FIELDS: ReadonlySet<string> = new Set(['updatedBy', 'updatedAt']);

interface Revert {
    readonly audited: AuditedDocument;
    readonly entryId: string;
    readonly caller: VerifiedCaller;
    readonly now: Date;
    /** A restored layer's `layer-delete` jobs still waiting, cancelled with the restore (CR-M2c-5). */
    readonly cancel: readonly string[];
}

/** The version an entry kept: a missing entry → `history.notFound`, a create's entry (nothing before it) → `nothingToRestore`. */
function previousOf(entry: HistoryEntryDoc | undefined): Fields {
    if (entry === undefined) {
        throw new ApiError('apiError.history.notFound');
    }
    if (entry.previous === null) {
        throw new ApiError('apiError.history.nothingToRestore');
    }
    return entry.previous;
}

/**
 * The client-editable fields (`CLIENT_WRITES[entity].update`) come from the kept version; every server-owned field
 * keeps its current value (a revert never resurrects a rotated token or a replaced image), or the kept version's when
 * the document was deleted; the stamp is the caller's.
 */
function restoredVersion(revert: Revert, previous: Fields, current: Fields | undefined): Fields {
    const editable: ReadonlySet<string> = new Set(CLIENT_WRITES[revert.audited.entity].update);
    const serverOwned = Object.entries(current ?? previous).filter(([key]) => !editable.has(key));
    const restored = Object.entries(previous).filter(([key]) => editable.has(key));
    return {
        ...Object.fromEntries(serverOwned),
        ...Object.fromEntries(restored),
        updatedBy: revert.caller.uid,
        updatedAt: timestampFromDate(revert.now),
    };
}

function checkedVersion(entity: HistoryEntity, version: Fields): Fields {
    const result = validate(SCHEMAS[entity], version);
    if (!result.ok) {
        throw new ApiError('apiError.history.invalidSnapshot', { count: String(result.issues.length) });
    }
    return result.value;
}

/**
 * A place that names a year keeps one (the owner's request of 2026-11-12; `firestore.rules` → `datedOrOnlyFiled`): a
 * version without a year is not restored over a dated place (`history.placeYear`). An Undo of a delete, or a place that
 * never had a year, restores as before.
 */
function requireKeptYear(entity: HistoryEntity, current: Fields | undefined, restored: Fields): void {
    if (entity === 'poi' && current !== undefined && hasPlaceYear(current) && !hasPlaceYear(restored)) {
        throw new ApiError('apiError.history.placeYear');
    }
}

/** The entry `history.revert` writes with the version: the history triggers skip the write it describes. */
function revertEntry(revert: Revert, current: Fields | undefined, restored: Fields): HistoryEntryDoc {
    return {
        cityId: revert.audited.cityId,
        entity: revert.audited.entity,
        entityId: revert.audited.entityId,
        action: 'revert',
        previous: current ?? null,
        changedFields: changedKeys(current ?? {}, restored),
        revertOf: revert.entryId,
        updatedBy: revert.caller.uid,
        updatedAt: timestampFromDate(revert.now),
    };
}

/** Reads the entry and the current version, writes the restored version and its `revert` entry; all or nothing. */
async function restore(transaction: DocumentTransaction, revert: Revert): Promise<string[]> {
    const { audited } = revert;
    const previous = previousOf(await transaction.get(FIRESTORE_PATHS.historyEntry(audited, revert.entryId), historyEntryDocSchema));
    const path = auditedDocumentPath(audited);
    const current = await transaction.get(path, SCHEMAS[audited.entity]);
    const restored = checkedVersion(audited.entity, restoredVersion(revert, previous, current));
    requireKeptYear(audited.entity, current, restored);
    const entryId = historyEntryId(revert.now, `revert-${revert.caller.uid}`);
    await cancelLayerDeletes(transaction, current === undefined ? revert.cancel : [], revert);
    await transaction.set(path, SCHEMAS[audited.entity], restored);
    await transaction.set(FIRESTORE_PATHS.historyEntry(audited, entryId), historyEntryDocSchema, revertEntry(revert, current, restored));
    return changedKeys(current ?? {}, restored).filter((key) => !STAMP_FIELDS.has(key));
}

/** Whether the audited document is gone now (a revert would bring a deleted document back). */
async function isDeleted(deps: RevertDeps, audited: AuditedDocument): Promise<boolean> {
    return (await deps.documents.get(auditedDocumentPath(audited), SCHEMAS[audited.entity])) === undefined;
}

/** The entities a moderator may revert (M13 §1; M17 §2 adds the story). */
const REVIEWED_ENTITIES: ReadonlySet<HistoryEntity> = new Set(['photo', 'poi', 'story']);

/** M13 §1: a moderator reverts a photo, a place or a story, and never a city's settings, a layer or a category. */
function requireEntityRight(caller: VerifiedCaller, data: CallableRequest<'history.revert'>): void {
    const staff = isStaffRole(caller.membership?.roleIn(data.cityId));
    if (!staff && !REVIEWED_ENTITIES.has(data.entity)) {
        throw new ApiError('apiError.city.notEditor', { cityId: data.cityId });
    }
}

/**
 * `history.revert` (admins; S-A23-HAPPY, S-A23-BAD-INVALID-SNAPSHOT, S-A23-BAD-CREATION-ENTRY): restores the version
 * one history entry kept. A version today's schema refuses is not written (`history.invalidSnapshot` with the number
 * of problems), nor a place's version without a year over a dated place (`history.placeYear`); the publish triggers
 * rebuild the manifest as for any edit. A deleted layer comes back only while its tileset exists (its waiting
 * `layer-delete` job is cancelled, a finished one answers `history.layerGone`); a deleted
 * photo whose public files were swept meanwhile is processed again from its original (CR-M2c-5).
 */
async function historyRevert(
    deps: RevertDeps,
    caller: VerifiedCaller,
    data: CallableRequest<'history.revert'>,
): Promise<CallableResponse<'history.revert'>> {
    requireEntityRight(caller, data);
    const audited: AuditedDocument = { entity: data.entity, cityId: data.cityId, entityId: data.entityId };
    const deleted = await isDeleted(deps, audited);
    const cancel = deleted ? await waitingLayerDeletes(deps, audited) : [];
    if (deleted) {
        await requireLayerTiles(deps, audited, data.entryId);
    }
    const revert: Revert = { audited, entryId: data.entryId, caller, now: deps.clock.now(), cancel };
    const restoredFields = await deps.documents.transaction((transaction) => restore(transaction, revert));
    if (deleted) {
        await reprocessIfSwept(deps, caller, audited);
    }
    deps.log.info('history reverted', { uid: caller.uid, entity: data.entity, entityId: data.entityId, entryId: data.entryId });
    return { restoredFields };
}

/** The `history-revert` callable. */
export function revertFunction(getDeps: () => RevertDeps & CallableDeps) {
    return defineCallable('history.revert', historyRevert, getDeps);
}
