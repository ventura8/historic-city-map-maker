import { describe, expect, it } from 'vitest';

import { createGoogleTokenProvider } from '../../src/adapters/google-token-provider.js';

describe('createGoogleTokenProvider', () => {
    it('happyPath_returnsTheAdcAccessToken', async () => {
        const provider = createGoogleTokenProvider({ getAccessToken: () => Promise.resolve('ya29.e2e') });

        await expect(provider.accessToken()).resolves.toBe('ya29.e2e');
    });

    it.each([null, undefined, ''])('badPath_noTokenIsAnError_%s', async (token) => {
        const provider = createGoogleTokenProvider({ getAccessToken: () => Promise.resolve(token) });

        await expect(provider.accessToken()).rejects.toThrow('Application Default Credentials returned no access token');
    });
});
