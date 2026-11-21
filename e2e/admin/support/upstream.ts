import type { APIRequestContext, APIResponse } from '@playwright/test';

import { MOCK_API_ORIGIN } from '../../fixtures/world.js';

/**
 * The fake upstreams' control endpoints (`@hcm/test-support/fakes/http`, docs/TESTING.md → *Fake upstreams*) for one
 * admin test (CR-M2-21). Two worlds take part: the **browser**'s, the test's own partition (the e2e network layer tags
 * every forwarded request with the test's id), and the **server**'s, the shared partition `''`, which the Functions
 * emulator reaches until CR-M2b-3 forwards the test's id. The admin tier runs one test at a time and empties `''`
 * first, so the shared world belongs to the running test.
 */

export type UpstreamWorld = 'browser' | 'server' | 'both';

/** One call a fake upstream answered (`@hcm/test-support/fakes` `RecordedCall`). */
export interface UpstreamCall {
    readonly seq: number;
    readonly operation: string;
    readonly method: string;
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly status: number;
}

async function ok(response: APIResponse, what: string): Promise<APIResponse> {
    if (!response.ok()) {
        throw new Error(`${what}: ${String(response.status())} ${await response.text()}`);
    }
    return response;
}

export class UpstreamControl {
    readonly #api: APIRequestContext;
    readonly #testId: string;

    constructor(api: APIRequestContext, testId: string) {
        this.#api = api;
        this.#testId = testId;
    }

    #partitions(world: UpstreamWorld): string[] {
        return { browser: [this.#testId], server: [''], both: [this.#testId, ''] }[world];
    }

    #url(action: string, partition: string, extra = ''): string {
        return `${MOCK_API_ORIGIN}/__upstream/${action}?test=${encodeURIComponent(partition)}${extra}`;
    }

    /** Applies a named scenario (`cloud-billing.enabled`, `google.provisioned`; `GET /__upstream/scenarios` lists them). */
    async scenario(name: string, world: UpstreamWorld = 'both'): Promise<void> {
        for (const partition of this.#partitions(world)) {
            await ok(await this.#api.post(this.#url('scenario', partition), { data: { name } }), `scenario ${name}`);
        }
    }

    /** Every call of `service` fails with `mode` (`unavailable`, `forbidden`, `apiDisabled`, …) until `null` clears it. */
    async fail(service: string, mode: string | null, world: UpstreamWorld = 'both'): Promise<void> {
        for (const partition of this.#partitions(world)) {
            await ok(await this.#api.post(this.#url('fail', partition), { data: { service, mode } }), `failure of ${service}`);
        }
    }

    /** The calls one world's fakes answered, oldest first; below one operation (`cloud-billing`) when given. */
    async calls(world: Exclude<UpstreamWorld, 'both'>, operation?: string): Promise<UpstreamCall[]> {
        const [partition = ''] = this.#partitions(world);
        const extra = operation === undefined ? '' : `&operation=${encodeURIComponent(operation)}`;
        return (await (await ok(await this.#api.get(this.#url('calls', partition, extra)), 'calls')).json()) as UpstreamCall[];
    }

    /** One world's state of every fake service (`GET /__upstream/snapshot`), as plain JSON by service name (M6). */
    async snapshot(world: Exclude<UpstreamWorld, 'both'>): Promise<Readonly<Record<string, unknown>>> {
        const [partition = ''] = this.#partitions(world);
        return (await (await ok(await this.#api.get(this.#url('snapshot', partition)), 'snapshot')).json()) as Readonly<
            Record<string, unknown>
        >;
    }

    /**
     * Forgets both worlds before a test starts: the server's (the shared partition) and the test's own, which a mock
     * server reused across runs (`reuseExistingServer` outside CI) would otherwise still hold from an earlier run.
     */
    async reset(): Promise<void> {
        for (const partition of this.#partitions('both')) {
            await ok(await this.#api.post(this.#url('reset', partition)), `reset of partition "${partition}"`);
        }
    }
}
