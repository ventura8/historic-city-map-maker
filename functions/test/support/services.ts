import { FIXTURE_VALUES } from '@hcm/test-support/api-fixtures';
import { GOOGLE_TOKENS, MAPBOX_TOKENS, USGS_CREDENTIALS } from '@hcm/test-support/fakes';

import type { ErrorReporter } from '../../src/ports/error-reporter.js';
import { UpstreamError } from '../../src/ports/errors.js';
import type { FirebaseManagement } from '../../src/ports/firebase-management.js';
import type { GoogleIam } from '../../src/ports/google-iam.js';
import type { MapboxApi } from '../../src/ports/mapbox-api.js';
import type { RuntimeConfig } from '../../src/ports/runtime-config.js';
import type { UsgsApi } from '../../src/ports/usgs-api.js';
import { PortRecorder, promised } from './recorder.js';

/**
 * In-memory fakes of the outside-service ports (Google identity and IAM, Firebase Management, Error Reporting, Mapbox,
 * USGS) for handler tests. They speak the same scenario credentials as the HTTP fakes of `@hcm/test-support/fakes`
 * (`GOOGLE_TOKENS`, `MAPBOX_TOKENS`, `USGS_CREDENTIALS`) and the same fixture values, so a handler test and an adapter
 * or e2e test of one scenario read alike. Failures are `UpstreamError`s, as the adapters throw them.
 */

const OWNER_EMAIL = String(FIXTURE_VALUES['ownerEmail']);
const CLIENT_ID = String(FIXTURE_VALUES['oauthClientId']);
const PROJECT_ID = String(FIXTURE_VALUES['projectId']);
const CLAIM_SCOPES = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/cloud-platform.read-only',
];

/** The `RuntimeConfig` of the emulator world (`demo-hcm`); override what a test needs. */
export function testRuntimeConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
    return {
        projectId: PROJECT_ID,
        region: 'us-central1',
        buckets: { private: `${PROJECT_ID}.firebasestorage.app`, public: `${PROJECT_ID}-public` },
        viewerOrigins: ['https://ventura8.github.io'],
        adminOrigins: [`https://${PROJECT_ID}.web.app`, `https://${PROJECT_ID}.firebaseapp.com`],
        adminUrl: `https://${PROJECT_ID}.web.app/`,
        oauthClientIds: [CLIENT_ID],
        errorEndpoint: `https://us-central1-${PROJECT_ID}.cloudfunctions.net/telemetry-reportError`,
        appCheck: 'monitor',
        ...overrides,
    };
}

type TokenInfo = Awaited<ReturnType<GoogleIam['tokenInfo']>>;

/** What each scenario token of `GOOGLE_TOKENS` is (`expired` is unknown) and the permissions it holds on any project. */
function defaultGrants(): Map<string, { readonly info: TokenInfo; readonly permissions: readonly string[] | 'all' }> {
    const info = (email: string, overrides: Partial<TokenInfo> = {}): TokenInfo => ({
        email,
        emailVerified: true,
        audience: CLIENT_ID,
        scopes: CLAIM_SCOPES,
        expiresInSeconds: 3599,
        ...overrides,
    });
    return new Map([
        [GOOGLE_TOKENS.owner, { info: info(OWNER_EMAIL), permissions: 'all' }],
        [GOOGLE_TOKENS.editor, { info: info('editor@e2e.test'), permissions: ['resourcemanager.projects.get'] }],
        [GOOGLE_TOKENS.stranger, { info: info(String(FIXTURE_VALUES['strangerEmail'])), permissions: [] }],
        [GOOGLE_TOKENS.otherClient, { info: info(OWNER_EMAIL, { audience: String(FIXTURE_VALUES['otherClientId']) }), permissions: 'all' }],
        [GOOGLE_TOKENS.noScope, { info: info(OWNER_EMAIL, { scopes: CLAIM_SCOPES.slice(0, 2) }), permissions: 'all' }],
    ]);
}

/** `GoogleIam` over the scenario tokens; `grants` takes more. */
export function createFakeGoogleIam() {
    const grants = defaultGrants();
    const recorder = new PortRecorder<'tokenInfo' | 'testProjectPermissions'>();
    const iam: GoogleIam = {
        tokenInfo: (accessToken) =>
            promised(() => {
                recorder.enter('tokenInfo', [accessToken]);
                const grant = grants.get(accessToken);
                if (grant === undefined) {
                    throw new UpstreamError('google-oauth', 'unauthorized', { status: 400 });
                }
                return grant.info;
            }),
        testProjectPermissions: (projectId, accessToken, permissions) =>
            promised(() => {
                recorder.enter('testProjectPermissions', [projectId, accessToken, permissions]);
                const held = grants.get(accessToken)?.permissions ?? [];
                return permissions.filter((permission) => held === 'all' || held.includes(permission));
            }),
    };
    return { iam, grants, recorder };
}

interface FakeWebApp {
    readonly appId: string;
    readonly displayName?: string;
    state: 'ACTIVE' | 'DELETED';
}

/**
 * `FirebaseManagement` of a fresh project: its one active web app, Google Analytics not linked (`linkAnalytics()`),
 * Google sign-in with the fixture OAuth client (`analytics.signInClient`, null when not set up).
 */
export function createFakeFirebaseManagement() {
    const apps: FakeWebApp[] = [{ appId: String(FIXTURE_VALUES['appId']), displayName: 'historic-city-map', state: 'ACTIVE' }];
    const analytics: { measurementId: string | undefined; signInClient: string | null } = {
        measurementId: undefined,
        signInClient: String(FIXTURE_VALUES['oauthClientId']),
    };
    const recorder = new PortRecorder<'listWebApps' | 'webAppConfig' | 'googleSignInClientId'>();
    const firebase: FirebaseManagement = {
        listWebApps: (projectId) =>
            promised(() => {
                recorder.enter('listWebApps', [projectId]);
                return [...apps];
            }),
        webAppConfig: (projectId, appId) =>
            promised(() => {
                recorder.enter('webAppConfig', [projectId, appId]);
                if (!apps.some((app) => app.appId === appId)) {
                    throw new UpstreamError('firebase-management', 'notFound', { status: 404 });
                }
                const measurement = analytics.measurementId === undefined ? {} : { measurementId: analytics.measurementId };
                return { projectId, appId, apiKey: String(FIXTURE_VALUES['apiKey']), ...measurement };
            }),
        googleSignInClientId: (projectId) =>
            promised(() => {
                recorder.enter('googleSignInClientId', [projectId]);
                return analytics.signInClient;
            }),
    };
    const linkAnalytics = (measurementId = String(FIXTURE_VALUES['measurementId'])): void => {
        analytics.measurementId = measurementId;
    };
    return { firebase, apps, linkAnalytics, analytics, recorder };
}

type ListGroupsResponse = Awaited<ReturnType<ErrorReporter['listGroups']>>;

/** `ErrorReporter` keeping every reported event; `groups` is what `listGroups` pages through (none by default). */
export function createFakeErrorReporter(groups: ListGroupsResponse['groups'] = []) {
    const reports: Parameters<ErrorReporter['report']>[0][] = [];
    const recorder = new PortRecorder<'report' | 'listGroups'>();
    const errors: ErrorReporter = {
        report: (event) => {
            recorder.enter('report', [event]);
            reports.push(event);
        },
        listGroups: (request) =>
            promised(() => {
                recorder.enter('listGroups', [request]);
                const start = Number(request.pageToken ?? 0);
                const next = start + request.pageSize < groups.length ? { nextPageToken: String(start + request.pageSize) } : {};
                return { groups: groups.slice(start, start + request.pageSize), ...next };
            }),
    };
    return { errors, reports, recorder };
}

type MapboxMethod = 'retrieveToken' | 'listTokens' | 'createToken' | 'updateToken' | 'deleteToken';
type TokenRecord = Awaited<ReturnType<MapboxApi['listTokens']>>[number];
type MapboxPlan = 'paid' | 'demo' | 'billing-pending';

interface FakeMapboxToken extends TokenRecord {
    readonly user: string;
    readonly value: string;
}

const BOOTSTRAP_SCOPES = [
    'styles:read',
    'styles:tiles',
    'fonts:read',
    'tilesets:read',
    'tilesets:write',
    'tilesets:list',
    'tokens:read',
    'tokens:write',
];
const PUBLIC_SCOPES = ['styles:tiles', 'styles:read', 'fonts:read', 'datasets:read', 'vision:read'];

function defaultMapboxTokens(): FakeMapboxToken[] {
    const secret = (user: string, id: string, value: string, scopes = BOOTSTRAP_SCOPES): FakeMapboxToken => ({
        user,
        id,
        value,
        usage: 'sk',
        note: 'historic-map-server',
        scopes,
    });
    return [
        {
            user: 'e2e-mapbox',
            id: 'cle2e0000default0000000001',
            value: MAPBOX_TOKENS.defaultPublic,
            usage: 'pk',
            note: 'Default public token',
            scopes: PUBLIC_SCOPES,
        },
        secret('e2e-mapbox', String(FIXTURE_VALUES['tokenId']), MAPBOX_TOKENS.bootstrap),
        secret(
            'e2e-mapbox',
            'cle2e00token00000000000002',
            MAPBOX_TOKENS.missingScopes,
            BOOTSTRAP_SCOPES.filter((scope) => scope !== 'tilesets:write' && scope !== 'tokens:write'),
        ),
        secret('e2e-mapbox-trial', 'cle2e00token00000000000003', MAPBOX_TOKENS.trial),
        secret('e2e-mapbox-billing', 'cle2e00token00000000000004', MAPBOX_TOKENS.billingPending),
    ];
}

/** Mapbox refuses to mint for a demo account (403) and for one blocked on its billing information (422). */
function refuseMint(plan: MapboxPlan | undefined): void {
    if (plan === 'demo') {
        throw new UpstreamError('mapbox', 'forbidden', { status: 403 });
    }
    if (plan === 'billing-pending') {
        throw new UpstreamError('mapbox', 'invalid', { status: 422 });
    }
}

/**
 * `MapboxApi` over the scenario tokens of `MAPBOX_TOKENS`: an unknown or deleted token is `unauthorized`; a demo
 * account's mint is `forbidden` (403), a billing-pending one's `invalid` (422). Minted tokens get the next id and value.
 */
export function createFakeMapboxApi() {
    const tokens = defaultMapboxTokens();
    const plans = new Map<string, MapboxPlan>([
        ['e2e-mapbox', 'paid'],
        ['e2e-mapbox-trial', 'demo'],
        ['e2e-mapbox-billing', 'billing-pending'],
    ]);
    const recorder = new PortRecorder<MapboxMethod>();
    let minted = 0;
    const owned = (user: string, secretToken: string): FakeMapboxToken[] => {
        const caller = tokens.find((token) => token.value === secretToken);
        if (caller?.user !== user) {
            throw new UpstreamError('mapbox', 'unauthorized', { status: 401 });
        }
        return tokens.filter((token) => token.user === user);
    };
    const record = (token: FakeMapboxToken): TokenRecord => ({
        id: token.id,
        usage: token.usage,
        note: token.note,
        scopes: token.scopes,
        ...(token.allowedUrls === undefined ? {} : { allowedUrls: token.allowedUrls }),
    });
    const mapbox: MapboxApi = {
        retrieveToken: (token) =>
            promised(() => {
                recorder.enter('retrieveToken', [token]);
                const found = tokens.find((candidate) => candidate.value === token);
                if (found === undefined) {
                    throw new UpstreamError('mapbox', 'unauthorized', { status: 401 });
                }
                return { user: found.user, usage: found.usage, tokenId: found.id };
            }),
        listTokens: (user, secretToken) =>
            promised(() => {
                recorder.enter('listTokens', [user]);
                return owned(user, secretToken).map(record);
            }),
        createToken: (user, secretToken, request) =>
            promised(() => {
                recorder.enter('createToken', [user, request]);
                owned(user, secretToken);
                refuseMint(plans.get(user));
                minted += 1;
                const usage = request.scopes.every((scope) => PUBLIC_SCOPES.includes(scope)) ? 'pk' : 'sk';
                const serial = String(minted);
                const token: FakeMapboxToken = {
                    ...request,
                    user,
                    usage,
                    id: `cle2e00minted${serial.padStart(13, '0')}`,
                    value: `${usage}.e2e-minted-token-${serial.padStart(4, '0')}`,
                };
                tokens.push(token);
                return { id: token.id, token: token.value };
            }),
        updateToken: (user, secretToken, tokenId, request) =>
            promised(() => {
                recorder.enter('updateToken', [user, tokenId, request]);
                owned(user, secretToken);
                const index = tokens.findIndex((token) => token.user === user && token.id === tokenId);
                const current = tokens[index];
                if (current === undefined) {
                    throw new UpstreamError('mapbox', 'notFound', { status: 404 });
                }
                tokens[index] = { ...current, ...request };
                return { id: current.id, token: current.value };
            }),
        deleteToken: (user, secretToken, tokenId) =>
            promised(() => {
                recorder.enter('deleteToken', [user, tokenId]);
                owned(user, secretToken);
                const index = tokens.findIndex((token) => token.user === user && token.id === tokenId);
                if (index !== -1) {
                    tokens.splice(index, 1);
                }
            }),
    };
    return { mapbox, tokens, plans, recorder };
}

/**
 * `UsgsApi` over `USGS_CREDENTIALS`: the approved user holds `download`, the pending one only `user` until
 * `approve()`, the expired token and unknown credentials are `unauthorized`. `sessions` holds the keys not logged out.
 */
export function createFakeUsgsApi() {
    const permissions = new Map<string, readonly string[]>([
        [USGS_CREDENTIALS.approved.username, ['user', 'download', 'order']],
        [USGS_CREDENTIALS.pending.username, ['user']],
    ]);
    const tokens = new Map<string, string>([
        [USGS_CREDENTIALS.approved.username, USGS_CREDENTIALS.approved.applicationToken],
        [USGS_CREDENTIALS.pending.username, USGS_CREDENTIALS.pending.applicationToken],
    ]);
    const sessions = new Map<string, string>();
    /** M7: what a generic M2M call answers, by endpoint (`data` as USGS sends it); an endpoint without one answers null. */
    const answers = new Map<string, unknown>();
    const recorder = new PortRecorder<'login' | 'permissions' | 'logout' | 'request'>();
    let logins = 0;
    const usgs: UsgsApi = {
        login: (username, applicationToken) =>
            promised(() => {
                recorder.enter('login', [username]);
                if (tokens.get(username) !== applicationToken) {
                    throw new UpstreamError('usgs', 'unauthorized', { status: 403 });
                }
                logins += 1;
                const apiKey = `e2e-usgs-api-key-${String(logins).padStart(4, '0')}`;
                sessions.set(apiKey, username);
                return apiKey;
            }),
        permissions: (apiKey) =>
            promised(() => {
                recorder.enter('permissions', [apiKey]);
                const username = sessions.get(apiKey);
                if (username === undefined) {
                    throw new UpstreamError('usgs', 'unauthorized', { status: 500 });
                }
                return permissions.get(username) ?? [];
            }),
        logout: (apiKey) =>
            promised(() => {
                recorder.enter('logout', [apiKey]);
                sessions.delete(apiKey);
            }),
        request: (apiKey, endpoint, payload) =>
            promised(() => {
                recorder.enter('request', [apiKey, endpoint, payload]);
                if (!sessions.has(apiKey)) {
                    throw new UpstreamError('usgs', 'unauthorized', { status: 500 });
                }
                return answers.get(endpoint) ?? null;
            }),
    };
    const approve = (): void => {
        permissions.set(USGS_CREDENTIALS.pending.username, ['user', 'download', 'order']);
    };
    return { usgs, sessions, approve, recorder, answers };
}
