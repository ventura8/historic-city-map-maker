/**
 * The installable app's service worker (`docs/ENGINE_API.md` → *Installable app*): one self-contained worker, written into
 * the file from these functions' source text by the site build (`scripts/site/src/app.ts`), like the admin's push worker.
 *
 * It never serves an old release, so it never stands between a deploy and the visitor (lesson 707: an entry file that is
 * not content-hashed must be revalidated):
 *
 * - **Network first, always.** With `offline` on (a city site), the page and its shell (`.js`, `.mjs`, `.css`, `.woff2`
 *   beside the page or in its `engine/` folder) go to the network as the browser would ask (Hosting's `no-cache` revalidates them); a copy is
 *   kept only for a visit with no network, when the last page and shell seen are served instead of the browser's error.
 * - **Never kept:** the data and the release's own records (`manifest.json`, `runtime.json`, `release.json`, `admin.mjs`,
 *   `app.webmanifest`), every other file (photos, icons) and every other origin (Mapbox, whose terms forbid keeping its
 *   tiles and styles; the public bucket; Firebase; analytics): the worker does not answer them, the browser does.
 * - **Another folder** (the root site's worker over `/bacau/` or `/admin/`, whose own worker is more specific anyway): not
 *   answered either.
 * - A new worker file (each build names its release) takes over at once (`skipWaiting`, `clients.claim`) and deletes the
 *   copies of the releases before it.
 *
 * With `offline` off (the admin, whose screens need the network anyway) it keeps nothing and answers nothing.
 */

/** The worker's file name beside a city site's page. */
export const APP_WORKER_FILE = 'sw.js';

/** What the build writes into the worker file. */
export interface AppWorkerOptions {
    /** The build's release: it names the offline copy, so a new release replaces it. */
    readonly release: string;
    /** Keep a copy of the page and its shell for a visit with no network (a city site); off: nothing kept (the admin). */
    readonly offline: boolean;
}

/** The part of an `ExtendableEvent` the worker uses. */
export interface WaitEvent {
    waitUntil(work: Promise<unknown>): void;
}

/** The part of a `FetchEvent` the worker uses. */
export interface FetchEventLike extends WaitEvent {
    readonly request: Request;
    respondWith(response: Promise<Response>): void;
}

/** The part of a `Cache` the worker uses (typed here: the functions, which import this package, have no DOM types). */
export interface CacheLike {
    match(request: Request | string): Promise<Response | undefined>;
    put(request: Request | string, response: Response): Promise<void>;
}

/** The part of `CacheStorage` the worker uses. */
export interface CacheStorageLike {
    open(name: string): Promise<CacheLike>;
    keys(): Promise<string[]>;
    delete(name: string): Promise<boolean>;
}

/** What the worker uses of its global scope (`self` in a service worker). */
export interface AppWorkerScope {
    readonly registration: { readonly scope: string };
    readonly caches: CacheStorageLike;
    readonly clients: { claim(): Promise<void> };
    fetch(request: Request): Promise<Response>;
    skipWaiting(): Promise<void>;
    addEventListener(type: 'install' | 'activate', listener: (event: WaitEvent) => void): void;
    addEventListener(type: 'fetch', listener: (event: FetchEventLike) => void): void;
}

/** Installs the worker's listeners on `scope`. Self-contained: its source text is the worker file. */
export function installAppWorker(scope: AppWorkerScope, options: AppWorkerOptions): void {
    const root = new URL(scope.registration.scope);
    const prefix = `hcm-app-${root.pathname}-`;
    const name = `${prefix}${options.release}`;
    const neverKept = /(?:^|\/)(?:manifest\.json|runtime\.json|release\.json|admin\.mjs|app\.webmanifest)$/;
    // The page's own scripts, styles and fonts: beside it, or in its engine's folder (never another city's or the admin's).
    const shellFile = /^(?:engine\/(?:[^/]+\/)*)?[^/]+\.(?:m?js|css|woff2)$/;
    const ownPage = /^(?:index\.html)?$/;
    /** The address's path below the scope, or null for another origin or folder. */
    const below = (url: URL): string | null =>
        url.origin === root.origin && url.pathname.startsWith(root.pathname) ? url.pathname.slice(root.pathname.length) : null;
    const kept = (request: Request): boolean => {
        const path = below(new URL(request.url));
        const wanted = request.mode === 'navigate' ? ownPage : shellFile;
        return request.method === 'GET' && path !== null && wanted.test(path) && !neverKept.test(path);
    };
    const lastSeen = async (request: Request): Promise<Response> => {
        const cache = await scope.caches.open(name);
        const copy = await cache.match(request.mode === 'navigate' ? root.href : request);
        return copy ?? Response.error();
    };
    const networkFirst = async (request: Request): Promise<Response> => {
        try {
            const response = await scope.fetch(request);
            if (response.ok && response.type === 'basic') {
                const cache = await scope.caches.open(name);
                await cache.put(request.mode === 'navigate' ? root.href : request, response.clone());
            }
            return response;
        } catch {
            return lastSeen(request);
        }
    };
    const older = async (): Promise<void> => {
        const names = await scope.caches.keys();
        await Promise.all(names.filter((cache) => cache.startsWith(prefix) && cache !== name).map((cache) => scope.caches.delete(cache)));
    };
    scope.addEventListener('install', (event) => {
        event.waitUntil(scope.skipWaiting());
    });
    scope.addEventListener('activate', (event) => {
        event.waitUntil(older().then(() => scope.clients.claim()));
    });
    if (options.offline) {
        scope.addEventListener('fetch', (event) => {
            if (kept(event.request)) {
                event.respondWith(networkFirst(event.request));
            }
        });
    }
}

const HEADER =
    "// Historic City Map Maker: the installable app's worker (docs/ENGINE_API.md → Installable app), from packages/shared/src/kit/app-worker.ts.";

/** The worker's lines: `installAppWorker` called on the worker's own scope (appended to the admin's push worker). */
export function appWorkerLines(options: AppWorkerOptions): string {
    return [HEADER, `(${installAppWorker.toString()})(self, ${JSON.stringify(options)});`, ''].join('\n');
}

/** The worker file of a city site. */
export function appWorkerSource(options: AppWorkerOptions): string {
    return ["'use strict';", appWorkerLines(options)].join('\n');
}
