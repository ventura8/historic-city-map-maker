/**
 * The host of the engine's extras (`loader.ts`): one global object, `__hcmEngineHost`, holding one entry per engine
 * release (its key, e.g. `v1_0_0`, is the build's: `hostKeyOf` in `scripts/site/src/engine-extras.ts`). An extra's script reads that release's shared bindings from its
 * entry (Lit and `@hcm/shared`: one copy of each on the page, one catalogue state), registers its exports on its `extras`
 * and, as its last statement, marks itself on its `ready` (a script that throws while it runs never gets there). The
 * extras' build maps `lit` to `__hcmEngineHost.<key>.lit` and `@hcm/shared` to `__hcmEngineHost.<key>.shared`
 * (`packages/engine/vite.config.ts`). Two engine releases on one page each keep their own entry, so neither takes the
 * other's bindings or extras. The property is not enumerable: it is not part of the API.
 */
import * as lit from './host-lit.js';
import * as shared from './host-shared.js';

export const EXTRAS_HOST_GLOBAL = '__hcmEngineHost';

export interface ExtrasHost {
    readonly lit: typeof lit;
    readonly shared: typeof shared;
    /** What each extra registered (`extras.<global>`), filled as its script runs. */
    readonly extras: Record<string, unknown>;
    /** `ready.<global> === true` once the extra's script ran to its end. */
    readonly ready: Record<string, unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isHost(value: unknown): value is ExtrasHost {
    return isObject(value) && isObject(value['extras']) && isObject(value['ready']) && 'lit' in value && 'shared' in value;
}

function hostsOf(scope: object): Record<string, unknown> {
    const existing: unknown = Reflect.get(scope, EXTRAS_HOST_GLOBAL);
    if (isObject(existing)) {
        return existing;
    }
    const hosts: Record<string, unknown> = {};
    Object.defineProperty(scope, EXTRAS_HOST_GLOBAL, { value: hosts, writable: true, configurable: true, enumerable: false });
    return hosts;
}

/** The scope's host for the release `key`, installed the first time (an engine of the same release loaded twice shares it). */
export function installExtrasHost(scope: object, key: string): ExtrasHost {
    const hosts = hostsOf(scope);
    const existing = hosts[key];
    if (isHost(existing)) {
        return existing;
    }
    const host: ExtrasHost = { lit, shared, extras: {}, ready: {} };
    hosts[key] = host;
    return host;
}
