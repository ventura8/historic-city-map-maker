import { readdirSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { gunzipSync } from 'node:zlib';

import { createLogger, installReleaseSlug, isUsableCityId, STORAGE_PATHS } from '@hcm/shared';

import { parseHostingConfig } from '../../scripts/site/src/admin/hosting.js';
import {
    ADMIN_CONNECT_ORIGINS,
    ADMIN_PATH,
    ADMIN_PORT,
    ADMIN_PROJECT,
    ADMIN_RUNTIME,
    ADMIN_WEB_CONFIG,
    E2E_HOSTING_DIR,
    E2E_HOSTING_START_UP_DIR,
    E2E_PROJECT_ID,
    emulatorOrigin,
} from '../admin/world.js';
import { installManifestText } from '../fixtures/install-bundle.js';
import { E2E_CITY_ID, E2E_SITE_DIR, MOCK_API_ORIGIN, SITE_PORT } from '../fixtures/world.js';
import { adminRequestHandler, type RequestHandler } from '../mock-apis/admin-server.js';
import { isUpstreamHost, mockedHostKind, refusedAddress } from '../mock-apis/hosts.js';
import { listen, siteRequestHandler } from '../mock-apis/server.js';
import { FORWARD_PREFIX, SHIM_PATH, shimScript, withShim } from './browser.js';

/**
 * The local stack's admin and site servers (docs/SETUP.md → *Local stack for manual testing*): the e2e Hosting server
 * (e2e/mock-apis/admin-server.ts: the admin at `/admin/`, and the stack's root sends there) and site server
 * (e2e/mock-apis/server.ts) with the stack's routes in front:
 *
 * - every HTML page they serve gets the shim first in its `<head>` (`/__stack/shim.js`) and its loading tags' https
 *   addresses pointed at the forward, and its CSP's `frame-src` lets the consent stand-in be framed (browser.ts);
 * - `/__stack/h/<host><path>`: what the shim forwards. Decided with the e2e firewall's host table
 *   (e2e/mock-apis/hosts.ts): a refused address (USGS, STAC, Overpass, OpenStreetMap tiles, Mapbox Satellite) and an
 *   unknown host answer 403 and are logged (host and path only); an object of the emulators' buckets on
 *   `storage.googleapis.com` is read from the Storage emulator; a mocked host or a fake upstream's host goes to the mock
 *   APIs, in the shared partition `''` that the Functions emulator also reaches, so the browser and the server see one
 *   fake Google, Mapbox and USGS;
 * - on the site: `/` redirects to the Bucharest site, and `/bucharest/data/manifest.json` is the manifest the emulators'
 *   build published for the city (`cities/bucharest/manifest.json` of the public bucket, its storage addresses made
 *   same-origin under `data/stack-storage/`, which the site's CSP allows), else the built fixture manifest;
 * - every other city of the emulators has its page at `/<city>/` (M5: what `site:add` and `build:site` make for a city
 *   made in the admin): the Bucharest site's built page and engine, a `config.js` naming the city, and the manifest the
 *   emulators published for it, else 404 (the page then says the map could not be found, as a site whose city is not
 *   published does). A first segment that is no usable city id, or a folder of the built sites, is the built sites'.
 */

const log = createLogger('dev-stack');

/** The emulators' buckets: the private one (the admin's uploads, the rasters) and the public one (photos, manifests). */
const PUBLIC_BUCKET = `${E2E_PROJECT_ID}-public`;
const BUCKETS: readonly string[] = [ADMIN_WEB_CONFIG.storageBucket, PUBLIC_BUCKET];
/** The Storage emulator's administrator credential (reads past the rules, as the public bucket's real IAM allows). */
const EMULATOR_ADMIN = { authorization: 'Bearer owner' } as const;
/** Where a site's manifest points the public bucket's objects, relative to `data/manifest.json`. */
const SITE_STORAGE = 'stack-storage';
/** The request headers a forward keeps (the fake upstreams read the bearer token). */
const FORWARDED_HEADERS = ['accept', 'content-type', 'authorization'];
/** Response headers that describe the connection or the encoding `fetch` already undid. */
const DROPPED_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);

interface Answer {
    readonly status: number;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: Buffer | string;
}

/** The stack's routes of one server, before its own handler (undefined: the server's own answer). */
type StackRoute = (request: IncomingMessage, target: Target) => Promise<Answer | undefined>;

interface Target {
    readonly pathname: string;
    /** `?…` or empty. */
    readonly search: string;
}

function targetOf(request: IncomingMessage): Target {
    const raw = request.url ?? '/';
    const queryStart = raw.indexOf('?');
    return queryStart === -1 ? { pathname: raw, search: '' } : { pathname: raw.slice(0, queryStart), search: raw.slice(queryStart) };
}

function text(status: number, body: string): Answer {
    return { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, body };
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
}

function keptHeaders(headers: Headers): Record<string, string> {
    const kept: Record<string, string> = {};
    headers.forEach((value, name) => {
        if (!DROPPED_HEADERS.has(name)) {
            kept[name] = value;
        }
    });
    return kept;
}

async function answerOf(response: Response): Promise<Answer> {
    return { status: response.status, headers: keptHeaders(response.headers), body: Buffer.from(await response.arrayBuffer()) };
}

/**
 * An object of the Storage emulator, read past the rules (404 when it does not exist). The request's `Range` goes along, as Cloud
 * Storage honours it: a layer's own tiles are one archive read by range (`docs/research/M12-own-tiles.md`), and without it every tile
 * fetched the whole archive, which the viewer's reader refuses (the layer failed on the stack: docs/LESSONS.md).
 */
async function storageObject(bucket: string, path: string, range?: string): Promise<Answer> {
    const url = `${emulatorOrigin('storage')}/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(path)}?alt=media`;
    return answerOf(await fetch(url, { headers: range === undefined ? EMULATOR_ADMIN : { ...EMULATOR_ADMIN, range } }));
}

/** `storage.googleapis.com/<bucket>/<path>` of one of the emulators' buckets, or null. */
function emulatorObjectOf(url: URL): { readonly bucket: string; readonly path: string } | null {
    if (url.hostname !== 'storage.googleapis.com') {
        return null;
    }
    const [, bucket = '', ...rest] = url.pathname.split('/');
    return BUCKETS.includes(bucket) && rest.length > 0 ? { bucket, path: decodeURIComponent(rest.join('/')) } : null;
}

/** A forwarded request the stack does not answer: 403, logged without its query (a token may be in it). */
function refused(url: URL, why: string): Answer {
    log.warn('request refused (it would leave the machine)', { host: url.host, path: url.pathname, why });
    return text(403, `refused by the local stack (${why}): https://${url.host}${url.pathname}`);
}

/** Sends a forwarded request to the mock APIs (the shared partition: no `x-hcm-test`). */
async function toMockApis(request: IncomingMessage, url: URL): Promise<Answer> {
    const headers: Record<string, string> = {};
    for (const name of FORWARDED_HEADERS) {
        const value = request.headers[name];
        if (typeof value === 'string') {
            headers[name] = value;
        }
    }
    const method = request.method ?? 'GET';
    const body = method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(await readBody(request));
    const response = await fetch(`${MOCK_API_ORIGIN}/h/${url.host}${url.pathname}${url.search}`, {
        method,
        headers,
        redirect: 'manual',
        ...(body === undefined ? {} : { body }),
    });
    return answerOf(response);
}

/** `/__stack/h/<host><path>`: what the service worker forwarded for `https://<host><path>`. */
async function forwarded(request: IncomingMessage, target: Target): Promise<Answer> {
    const rest = target.pathname.slice(FORWARD_PREFIX.length);
    const slash = rest.indexOf('/');
    const host = slash === -1 ? rest : rest.slice(0, slash);
    const url = new URL(`https://${host}${slash === -1 ? '/' : rest.slice(slash)}${target.search}`);
    const refusal = refusedAddress(url);
    if (refusal !== null) {
        return refused(url, refusal);
    }
    const object = emulatorObjectOf(url);
    if (object !== null && (request.method === 'GET' || request.method === 'HEAD')) {
        return storageObject(object.bucket, object.path, request.headers.range);
    }
    if (mockedHostKind(url.hostname) !== null || isUpstreamHost(url.hostname)) {
        return toMockApis(request, url);
    }
    return refused(url, 'no fake answers this host');
}

/** The routes both origins share: the shim and the forwards. */
async function commonRoute(request: IncomingMessage, target: Target): Promise<Answer | undefined> {
    if (target.pathname === SHIM_PATH) {
        return {
            status: 200,
            headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' },
            body: shimScript(),
        };
    }
    return target.pathname.startsWith(FORWARD_PREFIX) ? forwarded(request, target) : undefined;
}

/** Every https address of the public bucket in `value`, made relative to the site's `data/` folder. */
function siteAddresses(value: unknown): unknown {
    const prefix = `https://storage.googleapis.com/${PUBLIC_BUCKET}/`;
    if (typeof value === 'string') {
        return value.startsWith(prefix) ? `${SITE_STORAGE}/${PUBLIC_BUCKET}/${value.slice(prefix.length)}` : value;
    }
    if (Array.isArray(value)) {
        return value.map(siteAddresses);
    }
    if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, siteAddresses(item)]));
    }
    return value;
}

/** The manifest the emulators' build published for `city`, or undefined before its first build. */
async function publishedManifest(city: string): Promise<Answer | undefined> {
    const stored = await storageObject(PUBLIC_BUCKET, STORAGE_PATHS.manifest(city));
    if (stored.status !== 200 || stored.body === undefined) {
        return undefined;
    }
    const bytes = Buffer.from(stored.body);
    const json = (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString('utf8');
    const body = JSON.stringify(siteAddresses(JSON.parse(json) as unknown));
    return {
        status: 200,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-hcm-stack-manifest': 'emulators' },
        body,
    };
}

/** A city's page on the site: `/<city>/<rest>` (`rest` empty for its folder); `bare` for `/<city>` without the slash. */
interface CityPage {
    readonly city: string;
    readonly rest: string;
    readonly bare: boolean;
}

/** The first segments the built sites and the servers own (`dist/e2e-site/<folder>`, the kit's mount, the stack's routes). */
function builtFolders(): ReadonlySet<string> {
    return new Set([...readdirSync(E2E_SITE_DIR), 'kit', '__stack', '__health']);
}

/** The city page `pathname` names: Bucharest's, or a usable city id no built site holds; else null. */
function cityPageOf(pathname: string, built: ReadonlySet<string>): CityPage | null {
    const [, city = '', ...rest] = pathname.split('/');
    const isCity = city === E2E_CITY_ID || (!built.has(city) && isUsableCityId(city));
    return isCity ? { city, rest: rest.join('/'), bare: rest.length === 0 } : null;
}

/** The `config.js` of a city's page, as `site:add` writes it: its id and the manifest beside the page. */
function cityConfig(city: string): Answer {
    const config = JSON.stringify({ cityId: city, manifestUrl: './data/manifest.json' });
    return {
        status: 200,
        headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' },
        body: `window.HistoricCityMapConfig = ${config};\n`,
    };
}

/** An object of the public bucket the published manifest names (`data/stack-storage/<bucket>/<path>`). */
function storageRoute(request: IncomingMessage, rest: string): Promise<Answer> | undefined {
    const prefix = `data/${SITE_STORAGE}/`;
    if (!rest.startsWith(prefix) || (request.method !== 'GET' && request.method !== 'HEAD')) {
        return undefined;
    }
    const [bucket = '', ...path] = rest.slice(prefix.length).split('/');
    return BUCKETS.includes(bucket)
        ? storageObject(bucket, decodeURIComponent(path.join('/')), request.headers.range)
        : Promise.resolve(text(404, 'Not found'));
}

/**
 * A city's page: its published manifest and its objects; Bucharest's other files are its built site's; another city's
 * `config.js` is made here and every other file is the Bucharest site's (the request is pointed there for the fallback).
 */
async function cityRoute(request: IncomingMessage, target: Target, page: CityPage): Promise<Answer | undefined> {
    if (page.rest === 'data/manifest.json') {
        return (await publishedManifest(page.city)) ?? (page.city === E2E_CITY_ID ? undefined : text(404, 'Not found'));
    }
    const stored = storageRoute(request, page.rest);
    if (stored !== undefined || page.city === E2E_CITY_ID) {
        return stored;
    }
    if (page.bare) {
        return { status: 301, headers: { location: `/${page.city}/${target.search}`, 'cache-control': 'no-store' } };
    }
    if (page.rest === 'config.js') {
        return cityConfig(page.city);
    }
    request.url = `/${E2E_CITY_ID}/${page.rest}${target.search}`;
    return undefined;
}

/** The site's own routes: `/` to the Bucharest site, then the cities' pages (`built`: the first segments never a city). */
async function siteRoute(request: IncomingMessage, target: Target, built: ReadonlySet<string>): Promise<Answer | undefined> {
    if (target.pathname === '/') {
        return { status: 302, headers: { location: `/${E2E_CITY_ID}/`, 'cache-control': 'no-store' } };
    }
    const page = cityPageOf(target.pathname, built);
    return page === null ? undefined : cityRoute(request, target, page);
}

function write(response: ServerResponse, request: IncomingMessage, answer: Answer): void {
    response.writeHead(answer.status, answer.headers);
    response.end(request.method === 'HEAD' ? undefined : answer.body);
}

/** A page's policy letting the consent stand-in of the mock APIs be framed (the shim opens it in a frame, browser.ts). */
function withConsentFrame(policy: string): string {
    return policy.replace(/\bframe-src\b/, `frame-src ${MOCK_API_ORIGIN}`);
}

/**
 * `response` with every HTML page the fallback writes shimmed (`withShim`): its head and body are held until `end`, then
 * written with the new length.
 */
function shimmingHtml(response: ServerResponse): ServerResponse {
    const writeHead = response.writeHead.bind(response);
    const end = response.end.bind(response);
    let head: { status: number; headers: Record<string, string | number> } = { status: 200, headers: {} };
    const held = response as unknown as {
        writeHead: (status: number, headers?: Record<string, string | number>) => ServerResponse;
        end: (body?: unknown) => ServerResponse;
    };
    held.writeHead = (status, headers = {}) => {
        head = { status, headers: { ...headers } };
        return response;
    };
    held.end = (body?: unknown) => {
        const type = Object.entries(head.headers).find(([name]) => name.toLowerCase() === 'content-type')?.[1];
        const html = typeof type === 'string' && type.startsWith('text/html') && body !== undefined;
        const sent = html ? withShim(Buffer.from(body as Buffer | string).toString('utf8')) : body;
        const headers = Object.fromEntries(
            Object.entries(head.headers)
                .filter(([name]) => name.toLowerCase() !== 'content-length')
                .map(([name, value]) => [name, name.toLowerCase() === 'content-security-policy' ? withConsentFrame(String(value)) : value]),
        );
        writeHead(head.status, headers);
        return end(sent as Buffer | string | undefined);
    };
    return response;
}

/** A server whose stack routes answer first, then `fallback` (its HTML pages shimmed). */
function stackServer(routes: readonly StackRoute[], fallback: RequestHandler): Server {
    return createServer((request, response) => {
        const handle = async (): Promise<void> => {
            const target = targetOf(request);
            for (const route of routes) {
                const answer = await route(request, target);
                if (answer !== undefined) {
                    write(response, request, answer);
                    return;
                }
            }
            fallback(request, shimmingHtml(response));
        };
        handle().catch((error: unknown) => {
            log.error('stack route failed', { path: targetOf(request).pathname, error: String(error) });
            if (!response.headersSent) {
                write(response, request, text(502, `local stack: ${String(error)}`));
            }
        });
    });
}

export interface StackServerOptions {
    /** `/admin/runtime.json` says start-up mode (a new map's Hosting-only deploy, the `fresh` seed). */
    readonly startUp: boolean;
}

/**
 * The admin server of the stack on 127.0.0.1:4312: the e2e Hosting tree as Hosting serves it (the admin's e2e build at
 * `/admin/`, the public map at the root: M6), behind the stack's routes.
 */
export function startStackAdmin(options: StackServerOptions): Promise<Server> {
    const { release, releaseTime } = treeRelease();
    const timed = releaseTime === null ? {} : { releaseTime };
    const runtime = { ...ADMIN_RUNTIME, release, ...timed, ...(options.startUp ? { startUp: true } : {}) };
    const admin = adminRequestHandler({
        hostingDir: E2E_HOSTING_DIR,
        startUpDir: E2E_HOSTING_START_UP_DIR,
        hosting: parseHostingConfig(readFileSync('firebase.json', 'utf8')),
        connect: ADMIN_CONNECT_ORIGINS,
        webConfig: ADMIN_WEB_CONFIG,
        runtime,
        project: ADMIN_PROJECT,
    });
    return listen(stackServer([commonRoute, adminRootRoute, installBundleRoute(release, releaseTime)], admin), ADMIN_PORT);
}

/** The e2e Hosting tree's release (`release.json`, the admin build's own): what the stack's admin names and installs. */
/** The e2e tree's release and its build time (`release.json`; finding 39 of 2026-11-01: none without one). */
function treeRelease(): { readonly release: string; readonly releaseTime: number | null } {
    const { release, releaseTime } = JSON.parse(readFileSync(`${E2E_HOSTING_DIR}/release.json`, 'utf8')) as {
        readonly release: string;
        readonly releaseTime?: number;
    };
    return { release, releaseTime: releaseTime ?? null };
}

/**
 * The admin's install bundle of `release` (M6, docs/research/M6-interfaces.md §1.3): its `manifest.json`, which Setup's
 * install cards read and hash. The stack does not pack the bundle's files: the fake Cloud Build runs no step, and a build
 * ends when the stack's fake is told to (`{"name":"cloud-build.finish"}`, docs/MANUAL_TEST_PLAN.md B3).
 */
function installBundleRoute(release: string, releaseTime: number | null): StackRoute {
    const path = `${ADMIN_PATH}install/${installReleaseSlug(release)}/manifest.json`;
    const answer: Answer = {
        status: 200,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' },
        body: installManifestText(E2E_PROJECT_ID, true, release, releaseTime),
    };
    return (_request, target) => Promise.resolve(target.pathname === path ? answer : undefined);
}

/**
 * The admin server's root sends a visitor to the admin (M6: the admin is at `/admin/`, and the root of the e2e Hosting
 * tree is its public map, which reads the e2e world's bucket and not the emulators': the stack's viewer is the site
 * server's), so `http://127.0.0.1:4312` keeps opening the admin, as `.claude/launch.json` names it.
 */
function adminRootRoute(_request: IncomingMessage, target: Target): Promise<Answer | undefined> {
    const answer: Answer = { status: 302, headers: { location: `${ADMIN_PATH}${target.search}`, 'cache-control': 'no-store' } };
    return Promise.resolve(target.pathname === '/' ? answer : undefined);
}

/** The site server of the stack on 127.0.0.1:4310: the e2e sites and every city's page, behind the stack's routes. */
export function startStackSite(): Promise<Server> {
    const built = builtFolders();
    const route: StackRoute = (request, target) => siteRoute(request, target, built);
    return listen(stackServer([commonRoute, route], siteRequestHandler(E2E_SITE_DIR)), SITE_PORT);
}
