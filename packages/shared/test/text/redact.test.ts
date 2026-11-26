import { describe, expect, it } from 'vitest';

import { redactText } from '../../src/text/redact.js';

/** Test values shaped like credentials, assembled so no scanner mistakes them for real ones. */
const GOOGLE_KEY = ['AIza', 'SyA-1234567890abcdefghijklmn'].join('');
const ACCESS_TOKEN = ['ya29', 'a0-scenario-test-value'].join('.');
/** A JSON Web Token's shape (header, payload, signature), as a Firebase ID token or an App Check token has it. */
const WEB_TOKEN = ['eyJhbGciOiJSUzI1NiJ9', 'eyJzdWIiOiJzY2VuYXJpbyJ9', 'c2lnbmF0dXJl'].join('.');

describe('redactText', () => {
    it('happyPath_tokensKeysAndAddressesAreRedacted', () => {
        expect(redactText('key pk.eyJ1IjoieCJ9.abcdef and sk.secret123456 for jane.doe@example.org')).toBe(
            'key [redacted] and [redacted] for [redacted]',
        );
        expect(redactText(`${GOOGLE_KEY} token=abc&x=1 Bearer ${ACCESS_TOKEN}`)).toBe('[redacted] [redacted]&x=1 Bearer [redacted]');
    });

    it('happyPath_webTokensAreRedacted', () => {
        expect(redactText(`id token ${WEB_TOKEN} refused`)).toBe('id token [redacted] refused');
    });

    it('happyPath_urlsLoseTheirQueryAndFragment', () => {
        expect(redactText('at https://site.example.org/p#16/44.4/26.1&photo=x (https://api.mapbox.com/v4/a.json?access_token=pk.x)')).toBe(
            'at https://site.example.org/p (https://api.mapbox.com/v4/a.json)',
        );
    });

    it('badPath_plainTextIsLeftAlone', () => {
        expect(redactText('TypeError: x is undefined at load (engine.mjs:1:2)')).toBe('TypeError: x is undefined at load (engine.mjs:1:2)');
    });
});
