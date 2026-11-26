import type { TokenProvider } from '../ports/token-provider.js';

/** The part of google-auth-library's GoogleAuth this adapter uses (Application Default Credentials). */
export interface AccessTokenSource {
    getAccessToken(): Promise<string | null | undefined>;
}

export function createGoogleTokenProvider(source: AccessTokenSource): TokenProvider {
    return {
        accessToken: async () => {
            const token = await source.getAccessToken();
            if (!token) {
                throw new Error('Application Default Credentials returned no access token');
            }
            return token;
        },
    };
}
