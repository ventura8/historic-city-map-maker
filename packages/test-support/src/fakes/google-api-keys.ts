import { FIXTURE_VALUES, fixtureBody } from '../api-fixtures/index.js';
import { authenticated, googleError, googleFailure, type GoogleApi, type GoogleProjects } from './google-common.js';
import { applyMask, jsonResponse, requestObject, route, type Route, type RouteParams } from './routes.js';
import { sequence, type ServiceFake } from './service.js';

/**
 * API Keys v2 for the `api-key` doctor item (`docs/research/M2b-interfaces.md` §3.4 item 13): every project has the
 * browser key Firebase created with its web app (its string is `FIXTURE_VALUES.apiKey`, the web configuration's), with
 * API targets and no referrer restriction. A `PATCH` is a long-running operation, done at once.
 */

interface ApiKey {
    readonly body: Readonly<Record<string, unknown>>;
    readonly keyString: string;
}

export interface ApiKeysState {
    /** Project id → its keys (created with the browser key on first use). */
    readonly projects: Map<string, ApiKey[]>;
}

const API_KEYS: GoogleApi = { service: 'apikeys.googleapis.com', title: 'API Keys API', permission: 'apikeys.keys.update' };

/** The fake API Keys API. */
export function createApiKeysFake(state: ApiKeysState, projects: GoogleProjects): ServiceFake {
    const nextOperation = sequence('operations/akmf.p7-e2e-');
    const keysOf = (params: RouteParams): ApiKey[] => {
        const project = projects.resolve(String(params['project']));
        const existing = state.projects.get(project.id);
        if (existing !== undefined) {
            return existing;
        }
        const created = [
            {
                body: fixtureBody('api-keys/key.get', { projectNumber: project.number }) as Record<string, unknown>,
                keyString: String(FIXTURE_VALUES['apiKey']),
            },
        ];
        state.projects.set(project.id, created);
        return created;
    };
    const withKey = (params: RouteParams, answer: (key: ApiKey, index: number, keys: ApiKey[]) => Response): Response => {
        const keys = keysOf(params);
        const index = keys.findIndex((key) => String(key.body['name']).endsWith(`/keys/${String(params['key'])}`));
        const key = keys[index];
        return key === undefined ? googleError('google/error.not-found', API_KEYS) : answer(key, index, keys);
    };
    const patch: Route['answer'] = (request, params) =>
        withKey(params, (key, index, keys) => {
            keys[index] = { ...key, body: applyMask(key.body, requestObject(request), request.url.searchParams.get('updateMask')) };
            return jsonResponse(fixtureBody('api-keys/operation.done', { operationName: nextOperation() }));
        });
    const base = 'https://apikeys.googleapis.com/v2/projects/{project}/locations/global/keys';
    const auth = (answer: Route['answer']): Route['answer'] => authenticated(API_KEYS, answer);
    return {
        name: 'api-keys',
        routes: [
            route(
                'GET',
                base,
                'api-keys.list',
                auth((_request, params) => jsonResponse({ keys: keysOf(params).map((key) => key.body) })),
            ),
            route(
                'GET',
                `${base}/{key}/keyString`,
                'api-keys.getKeyString',
                auth((_request, params) =>
                    withKey(params, (key) => jsonResponse(fixtureBody('api-keys/key-string.get', { apiKey: key.keyString }))),
                ),
            ),
            route('PATCH', `${base}/{key}`, 'api-keys.patch', auth(patch)),
            route(
                'GET',
                'https://apikeys.googleapis.com/v2/operations/{operation*}',
                'api-keys.getOperation',
                auth((_request, params) =>
                    jsonResponse(fixtureBody('api-keys/operation.done', { operationName: `operations/${String(params['operation'])}` })),
                ),
            ),
        ],
        failure: (mode) => googleFailure(API_KEYS, mode),
        scenarios: {},
        snapshot: () => ({ projects: Object.fromEntries([...state.projects].map(([id, keys]) => [id, keys.map((key) => key.body)])) }),
    };
}
