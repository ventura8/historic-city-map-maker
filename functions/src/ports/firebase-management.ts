/** A Firebase web app of the project (`projects/{project}/webApps`). */
interface WebApp {
    readonly appId: string;
    readonly displayName?: string;
    readonly state: 'ACTIVE' | 'DELETED';
}

/** `webApps/{appId}/config`: the public identifiers (never secrets) the viewer's analytics needs. */
interface WebAppConfig {
    readonly projectId: string;
    readonly appId: string;
    readonly apiKey: string;
    /** Present once Google Analytics is linked to the project. */
    readonly measurementId?: string;
}

/**
 * The Firebase Management API v1beta1 over REST (`roles/firebase.viewer` on `fn-admin@`; adapter
 * `functions/src/adapters/firebase-management.ts`, fn-setup). Used by `setup.analyticsConfig` and `setup.selfTest`, and
 * by `admin.claim` for the Google sign-in provider's client.
 */
export interface FirebaseManagement {
    listWebApps(projectId: string): Promise<readonly WebApp[]>;
    webAppConfig(projectId: string, appId: string): Promise<WebAppConfig>;
    /**
     * The OAuth client id of the project's Google sign-in provider (Identity Toolkit admin v2
     * `defaultSupportedIdpConfigs/google.com`, `roles/firebaseauth.admin`), or null when Google sign-in is not set up:
     * the client an owner's access token must be issued to (`admin.claim`, CR-M2b-2). Read once per instance.
     */
    googleSignInClientId(projectId: string): Promise<string | null>;
}
