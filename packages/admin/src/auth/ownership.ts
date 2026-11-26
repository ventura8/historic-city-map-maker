/**
 * The bootstrap classification (`docs/research/M2b-interfaces.md` §3.2): the probe got no answer, so Google decides,
 * with the owner's own read-only token, between `bootstrap` (the account owns the project), `notOwner` (it does not, and
 * Cloud Functions was never enabled: a map never set up) and `backendDown` (a set-up map whose server is down, or the
 * check itself is unavailable). Two REST calls over `fetch`: Resource Manager v3 `testIamPermissions` and Service Usage.
 */
import { OWNER_PERMISSION } from '@hcm/shared';
import { z } from 'zod';

export type OwnershipVerdict =
    | { readonly kind: 'owner' }
    | { readonly kind: 'notOwner' }
    | { readonly kind: 'down' }
    /** Google refused the token (401): it expired or was revoked; ask again. */
    | { readonly kind: 'expired' }
    /** Resource Manager is disabled in the project (`SERVICE_DISABLED`): enable it, then check again. */
    | { readonly kind: 'apiDisabled'; readonly api: string };

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const FUNCTIONS_API = 'cloudfunctions.googleapis.com';

const errorDetailsSchema = z.object({ error: z.object({ details: z.array(z.unknown()) }) });
const serviceDisabledSchema = z.object({ reason: z.literal('SERVICE_DISABLED'), metadata: z.object({ service: z.string() }) });

/** The service a Google 403 `SERVICE_DISABLED` names (`error.details[].metadata.service`), else undefined. */
export function disabledService(body: unknown): string | undefined {
    const parsed = errorDetailsSchema.safeParse(body);
    const details = parsed.success ? parsed.data.error.details : [];
    for (const detail of details) {
        const info = serviceDisabledSchema.safeParse(detail);
        if (info.success) {
            return info.data.metadata.service;
        }
    }
    return undefined;
}

async function bodyOf(response: Response): Promise<unknown> {
    try {
        return (await response.json()) as unknown;
    } catch {
        return null;
    }
}

function bearer(token: string, init: RequestInit = {}): RequestInit {
    return { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, credentials: 'omit' };
}

const permissionsSchema = z.object({ permissions: z.array(z.string()) });
const serviceSchema = z.object({ state: z.string() });

/** A refusal of `testIamPermissions` that is a verdict of its own (a plain 403 is "not the owner"), else null. */
function refusalOf(status: number, body: unknown): OwnershipVerdict | null {
    if (status === 401) {
        return { kind: 'expired' };
    }
    const api = status === 403 ? disabledService(body) : undefined;
    if (api !== undefined) {
        return { kind: 'apiDisabled', api };
    }
    return status >= 500 ? { kind: 'down' } : null;
}

/** Whether the token's account holds `OWNER_PERMISSION` on the project; anything else is a verdict already. */
async function testOwner(fetch: Fetch, projectId: string, token: string): Promise<boolean | OwnershipVerdict> {
    const url = `https://cloudresourcemanager.googleapis.com/v3/projects/${encodeURIComponent(projectId)}:testIamPermissions`;
    const response = await fetch(url, bearer(token, { method: 'POST', body: JSON.stringify({ permissions: [OWNER_PERMISSION] }) }));
    const body = await bodyOf(response);
    const parsed = permissionsSchema.safeParse(body);
    return refusalOf(response.status, body) ?? (parsed.success && parsed.data.permissions.includes(OWNER_PERMISSION));
}

/**
 * Not the owner: was Cloud Functions ever enabled? Disabled means a map never set up (`notOwner`); enabled means a
 * set-up map whose server does not answer (`down`). An account that may not even read the project (403) is not its
 * owner either; a Google outage leaves it open (`down`).
 */
async function functionsVerdict(fetch: Fetch, projectId: string, token: string): Promise<OwnershipVerdict> {
    const url = `https://serviceusage.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/services/${FUNCTIONS_API}`;
    const response = await fetch(url, bearer(token));
    const service = serviceSchema.safeParse(await bodyOf(response));
    if (response.status === 403 || (service.success && service.data.state === 'DISABLED')) {
        return { kind: 'notOwner' };
    }
    return { kind: 'down' };
}

/** §3.2's decision for the signed-in account and its read-only token; a network failure is `down`. */
export async function checkOwnership(fetch: Fetch, projectId: string, token: string): Promise<OwnershipVerdict> {
    try {
        const owner = await testOwner(fetch, projectId, token);
        if (typeof owner !== 'boolean') {
            return owner;
        }
        return owner ? { kind: 'owner' } : await functionsVerdict(fetch, projectId, token);
    } catch {
        return { kind: 'down' };
    }
}

/**
 * Enables `api` with Service Usage (the owner's `cloud-platform` token): `services:batchEnable`, whose long-running
 * operation Google usually finishes at once. True when Google accepted the request.
 */
export async function enableService(fetch: Fetch, projectId: string, token: string, api: string): Promise<boolean> {
    const url = `https://serviceusage.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/services:batchEnable`;
    try {
        const response = await fetch(url, bearer(token, { method: 'POST', body: JSON.stringify({ serviceIds: [api] }) }));
        return response.ok;
    } catch {
        return false;
    }
}
