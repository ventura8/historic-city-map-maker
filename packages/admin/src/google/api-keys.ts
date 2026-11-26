import { asRecord, at, records, stringAt, strings, type JsonObject } from './json.js';
import type { GoogleTransport } from './transport.js';

/**
 * API Keys v2 for the `api-key` item (`docs/research/M2b-interfaces.md` §3.4): the browser key of the web configuration
 * (found by comparing each key's string with it) gets its HTTP referrer restriction; its API targets stay as they are.
 * The key string is compared in memory only, never logged or kept.
 */

const API_KEYS = 'https://apikeys.googleapis.com/v2';
const ROLE = 'roles/serviceusage.apiKeysAdmin';

interface ApiKey {
    /** `projects/<number>/locations/global/keys/<id>` */
    readonly name: string;
    readonly allowedReferrers: readonly string[];
    /** The key's `restrictions` as read (the API targets are kept when the referrers change). */
    readonly restrictions: JsonObject;
}

export interface ApiKeysClient {
    /** The project's key whose string is `keyString`, or undefined. */
    findKey(projectId: string, keyString: string): Promise<ApiKey | undefined>;
    setReferrers(key: ApiKey, allowedReferrers: readonly string[]): Promise<void>;
}

function keyOf(body: JsonObject): ApiKey {
    const restrictions = asRecord(at(body, 'restrictions'));
    return {
        name: String(body['name']),
        allowedReferrers: strings(at(restrictions, 'browserKeyRestrictions', 'allowedReferrers')),
        restrictions,
    };
}

export function createApiKeysClient(transport: GoogleTransport): ApiKeysClient {
    const keyString = async (name: string): Promise<string | undefined> =>
        stringAt(await transport.call({ operation: 'api-keys.getKeyString', url: `${API_KEYS}/${name}/keyString` }), 'keyString');
    return {
        findKey: async (projectId, wanted) => {
            const keys = records(
                await transport.pages(
                    { operation: 'api-keys.list', url: `${API_KEYS}/projects/${projectId}/locations/global/keys` },
                    'keys',
                ),
            ).map(keyOf);
            for (const key of keys) {
                if ((await keyString(key.name)) === wanted) {
                    return key;
                }
            }
            return undefined;
        },
        setReferrers: async (key, allowedReferrers) => {
            const request = {
                operation: 'api-keys.patch',
                method: 'PATCH' as const,
                url: `${API_KEYS}/${key.name}`,
                query: { updateMask: 'restrictions' },
                body: { restrictions: { ...key.restrictions, browserKeyRestrictions: { allowedReferrers } } },
                role: ROLE,
            };
            await transport.operation(API_KEYS, await transport.call(request), request);
        },
    };
}
