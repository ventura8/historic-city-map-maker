import type { APIRequestContext, BrowserContext, Route, WebSocketRoute } from '@playwright/test';

import { MOCK_API_ORIGIN, TEST_HEADER } from '../fixtures/world.js';
import { isLoopback, isUpstreamHost, mockedHostKind, refusedAddress } from '../mock-apis/hosts.js';

/**
 * The browser context's network, decided per request (docs/research/design-review-testability.md §4.2):
 *
 * - loopback (the site and admin servers, the Firebase emulators): passes through; a page's request to the mock APIs
 *   themselves (Google's consent stand-in, `/__oauth/…`) gets the test's id as `x-hcm-test`;
 * - a mocked host (Mapbox, analytics, the CDN, the e2e tile and telemetry hosts), and in the admin projects
 *   (`upstream`) a host of the fake upstreams: forwarded to the mock APIs as `/h/<host><path>`, tagged with the test's
 *   id, and answered from there; nothing reaches the real host;
 * - anything else, and a refused address of any host (`refusedAddress`: USGS, STAC, Overpass, OpenStreetMap tiles,
 *   Mapbox Satellite; docs/research/M3-interfaces.md §13): aborted (`blockedbyclient`) and recorded, and the test fails at
 *   teardown (the firewall).
 *
 * WebSockets get the same rule through `routeWebSocket` (route handlers never see them). A page-level `page.route`
 * a spec registers wins over these context routes, which is how a bad path scripts one response.
 */

/** Recorded entries that the test either claims with `take()` or that fail the test at teardown. */
export class Recorder {
    readonly #entries: string[] = [];

    record(entry: string): void {
        this.#entries.push(entry);
    }

    /** The entries recorded so far, which the test now owns; the recorder is empty afterwards. */
    take(): string[] {
        return this.#entries.splice(0);
    }

    /** The entries that match `pattern`, which the test now owns; the others stay recorded. */
    takeMatching(pattern: RegExp): string[] {
        const taken = this.#entries.filter((entry) => pattern.test(entry));
        const kept = this.#entries.filter((entry) => !pattern.test(entry));
        this.#entries.splice(0, this.#entries.length, ...kept);
        return taken;
    }
}

/** How a context's network treats the hosts beyond the viewer's. */
export interface NetworkOptions {
    /** Forward the fake upstreams' hosts too (the admin projects, CR-M2-21). */
    readonly upstream: boolean;
}

/** Playwright's message when the page, context or browser went away during a route. */
const CLOSED = /has been closed|Target closed/;

/**
 * Request headers the mock needs (the fake upstreams read the bearer token); the browser's own (cookies, host, origin)
 * stay out of the forwarded copy.
 */
const FORWARDED_HEADERS = ['accept', 'content-type', 'authorization'];

function forwardedHeaders(headers: Readonly<Record<string, string>>, testId: string): Record<string, string> {
    const kept = Object.entries(headers).filter(([name]) => FORWARDED_HEADERS.includes(name));
    return { ...Object.fromEntries(kept), [TEST_HEADER]: testId };
}

async function forward(route: Route, api: APIRequestContext, testId: string): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postDataBuffer();
    const response = await api.fetch(`${MOCK_API_ORIGIN}/h/${url.hostname}${url.pathname}${url.search}`, {
        method: request.method(),
        headers: forwardedHeaders(await request.allHeaders(), testId),
        maxRedirects: 0,
        failOnStatusCode: false,
        ...(body === null ? {} : { data: body }),
    });
    await route.fulfill({ response });
}

/** Loopback passes; a page's request to the mock APIs themselves carries the test's id, like a forwarded one. */
async function passLoopback(route: Route, testId: string): Promise<void> {
    const request = route.request();
    if (new URL(request.url()).origin !== MOCK_API_ORIGIN) {
        await route.fallback();
        return;
    }
    await route.fallback({ headers: { ...(await request.allHeaders()), [TEST_HEADER]: testId } });
}

function isForwarded(host: string, options: NetworkOptions): boolean {
    return mockedHostKind(host) !== null || (options.upstream && isUpstreamHost(host));
}

interface Decision {
    readonly api: APIRequestContext;
    readonly testId: string;
    readonly blocked: Recorder;
    readonly options: NetworkOptions;
}

/**
 * The host a request goes to. A `blob:` URL has none of its own: it is the page's memory, under the origin that made it
 * (WebKit routes Mapbox's worker blob through here, Chromium does not; the iPhone project, 2026-11-15).
 */
function hostOf(url: string): string {
    const parsed = new URL(url);
    return parsed.protocol === 'blob:' ? new URL(parsed.origin).hostname : parsed.hostname;
}

async function decide(route: Route, decision: Decision): Promise<void> {
    const { api, testId, blocked, options } = decision;
    const url = route.request().url();
    const host = hostOf(url);
    if (isLoopback(host)) {
        await passLoopback(route, testId);
    } else if (refusedAddress(new URL(url)) !== null || !isForwarded(host, options)) {
        blocked.record(url);
        await route.abort('blockedbyclient');
    } else {
        await forward(route, api, testId).catch(async (error: unknown) => {
            if (CLOSED.test(String(error))) {
                return; // the page or context closed while the answer was on its way: nothing is waiting for it
            }
            // The mock APIs are down or failed: say so through the firewall instead of leaving the request pending.
            blocked.record(`mock APIs unavailable for ${url}: ${String(error)}`);
            await route.abort('failed');
        });
    }
}

function guardWebSocket(socket: WebSocketRoute, blocked: Recorder): void {
    const url = socket.url();
    if (isLoopback(new URL(url).hostname)) {
        socket.connectToServer();
        return;
    }
    blocked.record(url);
    void socket.close({ code: 1008, reason: 'blocked by the e2e firewall' });
}

/** Installs the routes on `context`; `api` reaches the mock APIs from Node, `testId` tags every forwarded call. */
export async function installNetwork(
    context: BrowserContext,
    api: APIRequestContext,
    testId: string,
    blocked: Recorder,
    options: NetworkOptions = { upstream: false },
): Promise<void> {
    await context.route('**/*', (route) => decide(route, { api, testId, blocked, options }));
    await context.routeWebSocket(/.*/, (socket) => {
        guardWebSocket(socket, blocked);
    });
}
