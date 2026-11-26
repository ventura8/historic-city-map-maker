import type { APIRequestContext } from '@playwright/test';

import type { SignedInAccount } from '../admin/support/emulators.js';
import { E2E_PROJECT_ID, emulatorOrigin } from '../admin/world.js';

/**
 * An admin callable of the Functions emulator, called as `account` the way the admin's SDK calls it: the local stack's
 * seed (seed-imagery.ts, seed-cities.ts) makes its world through the server's own flows where one exists
 * (`imagery.search` is the function `imagery-search`).
 */

/** How long one call may take: an import's first run answers once its job is queued. */
const CALL_TIMEOUT_MS = 120_000;

export async function callable(
    api: APIRequestContext,
    account: SignedInAccount,
    name: string,
    data: unknown,
): Promise<Record<string, unknown>> {
    const response = await api.post(`${emulatorOrigin('functions')}/${E2E_PROJECT_ID}/us-central1/${name.replace('.', '-')}`, {
        headers: { authorization: `Bearer ${account.idToken}`, 'content-type': 'application/json' },
        data: { data },
        timeout: CALL_TIMEOUT_MS,
    });
    const body = (await response.json()) as { result?: Record<string, unknown>; error?: unknown };
    if (!response.ok() || body.result === undefined) {
        throw new Error(`${name}: ${String(response.status())} ${JSON.stringify(body.error ?? body)}`);
    }
    return body.result;
}
