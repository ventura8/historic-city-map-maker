/**
 * Asking Google for the start page's token (`docs/research/M14-start-your-map.md` §2): the OAuth 2.0 flow for browser
 * apps in the current tab (`response_type=token`), so no popup, no Google script before the click and no client secret.
 * A random `state` kept in `sessionStorage` proves the answer was meant for this tab. The token stays in memory; the
 * address's fragment is cleared before anything else runs.
 */
export const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

/** Create and list projects; Firebase, Hosting and Identity Toolkit all accept the second (§2). */
export const START_SCOPES = ['https://www.googleapis.com/auth/cloudplatformprojects', 'https://www.googleapis.com/auth/firebase'] as const;

export interface StartToken {
    readonly token: string;
    readonly scopes: readonly string[];
    /** Epoch milliseconds. */
    readonly expiresAt: number;
}

/** What Google's answer means. */
export type ConsentAnswer =
    | { readonly kind: 'none' }
    | { readonly kind: 'denied' | 'wrongState' | 'scope' }
    | { readonly kind: 'granted'; readonly grant: StartToken };

export interface ConsentRequest {
    readonly authorizeUrl: string;
    readonly clientId: string;
    readonly redirectUri: string;
    readonly state: string;
    readonly loginHint?: string;
    /** The e2e stand-in's partition; never set in production. */
    readonly testId?: string;
}

/** Where the click sends the tab. */
export function consentUrl(request: ConsentRequest): string {
    const url = new URL(request.authorizeUrl);
    const params: Readonly<Record<string, string>> = {
        client_id: request.clientId,
        redirect_uri: request.redirectUri,
        response_type: 'token',
        scope: START_SCOPES.join(' '),
        state: request.state,
        include_granted_scopes: 'false',
        ...(request.loginHint === undefined ? {} : { login_hint: request.loginHint }),
        ...(request.testId === undefined ? {} : { test: request.testId }),
    };
    Object.entries(params).forEach(([name, value]) => {
        url.searchParams.set(name, value);
    });
    return url.toString();
}

const DEFAULT_LIFETIME_S = 3540;

function lifetimeMs(fields: URLSearchParams): number {
    return Number(fields.get('expires_in') ?? DEFAULT_LIFETIME_S) * 1000;
}

function grantOf(fields: URLSearchParams, now: number): ConsentAnswer {
    const token = fields.get('access_token') ?? '';
    const scopes = (fields.get('scope') ?? '').split(' ');
    const complete = START_SCOPES.every((scope) => scopes.includes(scope));
    return token !== '' && complete
        ? { kind: 'granted', grant: { token, scopes, expiresAt: now + lifetimeMs(fields) } }
        : { kind: 'scope' };
}

function answered(fields: URLSearchParams): boolean {
    return fields.has('access_token') || fields.has('error');
}

/** Reads the address's fragment: nothing asked, a refusal, an answer of another tab, a refused scope, or the token. */
export function readConsentAnswer(fragment: string, expectedState: string | null, now: number): ConsentAnswer {
    const fields = new URLSearchParams(fragment.replace(/^#/, ''));
    if (!answered(fields)) {
        return { kind: 'none' };
    }
    if (expectedState === null || fields.get('state') !== expectedState) {
        return { kind: 'wrongState' };
    }
    return fields.has('error') ? { kind: 'denied' } : grantOf(fields, now);
}
