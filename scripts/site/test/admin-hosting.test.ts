/**
 * What Firebase Hosting does with a request (`scripts/site/src/admin/hosting.ts`, read from `firebase.json` by the e2e
 * Hosting server): the committed `hosting` block of M6 (docs/research/M6-interfaces.md §2.2), its globs and regular
 * expressions, superstatic's order (redirects, files with `cleanUrls` and `trailingSlash`, rewrites, `404.html`) and the
 * headers per path, probed over the paths of the Hosting tree: one Content-Security-Policy per page, the admin's on
 * `/admin/**` only, the viewer's its own meta policy.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { adminContentSecurityPolicy, e2eContentSecurityPolicy } from '../src/admin/csp.js';
import {
    CSP_HEADER,
    NOT_FOUND_PAGE,
    answerHeaders,
    e2eHeaders,
    e2eHostingHeaders,
    globToRegExp,
    hostingHeaders,
    isIgnored,
    parseHostingConfig,
    redirectOf,
    resolveHostingPath,
    rewriteOf,
    ruleMatches,
    type HostingConfig,
} from '../src/admin/hosting.js';
import { SiteBuildError } from '../src/errors.js';
import { CITY_PATH_REGEX } from '../src/hosting/city-page.js';
import { ROOT } from './support.js';

function committedHosting(): HostingConfig {
    return parseHostingConfig(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));
}

const E2E_ORIGINS = ['http://127.0.0.1:8080', 'http://127.0.0.1:4311'];

/** The files of a Hosting tree as `build:hosting` makes it (a root city, a committed city, the city page, the admin). */
const TREE = new Set([
    '/index.html',
    '/config.js',
    '/admin-redirect.js',
    '/engine/engine.mjs',
    '/engine/engine.mjs.map',
    '/.well-hidden',
    '/release.json',
    '/404.html',
    '/hosting.css',
    '/cluj/index.html',
    '/cluj/config.js',
    '/city/index.html',
    '/city/config.js',
    '/admin/index.html',
    '/admin/admin.mjs',
    '/admin/runtime.json',
    '/admin/legacy/bucharest/photos.json',
    '/admin/install/1-0-0-abc1234/manifest.json',
    '/admin/install/1-0-0-abc1234/server.tgz',
    '/about.html',
]);

function exists(hosting: HostingConfig): (path: string) => boolean {
    return (path) => TREE.has(path) && !isIgnored(hosting, path);
}

function resolve(path: string, search = ''): ReturnType<typeof resolveHostingPath> {
    const hosting = committedHosting();
    return resolveHostingPath(hosting, path, search, exists(hosting));
}

describe('parseHostingConfig', () => {
    it('happyPath_readsTheCommittedHostingBlock', () => {
        const hosting = committedHosting();

        expect(hosting.public).toBe('dist/hosting');
        expect([hosting.cleanUrls, hosting.trailingSlash]).toEqual([true, true]);
        expect(hosting.redirects).toEqual([{ regex: '^/admin$', destination: '/admin/', type: 301 }]);
        expect(hosting.rewrites).toEqual([
            { source: '/admin/**', destination: '/admin/index.html' },
            { regex: CITY_PATH_REGEX, destination: '/city/index.html' },
        ]);
    });

    it('happyPath_optionalPartsDefaultToNothing', () => {
        expect(parseHostingConfig('{"hosting": {"public": "dist"}}')).toEqual({
            public: 'dist',
            cleanUrls: false,
            ignore: [],
            redirects: [],
            rewrites: [],
            headers: [],
        });
    });

    it('badPath_notJsonOrWithoutAValidHostingBlockIsABuildError', () => {
        expect(() => parseHostingConfig('{', 'broken.json')).toThrow(/^broken\.json: not JSON: SyntaxError/);
        expect(() => parseHostingConfig('{"hosting": {"public": ""}}')).toThrow(/firebase\.json: invalid hosting block\nhosting\.public/);
        expect(() => parseHostingConfig('{}')).toThrow(SiteBuildError);
    });

    it('badPath_aRuleNeedsExactlyOneOfSourceAndRegex', () => {
        const both = '{"hosting": {"public": "d", "rewrites": [{"source": "**", "regex": ".*", "destination": "/i.html"}]}}';
        const neither = '{"hosting": {"public": "d", "headers": [{"headers": []}]}}';

        expect(() => parseHostingConfig(both)).toThrow(/hosting\.rewrites\[0\]\.source: .*\(validation\.format\)/);
        expect(() => parseHostingConfig(neither)).toThrow(/hosting\.headers\[0\]\.source/);
    });
});

describe('globToRegExp and ruleMatches', () => {
    it.each([
        ['**', '/', true],
        ['**', '/a/b/c.js', true],
        ['**/*.@(html|js|mjs|css|json)', '/admin.mjs', true],
        ['**/*.@(html|js|mjs|css|json)', '/legacy/bucharest/photos.json', true],
        ['**/*.@(html|js|mjs|css|json)', '/admin.mjs.map', false],
        ['**/*.map', '/admin.mjs.map', true],
        ['**/.*', '/legacy/.hidden', true],
        ['**/.*', '/legacy/visible', false],
        ['/static/?.txt', '/static/a.txt', true],
        ['/static/?.txt', '/static/ab.txt', false],
        ['*.html', '/a/index.html', false],
        ['a+b.js', '/a+b.js', true],
        ['/admin/install/*/manifest.json', '/admin/install/1-0-0-abc1234/manifest.json', true],
    ])('happyPath_%s_matches_%s_%s', (glob, path, expected) => {
        expect(globToRegExp(glob).test(path.replace(/^\//, ''))).toBe(expected);
    });

    it.each([
        ['/bacau/', true],
        ['/bacau', true],
        ['/cluj-napoca/', true],
        ['/Not_A_City/', false],
        ['/x/', false],
        ['/bacau/config.js', false],
    ])('happyPath_theCityRegexMatches_%s_%s', (path, expected) => {
        expect(ruleMatches({ regex: CITY_PATH_REGEX }, path)).toBe(expected);
    });
});

describe('resolveHostingPath over the committed rules', () => {
    it.each([
        ['/', { kind: 'file', file: '/index.html', status: 200 }],
        ['/config.js', { kind: 'file', file: '/config.js', status: 200 }],
        ['/admin/', { kind: 'file', file: '/admin/index.html', status: 200 }],
        ['/admin/photos/abc', { kind: 'file', file: '/admin/index.html', status: 200 }],
        ['/admin/admin.mjs', { kind: 'file', file: '/admin/admin.mjs', status: 200 }],
        ['/cluj/', { kind: 'file', file: '/cluj/index.html', status: 200 }],
        ['/bacau/', { kind: 'file', file: '/city/index.html', status: 200 }],
        ['/bacau', { kind: 'file', file: '/city/index.html', status: 200 }],
        ['/city/', { kind: 'file', file: '/city/index.html', status: 200 }],
        ['/about/', { kind: 'file', file: '/about.html', status: 200 }],
        ['/Not_A_City/', { kind: 'file', file: NOT_FOUND_PAGE, status: 404 }],
        ['/engine/engine.mjs.map', { kind: 'file', file: NOT_FOUND_PAGE, status: 404 }],
        ['/.well-hidden', { kind: 'file', file: NOT_FOUND_PAGE, status: 404 }],
        ['//admin//', { kind: 'file', file: '/admin/index.html', status: 200 }],
    ])('happyPath_%s', (path, expected) => {
        expect(resolve(path)).toEqual(expected);
    });

    it.each([
        ['/admin', '?lang=en', '/admin/?lang=en'],
        ['/cluj', '', '/cluj/'],
        ['/index.html', '', '/'],
        ['/cluj/index.html', '', '/cluj/'],
        ['/about', '', '/about/'],
        ['/about.html', '', '/about/'],
    ])('happyPath_%s%s_redirectsTo_%s', (path, search, location) => {
        expect(resolve(path, search)).toEqual({ kind: 'redirect', status: 301, location });
    });

    it('badPath_withoutA404PageAMissingPathIsPlainlyMissing', () => {
        const hosting = committedHosting();

        expect(resolveHostingPath(hosting, '/Not_A_City/', '', () => false)).toEqual({ kind: 'missing' });
        expect(resolveHostingPath(hosting, '/bacau/', '', () => false)).toEqual({ kind: 'missing' });
    });

    it.each([
        // trailingSlash, path, the folder index's answer
        [undefined, false, '/cluj', { kind: 'redirect', status: 301, location: '/cluj/' }],
        [undefined, true, '/cluj', { kind: 'file', file: '/cluj/index.html', status: 200 }],
        [false, true, '/cluj/', { kind: 'redirect', status: 301, location: '/cluj' }],
        [false, true, '/cluj', { kind: 'file', file: '/cluj/index.html', status: 200 }],
        [false, true, '/about/', { kind: 'redirect', status: 301, location: '/about' }],
        [undefined, true, '/about/', { kind: 'missing' }],
        [undefined, true, '/about', { kind: 'file', file: '/about.html', status: 200 }],
        [undefined, true, '/about.html', { kind: 'redirect', status: 301, location: '/about' }],
        [undefined, false, '/about', { kind: 'missing' }],
        [undefined, false, '/about.html', { kind: 'file', file: '/about.html', status: 200 }],
    ] as const)('happyPath_trailingSlash_%s_cleanUrls_%s_%s', (trailingSlash, cleanUrls, path, expected) => {
        const hosting: HostingConfig = {
            public: 'dist',
            cleanUrls,
            ...(trailingSlash === undefined ? {} : { trailingSlash }),
            ignore: [],
            redirects: [],
            rewrites: [],
            headers: [],
        };

        expect(resolveHostingPath(hosting, path, '', (file) => TREE.has(file) && file !== NOT_FOUND_PAGE)).toEqual(expected);
    });

    it('happyPath_aConfiguredRedirectComesFirstWithItsOwnStatus', () => {
        const hosting: HostingConfig = { ...committedHosting(), redirects: [{ regex: '^/old/', destination: '/', type: 302 }] };

        expect(redirectOf(hosting, '/old/x', '?a=1')).toEqual({ kind: 'redirect', status: 302, location: '/?a=1' });
        expect(redirectOf(hosting, '/new/x')).toBeUndefined();
    });

    it('badPath_theAdminRedirectNeverMatchesItsOwnDestination', () => {
        // A `source: "/admin"` glob also matches `/admin/` in superstatic (the emulator answered 301 to itself): the rule
        // is an anchored regex, so the destination is never redirected again.
        const hosting = committedHosting();

        expect(redirectOf(hosting, '/admin', '?lang=en')).toEqual({ kind: 'redirect', status: 301, location: '/admin/?lang=en' });
        expect(redirectOf(hosting, '/admin/')).toBeUndefined();
        expect(redirectOf(hosting, '/admin/photos')).toBeUndefined();
    });
});

describe('hostingHeaders: one policy per page', () => {
    const ADMIN_POLICY = adminContentSecurityPolicy('bucurestiul-disparut');

    it.each(['/admin/', '/admin/admin.mjs', '/admin/photos/abc', '/admin/install/1-0-0-abc1234/manifest.json'])(
        'happyPath_theAdminsPathsCarryTheAdminsPolicyAndPopupRule_%s',
        (path) => {
            const headers = hostingHeaders(committedHosting(), path);

            expect(headers[CSP_HEADER]).toBe(ADMIN_POLICY);
            expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin-allow-popups');
            expect(headers['Content-Security-Policy-Report-Only']).toBe("require-trusted-types-for 'script'");
        },
    );

    it.each([
        '/',
        '/index.html',
        '/engine/engine.iife.js',
        '/bacau/',
        '/cluj/',
        '/city/index.html',
        '/404.html',
        '/release.json',
        '/administration/',
    ])('badPath_theViewersPathsGetNoPolicyHeader_theirPageHasItsOwn_%s', (path) => {
        const headers = hostingHeaders(committedHosting(), path);

        expect(headers[CSP_HEADER]).toBeUndefined();
        expect(headers['Cross-Origin-Opener-Policy']).toBeUndefined();
        expect(headers['X-Content-Type-Options']).toBe('nosniff');
        expect(headers['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=(self)');
    });

    it('happyPath_cachingPerPath', () => {
        const hosting = committedHosting();
        const cache = (path: string): string | undefined => hostingHeaders(hosting, path)['Cache-Control'];

        expect([cache('/'), cache('/bacau/'), cache('/admin/'), cache('/config.js'), cache('/release.json')]).toEqual([
            'no-cache',
            'no-cache',
            'no-cache',
            'no-cache',
            'no-cache',
        ]);
        // The live finding of 2026-11-08: the bundle's JSON is read again on every visit (a new release may grow it); the
        // originals, which never change under their name, keep a day.
        expect(cache('/admin/legacy/bucharest/photos.json')).toBe('no-cache');
        expect(cache('/admin/legacy/bucharest/corrections.json')).toBe('no-cache');
        expect(cache('/admin/legacy/bucharest/city.json')).toBe('no-cache');
        expect(cache('/admin/legacy/bucharest/originals/Arionoaia%201980.jpg')).toBe('public, max-age=86400');
        expect(cache('/admin/legacy/bucharest/originals/a.json')).toBe('public, max-age=86400');
        expect(cache('/admin/install/1-0-0-abc1234/server.tgz')).toBe('public, max-age=31536000, immutable');
        expect(cache('/admin/install/1-0-0-abc1234/manifest.json')).toBe('no-cache');
        expect(cache('/engine/fonts/a.woff2')).toBeUndefined();
    });

    it('badPath_aLaterRuleOverridesTheSameHeader', () => {
        const hosting: HostingConfig = {
            public: 'dist',
            cleanUrls: false,
            ignore: [],
            redirects: [],
            rewrites: [],
            headers: [
                { source: '**', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
                { source: '**/*.js', headers: [{ key: 'Cache-Control', value: 'max-age=60' }] },
            ],
        };

        expect(hostingHeaders(hosting, '/a.js')).toEqual({ 'Cache-Control': 'max-age=60' });
        expect(hostingHeaders(hosting, '/a.css')).toEqual({ 'Cache-Control': 'no-cache' });
    });
});

describe('answerHeaders', () => {
    it('happyPath_theNotFoundPageAddsItsOwnHeadersAndAConfiguredRedirectNone', () => {
        const hosting = committedHosting();

        expect(answerHeaders(hosting, '/Not_A_City/', resolve('/Not_A_City/'))['Cache-Control']).toBe('no-cache');
        expect(answerHeaders(hosting, '/admin', resolve('/admin'))).toEqual({});
        expect(answerHeaders(hosting, '/cluj', resolve('/cluj'))['X-Content-Type-Options']).toBe('nosniff');
    });
});

describe('isIgnored and rewriteOf', () => {
    it('happyPath_sourceMapsAndDotFilesAreNeverDeployed', () => {
        const hosting = committedHosting();

        expect(isIgnored(hosting, '/admin/admin.mjs.map')).toBe(true);
        expect(isIgnored(hosting, '/.env')).toBe(true);
        expect(isIgnored(hosting, '/admin/admin.mjs')).toBe(false);
        expect(rewriteOf(hosting, '/admin/photos/abc')).toBe('/admin/index.html');
        expect(rewriteOf(hosting, '/bacau/')).toBe('/city/index.html');
    });

    it('badPath_noRewriteWithoutAMatchingRule', () => {
        expect(rewriteOf(committedHosting(), '/a/b/c')).toBeUndefined();
    });
});

describe('e2eHostingHeaders', () => {
    it('happyPath_onlyTheAdminsCspDiffersFromHosting', () => {
        const hosting = committedHosting();
        const production = hostingHeaders(hosting, '/admin/admin.mjs');
        const e2e = e2eHostingHeaders(hosting, '/admin/admin.mjs', E2E_ORIGINS);

        expect({ ...e2e, [CSP_HEADER]: '' }).toEqual({ ...production, [CSP_HEADER]: '' });
        expect(e2e[CSP_HEADER]).toBe(e2eContentSecurityPolicy(String(production[CSP_HEADER]), E2E_ORIGINS));
        expect(e2e[CSP_HEADER]).not.toContain('upgrade-insecure-requests');
        expect(e2e[CSP_HEADER]).toContain('http://127.0.0.1:8080 http://127.0.0.1:4311; img-src');
    });

    it('badPath_aResponseWithoutACspStaysWithoutOne', () => {
        expect(e2eHostingHeaders(committedHosting(), '/', E2E_ORIGINS)[CSP_HEADER]).toBeUndefined();
        expect(e2eHeaders({ 'X-A': 'b' }, E2E_ORIGINS)).toEqual({ 'X-A': 'b' });
    });
});
