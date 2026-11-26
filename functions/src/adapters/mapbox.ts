import { UpstreamError } from '../ports/errors.js';
import type { MapboxApi } from '../ports/mapbox-api.js';
import { at, readJson, send, stringAt, strings, upstreamError, type Fetch } from './upstream-http.js';

/**
 * The Mapbox Tokens API (`/tokens/v2`, onboarding review §2B) over REST with `fetch` (the tilesets list and the rest of
 * MTS live in `mapbox-tilesets.ts` since M3, CR-M3-4). The token travels as the `access_token` query parameter, as Mapbox requires, so no URL is ever logged or
 * put in an error; a pagination link is followed only on `api.mapbox.com`.
 *
 * Failures (`UpstreamError('mapbox', …)`): 401 or a `code` other than `TokenValid` → `unauthorized`; 403 (a missing
 * scope, or an account that may not create tokens: the demo plan) → `forbidden`; 422 (billing details not confirmed,
 * a refused scope or URL) → `invalid`; 429 → `rateLimited` with `Retry-After`; 5xx and network → `unavailable`; an
 * unreadable answer → `invalid`.
 */
export const MAPBOX_API = 'https://api.mapbox.com';

type TokenCheck = Awaited<ReturnType<MapboxApi['retrieveToken']>>;
type TokenRecord = Awaited<ReturnType<MapboxApi['listTokens']>>[number];
type TokenRequest = Parameters<MapboxApi['createToken']>[2];
type MintedToken = Awaited<ReturnType<MapboxApi['createToken']>>;
type Usage = TokenRecord['usage'];

const SERVICE = 'mapbox';
const USAGES: readonly Usage[] = ['pk', 'sk', 'tk'];
/** Tokens per page (the API's maximum) and how many pages are read at most (500 tokens). */
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

function isUsage(value: unknown): value is Usage {
    return USAGES.some((usage) => usage === value);
}

function apiUrl(path: string, token: string, query: Readonly<Record<string, string>> = {}): string {
    const url = new URL(path, MAPBOX_API);
    for (const [name, value] of Object.entries(query)) {
        url.searchParams.set(name, value);
    }
    url.searchParams.set('access_token', token);
    return url.toString();
}

const tokensPath = (user: string, tokenId?: string): string =>
    tokenId === undefined
        ? `/tokens/v2/${encodeURIComponent(user)}`
        : `/tokens/v2/${encodeURIComponent(user)}/${encodeURIComponent(tokenId)}`;

function invalid(): UpstreamError {
    return new UpstreamError(SERVICE, 'invalid');
}

function toTokenCheck(body: unknown, response: Response): TokenCheck {
    if (at(body, 'code') !== 'TokenValid') {
        throw upstreamError(SERVICE, response, 'unauthorized');
    }
    const user = stringAt(body, 'token', 'user');
    const usage = at(body, 'token', 'usage');
    const tokenId = stringAt(body, 'token', 'authorization');
    if (user === undefined || !isUsage(usage) || tokenId === undefined) {
        throw invalid();
    }
    return { user, usage, tokenId };
}

/** One entry of the token list; an entry without an id or a known usage is dropped. */
function toTokenRecord(entry: unknown): TokenRecord[] {
    const id = stringAt(entry, 'id');
    const usage = at(entry, 'usage');
    if (id === undefined || !isUsage(usage)) {
        return [];
    }
    const allowedUrls = at(entry, 'allowedUrls');
    const record = { id, usage, note: stringAt(entry, 'note') ?? '', scopes: strings(at(entry, 'scopes')) };
    return [Array.isArray(allowedUrls) ? { ...record, allowedUrls: strings(allowedUrls) } : record];
}

/** The `<url>` of the `rel="next"` part of a `Link` header (`<https://api.mapbox.com/…>; rel="next"`). */
function nextLinkTarget(link: string | null): URL | null {
    const part = (link ?? '').split(',').find((entry) => entry.includes('rel="next"'));
    return part === undefined ? null : URL.parse(part.slice(part.indexOf('<') + 1, part.indexOf('>')));
}

/** The next page of a `Link` header, with the token set again; never a URL outside `api.mapbox.com`. */
function nextPage(link: string | null, token: string): string | undefined {
    const url = nextLinkTarget(link);
    if (url?.origin !== MAPBOX_API) {
        return undefined;
    }
    url.searchParams.set('access_token', token);
    return url.toString();
}

function toMinted(body: unknown): MintedToken {
    const id = stringAt(body, 'id');
    const token = stringAt(body, 'token');
    if (id === undefined || token === undefined) {
        throw invalid();
    }
    return { id, token };
}

function tokenBody(request: TokenRequest): string {
    const body = { note: request.note, scopes: [...request.scopes] };
    return JSON.stringify(request.allowedUrls === undefined ? body : { ...body, allowedUrls: [...request.allowedUrls] });
}

export function createMapboxApi(options: { readonly fetch: Fetch }): MapboxApi {
    async function call(method: string, url: string, body?: string): Promise<Response> {
        const init: RequestInit = body === undefined ? { method } : { method, body, headers: { 'content-type': 'application/json' } };
        const response = await send(options.fetch, SERVICE, url, init);
        if (!response.ok) {
            throw upstreamError(SERVICE, response);
        }
        return response;
    }

    async function listPage(url: string, token: string): Promise<{ readonly records: TokenRecord[]; readonly next: string | undefined }> {
        const response = await call('GET', url);
        const body = await readJson(response);
        if (!Array.isArray(body)) {
            throw invalid();
        }
        return { records: body.flatMap(toTokenRecord), next: nextPage(response.headers.get('link'), token) };
    }

    async function mint(method: 'POST' | 'PATCH', url: string, request: TokenRequest): Promise<MintedToken> {
        return toMinted(await readJson(await call(method, url, tokenBody(request))));
    }

    return {
        retrieveToken: async (token) => {
            const response = await send(options.fetch, SERVICE, apiUrl('/tokens/v2', token), { method: 'GET' });
            if (!response.ok) {
                throw upstreamError(SERVICE, response);
            }
            return toTokenCheck(await readJson(response), response);
        },
        listTokens: async (user, secretToken) => {
            const records: TokenRecord[] = [];
            let url: string | undefined = apiUrl(tokensPath(user), secretToken, { limit: String(PAGE_SIZE) });
            for (let page = 0; url !== undefined && page < MAX_PAGES; page += 1) {
                const result = await listPage(url, secretToken);
                records.push(...result.records);
                url = result.next;
            }
            return records;
        },
        createToken: (user, secretToken, request) => mint('POST', apiUrl(tokensPath(user), secretToken), request),
        updateToken: (user, secretToken, tokenId, request) => mint('PATCH', apiUrl(tokensPath(user, tokenId), secretToken), request),
        deleteToken: async (user, secretToken, tokenId) => {
            const response = await send(options.fetch, SERVICE, apiUrl(tokensPath(user, tokenId), secretToken), { method: 'DELETE' });
            if (!response.ok && response.status !== 404) {
                throw upstreamError(SERVICE, response);
            }
        },
    };
}
