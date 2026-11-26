/** What Google says about an OAuth 2.0 access token (`oauth2.googleapis.com/tokeninfo`). */
interface AccessTokenInfo {
    /** The account the token was granted by (needs the `email` scope, which Google sign-in always grants). */
    readonly email: string;
    readonly emailVerified: boolean;
    /** The OAuth client the token was issued to (`azp`, else `aud`): must be this project's web client. */
    readonly audience: string;
    readonly scopes: readonly string[];
    readonly expiresInSeconds: number;
}

/**
 * The Google identity and IAM calls `admin.claim` needs, made with the CALLER's own access token (never the service
 * account's): proof that the signed-in account owns the Google Cloud project, with no e-mail address configured
 * anywhere. Adapter `functions/src/adapters/resource-manager.ts` (fn-setup); REST with `fetch`.
 */
export interface GoogleIam {
    /** Rejects with `UpstreamError` `unauthorized` for an invalid or expired token. */
    tokenInfo(accessToken: string): Promise<AccessTokenInfo>;
    /**
     * `POST cloudresourcemanager.googleapis.com/v3/projects/{projectId}:testIamPermissions` with the caller's token:
     * the subset of `permissions` the caller holds on the project (empty when none; a 403 means no access at all and
     * also resolves to empty).
     */
    testProjectPermissions(projectId: string, accessToken: string, permissions: readonly string[]): Promise<readonly string[]>;
}
