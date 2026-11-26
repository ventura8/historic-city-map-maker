import type { SecretName, SecretStore } from '../ports/secret-store.js';

/**
 * Secret store for the Functions emulator (FUNCTIONS_EMULATOR=true, deps.ts): versions live in
 * memory only, so no emulator or e2e run can ever touch the real Secret Manager.
 */
export function createMemorySecretStore(): SecretStore {
    const versions = new Map<SecretName, string[]>();
    return {
        read: (name) => Promise.resolve(versions.get(name)?.at(-1)),
        write: (name, value) => {
            const list = [...(versions.get(name) ?? []), value];
            versions.set(name, list);
            return Promise.resolve(`memory/secrets/${name}/versions/${String(list.length)}`);
        },
        invalidate: () => undefined,
    };
}
