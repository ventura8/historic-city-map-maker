import { describe, expect, it } from 'vitest';

import { analyticsCookieNames, cookieDomains, cookiePaths, expireAnalyticsCookies, type CookieJar } from '../../src/telemetry/cookies.js';

/** A cookie store as `document.cookie` shows it: reading lists the visible cookies, a `Max-Age=0` write removes one. */
class FakeJar implements CookieJar {
    readonly writes: string[] = [];
    readonly #cookies: Map<string, string>;

    constructor(cookies: Readonly<Record<string, string>>) {
        this.#cookies = new Map(Object.entries(cookies));
    }

    get cookie(): string {
        return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }

    set cookie(write: string) {
        this.writes.push(write);
        const name = write.split('=', 1)[0] ?? '';
        if (write.includes('Max-Age=0')) {
            this.#cookies.delete(name);
        }
    }
}

const PAGE = { hostname: 'harta.example.org', pathname: '/bucuresti/' };

describe('GA4 cookies on withdrawal', () => {
    it('happyPath_everyGa4CookieIsExpiredHostOnlyForEachParentDomainAndEveryPathOfThePage', () => {
        const jar = new FakeJar({ _ga: 'GA1.1.111.222', _ga_E2E0000000: 'GS1.1.333', theme: 'dark', _gac_x: '1' });

        const names = expireAnalyticsCookies(jar, PAGE);

        expect(names).toEqual(['_ga', '_ga_E2E0000000']);
        expect(jar.cookie).toBe('theme=dark; _gac_x=1');
        // 2 names x (host-only + 2 domains) x 3 paths.
        expect(jar.writes).toHaveLength(18);
        expect(jar.writes).toContain('_ga=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/');
        expect(jar.writes).toContain('_ga_E2E0000000=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Domain=example.org');
        expect(jar.writes).toContain('_ga=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/bucuresti/; Domain=harta.example.org');
    });

    it('happyPath_theDomainsAndPathsGtagMayHaveUsed', () => {
        expect(cookieDomains('a.b.example.org')).toEqual(['a.b.example.org', 'b.example.org', 'example.org']);
        expect(cookiePaths('/')).toEqual(['/']);
        expect(cookiePaths('/orase/bucuresti/index.html')).toEqual([
            '/',
            '/orase',
            '/orase/',
            '/orase/bucuresti',
            '/orase/bucuresti/',
            '/orase/bucuresti/index.html',
            '/orase/bucuresti/index.html/',
        ]);
    });

    it('badPath_anAddressOrAOneLabelHostIsItsOwnOnlyDomain', () => {
        expect(cookieDomains('127.0.0.1')).toEqual(['127.0.0.1']);
        expect(cookieDomains('[::1]')).toEqual(['[::1]']);
        expect(cookieDomains('localhost')).toEqual(['localhost']);
    });

    it('badPath_withoutAGa4CookieNothingIsWritten', () => {
        const jar = new FakeJar({ theme: 'dark', _gac_UA: '1', my_ga: '2' });

        expect(expireAnalyticsCookies(jar, PAGE)).toEqual([]);
        expect(jar.writes).toEqual([]);
        expect(analyticsCookieNames('')).toEqual([]);
        expect(analyticsCookieNames('_ga=1; _ga=2;  _ga_X1=3')).toEqual(['_ga', '_ga_X1']);
    });
});
