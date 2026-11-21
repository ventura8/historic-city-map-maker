import { fixtureResponse, type FixtureName } from '../api-fixtures/index.js';
import { bodyField, route, type Route } from './routes.js';
import { sequence, type FailureMode, type ServiceFake } from './service.js';
import { sceneSearch, type SceneSearchState } from './usgs-catalogue.js';
import {
    defaultDownloadState,
    deliveryRoutes,
    downloadOptions,
    downloadOrderRemove,
    downloadRequest,
    downloadRetrieve,
    downloadScenarios,
    type DownloadState,
} from './usgs-downloads.js';

/**
 * USGS M2M (`m2m.cr.usgs.gov/api/api/json/stable/`, scenario A07; scene search and downloads for M3): `login-token`
 * trades an ERS username and application token for a two-hour API key (`X-Auth-Token`), `permissions` lists the
 * M2M roles, `logout` ends the key. The credentials of `USGS_CREDENTIALS` encode their scenario: approved, awaiting
 * the M2M approval (no `download` until `usgs.m2mApproved`), an expired token (HTML 403); anything else is
 * `AUTH_INVALID`. JSON errors arrive as HTTP 500 with an `errorCode`, as M2M sends them. The scenes over Bucharest and
 * their search are usgs-catalogue.ts, the download flow and the delivery host usgs-downloads.ts (M3).
 */

/** ERS usernames and application tokens (generated test values, never JWT-shaped). */
export const USGS_CREDENTIALS = {
    /** M2M access approved: `permissions` includes `download`. */
    approved: { username: 'e2e-ok', applicationToken: 'e2e-usgs-app-token-ok' },
    /** M2M access requested, not yet approved (S-A07-BAD-ROLE-PENDING). */
    pending: { username: 'e2e-m2m-pending', applicationToken: 'e2e-usgs-app-token-pending' },
    /** An expired application token: `login-token` answers the HTML 403 (S-A07-BAD-INVALID-TOKEN). */
    expired: { username: 'e2e-expired', applicationToken: 'e2e-usgs-app-token-expired' },
    /** An ERS account without M2M access: `login-token` answers `AUTH_UNAUTHROIZED` (sic) until `usgs.m2mApproved`. */
    noAccess: { username: 'e2e-no-m2m', applicationToken: 'e2e-usgs-app-token-no-m2m' },
    /** Unknown to USGS: `AUTH_INVALID`. */
    unknown: { username: 'e2e-bad', applicationToken: 'e2e-usgs-app-token-bad' },
} as const;

const APPROVED_PERMISSIONS = ['user', 'download', 'order'];

interface UsgsUser {
    readonly applicationToken: string;
    permissions: readonly string[];
    expired: boolean;
    /** False: the account may not use M2M at all (`login-token` refuses it). */
    m2mAccess: boolean;
}

export interface UsgsState extends SceneSearchState, DownloadState {
    /** ERS username → account. */
    readonly users: Map<string, UsgsUser>;
    /** API key → username, while the key is logged in. */
    readonly sessions: Map<string, string>;
}

export function defaultUsgsState(): UsgsState {
    return {
        users: new Map([
            [
                USGS_CREDENTIALS.approved.username,
                {
                    applicationToken: USGS_CREDENTIALS.approved.applicationToken,
                    permissions: APPROVED_PERMISSIONS,
                    expired: false,
                    m2mAccess: true,
                },
            ],
            [
                USGS_CREDENTIALS.pending.username,
                { applicationToken: USGS_CREDENTIALS.pending.applicationToken, permissions: ['user'], expired: false, m2mAccess: true },
            ],
            [
                USGS_CREDENTIALS.expired.username,
                {
                    applicationToken: USGS_CREDENTIALS.expired.applicationToken,
                    permissions: APPROVED_PERMISSIONS,
                    expired: true,
                    m2mAccess: true,
                },
            ],
            [
                USGS_CREDENTIALS.noAccess.username,
                { applicationToken: USGS_CREDENTIALS.noAccess.applicationToken, permissions: [], expired: false, m2mAccess: false },
            ],
        ]),
        sessions: new Map(),
        noScenes: false,
        failingDatasets: new Set(),
        landsat: false,
        ...defaultDownloadState(),
    };
}

/** Why `login-token` refuses `user` with `token`: unknown credentials, an expired token, no M2M access; else undefined. */
function loginRefusal(user: UsgsUser | undefined, token: unknown): FixtureName | undefined {
    if (user === undefined || user.applicationToken !== token) {
        return 'usgs/login-token.auth-invalid';
    }
    if (user.expired) {
        return 'usgs/login-token.html-403';
    }
    return user.m2mAccess ? undefined : 'usgs/login-token.no-m2m-access';
}

/** An M2M envelope around `data`. */
function m2m(data: unknown): Response {
    return fixtureResponse('usgs/logout.ok', { merge: { data } });
}

const FAILURES: Readonly<Partial<Record<FailureMode, FixtureName>>> = {
    maintenance: 'usgs/maintenance.html-503',
    rateLimited: 'usgs/error.rate-limit',
    unavailable: 'usgs/error.unavailable',
    unauthorized: 'usgs/login-token.html-403',
};

const BASE = 'https://m2m.cr.usgs.gov/api/api/json/stable';

type KeyedAnswer = (request: Parameters<Route['answer']>[0], user: UsgsUser, apiKey: string) => Promise<Response> | Response;
type Keyed = (answer: KeyedAnswer) => Route['answer'];

/**
 * Scene search and downloads (M3's harvest and scan downloads, usgs-catalogue.ts and usgs-downloads.ts): search works
 * with any key, a download request needs the `download` role.
 */
function sceneRoutes(state: UsgsState, keyed: Keyed): Route[] {
    const downloadRequested = keyed((request, user) =>
        user.permissions.includes('download') ? m2m(downloadRequest(request, state)) : fixtureResponse('usgs/login-token.no-m2m-access'),
    );
    return [
        route(
            'POST',
            `${BASE}/dataset-search`,
            'usgs.dataset-search',
            keyed(() => fixtureResponse('usgs/dataset-search.declass')),
        ),
        route(
            'POST',
            `${BASE}/scene-search`,
            'usgs.scene-search',
            keyed((request) => sceneSearch(request, state)),
        ),
        route(
            'POST',
            `${BASE}/download-options`,
            'usgs.download-options',
            keyed(async (request) => m2m(await downloadOptions(request, state))),
        ),
        route('POST', `${BASE}/download-request`, 'usgs.download-request', downloadRequested),
        route(
            'POST',
            `${BASE}/download-retrieve`,
            'usgs.download-retrieve',
            keyed((request) => m2m(downloadRetrieve(request, state))),
        ),
        route(
            'POST',
            `${BASE}/download-order-remove`,
            'usgs.download-order-remove',
            keyed((request) => {
                downloadOrderRemove(request, state);
                return fixtureResponse('usgs/download-order-remove.ok');
            }),
        ),
        ...deliveryRoutes(state),
    ];
}

/** The fake USGS M2M API and its download host. */
export function createUsgsFake(state: UsgsState): ServiceFake {
    const nextKey = sequence('e2e-usgs-api-key-');
    const login: Route['answer'] = (request) => {
        const username = bodyField(request, 'username');
        const refusal = loginRefusal(typeof username === 'string' ? state.users.get(username) : undefined, bodyField(request, 'token'));
        if (refusal !== undefined) {
            return fixtureResponse(refusal);
        }
        const apiKey = nextKey();
        state.sessions.set(apiKey, String(username));
        return fixtureResponse('usgs/login-token.ok', { values: { usgsApiKey: apiKey } });
    };
    /** Wraps an endpoint that needs a logged-in API key (`X-Auth-Token`). */
    const keyed: Keyed = (answer) => (request) => {
        const apiKey = request.headers.get('x-auth-token') ?? '';
        const user = state.users.get(state.sessions.get(apiKey) ?? '');
        return user === undefined ? fixtureResponse('usgs/error.api-key-invalid') : answer(request, user, apiKey);
    };
    return {
        name: 'usgs',
        routes: [
            route('POST', `${BASE}/login-token`, 'usgs.login-token', login),
            route(
                'POST',
                `${BASE}/permissions`,
                'usgs.permissions',
                keyed((_request, user) => m2m(user.permissions)),
            ),
            route(
                'POST',
                `${BASE}/logout`,
                'usgs.logout',
                keyed((_request, _user, apiKey) => {
                    state.sessions.delete(apiKey);
                    return m2m(null);
                }),
            ),
            ...sceneRoutes(state, keyed),
        ],
        failure: (mode) => {
            const name = FAILURES[mode];
            return name === undefined ? undefined : fixtureResponse(name);
        },
        scenarios: {
            m2mApproved: () => {
                state.users.forEach((user) => {
                    user.permissions = APPROVED_PERMISSIONS;
                    user.m2mAccess = true;
                });
            },
            tokenExpired: () => {
                state.users.forEach((user) => {
                    user.expired = true;
                });
            },
            noScenes: () => {
                state.noScenes = true;
            },
            declassiiiUnavailable: () => {
                state.failingDatasets.add('declassiii');
            },
            // M25: the harvest lists Landsat 5 TM's three scenes over the city.
            landsatScenes: () => {
                state.landsat = true;
            },
            ...downloadScenarios(state),
        },
        snapshot: () => ({
            users: Object.fromEntries(
                [...state.users].map(([name, user]) => [name, { permissions: user.permissions, expired: user.expired }]),
            ),
            sessions: state.sessions.size,
            downloads: [...state.downloads.values()],
            signatures: state.signatures.next,
        }),
    };
}
