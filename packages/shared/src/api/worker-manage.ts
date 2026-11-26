/**
 * W5, household computers (`docs/research/M7-local-worker.md` *Household computers*): `worker.manage`, the admin's list of the city's
 * computers. Its own module: `worker.ts` is read by the imagery chunk, which never manages a computer.
 */
import { z } from 'zod';

import { WORKER_ID_PATTERN } from '../schemas/firestore-ops.js';
import { cityIdSchema } from '../schemas/paths.js';

/** W5 (household computers): what the admin's list of computers may change of one: its name, whether it takes jobs, its free space. */
export const WORKER_MANAGE_ACTIONS = ['rename', 'pause', 'resume', 'remove', 'freeSpace'] as const;
/** The owner's name for a computer (`workerNameSchema` of the worker documents, repeated here: this module stays out of them). */
const nameSchema = z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[^<>\p{Cc}]+$/u);
const manageFields = { cityId: cityIdSchema, workerId: z.string().regex(WORKER_ID_PATTERN) };
/**
 * `worker.manage` (admin): Rename, Pause or Resume a computer of the city, ask it to free space now (`freeSpace`), or Remove it (its worker cleans the computer up at its
 * next claim, with Docker when `docker`, keeping the scanned maps when `keep`, then is disconnected); false when it is unknown or
 * already disconnected.
 */
export const workerManageRequestSchema = z.discriminatedUnion('action', [
    z.strictObject({ ...manageFields, action: z.literal('rename'), name: nameSchema }),
    // Cleanup item 6 (2026-11-14): Free space now: the computer's worker frees what no job needs at its next claim.
    z.strictObject({ ...manageFields, action: z.enum(['pause', 'resume', 'freeSpace']) }),
    z.strictObject({ ...manageFields, action: z.literal('remove'), docker: z.boolean(), keep: z.boolean() }),
]);
export const workerManageResponseSchema = z.strictObject({ changed: z.boolean() });
