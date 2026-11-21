import { asRecord, lastSegment, records, stringAt, strings, type JsonObject } from './json.js';
import type { GoogleTransport } from './transport.js';

/**
 * reCAPTCHA Enterprise v1 and Firebase App Check v1 for the `app-check` item (`docs/research/M2b-interfaces.md` §3.4):
 * the admin's score-based web key (found by its display name) and the App Check provider configuration of the web app.
 * Enforcement stays off (monitor) until a week after the admin ships the key; switching it on is a later settings action.
 */

const RECAPTCHA = 'https://recaptchaenterprise.googleapis.com/v1';
const APP_CHECK = 'https://firebaseappcheck.googleapis.com/v1';

export interface RecaptchaKey {
    /** `projects/<number>/keys/<siteKey>` */
    readonly name: string;
    readonly displayName: string;
    /** The public site key the admin's App Check uses (the last segment of the name). */
    readonly siteKey: string;
    readonly allowedDomains: readonly string[];
}

interface AppCheckConfig {
    readonly siteKey?: string;
    readonly tokenTtl?: string;
}

export interface AppCheckClient {
    listKeys(projectId: string): Promise<RecaptchaKey[]>;
    createKey(projectId: string, displayName: string, allowedDomains: readonly string[]): Promise<RecaptchaKey>;
    setKeyDomains(key: RecaptchaKey, allowedDomains: readonly string[]): Promise<void>;
    getConfig(projectNumber: string, appId: string): Promise<AppCheckConfig>;
    setConfig(projectNumber: string, appId: string, config: Required<AppCheckConfig>): Promise<void>;
}

function keyOf(body: JsonObject): RecaptchaKey {
    const name = String(body['name']);
    return {
        name,
        displayName: stringAt(body, 'displayName') ?? '',
        siteKey: lastSegment(name),
        allowedDomains: strings((body['webSettings'] as JsonObject | undefined)?.['allowedDomains']),
    };
}

function webSettings(allowedDomains: readonly string[]): JsonObject {
    return { integrationType: 'SCORE', allowedDomains };
}

export function createAppCheckClient(transport: GoogleTransport): AppCheckClient {
    const config = (projectNumber: string, appId: string): string =>
        `${APP_CHECK}/projects/${projectNumber}/apps/${appId}/recaptchaEnterpriseConfig`;
    return {
        listKeys: async (projectId) =>
            records(
                await transport.pages(
                    { operation: 'recaptcha-enterprise.keys.list', url: `${RECAPTCHA}/projects/${projectId}/keys` },
                    'keys',
                ),
            ).map(keyOf),
        createKey: async (projectId, displayName, allowedDomains) => {
            const created = await transport.call({
                operation: 'recaptcha-enterprise.keys.create',
                method: 'POST',
                url: `${RECAPTCHA}/projects/${projectId}/keys`,
                body: { displayName, webSettings: webSettings(allowedDomains) },
                role: 'roles/recaptchaenterprise.admin',
            });
            return keyOf(asRecord(created));
        },
        setKeyDomains: async (key, allowedDomains) => {
            await transport.call({
                operation: 'recaptcha-enterprise.keys.patch',
                method: 'PATCH',
                url: `${RECAPTCHA}/${key.name}`,
                query: { updateMask: 'webSettings.allowedDomains' },
                body: { webSettings: webSettings(allowedDomains) },
                role: 'roles/recaptchaenterprise.admin',
            });
        },
        getConfig: async (projectNumber, appId) => {
            const body = await transport.find({ operation: 'app-check.recaptchaEnterpriseConfig.get', url: config(projectNumber, appId) });
            const siteKey = stringAt(body, 'siteKey');
            const tokenTtl = stringAt(body, 'tokenTtl');
            return { ...(siteKey === undefined ? {} : { siteKey }), ...(tokenTtl === undefined ? {} : { tokenTtl }) };
        },
        setConfig: async (projectNumber, appId, wanted) => {
            await transport.call({
                operation: 'app-check.recaptchaEnterpriseConfig.patch',
                method: 'PATCH',
                url: config(projectNumber, appId),
                query: { updateMask: 'siteKey,tokenTtl' },
                body: wanted,
                role: 'roles/firebaseappcheck.admin',
            });
        },
    };
}
