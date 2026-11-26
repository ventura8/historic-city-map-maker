import type { BrowserContext, Route } from '@playwright/test';

import type { Recorder } from '../../support/network.js';
import { emulatorOrigin } from '../world.js';

/**
 * "The server is not deployed yet", simulated at the network edge (docs/research/M2b-interfaces.md §6.2): while hidden,
 * every request of the browser to the Functions emulator fails like an unreachable host, which the Firebase SDK reports
 * as `internal`, as it does for a callable that is not deployed (its 404 has no CORS headers). `show()` lifts it, as a
 * finished deploy would; the bootstrap specs switch the fake Cloud Functions list along with it.
 */

const FUNCTIONS = `${emulatorOrigin('functions')}/**`;

/** The console line Chromium logs for each request that failed while hidden. */
const HIDDEN_SERVER_ERROR = /net::ERR_(?:FAILED|CONNECTION_REFUSED)/;

function refuse(route: Route): Promise<void> {
    return route.abort('connectionrefused');
}

export class ServerDeployment {
    readonly #context: BrowserContext;
    readonly #consoleErrors: Recorder;

    constructor(context: BrowserContext, consoleErrors: Recorder) {
        this.#context = context;
        this.#consoleErrors = consoleErrors;
    }

    /** From now on the server does not answer (a route registered later wins over the firewall's). */
    async hide(): Promise<void> {
        await this.#context.route(FUNCTIONS, refuse);
    }

    /** The server answers again. */
    async show(): Promise<void> {
        await this.#context.unroute(FUNCTIONS, refuse);
    }

    /** Claims the console errors the hidden server caused (the console guard fails the test on any other). */
    claimErrors(): string[] {
        return this.#consoleErrors.takeMatching(HIDDEN_SERVER_ERROR);
    }
}
