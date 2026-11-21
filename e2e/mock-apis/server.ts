import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

import { TEST_HEADER } from '../fixtures/world.js';
import { answer, type MockFiles, type MockResponse } from './router.js';

/**
 * The two loopback servers of the e2e topology (docs/research/design-review-testability.md §4.1), plain `node:http`:
 *
 * - **mock APIs**: `/h/<host><path>` answers a forwarded request for a mocked host (router.ts) and records it;
 *   `GET /__calls[?test=<id>&host=<host>]` lists the records (oldest first), `POST /__reset[?test=<id>]` forgets them,
 *   `GET /__health` says the server is up. Extensions (`MockExtension`) answer first: the fake upstreams of
 *   `@hcm/test-support/fakes/http` (Google Cloud, Mapbox's Tokens and Tilesets APIs, USGS M2M, Nominatim; main.ts) and
 *   their `/__upstream/…` control endpoints, Google's consent stand-in (`/__oauth/…`, oauth.ts) and the admin tier's
 *   lease (`/__lease/…`, lease.ts); whatever an extension leaves unanswered falls through to router.ts.
 * - **site**: the built sites (`dist/e2e-site`) as GitHub Pages serves them: `index.html` for a folder, a redirect to
 *   the folder with its trailing slash, `cache-control: max-age=600` and `access-control-allow-origin: *`; and, at
 *   `/kit/`, the starter kit's template as committed (`templates/starter-kit/`, M5).
 */

/** A forwarded request as an extension sees it: the router's fields plus the raw query, the headers and the test id. */
interface ExtensionRequest {
    readonly method: string;
    readonly host: string;
    readonly path: string;
    /** `?…` or empty. */
    readonly search: string;
    readonly headers: IncomingHttpHeaders;
    readonly body: string;
    /** The `x-hcm-test` header ('' without it). */
    readonly test: string;
}

/** Answers what it knows (undefined: the next extension, then the router, answers). */
export interface MockExtension {
    answer(request: ExtensionRequest): Promise<MockResponse | undefined>;
    /** A control request outside `/h/` (`/__upstream/…`, `/__oauth/…`, `/__lease/…`). */
    control(request: ControlRequest): Promise<MockResponse | undefined>;
}

/** A request to the mock APIs outside `/h/`, as an extension's `control` sees it. */
export interface ControlRequest {
    readonly method: string;
    readonly path: string;
    readonly query: URLSearchParams;
    readonly body: string;
    /** The request's headers (the e2e network layer adds `x-hcm-test` to a page's requests to the mock APIs). */
    readonly headers: IncomingHttpHeaders;
}

/** One forwarded request as the mock saw it. */
export interface RecordedCall {
    readonly seq: number;
    readonly test: string;
    readonly method: string;
    readonly host: string;
    readonly path: string;
    readonly query: string;
    readonly status: number;
    /** The request body as text, at most 64 KiB (beacons, error reports). */
    readonly body: string;
}

const MAX_BODY = 64 * 1024;
const CORS_HEADERS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
    'access-control-allow-headers': '*',
} as const;

/** Content types by file extension, for the site server and the admin server (admin-server.ts). */
export const SITE_TYPES: Readonly<Record<string, string>> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.map': 'application/json',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
};

interface RequestTarget {
    readonly pathname: string;
    /** `?…` or empty. */
    readonly search: string;
    readonly searchParams: URLSearchParams;
}

/** The path and query of a request target (`/h/api.mapbox.com/v4/x.json?secure`), parsed without inventing an origin. */
function requestTarget(request: IncomingMessage): RequestTarget {
    const raw = request.url ?? '/';
    const queryStart = raw.indexOf('?');
    const pathname = queryStart === -1 ? raw : raw.slice(0, queryStart);
    const search = queryStart === -1 ? '' : raw.slice(queryStart);
    return { pathname, search, searchParams: new URLSearchParams(search) };
}

async function readBody(request: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).subarray(0, MAX_BODY).toString('utf8');
}

function send(response: ServerResponse, result: MockResponse, extra: Readonly<Record<string, string>> = {}): void {
    const headers: Record<string, string> = { 'cache-control': 'no-store', ...CORS_HEADERS, ...result.headers, ...extra };
    if (result.type !== undefined) {
        headers['content-type'] = result.type;
    }
    response.writeHead(result.status, headers);
    response.end(result.body);
}

/** In-memory record of every forwarded call. */
class CallLog {
    readonly #calls: RecordedCall[] = [];
    #seq = 0;

    record(call: Omit<RecordedCall, 'seq'>): void {
        this.#seq += 1;
        this.#calls.push({ seq: this.#seq, ...call });
    }

    list(test: string | null, host: string | null): RecordedCall[] {
        return this.#calls.filter((call) => (test === null || call.test === test) && (host === null || call.host === host));
    }

    clear(test: string | null): void {
        const kept = this.#calls.filter((call) => test !== null && call.test !== test);
        this.#calls.splice(0, this.#calls.length, ...kept);
    }
}

async function extended(extensions: readonly MockExtension[], request: ExtensionRequest): Promise<MockResponse | undefined> {
    for (const extension of extensions) {
        const result = await extension.answer(request);
        if (result !== undefined) {
            return result;
        }
    }
    return undefined;
}

async function forwarded(
    request: IncomingMessage,
    url: RequestTarget,
    log: CallLog,
    files: MockFiles,
    extensions: readonly MockExtension[],
): Promise<MockResponse> {
    const [, , host = '', ...rest] = url.pathname.split('/');
    const path = `/${rest.join('/')}`;
    const method = request.method ?? 'GET';
    const body = await readBody(request);
    const header = request.headers[TEST_HEADER];
    const test = typeof header === 'string' ? header : '';
    const result =
        method === 'OPTIONS'
            ? { status: 204 }
            : ((await extended(extensions, { method, host, path, search: url.search, headers: request.headers, body, test })) ??
              (await answer({ method, host, path, query: url.searchParams, body }, files)));
    log.record({ test, method, host, path, query: url.search, status: result.status, body });
    return result;
}

async function controlled(
    extensions: readonly MockExtension[],
    request: IncomingMessage,
    url: RequestTarget,
): Promise<MockResponse | undefined> {
    const body = await readBody(request);
    for (const extension of extensions) {
        const result = await extension.control({
            method: request.method ?? 'GET',
            path: url.pathname,
            query: url.searchParams,
            body,
            headers: request.headers,
        });
        if (result !== undefined) {
            return result;
        }
    }
    return undefined;
}

async function handleMock(
    request: IncomingMessage,
    response: ServerResponse,
    log: CallLog,
    files: MockFiles,
    extensions: readonly MockExtension[],
): Promise<void> {
    const url = requestTarget(request);
    if (url.pathname.startsWith('/h/')) {
        send(response, await forwarded(request, url, log, files, extensions));
    } else if (url.pathname === '/__calls') {
        send(response, {
            status: 200,
            type: 'application/json',
            body: JSON.stringify(log.list(url.searchParams.get('test'), url.searchParams.get('host'))),
        });
    } else if (url.pathname === '/__reset' && request.method === 'POST') {
        log.clear(url.searchParams.get('test'));
        send(response, { status: 204 });
    } else if (url.pathname === '/__health') {
        send(response, { status: 200, type: 'text/plain', body: 'ok' });
    } else {
        send(response, (await controlled(extensions, request, url)) ?? { status: 404, type: 'text/plain', body: 'unknown mock endpoint' });
    }
}

/**
 * Starts listening. Idle keep-alive connections are never closed by the server: Node closes them after 5 s by default,
 * and a request the test's API client sends on such a connection at that moment fails with ECONNRESET ("socket hang
 * up"), which the firewall then reports as a blocked request (seen under load in the fn tier).
 */
export function listen(server: Server, port: number): Promise<Server> {
    server.keepAliveTimeout = 0;
    return new Promise((resolvePromise, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
            resolvePromise(server);
        });
    });
}

export function failed(response: ServerResponse, error: unknown): void {
    if (!response.headersSent) {
        send(response, { status: 500, type: 'text/plain', body: `mock failure: ${String(error)}` });
    }
}

/** Starts the mock APIs on 127.0.0.1:`port`; `extensions` answer before the built-in routes. */
export function startMockApis(
    port: number,
    files: MockFiles,
    extensions: readonly MockExtension[] = [],
    log = new CallLog(),
): Promise<Server> {
    const server = createServer((request, response) => {
        handleMock(request, response, log, files, extensions).catch((error: unknown) => {
            failed(response, error);
        });
    });
    return listen(server, port);
}

export async function isFile(path: string): Promise<boolean> {
    try {
        return (await stat(path)).isFile();
    } catch {
        return false;
    }
}

/** The file a site URL names below `dir`, or null outside `dir` or when missing; a folder means its index.html. */
async function siteFile(dir: string, pathname: string): Promise<{ file: string } | { redirect: true } | null> {
    const target = normalize(join(dir, decodeURIComponent(pathname)));
    if (target !== dir && !target.startsWith(`${dir}${sep}`)) {
        return null;
    }
    if (await isFile(target)) {
        return { file: target };
    }
    if (!(await isFile(join(target, 'index.html')))) {
        return null;
    }
    return pathname.endsWith('/') ? { file: join(target, 'index.html') } : { redirect: true };
}

/**
 * Folders served beside the built sites, by path prefix: the starter kit's template as committed, at `/kit/`
 * (M5-interfaces §3.6, behaviour V27), from the repository's root (the servers run there).
 */
const SITE_MOUNTS: readonly (readonly [prefix: string, folder: string])[] = [['/kit/', 'templates/starter-kit']];

/** The folder and the path below it that serve `pathname`: a mount's, else the built sites'. */
function servedFrom(dir: string, pathname: string): { readonly dir: string; readonly pathname: string } {
    const mount = SITE_MOUNTS.find(([prefix]) => pathname.startsWith(prefix));
    return mount === undefined ? { dir, pathname } : { dir: resolve(mount[1]), pathname: pathname.slice(mount[0].length - 1) };
}

async function handleSite(request: IncomingMessage, response: ServerResponse, dir: string): Promise<void> {
    const url = requestTarget(request);
    if (url.pathname === '/__health') {
        send(response, { status: 200, type: 'text/plain', body: 'ok' });
        return;
    }
    const served = servedFrom(dir, url.pathname);
    const found = await siteFile(served.dir, served.pathname);
    if (found === null) {
        send(response, { status: 404, type: 'text/plain', body: 'Not found' }, { 'cache-control': 'max-age=600' });
    } else if ('redirect' in found) {
        send(response, { status: 301 }, { location: `${url.pathname}/${url.search}` });
    } else {
        const type = SITE_TYPES[extname(found.file)] ?? 'application/octet-stream';
        send(response, { status: 200, type, body: await readFile(found.file) }, { 'cache-control': 'max-age=600' });
    }
}

/** The site server's handler: the built sites in `dir` (the local stack, e2e/stack/servers.ts, puts its routes in front). */
export function siteRequestHandler(dir: string): (request: IncomingMessage, response: ServerResponse) => void {
    const root = resolve(dir);
    return (request, response) => {
        handleSite(request, response, root).catch((error: unknown) => {
            failed(response, error);
        });
    };
}

/** Serves the built sites in `dir` on 127.0.0.1:`port`. */
export function startSiteServer(port: number, dir: string): Promise<Server> {
    return listen(createServer(siteRequestHandler(dir)), port);
}
