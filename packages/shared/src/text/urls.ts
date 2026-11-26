/**
 * URL rules shared by the schemas, the Markdown subset and the legacy migration (security review
 * §1.7): only `https:` reaches the page, never with credentials; relative asset paths stay below the
 * manifest that names them.
 */

/** Longer addresses are rejected (browsers and CDNs start failing around here). */
export const MAX_URL_LENGTH = 2048;

/** No scheme (`:`), no protocol-relative `//host`, no query or fragment: a plain path. */
const RELATIVE_URL = /^(?!\/\/)[\w.~%/-]+$/;

function parse(value: string): URL | null {
    return value.length <= MAX_URL_LENGTH && URL.canParse(value) ? new URL(value) : null;
}

/** An absolute `https:` URL with a host and without `user:password@`. */
export function isHttpsUrl(value: string): boolean {
    const url = parse(value);
    return url !== null && url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === '';
}

/**
 * An origin a Content Security Policy may name as one source: https, a host of letters, digits, dots and hyphens (a
 * leading `*.` allowed), and a port (CSP's host-source grammar). A WHATWG URL allows `;` and `'` in a host, and
 * `new URL('https://a.com;connect-src/x').origin` is `https://a.com;connect-src`: written into a policy, such an origin
 * ends its directive and adds others (`docs/LESSONS.md` 241).
 */
const CSP_ORIGIN = /^https:\/\/(?:\*\.)?[a-z0-9.-]{1,253}(?::\d{1,5})?$/i;

/** Whether `origin` may stand in a policy as one source (`CSP_ORIGIN`). */
export function isCspOrigin(origin: string): boolean {
    return CSP_ORIGIN.test(origin);
}

/** A relative path such as `derived/x/web.webp` or `/cities/x/web.webp`, without any `..` segment. */
export function isRelativeUrl(value: string): boolean {
    return value.length <= MAX_URL_LENGTH && RELATIVE_URL.test(value) && !value.split('/').includes('..');
}

/** True when `host` is `domain` or one of its subdomains (`www.flickr.com` for `flickr.com`). */
export function isHostOf(host: string, domain: string): boolean {
    const name = host.toLowerCase();
    return name === domain || name.endsWith(`.${domain}`);
}

/**
 * `raw` as a safe https URL: https kept, http upgraded only for a host in `upgradeHosts` (sites known
 * to serve the same page over https), anything else (other http hosts, `javascript:`, `data:`,
 * `mailto:`, credentials, garbage) null.
 */
export function toHttpsUrl(raw: string, upgradeHosts: readonly string[] = []): string | null {
    const url = parse(raw.trim());
    if (url === null) {
        return null;
    }
    const href = upgrade(url, upgradeHosts).href;
    return isHttpsUrl(href) ? href : null;
}

function upgrade(url: URL, upgradeHosts: readonly string[]): URL {
    if (url.protocol === 'http:' && upgradeHosts.some((domain) => isHostOf(url.hostname, domain))) {
        url.protocol = 'https:';
    }
    return url;
}
