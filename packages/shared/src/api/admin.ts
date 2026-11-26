/**
 * Who administers a map (`docs/research/M2-interfaces.md` §3.1; scenarios A01, A02, A20). Callables of a signed-in,
 * verified Google account that is not necessarily an admin yet: `admin.session`, `admin.claim` (the project owner
 * becomes the map's owner, proved with Google's IAM and the owner's own OAuth token, so no e-mail address is ever
 * configured or committed), `admin.join` (an invited account becomes an admin). Admin-only: `admins.invite`,
 * `admins.revoke`, `admins.list` (their M5 requests, one city each, are in `cities.ts`).
 */
import { z } from 'zod';

import { sha256Schema } from '../schemas/firestore-common.js';
import { ADMIN_ROLES } from '../schemas/firestore-ops.js';
import { httpsUrlSchema } from '../schemas/primitives.js';
import { sessionCitiesSchema } from './cities.js';
import { emptyRequestSchema, googleAccessTokenSchema, isoTimeSchema } from './common.js';

/** The OAuth scope the claim popup asks for (incremental consent, read-only): enough for `testIamPermissions`. */
export const CLAIM_OAUTH_SCOPE = 'https://www.googleapis.com/auth/cloud-platform.read-only';

/**
 * The permission that proves ownership: only Owners (and IAM admins, who could make themselves owners) may set a
 * project's IAM policy. Checked with `projects.testIamPermissions` of Resource Manager v3 and the caller's token.
 */
export const OWNER_PERMISSION = 'resourcemanager.projects.setIamPolicy';

/** An invitation expires after this many days (`ops.tick` deletes it). */
export const INVITE_TTL_DAYS = 14;

/** The form an e-mail address is hashed in: trimmed, lower case. */
export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

/** `invites/{id}`: the lowercase hex SHA-256 of the normalized address (Web Crypto: browsers and Node alike). */
export async function inviteIdFor(email: string): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeEmail(email)));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const roleSchema = z.enum(ADMIN_ROLES);

/** `admin.session`: what the admin app shows after Google sign-in (any verified Google account may ask). */
export const sessionRequestSchema = emptyRequestSchema;
export const sessionResponseSchema = z.strictObject({
    /** `admins/{uid}` exists. */
    admin: z.boolean(),
    role: roleSchema.nullable(),
    /** The caller's ID token carries `admin: true`. */
    claim: z.boolean(),
    /** Document and claim disagree: refresh the ID token (`getIdToken(true)`) and ask again (S-A01-BAD-CLAIM-DELAY). */
    refreshToken: z.boolean(),
    /** False only before the first `admin.claim`: the app then offers "I own this Google Cloud project". */
    ownerClaimed: z.boolean(),
    /** An invitation for the caller's address waits: the app offers "Join". */
    invitePending: z.boolean(),
    /**
     * M5 (`docs/research/M5-interfaces.md` §1.3, §1.5): the caller's cities with their role and name, for the switcher
     * (none for a non-admin), and whether the caller is the project's owner (who creates cities and sets their budgets).
     */
    // Finding 27 of docs/research/manual-test-2026-10-25.md (live test 2026-10-31): a server from before M5 answers without them; the admin reads
    // it as no city and not the project's owner (Setup still opens for its owner role, and Update the map replaces it).
    cities: sessionCitiesSchema.default([]),
    projectOwner: z.boolean().default(false),
});

/** `admin.claim`: the project owner's token, granted with `CLAIM_OAUTH_SCOPE` in the sign-in popup. */
export const claimRequestSchema = z.strictObject({ googleAccessToken: googleAccessTokenSchema });
export const claimResponseSchema = z.strictObject({ role: z.literal('owner'), refreshToken: z.literal(true) });

/** `admin.join`: accepts the invitation of the caller's verified address. */
export const joinRequestSchema = emptyRequestSchema;
export const joinResponseSchema = z.strictObject({ role: roleSchema, refreshToken: z.literal(true) });

/**
 * `admins.invite` (its M5 request is `cityInviteRequestSchema`: a city's owner invites an address to that city); the
 * response names the link the inviter sends themselves.
 */
export const inviteResponseSchema = z.strictObject({
    inviteId: sha256Schema,
    expiresAt: isoTimeSchema,
    /** The admin's address (`https://<project>.web.app/admin/` since M6): the invitee signs in there with Google and joins. */
    signInUrl: httpsUrlSchema,
});

/** `admins.revoke` (its M5 request is `cityRevokeRequestSchema`: an admin or an invitation of one city). */
export const revokeResponseSchema = z.strictObject({ revoked: z.literal(true) });

export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type ClaimRequest = z.infer<typeof claimRequestSchema>;
export type ClaimResponse = z.infer<typeof claimResponseSchema>;
export type JoinResponse = z.infer<typeof joinResponseSchema>;
export type InviteResponse = z.infer<typeof inviteResponseSchema>;
