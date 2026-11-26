import type { Logger } from '@hcm/shared';

import type { Clock } from '../ports/clock.js';
import { UpstreamError } from '../ports/errors.js';
import type { SecretName, SecretStore } from '../ports/secret-store.js';
import type { SetupRecords } from '../ports/setup-records.js';
import type { TokenProvider } from '../ports/token-provider.js';
import { googleError, googleJson, googleSend } from './google-call.js';
import { at, list, readJson, stringAt, type Fetch } from './upstream-http.js';

/**
 * Secret Manager over its REST API with `fetch` (security review §0.1, §1.2; it replaces the M0
 * `secret-store-rest.ts`): the gRPC client cannot be intercepted in tests and costs cold-start time. Values are read
 * at runtime, never through `defineSecret`, so a token pasted into the Setup Assistant works without a redeploy.
 *
 * - `read`: `versions/latest:access`, cached per instance for `ttlMs` (5 minutes) and only while
 *   `setup/status.secretsRev` is the revision the value was read under (`revision`), so a save on another instance
 *   reaches every instance on its next read.
 * - `write`: `:addVersion`, then every older enabled version is destroyed (best effort, logged): one active version per
 *   secret keeps the project inside the 6 free active versions, and a replaced token is gone, not just disabled.
 *
 * Failures are `UpstreamError('secret-manager', …)`; no value, token or response body ever reaches an error or a log.
 */
export const SECRET_MANAGER_API = 'https://secretmanager.googleapis.com/v1';

export interface SecretManagerOptions {
    readonly projectId: string;
    readonly tokens: TokenProvider;
    readonly fetch: Fetch;
    readonly clock: Clock;
    readonly log: Logger;
    /** How long a value is reused on this instance (5 minutes in production). */
    readonly ttlMs: number;
    /** `setup/status.secretsRev` (see {@link secretsRevision}); without it the cache expires by time only. */
    readonly revision?: () => Promise<number | undefined>;
}

interface CacheEntry {
    readonly value: string | undefined;
    readonly revision: number | undefined;
    readonly expiresAt: number;
}

/** `projects/{p}/secrets/{name}/versions/{n}`: a version name as Secret Manager spells it (never built from input). */
const VERSION_NAME = /^projects\/[\w-]{1,64}\/secrets\/[\w-]{1,255}\/versions\/\d{1,20}$/;

/** Enabled versions of one secret are few (one, plus the one just added): one page is all of them. */
const VERSION_PAGE_SIZE = 100;

const SERVICE = 'secret-manager';

function decodePayload(body: unknown): string {
    const data = stringAt(body, 'payload', 'data');
    if (data === undefined) {
        throw new UpstreamError(SERVICE, 'invalid');
    }
    return Buffer.from(data, 'base64').toString('utf8');
}

function isFresh(cached: CacheEntry | undefined, now: number, revision: number | undefined): cached is CacheEntry {
    return cached !== undefined && cached.expiresAt > now && cached.revision === revision;
}

/** The names of the enabled versions other than `keep`. */
function olderVersions(body: unknown, keep: string): string[] {
    return list(at(body, 'versions'))
        .map((version) => stringAt(version, 'name'))
        .filter((name): name is string => name !== undefined && name !== keep && VERSION_NAME.test(name));
}

/** The revision source the composition root passes: `setup/status.secretsRev` through the lenient setup read. */
export function secretsRevision(records: SetupRecords): () => Promise<number | undefined> {
    return async () => {
        const revision = (await records.readStatus())?.['secretsRev'];
        return typeof revision === 'number' ? revision : undefined;
    };
}

/** The REST calls of one project's secrets, with the service account's token. */
function secretManagerRest(options: Pick<SecretManagerOptions, 'projectId' | 'tokens' | 'fetch'>) {
    const secretUrl = (name: SecretName): string =>
        `${SECRET_MANAGER_API}/projects/${encodeURIComponent(options.projectId)}/secrets/${name}`;
    const authorized = async (method: 'GET' | 'POST', body?: unknown) => ({
        method,
        accessToken: await options.tokens.accessToken(),
        body,
    });
    return {
        /** The latest version's value; a 404 (no such secret, or no version yet) is "not set". */
        accessLatest: async (name: SecretName): Promise<string | undefined> => {
            const response = await googleSend(options.fetch, SERVICE, `${secretUrl(name)}/versions/latest:access`, await authorized('GET'));
            if (response.status === 404) {
                return undefined;
            }
            if (!response.ok) {
                throw await googleError(SERVICE, response);
            }
            return decodePayload(await readJson(response));
        },
        addVersion: async (name: SecretName, value: string): Promise<string> => {
            const payload = { payload: { data: Buffer.from(value, 'utf8').toString('base64') } };
            const answer = await googleJson(options.fetch, SERVICE, `${secretUrl(name)}:addVersion`, await authorized('POST', payload));
            const version = stringAt(answer, 'name');
            if (version === undefined) {
                throw new UpstreamError(SERVICE, 'invalid');
            }
            return version;
        },
        destroyOlderVersions: async (name: SecretName, keep: string): Promise<void> => {
            const listUrl = `${secretUrl(name)}/versions?filter=${encodeURIComponent('state:ENABLED')}&pageSize=${String(VERSION_PAGE_SIZE)}`;
            const older = olderVersions(await googleJson(options.fetch, SERVICE, listUrl, await authorized('GET')), keep);
            for (const version of older) {
                await googleJson(options.fetch, SERVICE, `${SECRET_MANAGER_API}/${version}:destroy`, await authorized('POST', {}));
            }
        },
    };
}

export function createSecretManagerStore(options: SecretManagerOptions): SecretStore {
    const cache = new Map<SecretName, CacheEntry>();
    const rest = secretManagerRest(options);
    return {
        read: async (name) => {
            const revision = await options.revision?.();
            const now = options.clock.now().getTime();
            const cached = cache.get(name);
            if (isFresh(cached, now, revision)) {
                return cached.value;
            }
            const value = await rest.accessLatest(name);
            cache.set(name, { value, revision, expiresAt: now + options.ttlMs });
            return value;
        },
        write: async (name, value) => {
            const version = await rest.addVersion(name, value);
            cache.delete(name);
            try {
                await rest.destroyOlderVersions(name, version);
            } catch (error) {
                options.log.warn('older secret versions were not destroyed', { name, error: String(error) });
            }
            return version;
        },
        invalidate: () => {
            cache.clear();
        },
    };
}
