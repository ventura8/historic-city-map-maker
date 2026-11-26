import type { MockResponse } from './router.js';
import type { ControlRequest, MockExtension } from './server.js';

/**
 * Named leases, so tests that share one outside world run one at a time whatever their project or worker. The admin
 * tier needs it: `setup/owner`, `setup/status`, `admins/*` and the Auth users are per emulator project, and the
 * Functions emulator reaches the fake upstreams in the shared partition `''` (docs/research/M2b-interfaces.md §6.2).
 *
 * - `POST /__lease/acquire?name=<lease>&holder=<id>&ttl=<ms>` answers 204 once `holder` holds the lease (requests
 *   wait in order); a holder that never releases loses the lease after `ttl` (a crashed worker);
 * - `POST /__lease/release?name=<lease>&holder=<id>` releases it, or leaves the queue.
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000;

interface Waiting {
    readonly holder: string;
    readonly ttlMs: number;
    readonly grant: () => void;
}

class Lease {
    #holder: { readonly id: string; readonly timer: ReturnType<typeof setTimeout> } | undefined;
    readonly #queue: Waiting[] = [];

    acquire(holder: string, ttlMs: number): Promise<void> {
        return new Promise((resolve) => {
            this.#queue.push({ holder, ttlMs, grant: resolve });
            this.#next();
        });
    }

    release(holder: string): void {
        if (this.#holder?.id === holder) {
            clearTimeout(this.#holder.timer);
            this.#holder = undefined;
            this.#next();
            return;
        }
        const index = this.#queue.findIndex((waiting) => waiting.holder === holder);
        if (index !== -1) {
            this.#queue.splice(index, 1);
        }
    }

    #next(): void {
        const waiting = this.#holder === undefined ? this.#queue.shift() : undefined;
        if (waiting === undefined) {
            return;
        }
        const timer = setTimeout(() => {
            this.release(waiting.holder);
        }, waiting.ttlMs);
        this.#holder = { id: waiting.holder, timer };
        waiting.grant();
    }
}

const NO_CONTENT: MockResponse = { status: 204 };

function ttlOf(query: URLSearchParams): number {
    const ttl = Number(query.get('ttl'));
    return Number.isInteger(ttl) && ttl > 0 ? ttl : DEFAULT_TTL_MS;
}

/** The leases as an extension of the mock APIs. */
export function createLeases(): MockExtension {
    const leases = new Map<string, Lease>();
    const lease = (name: string): Lease => {
        const existing = leases.get(name) ?? new Lease();
        leases.set(name, existing);
        return existing;
    };
    const control = async (request: ControlRequest): Promise<MockResponse | undefined> => {
        const name = request.query.get('name') ?? '';
        const holder = request.query.get('holder') ?? '';
        if (request.method !== 'POST' || name === '' || holder === '') {
            return undefined;
        }
        if (request.path === '/__lease/acquire') {
            await lease(name).acquire(holder, ttlOf(request.query));
            return NO_CONTENT;
        }
        if (request.path === '/__lease/release') {
            lease(name).release(holder);
            return NO_CONTENT;
        }
        return undefined;
    };
    return { answer: () => Promise.resolve(undefined), control };
}
