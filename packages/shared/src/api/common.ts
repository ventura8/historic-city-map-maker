/** Request and response pieces every API module uses (`docs/research/M2-interfaces.md` §3). */
import { z } from 'zod';

import { SERVICE_STATES } from '../schemas/firestore-ops.js';
import { apiErrorCodeSchema, apiErrorParamsSchema } from './errors.js';

/** Responses carry times as ISO 8601 UTC strings: a Firestore Timestamp does not survive a callable's JSON. */
export const isoTimeSchema = z.iso.datetime();

/** The request of a callable that takes no input. */
export const emptyRequestSchema = z.strictObject({});

/**
 * A Google OAuth 2.0 access token the admin has just granted in the sign-in popup (`ya29.…`). The server checks it
 * with Google, uses it for the one call it was granted for, and never stores or logs it (the logger redacts any key
 * containing `token`).
 */
export const googleAccessTokenSchema = z
    .string()
    .min(20)
    .max(4096)
    .regex(/^[\w.~+/-]+=*$/);

/** How a `setup/status` area reads in a response: its state, when it was last checked, and why (an error code). */
export const healthViewFields = {
    state: z.enum(SERVICE_STATES),
    checkedAt: isoTimeSchema.nullable(),
    detail: apiErrorCodeSchema.optional(),
    params: apiErrorParamsSchema.optional(),
};
