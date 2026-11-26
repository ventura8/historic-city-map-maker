/**
 * What the composition root (`functions/src/deps.ts`) reads from the environment once per instance: values, not I/O.
 * Nothing here is a secret. Variables (`HCM_*`, set as Firebase params at deploy; the emulator's in `e2e/env`):
 * `GCLOUD_PROJECT` (set by the runtime), `HCM_VIEWER_ORIGINS` (default the project's Hosting origins, M6),
 * `HCM_OAUTH_CLIENT_IDS` (the Google sign-in provider's web client id), `HCM_APP_CHECK` (`monitor` | `enforce`),
 * `HCM_ADMIN_SITE` (the admin's own Hosting site id, or `none`; §210).
 */
export interface RuntimeConfig {
    readonly projectId: string;
    readonly region: 'us-central1';
    /** `<project>.firebasestorage.app` and `<project>-public`. */
    readonly buckets: { readonly private: string; readonly public: string };
    /** The city sites: the viewer's public token allows them, the crash endpoint accepts their reports. */
    readonly viewerOrigins: readonly string[];
    /**
     * `https://<project>.web.app` and `https://<project>.firebaseapp.com`, then the admin's own site's two (§210) unless
     * `HCM_ADMIN_SITE` is `none`.
     */
    readonly adminOrigins: readonly string[];
    /**
     * The admin's address, the invitation link (`https://<project>.web.app/admin/` since M6; `https://<site>.web.app/admin/`
     * once `HCM_ADMIN_SITE` names the admin's own site, §210).
     */
    readonly adminUrl: string;
    /** The OAuth clients whose access tokens `admin.claim` accepts (`audience` of `GoogleIam.tokenInfo`). */
    readonly oauthClientIds: readonly string[];
    /** The public URL of `telemetry-reportError`, written into each manifest as `analytics.errorEndpoint`. */
    readonly errorEndpoint: string;
    /** Security review §1.6: one week of `monitor`, then `enforce`. */
    readonly appCheck: 'monitor' | 'enforce';
}
