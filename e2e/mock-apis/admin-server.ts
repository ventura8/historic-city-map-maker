import { readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

import {
    answerHeaders,
    e2eHeaders,
    isIgnored,
    resolveHostingPath,
    type HostingAnswer,
    type HostingConfig,
} from '../../scripts/site/src/admin/hosting.js';
import type { MockResponse } from './router.js';
import { failed, listen, SITE_TYPES } from './server.js';

/**
 * The e2e Hosting server (docs/research/M2b-interfaces.md §6.2, M6-interfaces.md §2, §7): the e2e build's Firebase Hosting
 * tree (`dist/e2e-hosting`: the public map at the root, the other cities at their paths, the generic city page, the
 * admin's `e2e` build under `/admin/`) served the way Firebase Hosting serves it, from `firebase.json`'s own `hosting`
 * block (`scripts/site/src/admin/hosting.ts` → `resolveHostingPath`: the redirects, the files with `cleanUrls` and
 * `trailingSlash`, the rewrites, `404.html`); ignored files (source maps, dot files) count as missing; every response
 * carries Hosting's headers for its path, the admin's CSP with `upgrade-insecure-requests` dropped and the emulators' and
 * mock APIs' origins added to `connect-src`. Hosting's reserved `/__/firebase/init.json` answers the `demo-hcm` web
 * configuration, `/admin/runtime.json` the e2e runtime (no App Check site key) and `/admin/project.json` the e2e world's
 * project (`E2E_PROJECT_CONFIG`, in place of the copy of `infra/project.json` the admin build writes; CR-M2b-26). The
 * Hosting emulator is not used: it would apply `upgrade-insecure-requests` to the http emulators.
 *
 * The start-up variant (`dist/e2e-hosting-start-up`, the first deploy of a new map, S-V30-BAD-START-UP) is served to a
 * browser that carries the cookie `hcm-e2e-variant=start-up` (`E2E_VARIANT_COOKIE`; per browser context, so parallel
 * tests never see each other's variant).
 *
 * e2e only: `/__harness` is a blank page on the admin's origin for the harness specs (e2e/admin/harness/): served from
 * 127.0.0.1 like the admin, so Chromium's Local Network Access lets it reach the emulators as the admin does (a document a
 * route fulfils has no address space and is refused the loopback); `/__old-push-sw.js` is a push worker at the site's root,
 * as an admin before M6 registered it there (S-A58-BAD-OLD-SERVICE-WORKER).
 *
 * e2e only: a browser that carries the cookie `hcm-e2e-cache=day` (`E2E_CACHE_COOKIE`) is served `/admin/legacy/**` with
 * the header Hosting gave it before the live finding of 2026-11-08, a day's `max-age` (`OLD_LEGACY_CACHE`), so a test can
 * put the release before's bundle in the browser's HTTP cache as the owner's browser held it (S-A28-BAD-STALE-BUNDLE-REFUSED).
 */

export interface AdminServerOptions {
    /** Absolute path, or relative to the working directory, of the e2e Hosting tree (the public variant). */
    readonly hostingDir: string;
    /** The start-up variant's tree, served to a browser with the variant cookie. */
    readonly startUpDir?: string;
    /** M14: the start site, served as it is at `/start/` (`docs/research/M14-start-your-map.md` §5). */
    readonly startDir?: string;
    /** The project's landing page (`sites/landing/`, GitHub Pages; DECISIONS-for-review.md §162), served as it is at `/landing/`. */
    readonly landingDir?: string;
    /** M14: the folder of what a test released on the fake Hosting (below it, one folder per test, named by the cookie). */
    readonly releasedDir?: string;
    readonly hosting: HostingConfig;
    /** Origins added to the CSP's `connect-src`. */
    readonly connect: readonly string[];
    /** `/__/firebase/init.json`. */
    readonly webConfig: Readonly<Record<string, string>>;
    /** `/admin/runtime.json`. */
    readonly runtime: Readonly<Record<string, unknown>>;
    /** `/admin/project.json`. */
    readonly project: Readonly<Record<string, unknown>>;
}

/** The cookie that picks the start-up variant of the tree, and its value. */
export const E2E_VARIANT_COOKIE = 'hcm-e2e-variant';
export const START_UP_VARIANT = 'start-up';
/** M14: the cookie that serves a browser what its test released on the fake Hosting (`released:<folder>`). */
const RELEASED_VARIANT = /(?:^|;\s*)hcm-e2e-variant=released:([\w-]{1,128})(?:;|$)/;

/** The legacy root push worker of the old-service-worker scenario (scope `/`). */
export const OLD_PUSH_WORKER_PATH = '/__old-push-sw.js';

const NOT_FOUND: MockResponse = { status: 404, type: 'text/plain', body: 'Not found' };

/** The harness page: no script, no style. */
const HARNESS_PAGE =
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Admin harness</title><link rel="icon" href="data:,"></head>' +
    '<body><main><h1>Admin harness</h1></main></body></html>';

/** A push worker that does nothing, as the pre-M6 admin's worker did between pushes (no fetch handler). */
const OLD_PUSH_WORKER = "'use strict';\nself.addEventListener('push', () => undefined);\n";

interface Target {
    readonly pathname: string;
    readonly search: string;
}

function targetOf(request: IncomingMessage): Target {
    const raw = request.url ?? '/';
    const queryStart = raw.indexOf('?');
    return queryStart === -1 ? { pathname: raw, search: '' } : { pathname: raw.slice(0, queryStart), search: raw.slice(queryStart) };
}

function reserved(options: AdminServerOptions, pathname: string): MockResponse | undefined {
    const json = (value: unknown): MockResponse => ({ status: 200, type: 'application/json', body: JSON.stringify(value) });
    switch (pathname) {
        case '/__health':
            return { status: 200, type: 'text/plain', body: 'ok' };
        case '/__/firebase/init.json':
            return json(options.webConfig);
        case '/admin/runtime.json':
            return json(options.runtime);
        case '/admin/project.json':
            return json(options.project);
        case '/__harness':
            return { status: 200, type: 'text/html; charset=utf-8', body: HARNESS_PAGE };
        case OLD_PUSH_WORKER_PATH:
            return { status: 200, type: 'text/javascript; charset=utf-8', body: OLD_PUSH_WORKER };
        default:
            return undefined;
    }
}

/** The tree a request is served from: the start-up variant's for a browser with its cookie, else the public one. */
function treeOf(options: AdminServerOptions, request: IncomingMessage): string {
    const cookies = (request.headers.cookie ?? '').split(';').map((pair) => pair.trim());
    const startUp = options.startUpDir;
    return startUp !== undefined && cookies.includes(`${E2E_VARIANT_COOKIE}=${START_UP_VARIANT}`) ? startUp : options.hostingDir;
}

/** Whether the tree deployed a file at the site path `path` (inside the tree, not ignored). */
function deployed(dir: string, hosting: HostingConfig, path: string): boolean {
    const target = normalize(join(dir, path));
    return target.startsWith(`${dir}${sep}`) && !isIgnored(hosting, path) && statSync(target, { throwIfNoEntry: false })?.isFile() === true;
}

interface Answered {
    readonly result: MockResponse;
    readonly answer: HostingAnswer | null;
}

async function served(dir: string, answer: HostingAnswer): Promise<MockResponse> {
    if (answer.kind === 'redirect') {
        return { status: answer.status, headers: { location: answer.location } };
    }
    if (answer.kind === 'missing') {
        return NOT_FOUND;
    }
    const file = join(dir, answer.file);
    return { status: answer.status, type: SITE_TYPES[extname(file)] ?? 'application/octet-stream', body: await readFile(file) };
}

/** The folder of what this browser's test released, or undefined (M14). */
function releasedTree(options: AdminServerOptions, request: IncomingMessage): string | undefined {
    const folder = RELEASED_VARIANT.exec(request.headers.cookie ?? '')?.[1];
    return folder === undefined || options.releasedDir === undefined ? undefined : join(options.releasedDir, folder);
}

/** A file of a static folder served as it is below `prefix` (the page for its folder), or undefined for any other address. */
async function staticFolder(dir: string | undefined, prefix: string, pathname: string): Promise<MockResponse | undefined> {
    if (dir === undefined || !pathname.startsWith(prefix)) {
        return undefined;
    }
    const relative = normalize(decodeURIComponent(pathname.slice(prefix.length)) || 'index.html');
    const file = resolve(dir, relative);
    if (!file.startsWith(`${resolve(dir)}${sep}`) || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
        return NOT_FOUND;
    }
    return { status: 200, type: SITE_TYPES[extname(file)] ?? 'application/octet-stream', body: await readFile(file) };
}

/** The start site at `/start/` (M14) or the landing page at `/landing/`, or undefined for any other address. */
async function startSite(options: AdminServerOptions, pathname: string): Promise<MockResponse | undefined> {
    return (await staticFolder(options.startDir, '/start/', pathname)) ?? staticFolder(options.landingDir, '/landing/', pathname);
}

async function answer(options: AdminServerOptions, request: IncomingMessage, target: Target): Promise<Answered> {
    const started = await startSite(options, target.pathname);
    if (started !== undefined) {
        return { result: started, answer: null };
    }
    const released = releasedTree(options, request);
    if (released !== undefined && target.pathname !== '/__/firebase/init.json' && target.pathname !== '/__health') {
        // What was released is served as it was uploaded: its own runtime and project files, never the e2e world's.
        const path = decodeURIComponent(target.pathname);
        const resolved = resolveHostingPath(options.hosting, path, target.search, (file) => deployed(released, options.hosting, file));
        return { result: await served(released, resolved), answer: resolved };
    }
    const fixed = reserved(options, target.pathname);
    if (fixed !== undefined) {
        return { result: fixed, answer: null };
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return { result: { status: 405, type: 'text/plain', body: 'Method not allowed' }, answer: null };
    }
    const dir = treeOf(options, request);
    const path = decodeURIComponent(target.pathname);
    const resolved = resolveHostingPath(options.hosting, path, target.search, (file) => deployed(dir, options.hosting, file));
    return { result: await served(dir, resolved), answer: resolved };
}

/** Hosting's own default for a file without a `Cache-Control` rule. */
const DEFAULT_CACHE_CONTROL = 'max-age=3600';

/** The cookie that serves the legacy bundle with Hosting's header before 2026-11-08, and that header. */
export const E2E_CACHE_COOKIE = 'hcm-e2e-cache';
export const OLD_LEGACY_CACHE = 'public, max-age=86400';
const LEGACY_PREFIX = '/admin/legacy/';

/** The old header of the legacy bundle, for a browser with the cookie; nothing otherwise. */
function oldCache(request: IncomingMessage, path: string): Readonly<Record<string, string>> {
    const cookies = (request.headers.cookie ?? '').split(';').map((pair) => pair.trim());
    const old = path.startsWith(LEGACY_PREFIX) && cookies.includes(`${E2E_CACHE_COOKIE}=day`);
    return old ? { 'Cache-Control': OLD_LEGACY_CACHE } : {};
}

async function handle(options: AdminServerOptions, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const target = targetOf(request);
    const { result, answer: hosted } = await answer(options, request, target);
    const path = decodeURIComponent(target.pathname);
    const headers = hosted === null ? {} : answerHeaders(options.hosting, path, hosted);
    response.writeHead(result.status, {
        'Cache-Control': DEFAULT_CACHE_CONTROL,
        ...e2eHeaders(headers, options.connect),
        ...oldCache(request, path),
        ...result.headers,
        ...(result.type === undefined ? {} : { 'Content-Type': result.type }),
    });
    response.end(request.method === 'HEAD' ? undefined : result.body);
}

/** A request handler of a loopback server (the local stack, e2e/stack/servers.ts, puts its own routes in front). */
export type RequestHandler = (request: IncomingMessage, response: ServerResponse) => void;

/** The e2e Hosting server's handler: the e2e Hosting tree as Hosting serves it. */
export function adminRequestHandler(options: AdminServerOptions): RequestHandler {
    const resolved: AdminServerOptions = {
        ...options,
        hostingDir: resolve(options.hostingDir),
        ...(options.startUpDir === undefined ? {} : { startUpDir: resolve(options.startUpDir) }),
    };
    return (request, response) => {
        handle(resolved, request, response).catch((error: unknown) => {
            failed(response, error);
        });
    };
}

/** Serves the e2e Hosting tree on 127.0.0.1:`port`. */
export function startAdminServer(port: number, options: AdminServerOptions): Promise<Server> {
    return listen(createServer(adminRequestHandler(options)), port);
}
