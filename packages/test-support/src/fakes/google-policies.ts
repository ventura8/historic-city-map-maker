import type { UpstreamRequest } from './fetch.js';
import { bodyField } from './routes.js';

/**
 * The IAM policies of resources as Pub/Sub and Secret Manager keep them (`getIamPolicy`, `setIamPolicy` with
 * `{policy}`): a version, an etag that changes on every write, and the bindings. A write naming a stale etag is refused
 * (the caller answers 409 `ABORTED`), as Google does, so the admin's read-merge-write retry is exercised.
 */

interface PolicyBinding {
    readonly role: string;
    readonly members: readonly string[];
}

interface StoredPolicy {
    readonly version: number;
    readonly etag: string;
    readonly bindings: readonly PolicyBinding[];
}

function fieldOf(value: unknown, field: string): unknown {
    return typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>)[field] : undefined;
}

function bindingsOf(value: unknown): readonly PolicyBinding[] {
    const bindings = typeof value === 'object' && value !== null ? (value as { bindings?: unknown }).bindings : undefined;
    return Array.isArray(bindings) ? (bindings as PolicyBinding[]) : [];
}

/** Resource key (`<project>/<secret>`) → its policy; a resource never written has an empty version-1 policy. */
export class PolicyStore {
    readonly #policies = new Map<string, StoredPolicy>();
    #writes = 0;

    read(key: string): StoredPolicy {
        return this.#policies.get(key) ?? { version: 1, etag: 'BwXe2e0000=', bindings: [] };
    }

    /** Applies a `setIamPolicy` request: the stored policy, or undefined when its etag is not the current one. */
    write(key: string, request: UpstreamRequest): StoredPolicy | undefined {
        const policy = bodyField(request, 'policy');
        const etag = fieldOf(policy, 'etag');
        if (typeof etag === 'string' && etag !== this.read(key).etag) {
            return undefined;
        }
        const version = fieldOf(policy, 'version');
        this.#writes += 1;
        const stored: StoredPolicy = {
            version: typeof version === 'number' ? version : 1,
            etag: `BwXe2e${String(this.#writes).padStart(4, '0')}=`,
            bindings: bindingsOf(policy),
        };
        this.#policies.set(key, stored);
        return stored;
    }

    /** Changes the etag without changing the bindings: someone else wrote the policy meanwhile. */
    touch(key: string): void {
        this.#writes += 1;
        this.#policies.set(key, { ...this.read(key), etag: `BwXe2e${String(this.#writes).padStart(4, '0')}=` });
    }

    snapshot(): Readonly<Record<string, StoredPolicy>> {
        return Object.fromEntries(this.#policies);
    }
}
