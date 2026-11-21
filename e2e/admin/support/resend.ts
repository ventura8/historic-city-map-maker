import type { APIRequestContext, APIResponse } from '@playwright/test';

/**
 * The requests the tests send the emulators, sent again when the emulator dropped the connection (`ECONNRESET`, "socket
 * hang up": the Auth emulator did, once, under a full run's load) instead of failing the test that sent them. Every
 * request the tests send there is idempotent (a seed, a read, a sign-in, a delete), so a resend changes nothing else.
 */

/** The request methods the emulator helpers use. */
export type EmulatorApi = Pick<APIRequestContext, 'get' | 'post' | 'patch' | 'delete'>;

/** A dropped connection, as Playwright's request context reports it. */
const DROPPED = /ECONNRESET|socket hang up/;

/** How many times a dropped request is sent again. */
const RESENDS = 2;

/** `send`, again while the emulator drops the connection (at most `RESENDS` times); any other error as it was. */
async function resent(send: () => Promise<APIResponse>, left: number = RESENDS): Promise<APIResponse> {
    try {
        return await send();
    } catch (error) {
        if (left === 0 || !DROPPED.test(String(error))) {
            throw error;
        }
        return resent(send, left - 1);
    }
}

/** `api` whose requests are sent again when the emulator drops the connection. */
export function resending(api: EmulatorApi): EmulatorApi {
    return {
        get: (url, options) => resent(() => api.get(url, options)),
        post: (url, options) => resent(() => api.post(url, options)),
        patch: (url, options) => resent(() => api.patch(url, options)),
        delete: (url, options) => resent(() => api.delete(url, options)),
    };
}
