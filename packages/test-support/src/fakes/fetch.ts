/**
 * The fake `fetch` every adapter test and every fake upstream shares (docs/research/M2-interfaces.md §7): a handler
 * answers a request it knows, every call is recorded, and a request nothing answers rejects like a network failure
 * (and is listed in `unhandled`), so an adapter that calls the wrong URL fails its test instead of reading a 404.
 */

/** One request as a fake upstream sees it: the method, the absolute URL, the headers and the body read as text. */
export interface UpstreamRequest {
    readonly method: string;
    readonly url: URL;
    readonly headers: Headers;
    readonly body: string;
}

/** A fake's answer, named by the operation it played (`mapbox.tokens.create`) so tests can find the call. */
export interface FakeAnswer {
    readonly operation: string;
    readonly response: Response;
}

/** Answers the requests it knows; undefined for the rest. */
export type UpstreamHandler = (request: UpstreamRequest) => Promise<FakeAnswer | undefined> | FakeAnswer | undefined;

/** A call as the fake saw it. */
export interface RecordedCall {
    readonly seq: number;
    /** The operation of the answer, or `unhandled`. */
    readonly operation: string;
    readonly method: string;
    readonly url: string;
    /** Lower-case names. Test credentials only: never a real token reaches a fake. */
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    /** 0 when nothing answered. */
    readonly status: number;
}

export interface FakeFetch {
    /** Pass this wherever an adapter takes `fetch`. */
    readonly fetch: typeof fetch;
    /** Every call, oldest first (unhandled ones included). */
    readonly calls: readonly RecordedCall[];
    /** The calls no handler answered (each one rejected its fetch). */
    readonly unhandled: readonly RecordedCall[];
    /** The calls of one operation (`mapbox.tokens.create`) or of every operation below it (`mapbox.tokens`). */
    callsTo(operation: string): readonly RecordedCall[];
    /**
     * Answers and records one request without fetch's semantics (the HTTP server uses it): undefined, and nothing
     * recorded, when no handler knows the request.
     */
    answer(request: UpstreamRequest): Promise<FakeAnswer | undefined>;
}

/** Reads a fetch's arguments the way `fetch` does (a `Request`, a URL or a string, plus `init`). */
async function upstreamRequest(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<UpstreamRequest> {
    const request = new Request(input, init);
    return { method: request.method.toUpperCase(), url: new URL(request.url), headers: request.headers, body: await request.text() };
}

function headerRecord(headers: Headers): Record<string, string> {
    return Object.fromEntries([...headers.entries()].map(([name, value]) => [name.toLowerCase(), value]));
}

/** Calls of `operation` itself or below it (`mapbox.tokens` matches `mapbox.tokens.create`). */
function callsTo(calls: readonly RecordedCall[], operation: string): readonly RecordedCall[] {
    return calls.filter((call) => call.operation === operation || call.operation.startsWith(`${operation}.`));
}

/** A recording `fetch` over `handler`. */
export function createFakeFetch(handler: UpstreamHandler): FakeFetch {
    const calls: RecordedCall[] = [];
    const unhandled: RecordedCall[] = [];
    const record = (request: UpstreamRequest, operation: string, status: number): RecordedCall => {
        const call = {
            seq: calls.length + 1,
            operation,
            method: request.method,
            url: request.url.toString(),
            headers: headerRecord(request.headers),
            body: request.body,
            status,
        };
        calls.push(call);
        return call;
    };
    const answer = async (request: UpstreamRequest): Promise<FakeAnswer | undefined> => {
        const answered = await handler(request);
        if (answered !== undefined) {
            record(request, answered.operation, answered.response.status);
        }
        return answered;
    };
    const fakeFetch = async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
        const request = await upstreamRequest(input, init);
        const answered = await answer(request);
        if (answered === undefined) {
            unhandled.push(record(request, 'unhandled', 0));
            throw new TypeError(`fetch failed: no fake answers ${request.method} ${request.url.origin}${request.url.pathname}`);
        }
        return answered.response;
    };
    return { fetch: fakeFetch, calls, unhandled, callsTo: (operation) => callsTo(calls, operation), answer };
}
