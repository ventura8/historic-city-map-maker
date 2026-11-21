/**
 * Secret Manager secrets, read at runtime with a short cache instead of `defineSecret`: a value the
 * admin pastes into the Setup Assistant works at once, without redeploying the functions
 * (docs/research/design-review-security-cost.md §0.1, §1.2). Values never reach logs or Firestore.
 */
export type SecretName = 'usgs-username' | 'usgs-app-token' | 'mapbox-sk-bootstrap' | 'mapbox-sk-tiles';

export interface SecretStore {
    /** The latest version's value (cached briefly), or undefined while the secret has no version. */
    read(name: SecretName): Promise<string | undefined>;
    /**
     * Adds `value` as the latest version, drops the cached value and returns the version's resource name; the older
     * enabled versions are destroyed (security review §1.2: one active version each, nothing replaced left behind).
     */
    write(name: SecretName, value: string): Promise<string>;
    /** Drops every cached value (setup/status.secretsRev changed on another instance). */
    invalidate(): void;
}
