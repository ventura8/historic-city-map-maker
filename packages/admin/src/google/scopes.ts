import { CLAIM_OAUTH_SCOPE } from '@hcm/shared';

/**
 * The Google OAuth scopes the admin asks for, each only when a step needs it (incremental consent through Firebase's
 * `GoogleAuthProvider.addScope`; `docs/research/M2b-interfaces.md` §2). Daily use asks for none: the sign-in's
 * `openid`, `email` and `profile` are enough. Every access token lives in memory only, for at most an hour.
 */
export const GOOGLE_SCOPES = {
    /** Step (a) in bootstrap mode and the owner claim: Resource Manager `testIamPermissions` on the project. */
    cloudReadOnly: CLAIM_OAUTH_SCOPE,
    /** Step (b): Cloud Billing (accounts, the project's billing link) and the Budget API. */
    cloudBilling: 'https://www.googleapis.com/auth/cloud-billing',
    /** Steps (c) and (d), the doctor's re-check: every Cloud API the provisioner calls. */
    cloudPlatform: 'https://www.googleapis.com/auth/cloud-platform',
    /** Step (g): the GA4 web stream's enhanced-measurement settings (Analytics Admin API, CR-M2-37). */
    analyticsEdit: 'https://www.googleapis.com/auth/analytics.edit',
    /** §203: the Statistics view's numbers (GA4 Data API and the Admin API's account summaries), read only. */
    analyticsRead: 'https://www.googleapis.com/auth/analytics.readonly',
} as const;

export type GoogleScope = keyof typeof GOOGLE_SCOPES;

/** The granted scopes that satisfy a needed one: Google's Cloud APIs all accept `cloud-platform` too. */
const SATISFIED_BY: Readonly<Record<GoogleScope, readonly GoogleScope[]>> = {
    cloudReadOnly: ['cloudReadOnly', 'cloudPlatform'],
    cloudBilling: ['cloudBilling', 'cloudPlatform'],
    cloudPlatform: ['cloudPlatform'],
    analyticsEdit: ['analyticsEdit'],
    analyticsRead: ['analyticsRead'],
};

/**
 * The needed scopes that the granted scope URLs (a token's space-separated `scope`, split) do not satisfy, in the order
 * asked: an empty list means the token may be used for the step; anything else is `adminShell.oauth.scopeDenied`.
 */
export function unsatisfiedScopes(granted: readonly string[], needed: readonly GoogleScope[]): GoogleScope[] {
    return needed.filter((scope) => !SATISFIED_BY[scope].some((candidate) => granted.includes(GOOGLE_SCOPES[candidate])));
}
