import { FIXTURE_VALUES, fixtureBody, fixtureResponse } from '../api-fixtures/index.js';
import { authenticated, bearerToken, googleError, googleFailure, type GoogleApi, type GoogleProjects } from './google-common.js';
import type { StartWorldState } from './google-hosting.js';
import { bodyField, jsonResponse, route, type Route } from './routes.js';
import type { ServiceFake } from './service.js';

/**
 * Google identity for `admin.claim` (docs/research/M2-interfaces.md §3.1): `oauth2.googleapis.com/tokeninfo` and Resource
 * Manager's `testIamPermissions`, `getIamPolicy` and `setIamPolicy` (v1 and v3). Access tokens encode their scenario
 * (`GOOGLE_TOKENS`): who granted them, for which OAuth client, with which scopes, and what the account may do on any
 * project. A token the fake does not know is expired (tokeninfo 400, Resource Manager 401).
 */

/** `ya29.` assembled at run time, so no file holds a string shaped like a Google access token. */
const ACCESS_TOKEN_PREFIX = `${['ya', '29'].join('')}.`;

function accessToken(name: string): string {
    return `${ACCESS_TOKEN_PREFIX}e2e-${name}-access-token`;
}

/** The scenario access tokens (each at least 20 characters, as `googleAccessTokenSchema` requires). */
export const GOOGLE_TOKENS = {
    /** The project owner, the admin's own OAuth client, `cloud-platform.read-only`. */
    owner: accessToken('owner'),
    /** A project editor: `testIamPermissions` grants `resourcemanager.projects.get` only (S-A01-BAD-NOT-OWNER). */
    editor: accessToken('editor'),
    /** Another account with no access to the project: Resource Manager answers 403. */
    stranger: accessToken('stranger'),
    /** The owner's address but another OAuth client (S-A01-BAD-FOREIGN-TOKEN). */
    otherClient: accessToken('other-client'),
    /** The owner without the cloud-platform scope. */
    noScope: accessToken('no-scope'),
    /** Unknown to the fake: expired. */
    expired: accessToken('expired'),
} as const;

export type ProjectAccess = 'owner' | 'editor' | 'none';

export interface GoogleGrant {
    readonly email: string;
    readonly audience: string;
    readonly scopes: readonly string[];
    readonly expiresInSeconds: number;
    readonly access: ProjectAccess;
}

const SIGN_IN_SCOPES = ['openid', 'https://www.googleapis.com/auth/userinfo.email'];
const CLAIM_SCOPES = [...SIGN_IN_SCOPES, 'https://www.googleapis.com/auth/cloud-platform.read-only'];
/** What an editor holds of the permissions `admin.claim` and the provisioner test. */
const EDITOR_PERMISSIONS = ['resourcemanager.projects.get'];

function defaultGrants(): Map<string, GoogleGrant> {
    const owner = String(FIXTURE_VALUES['ownerEmail']);
    const client = String(FIXTURE_VALUES['oauthClientId']);
    const grant = (email: string, access: ProjectAccess, overrides: Partial<GoogleGrant> = {}): GoogleGrant => ({
        email,
        audience: client,
        scopes: CLAIM_SCOPES,
        expiresInSeconds: 3599,
        access,
        ...overrides,
    });
    return new Map([
        [GOOGLE_TOKENS.owner, grant(owner, 'owner')],
        [GOOGLE_TOKENS.editor, grant('editor@e2e.test', 'editor')],
        [GOOGLE_TOKENS.stranger, grant(String(FIXTURE_VALUES['strangerEmail']), 'none')],
        [GOOGLE_TOKENS.otherClient, grant(owner, 'owner', { audience: String(FIXTURE_VALUES['otherClientId']) })],
        [GOOGLE_TOKENS.noScope, grant(owner, 'owner', { scopes: SIGN_IN_SCOPES })],
    ]);
}

export interface IdentityState {
    /** Access token → what it grants; add one to script a new account. */
    readonly grants: Map<string, GoogleGrant>;
}

/** The grants of `GOOGLE_TOKENS` (`expired` is deliberately missing). */
export function defaultIdentityState(): IdentityState {
    return { grants: defaultGrants() };
}

const OAUTH: GoogleApi = { service: 'oauth2.googleapis.com', title: 'Google OAuth2 API', permission: 'oauth2.tokeninfo' };

/** The access token of a tokeninfo request: `?access_token=`, an `access_token` form field, or `Authorization: Bearer`. */
function tokenOf(request: Parameters<Route['answer']>[0]): string | null {
    return (
        request.url.searchParams.get('access_token') ??
        new URLSearchParams(request.body).get('access_token') ??
        bearerToken(request) ??
        null
    );
}

/** The fake tokeninfo endpoint. */
export function createGoogleOauthFake(state: IdentityState): ServiceFake {
    const tokeninfo = (token: string | null): Response => {
        const grant = token === null ? undefined : state.grants.get(token);
        if (grant === undefined) {
            return fixtureResponse('google-oauth/tokeninfo.expired');
        }
        return fixtureResponse('google-oauth/tokeninfo.owner', {
            merge: {
                azp: grant.audience,
                aud: grant.audience,
                email: grant.email,
                scope: grant.scopes.join(' '),
                expires_in: String(grant.expiresInSeconds),
            },
        });
    };
    // The token travels in the query, a form body, or (google-auth-library's getTokenInfo) the Authorization header.
    const answer: Route['answer'] = (request) => tokeninfo(tokenOf(request));
    return {
        name: 'google-oauth',
        routes: [
            route('GET', 'https://oauth2.googleapis.com/tokeninfo', 'google-oauth.tokeninfo', answer),
            route('POST', 'https://oauth2.googleapis.com/tokeninfo', 'google-oauth.tokeninfo', answer),
        ],
        failure: (mode) => googleFailure(OAUTH, mode),
        scenarios: {
            ownerTokenExpired: () => {
                state.grants.delete(GOOGLE_TOKENS.owner);
            },
        },
        snapshot: () => ({ tokens: [...state.grants.values()].map((grant) => ({ email: grant.email, access: grant.access })) }),
    };
}

interface Binding {
    readonly role: string;
    readonly members: readonly string[];
}

interface Policy {
    readonly version: number;
    readonly etag: string;
    readonly bindings: readonly Binding[];
}

export interface ResourceManagerState {
    /**
     * Project id → its IAM policy (created from the fixture on first use: the owner, and `roles/editor` for the Compute
     * Engine and App Engine default accounts, as Google grants them; `DECISIONS-for-review.md` §75b and §75g take both away).
     */
    readonly policies: Map<string, Policy>;
    /**
     * Domain-restricted sharing (`constraints/iam.allowedPolicyMemberDomains`): when set, `setIamPolicy` refuses
     * `user:`, `group:` and `domain:` members outside these domains, and `allUsers`.
     */
    allowedMemberDomains: readonly string[] | undefined;
    /** The project's parent (`organizations/<id>`); a project outside any organisation has none (the default). */
    parent: string | undefined;
    /**
     * A binding an IAM deny policy of the owner's organisation keeps (scenarios `appEngineEditorLocked`,
     * `computeEditorLocked`): a write that drops it answers 403 `PERMISSION_DENIED`, as Google does for a denied
     * `resourcemanager.projects.setIamPolicy`.
     */
    locked?: { readonly role: string; readonly member: string };
}

/** The organisation of the scenarios that put the project inside one. */
export const E2E_ORGANIZATION = 'organizations/100000000001';

const RESOURCE_MANAGER: GoogleApi = {
    service: 'cloudresourcemanager.googleapis.com',
    title: 'Cloud Resource Manager API',
    permission: 'resourcemanager.projects.getIamPolicy',
};

/** A `setIamPolicy` request's policy: the etag is optional (without it, the write is unconditional). */
interface PolicyInput {
    readonly version?: number;
    readonly etag?: string;
    readonly bindings: readonly Binding[];
}

function isPolicyInput(value: unknown): value is PolicyInput {
    return typeof value === 'object' && value !== null && Array.isArray((value as { bindings?: unknown }).bindings);
}

/** The first member domain-restricted sharing refuses, or undefined. */
function refusedMember(policy: PolicyInput, domains: readonly string[] | undefined): string | undefined {
    if (domains === undefined) {
        return undefined;
    }
    const members = policy.bindings.flatMap((binding) => binding.members);
    return members.find(
        (member) =>
            member === 'allUsers' ||
            (/^(user|group|domain):/.test(member) &&
                !domains.some((domain) => member.endsWith(`@${domain}`) || member.endsWith(`:${domain}`))),
    );
}

function holdsBinding(policy: { readonly bindings: readonly Binding[] }, role: string, member: string): boolean {
    return policy.bindings.some((binding) => binding.role === role && binding.members.includes(member));
}

/** Whether `policy` drops the binding the state keeps from `current`. */
function dropsLocked(policy: PolicyInput, current: Policy, locked: ResourceManagerState['locked']): boolean {
    return locked !== undefined && holdsBinding(current, locked.role, locked.member) && !holdsBinding(policy, locked.role, locked.member);
}

/** The subset of the asked permissions an owner (all) or an editor (`EDITOR_PERMISSIONS`) holds. */
function heldPermissions(access: ProjectAccess, asked: unknown): string[] {
    const wanted = Array.isArray(asked) ? asked.filter((item): item is string => typeof item === 'string') : [];
    return access === 'owner' ? wanted : wanted.filter((permission) => EDITOR_PERMISSIONS.includes(permission));
}

/** The fake Resource Manager (v1 and v3 paths). */
export function createResourceManagerFake(
    identity: IdentityState,
    state: ResourceManagerState,
    projects: GoogleProjects,
    start: Pick<StartWorldState, 'fresh' | 'projects'>,
): ServiceFake {
    let etags = 0;
    const policyOf = (projectSegment: string): Policy => {
        const project = projects.resolve(projectSegment);
        const existing = state.policies.get(project.id);
        if (existing !== undefined) {
            return existing;
        }
        const created = fixtureBody('resource-manager/get-iam-policy.ok', {
            projectId: project.id,
            projectNumber: project.number,
        }) as Policy;
        state.policies.set(project.id, created);
        return created;
    };
    const testPermissions: Route['answer'] = (request) => {
        const grant = identity.grants.get(bearerToken(request) ?? '');
        if (grant === undefined) {
            return googleError('google/error.unauthenticated', RESOURCE_MANAGER);
        }
        if (grant.access === 'none') {
            return fixtureResponse('resource-manager/test-iam-permissions.forbidden');
        }
        const held = heldPermissions(grant.access, bodyField(request, 'permissions'));
        return jsonResponse(held.length === 0 ? {} : { permissions: held });
    };
    /** Why `policy` cannot replace `current`: a stale etag (409), a denied removal (403) or a member the organization refuses (400). */
    const refusal = (policy: PolicyInput, current: Policy): Response | undefined => {
        if (policy.etag !== undefined && policy.etag !== current.etag) {
            return googleError('google/error.aborted', RESOURCE_MANAGER);
        }
        if (dropsLocked(policy, current, state.locked)) {
            return googleError('google/error.permission-denied', RESOURCE_MANAGER, { permission: 'resourcemanager.projects.setIamPolicy' });
        }
        const refused = refusedMember(policy, state.allowedMemberDomains);
        return refused === undefined
            ? undefined
            : fixtureResponse('resource-manager/set-iam-policy.org-policy', { values: { member: refused } });
    };
    const setPolicy: Route['answer'] = (request, params) => {
        const current = policyOf(String(params['project']));
        const policy = bodyField(request, 'policy');
        if (!isPolicyInput(policy)) {
            return googleError('google/error.invalid-argument', RESOURCE_MANAGER);
        }
        const refused = refusal(policy, current);
        if (refused !== undefined) {
            return refused;
        }
        etags += 1;
        const stored: Policy = {
            version: policy.version ?? 1,
            bindings: policy.bindings,
            etag: `BwXe2e${String(etags + 1).padStart(4, '0')}A=`,
        };
        state.policies.set(projects.resolve(String(params['project'])).id, stored);
        return jsonResponse(stored);
    };
    const routes = ['v1', 'v3'].flatMap((version) => {
        const base = `https://cloudresourcemanager.googleapis.com/${version}/projects/{project}`;
        const auth = (answer: Route['answer']): Route['answer'] => authenticated(RESOURCE_MANAGER, answer);
        return [
            route('POST', `${base}:testIamPermissions`, 'resource-manager.testIamPermissions', testPermissions),
            route(
                'POST',
                `${base}:getIamPolicy`,
                'resource-manager.getIamPolicy',
                auth((_request, params) => jsonResponse(policyOf(String(params['project'])))),
            ),
            route('POST', `${base}:setIamPolicy`, 'resource-manager.setIamPolicy', auth(setPolicy)),
            route(
                'GET',
                base,
                'resource-manager.getProject',
                auth((_request, params) => {
                    const project = projects.resolve(String(params['project']));
                    // M14: in the start page's fresh world a project exists once it was made (google-hosting.ts). What the
                    // caller cannot see answers 403 whether it exists or not (AIP-193), never a 404 that says the id is free.
                    if (start.fresh && !start.projects.has(project.id)) {
                        return googleError('google/error.permission-denied', RESOURCE_MANAGER);
                    }
                    const values = { projectId: project.id, projectNumber: project.number };
                    return state.parent === undefined
                        ? fixtureResponse('resource-manager/project.get.no-organization', { values })
                        : fixtureResponse('resource-manager/project.get', { values, merge: { parent: state.parent } });
                }),
            ),
        ];
    });
    return {
        name: 'resource-manager',
        routes,
        failure: (mode) => googleFailure(RESOURCE_MANAGER, mode),
        scenarios: {
            domainRestricted: () => {
                state.allowedMemberDomains = ['e2e.test'];
                state.parent = E2E_ORGANIZATION;
            },
            inOrganization: () => {
                state.parent = E2E_ORGANIZATION;
            },
            /**
             * `DECISIONS-for-review.md` §75b: the organisation's IAM deny policy keeps the App Engine default account's
             * Editor role on the project, so Provision's removal of it is refused (the role table's own writes go through).
             */
            appEngineEditorLocked: () => {
                const projectId = String(FIXTURE_VALUES['projectId']);
                state.locked = { role: 'roles/editor', member: `serviceAccount:${projectId}@appspot.gserviceaccount.com` };
            },
            /**
             * §75g (finding 33): the same deny policy keeps the Compute Engine default account's Editor role, so Provision's
             * removal of it is refused once its builder role is in place (the grants before it go through).
             */
            computeEditorLocked: () => {
                const projectNumber = String(FIXTURE_VALUES['projectNumber']);
                state.locked = { role: 'roles/editor', member: `serviceAccount:${projectNumber}-compute@developer.gserviceaccount.com` };
            },
        },
        snapshot: () => ({
            policies: Object.fromEntries(state.policies),
            allowedMemberDomains: state.allowedMemberDomains ?? null,
            parent: state.parent ?? null,
        }),
    };
}
