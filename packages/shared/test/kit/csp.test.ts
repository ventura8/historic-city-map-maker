/** The one CSP table of every engine page (M5 kit-cli; docs/research/M5-interfaces.md §3.2). */
import { describe, expect, it } from 'vitest';

import { ANALYTICS_CONNECT_SOURCES, contentSecurityPolicy, NO_EXTRA_SOURCES, policyExtras, SELF_SOURCE } from '../../src/kit/csp.js';
import { isCspOrigin } from '../../src/text/urls.js';

function directive(policy: string, name: string): string[] {
    const found = policy.split('; ').find((part) => part.startsWith(`${name} `));
    return (found ?? '').split(' ').slice(1);
}

const PINNED = 'https://cdn.jsdelivr.net/gh/ventura8/historic-city-map-maker@v1.0.0/cdn/engine/';
/** A clear-text origin, which no policy names (built, so no `http:` address stands in the source). */
const CLEAR_TEXT_ORIGIN = ['http', '//a.org'].join(':');

describe('contentSecurityPolicy', () => {
    it('happyPath_aSitePageLoadsTheEngineFromItsOwnOrigin', () => {
        const policy = contentSecurityPolicy(NO_EXTRA_SOURCES);

        expect(policy.split('; ').map((part) => part.split(' ')[0])).toEqual([
            'default-src',
            'script-src',
            'style-src',
            'img-src',
            'connect-src',
            'font-src',
            'worker-src',
            'child-src',
            'manifest-src',
            'base-uri',
            'form-action',
            'object-src',
        ]);
        expect(directive(policy, 'default-src')).toEqual(["'none'"]);
        expect(directive(policy, 'script-src')).toEqual([
            SELF_SOURCE,
            'https://api.mapbox.com/mapbox-gl-js/',
            "'wasm-unsafe-eval'",
            'https://www.googletagmanager.com',
        ]);
        expect(directive(policy, 'style-src')).toEqual([SELF_SOURCE, 'https://api.mapbox.com/mapbox-gl-js/']);
        expect(directive(policy, 'font-src')).toEqual([SELF_SOURCE]);
        expect(directive(policy, 'worker-src')).toEqual(['blob:', "'self'"]);
        expect(directive(policy, 'object-src')).toEqual(["'none'"]);
    });

    it('happyPath_theKitLoadsItsScriptStylesAndFontsFromThePinnedFolderOnly', () => {
        const policy = contentSecurityPolicy(NO_EXTRA_SOURCES, PINNED);

        expect(directive(policy, 'script-src')).toEqual([
            PINNED,
            'https://api.mapbox.com/mapbox-gl-js/',
            "'wasm-unsafe-eval'",
            'https://www.googletagmanager.com',
        ]);
        expect(directive(policy, 'style-src')).toEqual([PINNED, 'https://api.mapbox.com/mapbox-gl-js/']);
        expect(directive(policy, 'font-src')).toEqual([PINNED]);
        // The manifest and the photos beside the page stay the page's own origin.
        expect(directive(policy, 'connect-src')[0]).toBe(SELF_SOURCE);
        expect(directive(policy, 'img-src')[0]).toBe(SELF_SOURCE);
        expect(policy).not.toContain('cdn.jsdelivr.net/gh/ventura8/historic-city-map-maker@1/');
    });

    it('happyPath_aManifestsOwnOriginsJoinOnceEach', () => {
        const policy = contentSecurityPolicy({
            connect: ['https://tiles.example.org', 'https://tiles.example.org'],
            images: ['https://photos.example.org'],
        });

        expect(directive(policy, 'connect-src').filter((source) => source === 'https://tiles.example.org')).toHaveLength(1);
        expect(directive(policy, 'img-src')).toContain('https://photos.example.org');
        expect(directive(policy, 'connect-src')).not.toContain('https://photos.example.org');
    });

    it('badPath_noSourceAllowsInlineCodeOrAnyHost', () => {
        const policy = contentSecurityPolicy(NO_EXTRA_SOURCES, PINNED);

        expect(policy).not.toContain("'unsafe-inline'");
        expect(policy).not.toContain("'unsafe-eval'");
        expect(policy.split(/[ ;]+/)).not.toContain('*');
        expect(policy.split(/[ ;]+/)).not.toContain('https:');
    });

    it('happyPath_anExportsPolicyNamesNoTelemetryHost', () => {
        const policy = contentSecurityPolicy({ connect: ['https://tiles.example.org'], images: [] }, SELF_SOURCE, false);

        expect(directive(policy, 'script-src')).toEqual([SELF_SOURCE, 'https://api.mapbox.com/mapbox-gl-js/', "'wasm-unsafe-eval'"]);
        expect(directive(policy, 'connect-src')).toEqual([
            SELF_SOURCE,
            'https://api.mapbox.com',
            'https://events.mapbox.com',
            'https://*.tiles.mapbox.com',
            'https://tiles.example.org',
        ]);
        expect(directive(policy, 'img-src')).toEqual([SELF_SOURCE, 'data:', 'blob:', 'https://api.mapbox.com']);
    });

    it('badPath_aSourceThatWouldEndItsDirectiveThrows', () => {
        // docs/LESSONS.md 241: `new URL('https://a.example.org;font-src/x').origin` is `https://a.example.org;font-src`.
        for (const source of [
            'https://a.example.org;font-src',
            "https://a.example.org'unsafe-inline'",
            'https://a.example.org/path',
            CLEAR_TEXT_ORIGIN,
        ]) {
            expect(() => contentSecurityPolicy({ connect: [source], images: [] })).toThrow(RangeError);
            expect(() => contentSecurityPolicy({ connect: [], images: [source] })).toThrow(RangeError);
        }
    });
});

describe('isCspOrigin', () => {
    it('happyPath_httpsHostsWithAPortOrAWildcard', () => {
        for (const origin of [
            'https://tiles.example.org',
            'https://TILES.example.org:8443',
            'https://*.tiles.example.org',
            'https://xn--bucureti-xjb.ro',
        ]) {
            expect(isCspOrigin(origin)).toBe(true);
        }
    });

    it('badPath_anythingAPolicyWouldReadAsMore', () => {
        for (const origin of [
            'https://a.org;img-src',
            "https://a.org'x'",
            'https://a.org/',
            'https://a_b.org',
            CLEAR_TEXT_ORIGIN,
            'https://a.org:',
            '*',
        ]) {
            expect(isCspOrigin(origin)).toBe(false);
        }
    });
});

describe('policyExtras', () => {
    it('happyPath_theOriginsAPageAddedAndItsTelemetry', () => {
        const policy = contentSecurityPolicy({ connect: ['https://tiles.example.org'], images: ['https://photos.example.org'] }, PINNED);

        expect(policyExtras(policy)).toEqual({
            sources: { connect: ['https://tiles.example.org'], images: ['https://photos.example.org'] },
            analytics: true,
        });
        expect(policyExtras(contentSecurityPolicy(NO_EXTRA_SOURCES, SELF_SOURCE, false))).toEqual({
            sources: NO_EXTRA_SOURCES,
            analytics: false,
        });
    });

    it('badPath_whatIsNotAnOriginIsNotCarriedOver', () => {
        const policy = `default-src 'none'; img-src 'self' https://a.org/path 'unsafe-inline' https://ok.example.org https://*.tiles.mapbox.com; connect-src ${ANALYTICS_CONNECT_SOURCES[0] ?? ''}`;

        expect(policyExtras(policy)).toEqual({ sources: { connect: [], images: ['https://ok.example.org'] }, analytics: true });
        expect(policyExtras('')).toEqual({ sources: NO_EXTRA_SOURCES, analytics: false });
    });
});
