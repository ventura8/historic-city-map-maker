import type { GoogleIam } from '../ports/google-iam.js';
import { googleError, googleSend } from './google-call.js';
import { at, readJson, send, stringAt, strings, upstreamError, type Fetch } from './upstream-http.js';

/**
 * The Google identity and IAM calls of `admin.claim` (M2-interfaces §3.1), made with the CALLER's own OAuth access
 * token, never the service account's: Google's tokeninfo (whose account, which client, which scopes) and Resource
 * Manager `testIamPermissions` (does that account hold a permission on the project). The token travels only in an
 * `Authorization` header, never in a URL, and never appears in an error or a log.
 */
export const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
export const RESOURCE_MANAGER_API = 'https://cloudresourcemanager.googleapis.com/v3';

type AccessTokenInfo = Awaited<ReturnType<GoogleIam['tokenInfo']>>;

const OAUTH = 'google-oauth';
const RESOURCE_MANAGER = 'resource-manager';
/** tokeninfo answers 400 `invalid_token` for an expired, revoked or malformed token. */
const INVALID_TOKEN = 400;
const FORBIDDEN = 403;

/** `email_verified` and `expires_in` arrive as strings ("true", "3599"). */
function isTrue(value: unknown): boolean {
    return value === true || value === 'true';
}

function seconds(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** What tokeninfo says; a token without the `email` scope cannot prove who granted it, so it is refused like a bad one. */
function toTokenInfo(body: unknown, response: Response): AccessTokenInfo {
    const email = stringAt(body, 'email');
    const audience = stringAt(body, 'azp') ?? stringAt(body, 'aud');
    if (email === undefined || audience === undefined) {
        throw upstreamError(OAUTH, response, 'unauthorized');
    }
    return {
        email,
        emailVerified: isTrue(at(body, 'email_verified')),
        audience,
        scopes: (stringAt(body, 'scope') ?? '').split(' ').filter((scope) => scope !== ''),
        expiresInSeconds: seconds(at(body, 'expires_in')),
    };
}

export function createGoogleIam(options: { readonly fetch: Fetch }): GoogleIam {
    return {
        tokenInfo: async (accessToken) => {
            // google-auth-library's own `getTokenInfo` shape: POST with the token as a bearer header.
            const response = await send(options.fetch, OAUTH, GOOGLE_TOKENINFO_URL, {
                method: 'POST',
                headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/x-www-form-urlencoded' },
            });
            if (!response.ok) {
                throw upstreamError(OAUTH, response, response.status === INVALID_TOKEN ? 'unauthorized' : undefined);
            }
            return toTokenInfo(await readJson(response), response);
        },
        testProjectPermissions: async (projectId, accessToken, permissions) => {
            const url = `${RESOURCE_MANAGER_API}/projects/${encodeURIComponent(projectId)}:testIamPermissions`;
            const response = await googleSend(options.fetch, RESOURCE_MANAGER, url, { method: 'POST', accessToken, body: { permissions } });
            if (response.status === FORBIDDEN) {
                return [];
            }
            if (!response.ok) {
                throw await googleError(RESOURCE_MANAGER, response);
            }
            const granted = strings(at(await readJson(response), 'permissions'));
            return permissions.filter((permission) => granted.includes(permission));
        },
    };
}
