import { authenticated, googleError, googleFailure, type GoogleApi, type GoogleProjects } from './google-common.js';
import { jsonResponse, route, type Route } from './routes.js';
import { adminSiteRoutes, createSite, userSitesOf } from './google-admin-site.js';
import { sequence, type ServiceFake } from './service.js';
import type { FirebaseState } from './google-firebase.js';

/**
 * Everything the start page asks of Google to make a project and publish to it (`docs/research/M14-start-your-map.md` §1),
 * following the documents that section quotes: Resource Manager v3's create and search, Firebase Management's addFirebase
 * and web app creation, and Firebase Hosting's sites, versions, `populateFiles`, upload, finalize and release. By default a
 * project exists (the rest of the world starts from `demo-hcm`); the scenario `fresh` starts from a Google account with no
 * project at all, `termsNotAccepted` refuses addFirebase, `quotaReached` and `idTaken` refuse the create.
 */

interface HostingVersion {
    readonly site: string;
    readonly config: unknown;
    readonly labels: unknown;
    /** Path → hash. */
    readonly files: Record<string, string>;
    status: 'CREATED' | 'FINALIZED';
}

export interface StartWorldState {
    /** When true, a project exists only once it was created. */
    fresh: boolean;
    terms: boolean;
    quotaReached: boolean;
    idTaken: boolean;
    /** `projects.create` refuses every request (`INVALID_ARGUMENT`). */
    projectRefused: boolean;
    /** Created or owned project ids (display names beside them). */
    readonly projects: Map<string, string>;
    /** Project id → default site, once Hosting is provisioned. */
    readonly sites: Map<string, string>;
    readonly versions: Map<string, HostingVersion>;
    /** Hashes uploaded so far: `populateFiles` asks only for the others. */
    readonly hashes: Set<string>;
    /** Site → the released version's name. */
    readonly live: Map<string, string>;
    /** Hashes refused at upload: their content was not their name. */
    readonly badUploads: string[];
    /** §210: each project's other sites (the admin's own, `<project>-admin`), site id → project id. */
    readonly userSites: Map<string, string>;
    /** §210: the admin's site id is another project's: `sites.create` answers it exists. */
    adminSiteTaken: boolean;
    /** Firebase Auth's authorised domains by project (Identity Toolkit's config); a project never read starts with the defaults. */
    readonly authorizedDomains: Map<string, string[]>;
}

export function defaultStartWorldState(): StartWorldState {
    return {
        fresh: false,
        terms: true,
        quotaReached: false,
        idTaken: false,
        projectRefused: false,
        projects: new Map(),
        sites: new Map(),
        versions: new Map(),
        hashes: new Set(),
        live: new Map(),
        badUploads: [],
        userSites: new Map(),
        adminSiteTaken: false,
        authorizedDomains: new Map(),
    };
}

const HOSTING_API: GoogleApi = {
    service: 'firebasehosting.googleapis.com',
    title: 'Firebase Hosting API',
    permission: 'firebasehosting.sites.update',
};
const PROJECTS_API: GoogleApi = {
    service: 'cloudresourcemanager.googleapis.com',
    title: 'Cloud Resource Manager API',
    permission: 'resourcemanager.projects.create',
};
const FIREBASE_API: GoogleApi = {
    service: 'firebase.googleapis.com',
    title: 'Firebase Management API',
    permission: 'firebase.projects.update',
};

type GoogleErrorFixture = Parameters<typeof googleError>[0];

const RESOURCE_MANAGER = 'https://cloudresourcemanager.googleapis.com/v3';
const FIREBASE = 'https://firebase.googleapis.com/v1beta1';
const HOSTING = 'https://firebasehosting.googleapis.com/v1beta1';
const UPLOAD = 'https://upload-firebasehosting.googleapis.com/upload';

/** Resource Manager's `displayName`: "lowercase and uppercase letters, numbers, hyphen, single-quote, double-quote, space, and exclamation point", 4 to 30 of them. */
const DISPLAY_NAME = /^[A-Za-z0-9\-'" !]{4,30}$/;

const bodyOf = (request: { readonly body: string }): Record<string, unknown> =>
    JSON.parse(request.body === '' ? '{}' : request.body) as Record<string, unknown>;

async function textHash(text: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Hosting's `ServingConfig`, as the REST reference says it is built; anything else is refused like Google refuses it. */
function validConfig(config: unknown): boolean {
    const allowed = ['rewrites', 'headers', 'redirects', 'cleanUrls', 'trailingSlashBehavior'];
    return typeof config === 'object' && config !== null && Object.keys(config).every((key) => allowed.includes(key));
}

function validProject(state: StartWorldState, displayName: string): boolean {
    return !state.projectRefused && DISPLAY_NAME.test(displayName);
}

/** Why `projects.create` refuses, as a fixture of Google's errors, or null. */
function createRefusal(state: StartWorldState, projectId: string, displayName: string): GoogleErrorFixture | null {
    if (state.quotaReached) {
        return 'google/error.rate-limited';
    }
    if (state.idTaken || state.projects.has(projectId)) {
        return 'google/error.already-exists';
    }
    return validProject(state, displayName) ? null : 'google/error.invalid-argument';
}

/** The projects' side. */
function projectRoutes(state: StartWorldState, firebase: FirebaseState, projects: GoogleProjects): Route[] {
    const nextOperation = sequence('e2e-start-');
    const operations = new Set<string>();
    const operation = (prefix: string): Response => {
        const name = `${prefix}/${nextOperation()}`;
        operations.add(name);
        return jsonResponse({ name, done: false });
    };
    const finished = (api: GoogleApi, prefix: string): Route['answer'] =>
        authenticated(api, (_request, params) => {
            const name = `${prefix}/${String(params['operation'])}`;
            return operations.has(name) ? jsonResponse({ name, done: true, response: {} }) : googleError('google/error.not-found', api);
        });
    const create: Route['answer'] = (request) => {
        const { projectId, displayName } = bodyOf(request);
        const refused = createRefusal(state, String(projectId), String(displayName));
        if (refused !== null) {
            return googleError(refused, PROJECTS_API);
        }
        state.projects.set(String(projectId), String(displayName));
        return operation('operations');
    };
    const search: Route['answer'] = () =>
        jsonResponse({
            projects: [...state.projects].map(([id, displayName]) => ({
                name: `projects/${projects.resolve(id).number}`,
                projectId: id,
                displayName,
                state: 'ACTIVE',
            })),
        });
    const addFirebase: Route['answer'] = (_request, params) => {
        const id = String(params['project']);
        if (!state.terms) {
            return googleError('google/error.permission-denied', FIREBASE_API);
        }
        firebase.added.add(id);
        state.sites.set(id, id);
        return operation('operations/start');
    };
    return [
        route('POST', `${RESOURCE_MANAGER}/projects`, 'start.projects.create', authenticated(PROJECTS_API, create)),
        route('GET', `${RESOURCE_MANAGER}/projects:search`, 'start.projects.search', authenticated(PROJECTS_API, search)),
        route('GET', `${RESOURCE_MANAGER}/operations/{operation}`, 'start.projects.operation', finished(PROJECTS_API, 'operations')),
        route('POST', `${FIREBASE}/projects/{project}:addFirebase`, 'start.firebase.add', authenticated(FIREBASE_API, addFirebase)),
        route('GET', `${FIREBASE}/operations/start/{operation}`, 'start.firebase.operation', finished(FIREBASE_API, 'operations/start')),
    ];
}

/** Hosting's side. */
function hostingRoutes(state: StartWorldState): Route[] {
    const nextVersion = sequence('v');
    const versionName = (params: Readonly<Record<string, string>>): string =>
        `sites/${String(params['site'])}/versions/${String(params['version'])}`;
    const createVersion: Route['answer'] = (request, params) => {
        const { config, labels } = bodyOf(request);
        if (!validConfig(config)) {
            return googleError('google/error.invalid-argument', HOSTING_API);
        }
        const name = `sites/${String(params['site'])}/versions/${nextVersion()}`;
        state.versions.set(name, { site: String(params['site']), config, labels, files: {}, status: 'CREATED' });
        return jsonResponse({ name, status: 'CREATED', config });
    };
    const populate: Route['answer'] = (request, params) => {
        const version = state.versions.get(versionName(params));
        const files = bodyOf(request)['files'] as Readonly<Record<string, string>> | undefined;
        if (version === undefined || files === undefined || Object.keys(files).length > 1000) {
            return googleError('google/error.invalid-argument', HOSTING_API);
        }
        Object.assign(version.files, files);
        const missing = [...new Set(Object.values(files))].filter((hash) => !state.hashes.has(hash));
        return jsonResponse({
            ...(missing.length === 0 ? {} : { uploadRequiredHashes: missing }),
            uploadUrl: `${UPLOAD}/sites/${String(params['site'])}/versions/${String(params['version'])}/files`,
        });
    };
    const upload: Route['answer'] = async (request, params) => {
        const hash = String(params['hash']);
        // The e2e network layer checks the bytes where it has them and says so (`x-hcm-checked`): the mock APIs read text.
        const checked = request.headers.get('x-hcm-checked') === hash || (await textHash(request.body)) === hash;
        if (!checked) {
            state.badUploads.push(hash);
            return googleError('google/error.invalid-argument', HOSTING_API);
        }
        state.hashes.add(hash);
        return jsonResponse({});
    };
    const finalize: Route['answer'] = (request, params) => {
        const version = state.versions.get(versionName(params));
        if (version === undefined || bodyOf(request)['status'] !== 'FINALIZED' || !everyFileUploaded(state, version)) {
            return googleError('google/error.invalid-argument', HOSTING_API);
        }
        version.status = 'FINALIZED';
        return jsonResponse({ name: versionName(params), status: 'FINALIZED' });
    };
    const release: Route['answer'] = (request, params) => {
        const name = request.url.searchParams.get('versionName') ?? '';
        if (state.versions.get(name)?.status !== 'FINALIZED') {
            return googleError('google/error.invalid-argument', HOSTING_API);
        }
        state.live.set(String(params['site']), name);
        return jsonResponse({ name: `sites/${String(params['site'])}/releases/1`, version: { name } });
    };
    return [
        route('POST', `${HOSTING}/sites/{site}/versions`, 'start.hosting.versions.create', authenticated(HOSTING_API, createVersion)),
        route(
            'POST',
            `${HOSTING}/sites/{site}/versions/{version}:populateFiles`,
            'start.hosting.populateFiles',
            authenticated(HOSTING_API, populate),
        ),
        route('PATCH', `${HOSTING}/sites/{site}/versions/{version}`, 'start.hosting.versions.patch', authenticated(HOSTING_API, finalize)),
        route('POST', `${HOSTING}/sites/{site}/releases`, 'start.hosting.releases.create', authenticated(HOSTING_API, release)),
        route('POST', `${UPLOAD}/sites/{site}/versions/{version}/files/{hash}`, 'start.hosting.upload', authenticated(HOSTING_API, upload)),
        route(
            'GET',
            `${HOSTING}/sites/{site}/channels/live`,
            'start.hosting.channels.get',
            authenticated(HOSTING_API, (_request, params) => {
                const site = String(params['site']);
                const name = state.live.get(site);
                const channel = `sites/${site}/channels/live`;
                return jsonResponse(
                    name === undefined
                        ? { name: channel }
                        : {
                              name: channel,
                              release: { name: `${channel}/releases/1`, version: { name, labels: state.versions.get(name)?.labels } },
                          },
                );
            }),
        ),
        route(
            'GET',
            `${HOSTING}/projects/{project}/sites`,
            'start.hosting.sites.list',
            authenticated(HOSTING_API, (_request, params) => {
                const project = String(params['project']);
                const site = state.sites.get(project);
                const own = site === undefined ? [] : [{ name: `projects/${project}/sites/${site}`, type: 'DEFAULT_SITE' }];
                const users = userSitesOf(state, project).map((id) => ({ name: `projects/${project}/sites/${id}`, type: 'USER_SITE' }));
                return jsonResponse(own.length + users.length === 0 ? {} : { sites: [...own, ...users] });
            }),
        ),
        route('POST', `${HOSTING}/projects/{project}/sites`, 'start.hosting.sites.create', authenticated(HOSTING_API, createSite(state))),
        ...adminSiteRoutes(state),
    ];
}

function everyFileUploaded(state: StartWorldState, version: HostingVersion): boolean {
    return Object.values(version.files).every((hash) => state.hashes.has(hash));
}

/** The fake; `fresh` is also what `resource-manager` and `firebase-management` look at for a project that does not exist yet. */
export function createStartWorldFake(state: StartWorldState, firebase: FirebaseState, projects: GoogleProjects): ServiceFake {
    return {
        name: 'firebase-hosting',
        routes: [...projectRoutes(state, firebase, projects), ...hostingRoutes(state)],
        failure: (mode) => googleFailure(HOSTING_API, mode),
        scenarios: {
            fresh: () => {
                state.fresh = true;
                firebase.fresh = true;
            },
            termsNotAccepted: () => {
                state.terms = false;
            },
            termsAccepted: () => {
                state.terms = true;
            },
            quotaReached: () => {
                state.quotaReached = true;
            },
            idTaken: () => {
                state.idTaken = true;
            },
            idFree: () => {
                state.idTaken = false;
            },
            /** §210: the admin's site id is another project's. */
            adminSiteTaken: () => {
                state.adminSiteTaken = true;
            },
            projectRefused: () => {
                state.projectRefused = true;
            },
            /** The owner has a project with Firebase and its site, as an earlier console session left it. */
            ownedProject: () => {
                const id = projects.resolve('demo-hcm').id;
                state.projects.set(id, 'Fostul Bacău');
                state.sites.set(id, id);
                firebase.added.add(id);
            },
            googleSignInOn: () => {
                firebase.signInOn = true;
            },
        },
        snapshot: () => ({
            projects: Object.fromEntries(state.projects),
            sites: Object.fromEntries(state.sites),
            versions: Object.fromEntries(state.versions),
            live: Object.fromEntries(state.live),
            hashes: [...state.hashes],
            badUploads: state.badUploads,
            userSites: Object.fromEntries(state.userSites),
            authorizedDomains: Object.fromEntries(state.authorizedDomains),
        }),
    };
}
