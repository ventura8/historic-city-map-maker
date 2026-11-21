import { UpstreamError } from '../ports/errors.js';
import type { FirebaseManagement } from '../ports/firebase-management.js';
import type { TokenProvider } from '../ports/token-provider.js';
import { googleJson } from './google-call.js';
import { at, stringAt, type Fetch } from './upstream-http.js';

/**
 * The Firebase Management API v1beta1 over REST with the runtime service account's token (`roles/firebase.viewer`;
 * security review §1.1, M2-interfaces §4.3): the project's web apps and the public config of one of them, which
 * `setup.analyticsConfig` copies into the city document (the GA4 measurement id and the app's public identifiers;
 * nothing here is a secret). A 403 that names `SERVICE_DISABLED` carries the API's name (`GoogleApiError.api`).
 */
export const FIREBASE_MANAGEMENT_API = 'https://firebase.googleapis.com/v1beta1';

/** Identity Toolkit's admin API: the project's sign-in providers (Firebase Auth's own configuration). */
export const IDENTITY_TOOLKIT_API = 'https://identitytoolkit.googleapis.com/admin/v2';

type WebApp = Awaited<ReturnType<FirebaseManagement['listWebApps']>>[number];
type WebAppConfig = Awaited<ReturnType<FirebaseManagement['webAppConfig']>>;

const SERVICE = 'firebase-management';
/** Web apps per page (the API's maximum) and pages read at most: a project has one or two web apps. */
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

interface FirebaseManagementOptions {
    readonly tokens: TokenProvider;
    readonly fetch: Fetch;
}

/** One web app of a list page; an entry without an app id is dropped, any state but `ACTIVE` reads as `DELETED`. */
function toWebApp(entry: unknown): WebApp[] {
    const appId = stringAt(entry, 'appId');
    if (appId === undefined) {
        return [];
    }
    const state = at(entry, 'state') === 'ACTIVE' ? 'ACTIVE' : 'DELETED';
    const displayName = stringAt(entry, 'displayName');
    return [displayName === undefined ? { appId, state } : { appId, displayName, state }];
}

function toConfig(body: unknown): WebAppConfig {
    const projectId = stringAt(body, 'projectId');
    const appId = stringAt(body, 'appId');
    const apiKey = stringAt(body, 'apiKey');
    if (projectId === undefined || appId === undefined || apiKey === undefined) {
        throw new UpstreamError(SERVICE, 'invalid');
    }
    const measurementId = stringAt(body, 'measurementId');
    return measurementId === undefined ? { projectId, appId, apiKey } : { projectId, appId, apiKey, measurementId };
}

/**
 * The Google provider's client id, or null when the provider is not configured (404). The answer also holds the
 * provider's client secret: only `clientId` is read, and nothing of the answer is kept or logged.
 */
async function signInClientId(get: (url: string) => Promise<unknown>, projectId: string): Promise<string | null> {
    try {
        const body = await get(`${IDENTITY_TOOLKIT_API}/projects/${encodeURIComponent(projectId)}/defaultSupportedIdpConfigs/google.com`);
        return stringAt(body, 'clientId') ?? null;
    } catch (error) {
        if (error instanceof UpstreamError && error.failure === 'notFound') {
            return null;
        }
        throw error;
    }
}

export function createFirebaseManagement(options: FirebaseManagementOptions): FirebaseManagement {
    const projectUrl = (projectId: string): string => `${FIREBASE_MANAGEMENT_API}/projects/${encodeURIComponent(projectId)}`;
    const get = async (url: string): Promise<unknown> =>
        googleJson(options.fetch, SERVICE, url, { method: 'GET', accessToken: await options.tokens.accessToken() });
    /** The client id per project, once per instance (a failed read is forgotten, so the next claim tries again). */
    const clients = new Map<string, Promise<string | null>>();

    async function listPage(
        projectId: string,
        pageToken: string | undefined,
    ): Promise<{ readonly apps: WebApp[]; readonly next?: string }> {
        const query = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
        if (pageToken !== undefined) {
            query.set('pageToken', pageToken);
        }
        const body = await get(`${projectUrl(projectId)}/webApps?${query.toString()}`);
        const apps = at(body, 'apps');
        const next = stringAt(body, 'nextPageToken');
        const page = { apps: Array.isArray(apps) ? apps.flatMap(toWebApp) : [] };
        return next === undefined || next === '' ? page : { ...page, next };
    }

    return {
        listWebApps: async (projectId) => {
            const apps: WebApp[] = [];
            let pageToken: string | undefined;
            for (let page = 0; page < MAX_PAGES; page += 1) {
                const result = await listPage(projectId, pageToken);
                apps.push(...result.apps);
                pageToken = result.next;
                if (pageToken === undefined) {
                    break;
                }
            }
            return apps;
        },
        webAppConfig: async (projectId, appId) =>
            toConfig(await get(`${projectUrl(projectId)}/webApps/${encodeURIComponent(appId)}/config`)),
        googleSignInClientId: (projectId) => {
            const known = clients.get(projectId) ?? signInClientId(get, projectId);
            clients.set(projectId, known);
            known.catch(() => {
                clients.delete(projectId);
            });
            return known;
        },
    };
}
