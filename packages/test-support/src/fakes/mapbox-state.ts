import { FIXTURE_VALUES, fixtureResponse } from '../api-fixtures/index.js';
import type { Route, RouteParams } from './routes.js';

/**
 * The state of the fake Mapbox (mapbox.ts, mapbox-tilesets.ts): accounts with a plan, their tokens, tileset sources,
 * tilesets and publish jobs, and the token check every Mapbox API makes.
 */

/** The scenario tokens (each passes `classifyMapboxToken` as the kind it names). */
export const MAPBOX_TOKENS = {
    /** `e2e-mapbox`, a paid account; every bootstrap scope. */
    bootstrap: 'sk.e2e-bootstrap-all-scopes',
    /** `e2e-mapbox`; lacks `tilesets:write` and `tokens:write` (S-A06-BAD-MISSING-SCOPES). */
    missingScopes: 'sk.e2e-bootstrap-missing-scopes',
    /** `e2e-mapbox-trial`, a demo account: Mapbox refuses to create tokens (S-A05-BAD-TRIAL). */
    trial: 'sk.e2e-bootstrap-trial-account',
    /** `e2e-mapbox-billing`, blocked on "confirm billing information" (S-A05-BAD-MISSING-BILLING-ADDRESS). */
    billingPending: 'sk.e2e-bootstrap-billing-pending',
    /** Unknown to the fake: revoked (S-A06-BAD-REVOKED). */
    revoked: 'sk.e2e-bootstrap-revoked',
    /** `e2e-mapbox`'s default public token (a `pk` pasted by mistake: S-A06-BAD-PUBLIC-TOKEN-PASTED). */
    defaultPublic: 'pk.e2e-default-public-token',
    /** `e2e-mapbox`'s tiles token (`mapbox-sk-tiles`, the M3 publisher's): `tilesets:read`, `:write`, `:list`. */
    tiles: 'sk.e2e-tiles-token',
} as const;

export type MapboxPlan = 'paid' | 'demo' | 'billing-pending';

export interface MapboxToken {
    readonly id: string;
    usage: 'pk' | 'sk';
    note: string;
    scopes: readonly string[];
    allowedUrls: readonly string[] | undefined;
    readonly value: string;
    readonly isDefault: boolean;
}

/** What a publish of a tileset produced: its tiles' zoom range (from the recipe), and the job that made them. */
export interface PublishedTiles {
    readonly minzoom: number;
    readonly maxzoom: number;
    readonly jobId: string;
}

interface MapboxTileset {
    readonly id: string;
    readonly name: string;
    /** When the fake created it (ISO 8601), as Mapbox's listing reports it. */
    readonly created?: string;
    recipe: unknown;
    /** Set when a publish job succeeded (the TileJSON and the tiles answer from then on). */
    published?: PublishedTiles;
}

/** How a publish job ends: success, a failure of the data or the recipe, or a failure on Mapbox's side. */
export type MapboxJobOutcome = 'success' | 'failed' | 'failed-internal';

export interface MapboxJob {
    readonly id: string;
    readonly tilesetId: string;
    readonly outcome: MapboxJobOutcome;
    /** When it was created (epoch milliseconds), as the jobs listing reports it. */
    readonly created: number;
    stage: 'queued' | 'processing' | 'success' | 'failed' | 'failed-internal';
}

/** A tileset source as uploaded (`size`: the bytes Mapbox received). */
interface MapboxSource {
    files: number;
    size: number;
}

interface MapboxAccount {
    plan: MapboxPlan;
    readonly tokens: MapboxToken[];
    readonly sources: Map<string, MapboxSource>;
    readonly tilesets: Map<string, MapboxTileset>;
    readonly jobs: Map<string, MapboxJob>;
}

export interface MapboxState {
    /** Username → account. */
    readonly accounts: Map<string, MapboxAccount>;
    /** How a publish job ends once polled past `processing`, unless `jobOutcomes` says otherwise. */
    jobOutcome: MapboxJobOutcome;
    /** The outcomes of the next publish jobs, first first (`mapbox.internalFailureOnce`); then `jobOutcome`. */
    readonly jobOutcomes: MapboxJobOutcome[];
}

/** What Mapbox lets a public token hold; any other scope makes a token secret. */
export const PUBLIC_SCOPES: readonly string[] = ['styles:tiles', 'styles:read', 'fonts:read', 'datasets:read', 'vision:read'];
/** The tiles token's scopes (`setup.saveMapbox` mints it as `mapbox-sk-tiles`). */
const TILES_SCOPES = ['tilesets:read', 'tilesets:write', 'tilesets:list'];
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

function account(plan: MapboxPlan, tokens: MapboxToken[]): MapboxAccount {
    return { plan, tokens, sources: new Map(), tilesets: new Map(), jobs: new Map() };
}

function secret(id: string, value: string, scopes: readonly string[]): MapboxToken {
    return { id, usage: 'sk', note: 'historic-map-server', scopes, allowedUrls: undefined, value, isDefault: false };
}

export function defaultMapboxState(): MapboxState {
    const defaultPublic: MapboxToken = {
        id: 'cle2e0000default0000000001',
        usage: 'pk',
        note: 'Default public token',
        scopes: PUBLIC_SCOPES,
        allowedUrls: undefined,
        value: MAPBOX_TOKENS.defaultPublic,
        isDefault: true,
    };
    const missing = BOOTSTRAP_SCOPES.filter((scope) => scope !== 'tilesets:write' && scope !== 'tokens:write');
    return {
        accounts: new Map([
            [
                String(FIXTURE_VALUES['mapboxUser']),
                account('paid', [
                    defaultPublic,
                    secret(String(FIXTURE_VALUES['tokenId']), MAPBOX_TOKENS.bootstrap, BOOTSTRAP_SCOPES),
                    secret('cle2e00token00000000000002', MAPBOX_TOKENS.missingScopes, missing),
                    secret('cle2e00token00000000000005', MAPBOX_TOKENS.tiles, TILES_SCOPES),
                ]),
            ],
            ['e2e-mapbox-trial', account('demo', [secret('cle2e00token00000000000003', MAPBOX_TOKENS.trial, BOOTSTRAP_SCOPES)])],
            [
                'e2e-mapbox-billing',
                account('billing-pending', [secret('cle2e00token00000000000004', MAPBOX_TOKENS.billingPending, BOOTSTRAP_SCOPES)]),
            ],
        ]),
        jobOutcome: 'success',
        jobOutcomes: [],
    };
}

/** A token's owner and record, or undefined for a token the fake does not know. */
export function findToken(state: MapboxState, value: string | null): { readonly user: string; readonly token: MapboxToken } | undefined {
    for (const [user, candidate] of state.accounts) {
        const token = candidate.tokens.find((item) => item.value === value);
        if (token !== undefined) {
            return { user, token };
        }
    }
    return undefined;
}

export type MapboxAnswer = (request: Parameters<Route['answer']>[0], params: RouteParams, owner: MapboxAccount) => Response;

/**
 * Wraps a route of `user`'s resources: the `access_token` must be a token of that user (else 401, or 403 for another
 * user's token) holding `scope` (else 403).
 */
export function mapboxAuthorized(
    state: MapboxState,
    scope: string,
    answer: MapboxAnswer,
    userOf = (params: RouteParams): string => String(params['user']),
): Route['answer'] {
    return (request, params) => {
        const found = findToken(state, request.url.searchParams.get('access_token'));
        if (found === undefined) {
            return fixtureResponse('mapbox/error.unauthorized');
        }
        const owner = state.accounts.get(found.user);
        if (owner === undefined || found.user !== userOf(params) || !found.token.scopes.includes(scope)) {
            return fixtureResponse('mapbox/error.forbidden');
        }
        return answer(request, params, owner);
    };
}
