/**
 * GA4's first-party cookies expired when the visitor withdraws consent (docs/research/DECISIONS-for-review.md §18c):
 * the privacy notice promises that without consent the map uses no cookies, and gtag.js leaves `_ga` and
 * `_ga_<container>` (two years) behind when it is merely switched off. gtag.js writes them for the highest domain it
 * may (`cookie_domain: 'auto'`) with the path `/`, so every GA4 cookie the page can see is expired host-only, for each
 * parent domain and for every path prefix of the page: a write whose domain or path does not match changes nothing.
 */

/** `_ga` and `_ga_<container id>`; never `_gac_…` or another site's cookie. */
const GA_COOKIE = /^_ga(?:_[\w-]+)?$/;

const IP_ADDRESS = /^[\d.]+$|:/;

/** What the expiry needs of `document` (`cookie` reads the visible cookies and writes one per assignment). */
export interface CookieJar {
    cookie: string;
}

/** What the expiry needs of `location`. */
export interface CookiePage {
    readonly hostname: string;
    readonly pathname: string;
}

/** The GA4 cookie names among `document.cookie`'s `name=value; …` pairs, each once. */
export function analyticsCookieNames(cookies: string): readonly string[] {
    const names = cookies.split(';').map((pair) => pair.split('=', 1).join('').trim());
    return [...new Set(names.filter((name) => GA_COOKIE.test(name)))];
}

/** The host and each parent domain of at least two labels (`a.b.example.org`, `b.example.org`, `example.org`). */
export function cookieDomains(hostname: string): readonly string[] {
    const labels = hostname.split('.');
    if (IP_ADDRESS.test(hostname) || labels.length < 2) {
        return [hostname];
    }
    return labels.slice(0, -1).map((_label, index) => labels.slice(index).join('.'));
}

/** `/` and every prefix of `pathname`, with and without its trailing slash (`/`, `/bucharest`, `/bucharest/`). */
export function cookiePaths(pathname: string): readonly string[] {
    const paths = ['/'];
    let prefix = '';
    for (const segment of pathname.split('/').filter((part) => part !== '')) {
        prefix = `${prefix}/${segment}`;
        paths.push(prefix, `${prefix}/`);
    }
    return paths;
}

/** One expiring write: the attributes that pick the cookie (name, domain, path), an empty value, a date in the past. */
function expiry(name: string, path: string, domain: string | null): string {
    const scope = domain === null ? '' : `; Domain=${domain}`;
    return `${name}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=${path}${scope}`;
}

/** Expires every GA4 cookie `jar` shows on `page`; returns their names (empty when there were none). */
export function expireAnalyticsCookies(jar: CookieJar, page: CookiePage): readonly string[] {
    const names = analyticsCookieNames(jar.cookie);
    const scopes = [null, ...cookieDomains(page.hostname)];
    const paths = cookiePaths(page.pathname);
    for (const name of names) {
        for (const domain of scopes) {
            for (const path of paths) {
                jar.cookie = expiry(name, path, domain);
            }
        }
    }
    return names;
}
