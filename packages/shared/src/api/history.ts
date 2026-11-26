/**
 * Audited edits (PLAN Addendum 3; `docs/research/M2-interfaces.md` §3.2; scenario A23). The `history.onWrite`
 * triggers keep the previous version of every audited document in its `history` subcollection; admins read it with
 * the Firestore SDK and restore one version with the `history.revert` callable.
 */
import { z } from 'zod';

import { HISTORY_ENTITIES } from '../schemas/firestore.js';
import { cityIdSchema } from '../schemas/paths.js';
import { coded, idSchema } from '../schemas/primitives.js';

/** History entries kept per document: the trigger deletes the oldest beyond this. */
export const HISTORY_KEEP = 50;

/** `<13-digit epoch milliseconds>-<event id>`: ids sort by time, and a redelivered event writes the same entry. */
export const historyEntryIdSchema = z.string().regex(/^\d{13}-[A-Za-z0-9_-]{1,64}$/);

const MAX_EVENT_ID = 64;

/** The id of the entry a trigger writes for the change `eventId` made at `at`. */
export function historyEntryId(at: Date, eventId: string): string {
    const safe = eventId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, MAX_EVENT_ID);
    return `${String(at.getTime()).padStart(13, '0')}-${safe === '' ? '_' : safe}`;
}

/** `history.revert`: restore the `previous` version an entry recorded (validated again with the entity's schema). */
export const revertRequestSchema = z
    .strictObject({
        cityId: cityIdSchema,
        entity: z.enum(HISTORY_ENTITIES),
        entityId: idSchema,
        entryId: historyEntryIdSchema,
    })
    .refine((request) => request.entity !== 'city' || request.entityId === request.cityId, coded('validation.reference', ['entityId']));

export const revertResponseSchema = z.strictObject({
    /** The fields that differed from the current version and were restored. */
    restoredFields: z.array(z.string().min(1).max(64)).max(100),
});

export type RevertRequest = z.infer<typeof revertRequestSchema>;
export type RevertResponse = z.infer<typeof revertResponseSchema>;
