import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { UpstreamRequest } from './fetch.js';
import { createUpstreamFakes, type UpstreamFakes } from './upstream.js';

/**
 * The fake upstreams over HTTP (`node:http`), so the Playwright admin tier and the Functions emulator use the same fakes
 * as the in-process tests. Two ways in:
 *
 * - `startUpstreamServer({port})`: a server of its own, for the Functions emulator or the Python tests;
 * - `createUpstreamExtension()`: plugged into the e2e mock APIs (`e2e/mock-apis/server.ts`), which already forward
 *   every mocked request as `/h/<host><path>` and record it.
 *
 * Both keep one world per test: a forwarded request's `x-hcm-test` header names its partition (the e2e network layer
 * sets it; a request without it uses the shared partition ''), so parallel tests never see each other's state. The
 * control endpoints take the partition as `?test=<id>`:
 *
 * - `GET /__upstream/calls?test=&operation=` the recorded calls (oldest first), optionally below one operation;
 * - `POST /__upstream/scenario?test=` `{"name": "usgs.m2mApproved"}`; `GET /__upstream/scenarios` lists the names;
 * - `POST /__upstream/fail?test=` `{"service": "mapbox", "mode": "unavailable"}` (`"mode": null` clears it);
 * - `GET /__upstream/snapshot?test=` every service's state;
 * - `POST /__upstream/reset?test=` forgets the partition (without `test`: every partition).
 */

/** The request header that names a test's partition (the e2e mock APIs' `TEST_HEADER`). */
export const UPSTREAM_TEST_HEADER = 'x-hcm-test';

/** One world per test id, created on first use and set up by `setup` (a default scenario, say). */
export class UpstreamPartitions {
    readonly #worlds = new Map<string, UpstreamFakes>();
    readonly #setup: (fakes: UpstreamFakes) => void;

    constructor(setup: (fakes: UpstreamFakes) => void = () => undefined) {
        this.#setup = setup;
    }

    get(test: string): UpstreamFakes {
        const existing = this.#worlds.get(test);
        if (existing !== undefined) {
            return existing;
        }
        const created = createUpstreamFakes();
        this.#setup(created);
        this.#worlds.set(test, created);
        return created;
    }

    /** Forgets one partition, or every partition for `null`. */
    reset(test: string | null): void {
        if (test === null) {
            this.#worlds.clear();
        } else {
            this.#worlds.delete(test);
        }
    }
}

/** A request forwarded as `/h/<host><path>?<query>`, as the e2e mock APIs see it. */
export interface ForwardedRequest {
    readonly method: string;
    readonly host: string;
    readonly path: string;
    /** `?…` or empty. */
    readonly search: string;
    readonly headers: IncomingHttpHeaders | Readonly<Record<string, string>>;
    readonly body: string;
    /** The partition (`x-hcm-test`); '' for none. */
    readonly test: string;
}

/** A control request (`/__upstream/<action>`). */
export interface ControlRequest {
    readonly method: string;
    readonly path: string;
    readonly query: URLSearchParams;
    readonly body: string;
}

/** An answer in the shape of the e2e mock APIs' `MockResponse`, plus the upstream's own headers (`retry-after`). */
export interface ForwardedResponse {
    readonly status: number;
    readonly type?: string;
    readonly body?: Uint8Array;
    readonly headers?: Readonly<Record<string, string>>;
}

export interface UpstreamExtension {
    readonly partitions: UpstreamPartitions;
    /** The fakes' answer, or undefined when no fake knows the request (the caller's own routes answer then). */
    answer(request: ForwardedRequest): Promise<ForwardedResponse | undefined>;
    /** The answer to a `/__upstream/…` control request, or undefined for any other path. */
    control(request: ControlRequest): Promise<ForwardedResponse | undefined>;
}

function headersOf(headers: ForwardedRequest['headers']): Headers {
    const result = new Headers();
    for (const [name, value] of Object.entries(headers)) {
        for (const item of Array.isArray(value) ? value : [value]) {
            if (typeof item === 'string') {
                result.append(name, item);
            }
        }
    }
    return result;
}

/**
 * The headers the server writes itself are left out (the type is `type`; the length is the body's), but a body-less
 * answer keeps its declared length: a HEAD answer's is the file's size, which a client such as GDAL's `/vsicurl/` reads.
 */
function keptHeader(name: string, body: Uint8Array): boolean {
    return name !== 'content-type' && (name !== 'content-length' || body.length === 0);
}

async function forwardedResponse(response: Response): Promise<ForwardedResponse> {
    const body = new Uint8Array(await response.arrayBuffer());
    const headers = Object.fromEntries([...response.headers.entries()].filter(([name]) => keptHeader(name, body)));
    const type = response.headers.get('content-type');
    return {
        status: response.status,
        ...(type === null ? {} : { type }),
        body,
        headers,
    };
}

function json(value: unknown, status = 200): ForwardedResponse {
    return { status, type: 'application/json', body: new TextEncoder().encode(JSON.stringify(value)) };
}

const NO_CONTENT: ForwardedResponse = { status: 204 };

function parsed(body: string): Readonly<Record<string, unknown>> {
    try {
        const value = JSON.parse(body) as unknown;
        return typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : {};
    } catch {
        return {};
    }
}

/** Runs a state change and answers 204, or 400 with the reason it was refused. */
function applied(change: () => void): ForwardedResponse {
    try {
        change();
        return NO_CONTENT;
    } catch (error) {
        return json({ message: error instanceof Error ? error.message : String(error) }, 400);
    }
}

type ControlAction = (partitions: UpstreamPartitions, request: ControlRequest, test: string) => ForwardedResponse;

const CONTROL: Readonly<Record<string, ControlAction>> = {
    'GET calls': (partitions, request, test) => {
        const operation = request.query.get('operation');
        const fakes = partitions.get(test);
        return json(operation === null ? fakes.calls : fakes.callsTo(operation));
    },
    'GET scenarios': (partitions) => json(partitions.get('').scenarioNames),
    'POST scenario': (partitions, request, test) =>
        applied(() => {
            partitions.get(test).scenario(String(parsed(request.body)['name']));
        }),
    'POST fail': (partitions, request, test) => {
        const body = parsed(request.body);
        return applied(() => {
            partitions
                .get(test)
                .fail(
                    body['service'] as Parameters<UpstreamFakes['fail']>[0],
                    (body['mode'] ?? null) as Parameters<UpstreamFakes['fail']>[1],
                );
        });
    },
    'GET snapshot': (partitions, _request, test) => json(partitions.get(test).snapshot()),
    'POST reset': (partitions, request) => {
        partitions.reset(request.query.get('test'));
        return NO_CONTENT;
    },
};

/** The fakes as an extension of another server: answers forwarded requests and `/__upstream/…` control requests. */
export function createUpstreamExtension(partitions = new UpstreamPartitions()): UpstreamExtension {
    return {
        partitions,
        answer: async (request) => {
            const upstream: UpstreamRequest = {
                method: request.method.toUpperCase(),
                url: new URL(`https://${request.host}${request.path}${request.search}`),
                headers: headersOf(request.headers),
                body: request.body,
            };
            const answered = await partitions.get(request.test).answer(upstream);
            return answered === undefined ? undefined : forwardedResponse(answered.response);
        },
        control: (request) => {
            const match = /^\/__upstream\/(\w+)$/.exec(request.path);
            const action = match === null ? undefined : CONTROL[`${request.method.toUpperCase()} ${String(match[1])}`];
            return Promise.resolve(action?.(partitions, request, request.query.get('test') ?? ''));
        },
    };
}

async function readBody(request: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
}

function send(response: ServerResponse, result: ForwardedResponse): void {
    response.writeHead(result.status, {
        'cache-control': 'no-store',
        ...(result.type === undefined ? {} : { 'content-type': result.type }),
        ...result.headers,
    });
    response.end(result.body);
}

const NOT_MOCKED: ForwardedResponse = { status: 404, type: 'text/plain', body: new TextEncoder().encode('not mocked') };
const HEALTHY: ForwardedResponse = { status: 200, type: 'text/plain', body: new TextEncoder().encode('ok') };

interface Incoming {
    readonly method: string;
    readonly path: string;
    /** `?…` or empty. */
    readonly search: string;
    readonly headers: IncomingHttpHeaders;
    readonly body: string;
}

function splitTarget(raw: string): { readonly path: string; readonly search: string } {
    const queryStart = raw.indexOf('?');
    return queryStart === -1 ? { path: raw, search: '' } : { path: raw.slice(0, queryStart), search: raw.slice(queryStart) };
}

function partitionOf(headers: IncomingHttpHeaders): string {
    const test = headers[UPSTREAM_TEST_HEADER];
    return typeof test === 'string' ? test : '';
}

async function controlled(extension: UpstreamExtension, incoming: Incoming): Promise<ForwardedResponse> {
    if (incoming.path === '/__health') {
        return HEALTHY;
    }
    const answered = await extension.control({
        method: incoming.method,
        path: incoming.path,
        query: new URLSearchParams(incoming.search),
        body: incoming.body,
    });
    return answered ?? NOT_MOCKED;
}

async function proxied(extension: UpstreamExtension, incoming: Incoming, target: RegExpExecArray): Promise<ForwardedResponse> {
    const answered = await extension.answer({
        method: incoming.method,
        host: String(target[1]),
        path: target[2] ?? '/',
        search: incoming.search,
        headers: incoming.headers,
        body: incoming.body,
        test: partitionOf(incoming.headers),
    });
    return answered ?? NOT_MOCKED;
}

async function serve(extension: UpstreamExtension, request: IncomingMessage): Promise<ForwardedResponse> {
    const { path, search } = splitTarget(request.url ?? '/');
    const incoming: Incoming = { method: request.method ?? 'GET', path, search, headers: request.headers, body: await readBody(request) };
    const target = /^\/h\/([^/]+)(\/.*)?$/.exec(path);
    return target === null ? controlled(extension, incoming) : proxied(extension, incoming, target);
}

function listen(server: Server, port: number): Promise<number> {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
            const address = server.address();
            resolve(typeof address === 'object' && address !== null ? address.port : port);
        });
    });
}

function closeServer(server: Server): Promise<void> {
    server.closeAllConnections();
    return new Promise((resolve) => {
        server.close(() => {
            resolve();
        });
    });
}

export interface UpstreamServer {
    /** `http://127.0.0.1:<port>`; forwarded requests go to `<origin>/h/<host><path>`. */
    readonly origin: string;
    readonly partitions: UpstreamPartitions;
    close(): Promise<void>;
}

export interface UpstreamServerOptions {
    /** 0 (the default) picks a free port. */
    readonly port?: number;
    /** Applied to each new partition. */
    readonly setup?: (fakes: UpstreamFakes) => void;
}

/** Starts the fake upstreams on `127.0.0.1`. */
export async function startUpstreamServer(options: UpstreamServerOptions = {}): Promise<UpstreamServer> {
    const extension = createUpstreamExtension(new UpstreamPartitions(options.setup));
    const server: Server = createServer((request, response) => {
        serve(extension, request).then(
            (result) => {
                send(response, result);
            },
            (error: unknown) => {
                send(response, {
                    status: 500,
                    type: 'text/plain',
                    body: new TextEncoder().encode(`fake upstream failure: ${String(error)}`),
                });
            },
        );
    });
    server.keepAliveTimeout = 0;
    const port = await listen(server, options.port ?? 0);
    return { origin: `http://127.0.0.1:${String(port)}`, partitions: extension.partitions, close: () => closeServer(server) };
}
