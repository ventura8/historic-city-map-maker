/**
 * The old admin addresses on the Hosting site's root (docs/research/M6-interfaces.md §2.7, behaviour A58): before M6 the
 * admin was the whole site, so a bookmark, a notification already on a device or an invitation names
 * `https://<project>.web.app/#/<route>`. Since M6 the root is the public map and the admin lives at `/admin/`. The root's
 * page (in both variants, the public map and the start-up page) loads `admin-redirect.js` first, before Mapbox GL and the
 * engine: an address whose hash starts with `#/` (an admin route) is sent to `/admin/` with the same query and hash
 * (`location.replace`, so Back does not come back to it). A viewer hash (`#15.5/44.4271/26.0853/90/!a3!p2`, the old
 * site's; `#17/44.43/26.1&photo=…`, the engine's; `#photo=…`) never starts with `#/` and is left alone, so the map opens.
 * Finding 25 of `docs/research/manual-test-2026-10-25.md (live test 2026-10-31)`: an old address typed while the root is already open changes
 * only the hash (no page load), so the script also forwards on `hashchange`.
 *
 * Written like the admin's push service worker (`../admin/service-worker.ts`): `forwardOldAdminAddress` is typed, linted
 * and tested, and the file is its source text called on the page's `window` (Node strips the types when the build runs).
 */

/** The file the root page loads first, next to it. */
export const ADMIN_REDIRECT_FILE = 'admin-redirect.js';

/** Where the admin lives on the Hosting site (`packages/admin/vite.config.ts`'s base). */
export const ADMIN_PATH = '/admin/';

/** What the script uses of the page's `window`. */
export interface RedirectScope {
    readonly location: { readonly hash: string; readonly search: string; replace(url: string): void };
    addEventListener(type: 'hashchange', listener: () => void): void;
}

/**
 * Sends an admin route on the root to `adminPath` with the same query and hash, now and on every later hash change;
 * true when it did now. Self-contained (its source is the script).
 */
export function forwardOldAdminAddress(scope: RedirectScope, adminPath: string): boolean {
    const forward = (): boolean => {
        const { hash, search } = scope.location;
        if (!hash.startsWith('#/')) {
            return false;
        }
        scope.location.replace(`${adminPath}${search}${hash}`);
        return true;
    };
    scope.addEventListener('hashchange', () => {
        forward();
    });
    return forward();
}

/** `admin-redirect.js`: `forwardOldAdminAddress`'s source called on the page's `window`. */
export const ADMIN_REDIRECT_SOURCE = [
    '// Historic City Map Maker: an old admin address on the root goes to /admin/ (docs/research/M6-interfaces.md §2.7),',
    '// from scripts/site/src/hosting/admin-redirect.ts.',
    "'use strict';",
    `(${forwardOldAdminAddress.toString()})(window, ${JSON.stringify(ADMIN_PATH)});`,
    '',
].join('\n');
