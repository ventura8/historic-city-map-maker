import { at, strings } from './json.js';
import type { GoogleTransport } from './transport.js';

/**
 * Firebase Hosting's sites and Firebase Auth's authorised domains for the `admin-site` item (`DECISIONS-for-review.md`
 * §210): the admin's own site (`projects.sites.get` finds it among the project's own; another project's answers 404) is made with `projects.sites.create`, then its two host names join the domains Firebase Auth lets
 * a sign-in finish on (Identity Toolkit admin v2 `projects.getConfig`, `updateConfig` with the mask
 * `authorizedDomains`: the list read, the two added, every other domain kept).
 */

const HOSTING = 'https://firebasehosting.googleapis.com/v1beta1';
const IDENTITY = 'https://identitytoolkit.googleapis.com/admin/v2';

export interface HostingSitesClient {
    /** Whether `siteId` is one of the project's own Hosting sites. */
    ownSite(projectId: string, siteId: string): Promise<boolean>;
    createSite(projectId: string, siteId: string): Promise<void>;
    /** Firebase Auth's authorised domains. */
    authorizedDomains(projectId: string): Promise<readonly string[]>;
    setAuthorizedDomains(projectId: string, domains: readonly string[]): Promise<void>;
}

export function createHostingSitesClient(transport: GoogleTransport): HostingSitesClient {
    return {
        ownSite: async (projectId, siteId) =>
            (await transport.find({
                operation: 'firebase-hosting.sites.get',
                url: `${HOSTING}/projects/${projectId}/sites/${siteId}`,
            })) !== undefined,
        createSite: async (projectId, siteId) => {
            await transport.call({
                operation: 'firebase-hosting.sites.create',
                method: 'POST',
                url: `${HOSTING}/projects/${projectId}/sites`,
                query: { siteId },
                body: {},
            });
        },
        authorizedDomains: async (projectId) => {
            const config = await transport.call({
                operation: 'identity-toolkit.getConfig',
                url: `${IDENTITY}/projects/${projectId}/config`,
            });
            return strings(at(config, 'authorizedDomains'));
        },
        setAuthorizedDomains: async (projectId, domains) => {
            await transport.call({
                operation: 'identity-toolkit.updateConfig',
                method: 'PATCH',
                url: `${IDENTITY}/projects/${projectId}/config`,
                query: { updateMask: 'authorizedDomains' },
                body: { authorizedDomains: [...domains] },
            });
        },
    };
}
