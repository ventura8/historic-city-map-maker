import { fixtureResponse, type FixtureName } from '../api-fixtures/index.js';
import {
    findToken,
    mapboxAuthorized,
    MAPBOX_TOKENS,
    PUBLIC_SCOPES,
    type MapboxAnswer,
    type MapboxPlan,
    type MapboxState,
    type MapboxToken,
} from './mapbox-state.js';
import { styleRoutes, tilesetRoutes } from './mapbox-tilesets.js';
import { tileRoutes } from './mapbox-tiles.js';
import { uploadRoutes } from './mapbox-uploads.js';
import { jsonResponse, requestObject, route, type Route } from './routes.js';
import { sequence, type FailureMode, type ServiceFake } from './service.js';

/**
 * Mapbox (`api.mapbox.com`): the Tokens API v2 for `setup.saveMapbox` and `setup.rotatePublicToken` (scenarios A05, A06),
 * plus the Tilesets API v1 and the styles list of mapbox-tilesets.ts and the published tiles of mapbox-tiles.ts (M3). Accounts have a plan: a `demo` account cannot
 * create tokens (403), a `billing-pending` one is blocked on its billing information (422). The secret tokens of
 * `MAPBOX_TOKENS` encode their scenario; a token the fake does not know is invalid (401 `TokenInvalid`).
 */

function tokenRecord(token: MapboxToken, withValue: boolean): Record<string, unknown> {
    return {
        client: 'api',
        usage: token.usage,
        id: token.id,
        default: token.isDefault,
        note: token.note,
        scopes: token.scopes,
        created: '2026-10-12T08:30:00.000Z',
        modified: '2026-10-12T08:30:00.000Z',
        ...(token.allowedUrls === undefined ? {} : { allowedUrls: token.allowedUrls }),
        ...(withValue || token.usage === 'pk' ? { token: token.value } : {}),
    };
}

const PLAN_REFUSALS: Readonly<Partial<Record<MapboxPlan, FixtureName>>> = {
    demo: 'mapbox/tokens.create.demo-account',
    'billing-pending': 'mapbox/tokens.create.billing',
};

function stringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const strings = value.filter((item): item is string => typeof item === 'string');
    return strings.length === value.length ? strings : undefined;
}

interface TokenFields {
    readonly scopes: string[];
    readonly note: string;
    readonly allowedUrls: string[] | undefined;
}

function tokenFields(body: Readonly<Record<string, unknown>>): TokenFields {
    return {
        scopes: stringArray(body['scopes']) ?? [],
        note: typeof body['note'] === 'string' ? body['note'] : '',
        allowedUrls: stringArray(body['allowedUrls']),
    };
}

type TokenRule = (fields: TokenFields, granted: readonly string[]) => string;

/** What Mapbox refuses in a token request (400 `{message}`); '' when a rule passes. */
const TOKEN_RULES: readonly TokenRule[] = [
    (fields) => (fields.scopes.length === 0 ? 'scopes must be a non-empty array of strings' : ''),
    (fields, granted) => {
        const missing = fields.scopes.filter((scope) => !granted.includes(scope));
        return missing.length > 0 ? `This token cannot grant scopes it does not have: ${missing.join(', ')}` : '';
    },
    (fields) =>
        fields.allowedUrls !== undefined && fields.scopes.some((scope) => !PUBLIC_SCOPES.includes(scope))
            ? 'allowedUrls are only valid for public tokens'
            : '',
];

function tokenProblem(fields: TokenFields, granted: readonly string[]): string {
    return TOKEN_RULES.map((rule) => rule(fields, granted)).find((problem) => problem !== '') ?? '';
}

const MAPBOX_FAILURES: Readonly<Partial<Record<FailureMode, FixtureName>>> = {
    unavailable: 'mapbox/error.unavailable',
    rateLimited: 'mapbox/error.rate-limited',
    unauthorized: 'mapbox/error.unauthorized',
    forbidden: 'mapbox/error.forbidden',
};

/** The named state changes of the fake Mapbox (`mapbox.<name>`). */
function mapboxScenarios(state: MapboxState): Record<string, () => void> {
    return {
        upgraded: () => {
            state.accounts.forEach((candidate) => {
                candidate.plan = 'paid';
            });
        },
        bootstrapRevoked: () => {
            state.accounts.forEach((candidate) => {
                const index = candidate.tokens.findIndex((token) => token.value === MAPBOX_TOKENS.bootstrap);
                if (index !== -1) {
                    candidate.tokens.splice(index, 1);
                }
            });
        },
        jobsFail: () => {
            state.jobOutcome = 'failed';
        },
        internalFailureOnce: () => {
            state.jobOutcomes.push('failed-internal');
        },
    };
}

/** The fake Mapbox's state as plain JSON. */
function mapboxSnapshot(state: MapboxState): unknown {
    return {
        accounts: Object.fromEntries(
            [...state.accounts].map(([user, owner]) => [
                user,
                {
                    plan: owner.plan,
                    tokens: owner.tokens.map((token) => tokenRecord(token, true)),
                    tilesets: [...owner.tilesets.keys()],
                    published: Object.fromEntries(
                        [...owner.tilesets.values()].flatMap((tileset) =>
                            tileset.published === undefined ? [] : [[tileset.id, tileset.published]],
                        ),
                    ),
                    sources: Object.fromEntries(owner.sources),
                    jobs: [...owner.jobs.values()],
                },
            ]),
        ),
        jobOutcome: state.jobOutcome,
    };
}

/** The fake Mapbox APIs. */
export function createMapboxFake(state: MapboxState): ServiceFake {
    const nextId = sequence('cle2e00minted', 13);
    const nextValue = sequence('e2e-minted-token-');
    const authToken = (request: Parameters<Route['answer']>[0]): readonly string[] =>
        findToken(state, request.url.searchParams.get('access_token'))?.token.scopes ?? [];
    const retrieve: Route['answer'] = (request) => {
        const found = findToken(state, request.url.searchParams.get('access_token'));
        if (found === undefined) {
            return fixtureResponse('mapbox/tokens.retrieve.invalid');
        }
        const name = found.token.usage === 'sk' ? 'mapbox/tokens.retrieve.secret' : 'mapbox/tokens.retrieve.public';
        return fixtureResponse(name, { values: { mapboxUser: found.user, tokenId: found.token.id } });
    };
    const create: MapboxAnswer = (request, _params, owner) => {
        const refusal = PLAN_REFUSALS[owner.plan];
        if (refusal !== undefined) {
            return fixtureResponse(refusal);
        }
        const asked = tokenFields(requestObject(request));
        const problem = tokenProblem(asked, authToken(request));
        if (problem !== '') {
            return jsonResponse({ message: problem }, 400);
        }
        const usage = asked.scopes.every((scope) => PUBLIC_SCOPES.includes(scope)) ? 'pk' : 'sk';
        const token: MapboxToken = {
            id: nextId(),
            usage,
            note: asked.note,
            scopes: asked.scopes,
            allowedUrls: asked.allowedUrls,
            value: `${usage}.${nextValue()}`,
            isDefault: false,
        };
        owner.tokens.push(token);
        return jsonResponse(tokenRecord(token, true), 201);
    };
    const update: MapboxAnswer = (request, params, owner) => {
        const token = owner.tokens.find((candidate) => candidate.id === params['tokenId']);
        if (token === undefined) {
            return fixtureResponse('mapbox/error.not-found');
        }
        const asked = tokenFields({ scopes: token.scopes, note: token.note, allowedUrls: token.allowedUrls, ...requestObject(request) });
        const problem = tokenProblem(asked, authToken(request));
        if (problem !== '') {
            return jsonResponse({ message: problem }, 400);
        }
        Object.assign(token, asked);
        return jsonResponse(tokenRecord(token, true));
    };
    const remove: MapboxAnswer = (_request, params, owner) => {
        const index = owner.tokens.findIndex((candidate) => candidate.id === params['tokenId']);
        if (index === -1) {
            return fixtureResponse('mapbox/error.not-found');
        }
        owner.tokens.splice(index, 1);
        return new Response(null, { status: 204 });
    };
    const base = 'https://api.mapbox.com/tokens/v2';
    return {
        name: 'mapbox',
        routes: [
            route('GET', base, 'mapbox.tokens.retrieve', retrieve),
            route(
                'GET',
                `${base}/{user}`,
                'mapbox.tokens.list',
                mapboxAuthorized(state, 'tokens:read', (_request, _params, owner) =>
                    jsonResponse(owner.tokens.map((token) => tokenRecord(token, false))),
                ),
            ),
            route('POST', `${base}/{user}`, 'mapbox.tokens.create', mapboxAuthorized(state, 'tokens:write', create)),
            route('PATCH', `${base}/{user}/{tokenId}`, 'mapbox.tokens.update', mapboxAuthorized(state, 'tokens:write', update)),
            route('DELETE', `${base}/{user}/{tokenId}`, 'mapbox.tokens.delete', mapboxAuthorized(state, 'tokens:write', remove)),
            ...tilesetRoutes(state),
            ...styleRoutes(state),
            ...tileRoutes(state),
            ...uploadRoutes(state),
        ],
        failure: (mode) => {
            const name = MAPBOX_FAILURES[mode];
            return name === undefined ? undefined : fixtureResponse(name);
        },
        scenarios: mapboxScenarios(state),
        snapshot: () => mapboxSnapshot(state),
    };
}
