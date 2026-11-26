import type { FakeAnswer, UpstreamHandler, UpstreamRequest } from './fetch.js';

/**
 * A route table for fake upstreams: `route('POST', 'https://api.mapbox.com/tokens/v2/{user}', 'mapbox.tokens.create',
 * answer)`. A pattern is an absolute URL without a query; `{name}` matches one path segment (`[^/]+`, so a Google
 * custom verb such as `{service}:enable` still splits), `{name*}` the rest of the path (an operation name with
 * slashes). Parameters arrive decoded; the query is read from `request.url.searchParams`. The first matching route
 * answers, so list a custom verb before the plain resource.
 */

export type RouteParams = Readonly<Record<string, string>>;

export type RouteAnswer = (request: UpstreamRequest, params: RouteParams) => Promise<Response> | Response;

export interface Route {
    readonly method: string;
    readonly host: string;
    readonly path: RegExp;
    readonly names: readonly string[];
    readonly operation: string;
    readonly answer: RouteAnswer;
}

const PARAM = /\{(\w+)(\*?)\}/g;

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Compiles the path of a pattern into an anchored expression and the parameter names in order. */
function compile(pathname: string): { readonly path: RegExp; readonly names: string[] } {
    const names: string[] = [];
    let source = '';
    let last = 0;
    for (const match of pathname.matchAll(PARAM)) {
        source += escapeRegExp(pathname.slice(last, match.index));
        names.push(String(match[1]));
        source += match[2] === '*' ? '(.+)' : '([^/]+)';
        last = match.index + match[0].length;
    }
    source += escapeRegExp(pathname.slice(last));
    return { path: new RegExp(`^${source}$`), names };
}

/** One route. `pattern` is `https://<host><path>`; braces are kept literal by the URL parser (`%7B` decoded back). */
export function route(method: string, pattern: string, operation: string, answer: RouteAnswer): Route {
    const url = new URL(pattern);
    const { path, names } = compile(decodeURI(url.pathname));
    return { method: method.toUpperCase(), host: url.hostname, path, names, operation, answer };
}

function paramsOf(match: RegExpExecArray, names: readonly string[]): RouteParams {
    return Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(String(match[index + 1]))]));
}

/** The first route that matches the request's method, host and path, with its parameters; undefined for none. */
export function matchRoute(
    routes: readonly Route[],
    request: UpstreamRequest,
): { readonly route: Route; readonly params: RouteParams } | undefined {
    for (const candidate of routes) {
        const match =
            candidate.method === request.method && candidate.host === request.url.hostname
                ? candidate.path.exec(request.url.pathname)
                : null;
        if (match !== null) {
            return { route: candidate, params: paramsOf(match, candidate.names) };
        }
    }
    return undefined;
}

/** A handler that answers with the first matching route (adapter tests build their own small tables with it). */
export function routeTable(routes: readonly Route[]): UpstreamHandler {
    return async (request): Promise<FakeAnswer | undefined> => {
        const found = matchRoute(routes, request);
        return found === undefined
            ? undefined
            : { operation: found.route.operation, response: await found.route.answer(request, found.params) };
    };
}

/** A JSON response (`status` 200 by default). */
export function jsonResponse(body: unknown, status = 200, headers: Readonly<Record<string, string>> = {}): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

/** The JSON body of a request, or undefined when it is empty or not JSON. */
function requestJson(request: UpstreamRequest): unknown {
    try {
        return JSON.parse(request.body) as unknown;
    } catch {
        return undefined;
    }
}

/** The JSON object body of a request; `{}` for anything else. */
export function requestObject(request: UpstreamRequest): Readonly<Record<string, unknown>> {
    const body = requestJson(request);
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Readonly<Record<string, unknown>>) : {};
}

/** A field of a JSON object body, or undefined. */
export function bodyField(request: UpstreamRequest, field: string): unknown {
    return requestObject(request)[field];
}

/** The value at a dotted path (`notificationsRule.pubsubTopic`), or undefined. */
function valueAt(body: Readonly<Record<string, unknown>>, path: readonly string[]): unknown {
    return path.reduce<unknown>(
        (current, key) => (typeof current === 'object' && current !== null ? (current as Record<string, unknown>)[key] : undefined),
        body,
    );
}

/** `target` with `value` set at a dotted path, the objects on the way copied. */
function withValue(target: Readonly<Record<string, unknown>>, path: readonly string[], value: unknown): Record<string, unknown> {
    const [head = '', ...rest] = path;
    const inner = target[head];
    const child = typeof inner === 'object' && inner !== null ? (inner as Readonly<Record<string, unknown>>) : {};
    return { ...target, [head]: rest.length === 0 ? value : withValue(child, rest, value) };
}

/** A PATCH: the fields of `updateMask` (every top-level field of the body without one) copied from the body. */
export function applyMask(
    target: Readonly<Record<string, unknown>>,
    body: Readonly<Record<string, unknown>>,
    updateMask: string | null,
): Readonly<Record<string, unknown>> {
    const paths = (updateMask ?? Object.keys(body).join(',')).split(',').filter((path) => path !== '');
    return paths.reduce((current, path) => withValue(current, path.split('.'), valueAt(body, path.split('.'))), target);
}
