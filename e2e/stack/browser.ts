import { MOCK_API_ORIGIN } from '../fixtures/world.js';

/**
 * The local stack's browser side (docs/SETUP.md → *Local stack for manual testing*): the e2e world without Playwright.
 * In the e2e tiers Playwright's routes send every request for Mapbox, Google's REST APIs, analytics and the e2e hosts to
 * the mock APIs (e2e/support/network.ts). A person's browser has no such routes, and the Claude browser pane cannot even
 * register a service worker (its network layer refuses the worker's script), so the stack's admin and site servers
 * (servers.ts) put this shim first into every page they serve, as a same-origin script (`script-src 'self'` allows it):
 *
 * - it rewrites every absolute address of a host off this machine to the same origin's `/__stack/h/<host><path>`, where
 *   the server forwards it to the mock APIs, reads it from the Storage emulator or refuses it, with the e2e firewall's
 *   own host table (e2e/mock-apis/hosts.ts); loopback addresses (the emulators, the mock APIs, Google's consent
 *   stand-in) stay as they are;
 * - in the page: `fetch`, `XMLHttpRequest`, `navigator.sendBeacon`, and the `src`, `href` and `srcset` of the elements
 *   that load something (images, scripts, style sheets), set as a property or as an attribute (Lit's bindings); a link
 *   (`<a href>`) is left alone: following it is a person's choice;
 * - in every worker made from a script blob (Mapbox GL's, which loads the tiles): the same `fetch` and `XMLHttpRequest`,
 *   prepended to the blob;
 * - Google's consent stand-in (`window.open` of the mock APIs' `/__oauth/authorize`) opens in a frame over the page, not
 *   in a popup: the Claude browser pane opens a popup in place of its page, which loses the opener the answer goes to.
 *
 * The servers also rewrite the addresses of the `<script>`, `<link>` and `<img>` tags of the HTML they serve (the viewer's
 * page loads Mapbox GL from its CDN in its markup). The shim is serialized with `Function.prototype.toString` (as Google's
 * consent stand-in, e2e/mock-apis/oauth-page.ts), so it references nothing outside its own body; the servers run under
 * Node's type stripping, which leaves plain JavaScript. The stack's check (check.ts) proves that no request of the main
 * screens reaches the network for a host off this machine.
 */

/** Every route of the stack itself lives under this prefix of the admin's and the site's origins. */
const STACK_PREFIX = '/__stack';
/** The shim's script. */
export const SHIM_PATH = `${STACK_PREFIX}/shim.js`;
/** `/__stack/h/<host><path>`: a request for `https://<host><path>`, decided by the server. */
export const FORWARD_PREFIX = `${STACK_PREFIX}/h/`;

interface ShimConfig {
    readonly forward: string;
    /** Google's consent stand-in (`<mock APIs>/__oauth/authorize`), opened in a frame instead of a popup. */
    readonly consent: string;
}

/** Runs in a page or a worker: points every address off this machine at the stack's forward. */
function stackShim(config: ShimConfig): void {
    const scope = globalThis as unknown as Window & typeof globalThis;
    const origin = scope.location.origin;
    const loopback = ['127.0.0.1', 'localhost'];
    // A method or an accessor of a prototype, read without binding it (it is called with its own `this` below).
    const own = (target: object, name: string, part: 'value' | 'set'): unknown => {
        const descriptor = Object.getOwnPropertyDescriptor(target, name);
        return descriptor === undefined ? undefined : (Reflect.get(descriptor, part) as unknown);
    };

    const rewrite = (value: string): string => {
        let url: URL;
        try {
            url = new URL(value, scope.location.href);
        } catch {
            return value;
        }
        if (!url.protocol.startsWith('http') || loopback.includes(url.hostname)) {
            return value;
        }
        return `${origin}${config.forward}${url.host}${url.pathname}${url.search}${url.hash}`;
    };
    const rewriteSrcset = (value: string): string =>
        value
            .split(',')
            .map((candidate) => candidate.trim().replace(/^\S+/, (address) => rewrite(address)))
            .join(', ');

    const originalFetch = scope.fetch.bind(scope);
    scope.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (input instanceof Request) {
            const target = rewrite(input.url);
            return originalFetch(target === input.url ? input : new Request(target, input), init);
        }
        return originalFetch(rewrite(input instanceof URL ? input.href : input), init);
    };
    const open = own(scope.XMLHttpRequest.prototype, 'open', 'value') as ((this: XMLHttpRequest, ...args: unknown[]) => void) | undefined;
    scope.XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, address: string | URL, ...rest: unknown[]) {
        open?.call(this, method, rewrite(String(address)), ...rest);
    };

    if (typeof scope.document === 'undefined') {
        return;
    }
    const beacon = scope.navigator.sendBeacon.bind(scope.navigator);
    scope.navigator.sendBeacon = (address: string | URL, data?: BodyInit | null) => beacon(rewrite(String(address)), data);

    // The elements that load what an address names, and the attributes that name it.
    const loaders: Readonly<Record<string, readonly string[]>> = {
        IMG: ['src', 'srcset'],
        SCRIPT: ['src'],
        LINK: ['href'],
        SOURCE: ['src', 'srcset'],
    };
    const rewritten = (name: string, value: string): string => (name === 'srcset' ? rewriteSrcset(value) : rewrite(value));
    const setAttribute = own(scope.Element.prototype, 'setAttribute', 'value') as
        ((this: Element, name: string, value: unknown) => void) | undefined;
    scope.Element.prototype.setAttribute = function (this: Element, name: string, value: unknown): void {
        const lower = name.toLowerCase();
        const kept = loaders[this.tagName]?.includes(lower) === true ? rewritten(lower, String(value)) : value;
        setAttribute?.call(this, name, kept);
    };
    const classes: Readonly<Record<string, { prototype: object }>> = {
        IMG: scope.HTMLImageElement,
        SCRIPT: scope.HTMLScriptElement,
        LINK: scope.HTMLLinkElement,
        SOURCE: scope.HTMLSourceElement,
    };
    for (const [tag, names] of Object.entries(loaders)) {
        const prototype = classes[tag]?.prototype;
        for (const name of names) {
            const set =
                prototype === undefined ? undefined : (own(prototype, name, 'set') as ((this: Element, value: string) => void) | undefined);
            if (prototype !== undefined && set !== undefined) {
                Object.defineProperty(prototype, name, {
                    ...Object.getOwnPropertyDescriptor(prototype, name),
                    set(this: Element, value: unknown) {
                        set.call(this, rewritten(name, String(value)));
                    },
                });
            }
        }
    }

    // A link the page clicks itself to save a file (`<a download>`: the export's Download) is the page's own request, not a
    // person's choice of where to go, so it is forwarded too.
    scope.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement): void {
        setAttribute?.call(this, 'href', this.hasAttribute('download') ? rewrite(this.href) : this.href);
        scope.HTMLElement.prototype.click.call(this);
    };

    // Google's consent stand-in opens in a frame over the page instead of a popup (the Claude browser pane opens a popup in
    // place of its page, and the opener is lost): the frame's window is the "popup" the admin waits on, the stand-in posts
    // its answer to its parent, and the frame goes once it has (its window then reads as closed).
    const openWindow = scope.open.bind(scope);
    scope.open = (address?: string | URL, target?: string, features?: string): WindowProxy | null => {
        if (!String(address ?? '').startsWith(config.consent)) {
            return openWindow(address, target, features);
        }
        const frame = scope.document.createElement('iframe');
        frame.title = 'Sign in with Google (e2e stand-in)';
        Object.assign(frame.style, {
            position: 'fixed',
            inset: '5vh 5vw',
            width: '90vw',
            height: '90vh',
            zIndex: '2147483647',
            border: '2px solid #888',
            borderRadius: '12px',
            background: '#fff',
        });
        frame.src = String(address);
        scope.document.body.append(frame);
        const answered = (event: MessageEvent): void => {
            if (config.consent.startsWith(event.origin) && event.source === frame.contentWindow) {
                scope.removeEventListener('message', answered);
                scope.setTimeout(() => {
                    frame.remove();
                }, 0);
            }
        };
        scope.addEventListener('message', answered);
        return frame.contentWindow;
    };

    // A worker made from a script blob (Mapbox GL's) gets the same rewrite of its own requests first.
    const prelude = `(${stackShimSource})(${JSON.stringify(config)});\n`;
    const OriginalBlob = scope.Blob;
    class StackBlob extends OriginalBlob {
        constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
            super((options?.type ?? '').includes('javascript') ? [prelude, ...(parts ?? [])] : parts, options);
        }
    }
    scope.Blob = StackBlob;
}

/** The shim's own source, which it prepends to a worker's script (a worker has no `document`: only its requests change). */
const stackShimSource = stackShim.toString();

/** The shim as the page's first script: `stackShim` applied to the stack's forward, with its own source for workers. */
export function shimScript(): string {
    const config: ShimConfig = { forward: FORWARD_PREFIX, consent: `${MOCK_API_ORIGIN}/__oauth/authorize` };
    return `(function (stackShimSource) {\n(${stackShimSource})(${JSON.stringify(config)});\n})(${JSON.stringify(stackShimSource)});\n`;
}

/** The tag the servers put first into every page's `<head>`. */
const SHIM_TAG = `<script src="${SHIM_PATH}"></script>`;

/** The tags of an HTML page that load what an address names, and the address attributes in them. */
const LOADING_TAG = /<(?:script|link|img)\b[^>]*>/gi;
const ADDRESS = /\b(src|href)="https:\/\/([^"]*)"/g;

/**
 * `html` with the shim first in its `<head>` and every https address of its loading tags pointed at the forward (an
 * address of `origin` itself never is: only hosts off this machine get here).
 */
export function withShim(html: string): string {
    const shimmed = html.replace(/<head\b[^>]*>/i, (head) => `${head}${SHIM_TAG}`);
    return shimmed.replace(LOADING_TAG, (tag) =>
        tag.replace(ADDRESS, (_all, name: string, address: string) => `${name}="${FORWARD_PREFIX}${address}"`),
    );
}
