import type { Logger } from '@hcm/shared';

import { failureOfAnswer, failureOfOperation, GoogleApiError, googleFailureOf, unavailableFailure, type GoogleFailure } from './failure.js';
import { at, isRecord, list, stringAt } from './json.js';

/**
 * The one way the admin calls a Google REST API from the browser (`docs/research/M2b-interfaces.md` §3.4): `fetch`
 * with the owner's access token as a bearer header, JSON in and out, Google's error JSON mapped to a
 * {@link GoogleApiError}, a retry with backoff for 429 and 5xx answers and network failures, every page of a list, and
 * long-running operations polled until done. The token is read from memory for each call and never logged; a 401 is
 * never retried (the step drops the token and asks for a new one, §1.5).
 */

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type QueryValue = string | number | boolean | readonly string[] | undefined;

export interface GoogleCall {
    /** The operation's name for logs and failures (`cloud-billing.updateBillingInfo`). */
    readonly operation: string;
    readonly method?: HttpMethod;
    /** Absolute URL without a query. */
    readonly url: string;
    readonly query?: Readonly<Record<string, QueryValue>>;
    /** Sent as JSON. */
    readonly body?: unknown;
    /** The role a 403 names (`apiError.cloud.permission`); the provisioner's calls need the project owner's. */
    readonly role?: string;
}

/**
 * M6 (finding 4 of `docs/research/manual-test-2026-10-25.md`; `docs/research/M6-interfaces.md` §1.5): an API that
 * `services:batchEnable` reports on still answers 403 `SERVICE_DISABLED` for a few minutes. With this option the
 * transport waits that out (after 10, 20, 40, 60 and 60 s, about three minutes, on the injected clock) when Service
 * Usage says the API is enabled, telling `onWait` before each wait; a truly disabled API fails at once as before, and an
 * API still refused after the last wait fails as {@link API_PROPAGATING} (`apiError.cloud.apiPropagation`).
 */
interface ApiPropagation {
    /** The project (number or id) whose Service Usage says whether a refused API is on. */
    readonly project: string;
    /** Heard before each wait for `api` (the doctor line says "Waiting for Google to switch on {api}…"). */
    readonly onWait: (api: string) => void;
}

/** The waits of an API Google is still switching on, in order. */
export const API_PROPAGATION_RETRY_MS: readonly number[] = [10_000, 20_000, 40_000, 60_000, 60_000];

/** The failure reason of an API still refused after every wait (`failureMessage` names `apiError.cloud.apiPropagation`). */
const API_PROPAGATING = 'API_PROPAGATING';

export interface GoogleTransportOptions {
    readonly fetch: typeof fetch;
    /** The current access token (memory only, §2.3); null once it was dropped: the call fails `unauthorized`. */
    readonly token: () => string | null;
    /** Waits; the injected clock's in the app, so tests advance it. */
    readonly sleep: (ms: number) => Promise<void>;
    readonly log: Logger;
    /** Retries of a 429, a 5xx or a network failure (default 3). */
    readonly retries?: number;
    /** Polls of an unfinished long-running operation before it counts as unavailable (default 60). */
    readonly operationPolls?: number;
    /** M6: wait out an API Google is still switching on (§1.5); without it a `SERVICE_DISABLED` fails at once. */
    readonly propagation?: ApiPropagation;
}

export interface GoogleTransport {
    /** One call; resolves to the JSON body (undefined for an empty one). */
    call(call: GoogleCall): Promise<unknown>;
    /** As `call`, but a 404 resolves to undefined. */
    find(call: GoogleCall): Promise<unknown>;
    /** Every item of a paged list (`field` of each page, following `nextPageToken`). */
    pages(call: GoogleCall, field: string): Promise<readonly unknown[]>;
    /** Waits for a long-running operation (`{name, done}` from `apiBase`) and resolves to its `response`. */
    operation(apiBase: string, started: unknown, call: Pick<GoogleCall, 'operation' | 'role'>): Promise<unknown>;
}

const SERVICE_USAGE = 'https://serviceusage.googleapis.com/v1';
const FIRST_RETRY_MS = 1000;
const MAX_BACKOFF_MS = 8000;
const MAX_DELAY_MS = 30_000;
const OPERATION_POLL_MS = 2000;
const MAX_PAGES = 50;
const RETRYABLE: ReadonlySet<GoogleFailure['kind']> = new Set(['rateLimited', 'unavailable']);

function urlOf(call: GoogleCall): string {
    const url = new URL(call.url);
    for (const [name, value] of Object.entries(call.query ?? {})) {
        const values = Array.isArray(value) ? value : [value];
        values
            .filter((item) => item !== undefined)
            .forEach((item) => {
                url.searchParams.append(name, String(item));
            });
    }
    return url.toString();
}

function requestInit(call: GoogleCall, token: string): RequestInit {
    const method = call.method ?? 'GET';
    const authorization = `Bearer ${token}`;
    return call.body === undefined
        ? { method, headers: { authorization } }
        : { method, headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(call.body) };
}

async function readBody(response: Response): Promise<unknown> {
    const text = await response.text().catch(() => '');
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return undefined;
    }
}

function roleOf(call: Pick<GoogleCall, 'role'>): { readonly role?: string } {
    return call.role === undefined ? {} : { role: call.role };
}

/** Backoff: Google's `Retry-After` when given, else 1, 2, 4, 8 s; never more than 30 s. */
function delayOf(failure: GoogleFailure, attempt: number): number {
    const backoff = Math.min(FIRST_RETRY_MS * 2 ** attempt, MAX_BACKOFF_MS);
    return Math.min(failure.retryAfterSeconds === undefined ? backoff : failure.retryAfterSeconds * 1000, MAX_DELAY_MS);
}

/** An API Google refused as disabled, with what the transport needs to wait for it. */
interface Propagating {
    readonly api: string;
    readonly failure: GoogleFailure;
    readonly propagation: ApiPropagation;
}

class Transport implements GoogleTransport {
    readonly #options: GoogleTransportOptions;

    constructor(options: GoogleTransportOptions) {
        this.#options = options;
    }

    readonly call = async (request: GoogleCall): Promise<unknown> => {
        for (let waited = 0; ; waited += 1) {
            try {
                return await this.#retried(request);
            } catch (error) {
                await this.#waitForPropagation(request, error, waited);
            }
        }
    };

    readonly find = async (request: GoogleCall): Promise<unknown> => {
        try {
            return await this.call(request);
        } catch (error) {
            if (googleFailureOf(error)?.kind === 'notFound') {
                return undefined;
            }
            throw error;
        }
    };

    readonly pages = async (request: GoogleCall, field: string): Promise<readonly unknown[]> => {
        const items: unknown[] = [];
        let pageToken: string | undefined;
        for (let page = 0; page < MAX_PAGES; page += 1) {
            const body = await this.call({ ...request, query: { ...request.query, pageToken } });
            items.push(...list(at(body, field)));
            pageToken = stringAt(body, 'nextPageToken');
            if ((pageToken ?? '') === '') {
                break;
            }
        }
        return items;
    };

    readonly operation = async (apiBase: string, started: unknown, request: Pick<GoogleCall, 'operation' | 'role'>): Promise<unknown> => {
        const polls = this.#options.operationPolls ?? 60;
        let current = started;
        let poll = 0;
        while (at(current, 'done') !== true) {
            current = await this.#poll(apiBase, current, request, poll < polls);
            poll += 1;
        }
        const error = at(current, 'error');
        if (isRecord(error)) {
            throw new GoogleApiError(request.operation, failureOfOperation(error, request.role));
        }
        return at(current, 'response');
    };

    /** One call with its retries of 429, 5xx and network failures. */
    async #retried(request: GoogleCall): Promise<unknown> {
        for (let tried = 0; ; tried += 1) {
            try {
                return await this.#attempt(request);
            } catch (error) {
                await this.#backoff(request, error, tried);
            }
        }
    }

    /**
     * Waits before the next try of an API Google is still switching on (§1.5); rethrows any other failure, a
     * `SERVICE_DISABLED` for an API Service Usage reports off, and, after the last wait, the failure as still propagating.
     */
    async #waitForPropagation(request: GoogleCall, error: unknown, waited: number): Promise<void> {
        const found = this.#propagating(error);
        if (found === undefined) {
            throw error;
        }
        const delay = API_PROPAGATION_RETRY_MS[waited];
        if (delay === undefined) {
            throw new GoogleApiError(request.operation, { ...found.failure, reason: API_PROPAGATING });
        }
        if (!(await this.#mayWait(found, waited))) {
            throw error;
        }
        found.propagation.onWait(found.api);
        this.#options.log.warn('google api still switching on', { operation: request.operation, api: found.api, attempt: waited + 1 });
        await this.#options.sleep(delay);
    }

    /** A `SERVICE_DISABLED` failure naming its API, when this transport waits out propagation. */
    #propagating(error: unknown): Propagating | undefined {
        const failure = googleFailureOf(error);
        const { propagation } = this.#options;
        if (propagation === undefined || failure?.reason !== 'SERVICE_DISABLED' || failure.api === undefined) {
            return undefined;
        }
        return { api: failure.api, failure, propagation };
    }

    /** The first wait asks Service Usage whether the API is on at all; the later ones only wait. */
    #mayWait(found: Propagating, waited: number): Promise<boolean> {
        return waited > 0 ? Promise.resolve(true) : this.#enabled(found.propagation.project, found.api);
    }

    /** Whether Service Usage reports `api` enabled in the project (a failed read counts as off: the call fails as before). */
    async #enabled(project: string, api: string): Promise<boolean> {
        try {
            const body = await this.#retried({
                operation: 'service-usage.get',
                url: `${SERVICE_USAGE}/projects/${project}/services/${api}`,
            });
            return stringAt(body, 'state') === 'ENABLED';
        } catch {
            return false;
        }
    }

    /** Waits before the next try of a retryable failure; rethrows anything else, and the last failure. */
    async #backoff(request: GoogleCall, error: unknown, tried: number): Promise<void> {
        const failure = googleFailureOf(error);
        const retries = this.#options.retries ?? 3;
        if (failure === undefined || tried >= retries || !RETRYABLE.has(failure.kind)) {
            throw error;
        }
        this.#options.log.warn('google call retried', { operation: request.operation, status: failure.status, attempt: tried + 1 });
        await this.#options.sleep(delayOf(failure, tried));
    }

    async #poll(apiBase: string, current: unknown, request: Pick<GoogleCall, 'operation' | 'role'>, mayPoll: boolean): Promise<unknown> {
        const name = stringAt(current, 'name');
        if (name === undefined || !mayPoll) {
            throw new GoogleApiError(request.operation, unavailableFailure(request.role));
        }
        await this.#options.sleep(OPERATION_POLL_MS);
        return this.call({ operation: request.operation, url: `${apiBase}/${name}`, ...roleOf(request) });
    }

    async #attempt(call: GoogleCall): Promise<unknown> {
        const token = this.#options.token();
        if (token === null) {
            throw new GoogleApiError(call.operation, { kind: 'unauthorized', status: 0, ...roleOf(call) });
        }
        let response: Response;
        try {
            response = await this.#options.fetch(urlOf(call), requestInit(call, token));
        } catch {
            // No answer at all (finding 48): the request never left the browser, so the message names its host. The original
            // error may hold the URL; it is dropped on purpose.
            throw new GoogleApiError(call.operation, { ...unavailableFailure(call.role), host: new URL(call.url).host });
        }
        const body = await readBody(response);
        if (!response.ok) {
            throw new GoogleApiError(call.operation, failureOfAnswer(response.status, response.headers, body, call.role));
        }
        return body;
    }
}

/** A create whose 409 means the resource exists already: resolves to true when it was created, false when it existed. */
export async function createOnce(transport: GoogleTransport, call: GoogleCall): Promise<boolean> {
    try {
        await transport.call(call);
        return true;
    } catch (error) {
        if (googleFailureOf(error)?.kind !== 'conflict') {
            throw error;
        }
        return false;
    }
}

/** A transport over `fetch`. */
export function createGoogleTransport(options: GoogleTransportOptions): GoogleTransport {
    return new Transport(options);
}

/**
 * Where a run hears the APIs the transport waits for (M6, §1.5): `onWait` goes into the transport's options, `listen`
 * to the provisioner, which names the item it was running (S-A04-HAPPY-API-PROPAGATION).
 */
export interface ApiWaits {
    readonly onWait: (api: string) => void;
    listen(listener: ((api: string) => void) | undefined): void;
}

export function createApiWaits(): ApiWaits {
    let current: ((api: string) => void) | undefined;
    return {
        onWait: (api) => {
            current?.(api);
        },
        listen: (listener) => {
            current = listener;
        },
    };
}

/** `options` that wait out the APIs Google is still switching on in `project` (the installer's submit shares it). */
export function withApiPropagation(options: GoogleTransportOptions, project: string, waits: ApiWaits): GoogleTransportOptions {
    return { ...options, propagation: { project, onWait: waits.onWait } };
}
