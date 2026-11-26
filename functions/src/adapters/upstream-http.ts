/**
 * The HTTP plumbing of the fn-setup REST adapters (Mapbox, USGS M2M, Secret Manager, Firebase Management, Resource
 * Manager): one `fetch` call that never lets its URL, headers or body into an error, and the mapping of a failed answer
 * to the `UpstreamError` a handler reads (docs/research/M2-interfaces.md §4.1). Google APIs, Mapbox and USGS put
 * credentials in query strings or headers, so nothing here ever logs or rethrows what `fetch` itself reported.
 */
import { UpstreamError, type UpstreamFailure, type UpstreamService } from '../ports/errors.js';

export type Fetch = typeof fetch;

/** Every outside call gives up after this long: a hung upstream must not hold a callable until its own timeout. */
export const UPSTREAM_TIMEOUT_MS = 20_000;

/** Statuses that say something specific; any other 5xx is `unavailable`, any other answer `invalid`. */
const FAILURE_BY_STATUS: ReadonlyMap<number, UpstreamFailure> = new Map([
    [400, 'invalid'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'notFound'],
    [409, 'conflict'],
    [412, 'conflict'],
    [422, 'invalid'],
    [429, 'rateLimited'],
]);

const SERVER_ERROR = 500;

export function failureOfStatus(status: number): UpstreamFailure {
    return FAILURE_BY_STATUS.get(status) ?? (status >= SERVER_ERROR ? 'unavailable' : 'invalid');
}

/** `Retry-After` in seconds (the HTTP-date form is ignored: callers fall back to their own backoff). */
function retryAfterSeconds(headers: Headers): number | undefined {
    const value = headers.get('retry-after') ?? '';
    return /^\d{1,6}$/.test(value) ? Number(value) : undefined;
}

/** The status and the `Retry-After` hint of a failed answer, as `UpstreamError` takes them. */
export function errorDetails(response: Response): { readonly status: number; readonly retryAfterSeconds?: number } {
    const retryAfter = retryAfterSeconds(response.headers);
    return retryAfter === undefined ? { status: response.status } : { status: response.status, retryAfterSeconds: retryAfter };
}

/** The error for a failed answer: the failure of its status unless the caller read a better one from the body. */
export function upstreamError(
    service: UpstreamService,
    response: Response,
    failure: UpstreamFailure = failureOfStatus(response.status),
): UpstreamError {
    return new UpstreamError(service, failure, errorDetails(response));
}

/** The `reason` of the `unavailable` error a request that ran out of its time fails with (lesson 676: the harvest records it). */
export const TIMED_OUT_REASON = 'TIMED_OUT';

/**
 * One request with a timeout (`init.timeoutMs`, `UPSTREAM_TIMEOUT_MS` by default), its own `AbortController` aborting it. A network
 * failure, a refused connection or the timeout is `unavailable` (the timeout's `reason` `TIMED_OUT`); the original error is dropped on
 * purpose (its message or cause may hold the URL, and with it a token).
 */
export async function send(
    fetchFn: Fetch,
    service: UpstreamService,
    url: string,
    init: RequestInit & { readonly timeoutMs?: number },
): Promise<Response> {
    const { timeoutMs = UPSTREAM_TIMEOUT_MS, ...request } = init;
    const controller = new AbortController();
    const timer = setTimeout(() => {
        controller.abort();
    }, timeoutMs);
    try {
        return await fetchFn(url, { ...request, signal: controller.signal });
    } catch {
        throw new UpstreamError(service, 'unavailable', controller.signal.aborted ? { reason: TIMED_OUT_REASON } : {});
    } finally {
        clearTimeout(timer);
    }
}

/** The body as JSON, or undefined for anything else (an HTML error page, an empty 204, a broken stream). */
export async function readJson(response: Response): Promise<unknown> {
    let text: string;
    try {
        text = await response.text();
    } catch {
        return undefined;
    }
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return undefined;
    }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The value at `path` inside nested objects, or undefined as soon as a step is not an object. */
export function at(value: unknown, ...path: readonly string[]): unknown {
    return path.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value);
}

/** The string at `path`, or undefined. */
export function stringAt(value: unknown, ...path: readonly string[]): string | undefined {
    const found = at(value, ...path);
    return typeof found === 'string' ? found : undefined;
}

/** The entries of an array; not an array → empty. */
export function list(value: unknown): readonly unknown[] {
    return Array.isArray(value) ? (value as readonly unknown[]) : [];
}

/** The strings of an array (other entries dropped); not an array → empty. */
export function strings(value: unknown): string[] {
    return list(value).filter((entry): entry is string => typeof entry === 'string');
}
