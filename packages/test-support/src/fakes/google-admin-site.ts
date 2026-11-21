import { ADMIN_SITE_SUFFIX } from '@hcm/shared';

import { authenticated, googleError, type GoogleApi } from './google-common.js';
import { jsonResponse, route, type Route } from './routes.js';

/**
 * The admin's own Hosting site (`DECISIONS-for-review.md` §210) in the fake Hosting of `google-hosting.ts`: a site of the
 * project besides its default one (`sites.create`, `projects.sites.get`, which answers 404 for another project's), and
 * Firebase Auth's authorised domains (Identity Toolkit admin v2 `projects.getConfig` and `updateConfig`), which a project
 * starts with as Firebase makes them.
 */

const HOSTING = 'https://firebasehosting.googleapis.com/v1beta1';
const IDENTITY = 'https://identitytoolkit.googleapis.com/admin/v2';

const HOSTING_API: GoogleApi = {
    service: 'firebasehosting.googleapis.com',
    title: 'Firebase Hosting API',
    permission: 'firebasehosting.sites.create',
};

/** What these routes read and write of the start world's state (`StartWorldState` of `google-hosting.ts`). */
export interface AdminSiteState {
    /** Project id → its default site. */
    readonly sites: Map<string, string>;
    /** Site id → the project of a site besides its default one. */
    readonly userSites: Map<string, string>;
    adminSiteTaken: boolean;
    readonly authorizedDomains: Map<string, string[]>;
}

const bodyOf = (request: { readonly body: string }): Record<string, unknown> =>
    JSON.parse(request.body === '' ? '{}' : request.body) as Record<string, unknown>;

const IDENTITY_API: GoogleApi = {
    service: 'identitytoolkit.googleapis.com',
    title: 'Identity Toolkit API',
    permission: 'firebaseauth.configs.update',
};

/** A project's sites besides its default one (§210). */
export function userSitesOf(state: AdminSiteState, project: string): string[] {
    return [...state.userSites].filter(([, owner]) => owner === project).map(([id]) => id);
}

/**
 * `sites.create`: the start page's site becomes the project's default one; the admin's own (`<project>-admin`, §210) a
 * user site beside it, refused as Hosting refuses an id another project holds under the scenario `adminSiteTaken`.
 */
export function createSite(state: AdminSiteState): Route['answer'] {
    return (request, params) => {
        const project = String(params['project']);
        const siteId = request.url.searchParams.get('siteId') ?? '';
        if (!siteId.endsWith(ADMIN_SITE_SUFFIX)) {
            state.sites.set(project, siteId);
            return jsonResponse({ name: `projects/${project}/sites/${siteId}`, type: 'USER_SITE' });
        }
        if (state.adminSiteTaken || state.userSites.has(siteId)) {
            return googleError('google/error.already-exists', HOSTING_API);
        }
        state.userSites.set(siteId, project);
        return jsonResponse({ name: `projects/${project}/sites/${siteId}`, type: 'USER_SITE' });
    };
}

/** The domains Firebase Auth starts a project with. */
function defaultDomains(project: string): string[] {
    return ['localhost', `${project}.firebaseapp.com`, `${project}.web.app`];
}

/** §210: one site of the project (404 for another project's or none), and Firebase Auth's authorised domains. */
export function adminSiteRoutes(state: AdminSiteState): Route[] {
    const domains = (project: string): string[] => state.authorizedDomains.get(project) ?? defaultDomains(project);
    return [
        route(
            'GET',
            `${HOSTING}/projects/{project}/sites/{site}`,
            'hosting.sites.get',
            authenticated(HOSTING_API, (_request, params) => {
                const project = String(params['project']);
                const site = String(params['site']);
                const own = state.userSites.get(site) === project || (state.sites.get(project) ?? project) === site;
                return own
                    ? jsonResponse({ name: `projects/${project}/sites/${site}` })
                    : googleError('google/error.not-found', HOSTING_API);
            }),
        ),
        route(
            'GET',
            `${IDENTITY}/projects/{project}/config`,
            'identity-toolkit.getConfig',
            authenticated(IDENTITY_API, (_request, params) => {
                const project = String(params['project']);
                return jsonResponse({ name: `projects/${project}/config`, authorizedDomains: domains(project) });
            }),
        ),
        route(
            'PATCH',
            `${IDENTITY}/projects/{project}/config`,
            'identity-toolkit.updateConfig',
            authenticated(IDENTITY_API, (request, params) => {
                const project = String(params['project']);
                const wanted = (bodyOf(request)['authorizedDomains'] ?? []) as string[];
                state.authorizedDomains.set(project, [...wanted]);
                return jsonResponse({ name: `projects/${project}/config`, authorizedDomains: wanted });
            }),
        ),
    ];
}
