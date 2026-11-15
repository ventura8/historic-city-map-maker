import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KIT_PLACEHOLDER_TOKEN } from '@hcm/shared';

import { E2E_BROKEN_TILESET, E2E_MEASUREMENT_ID, tilesetColour, XYZ_COLOURS, type Rgb } from '../fixtures/world.js';
import { catalogue } from './catalogue.js';
import { glyphRange, RANGE_SIZE } from './glyphs.js';
import { firebaseWebConfig, GTAG_SCRIPT } from './gtag.js';
import { mockedHostKind, type HostKind } from './hosts.js';
import { basemapStyle } from './style.js';
import { rasterTile, transparentPixel, type TileFormat } from './tiles.js';

/**
 * What the mock APIs answer, per mocked host (docs/research/design-review-testability.md §4.1–§4.2). Requests arrive
 * as `/h/<host><path>?<query>` (support/network.ts forwards every routed browser request that way) and every answer
 * allows any origin, so `crossorigin` scripts with Subresource Integrity load as they do from the real CDN.
 */

export interface MockRequest {
    readonly method: string;
    readonly host: string;
    readonly path: string;
    readonly query: URLSearchParams;
    readonly body: string;
}

export interface MockResponse {
    readonly status: number;
    readonly type?: string;
    readonly body?: string | Uint8Array;
    /** More response headers (an extension's upstream `retry-after`, say). */
    readonly headers?: Readonly<Record<string, string>>;
}

/** Absolute folders the mock serves files from. */
export interface MockFiles {
    /** The pinned `mapbox-gl` package's `dist/`. */
    readonly mapboxGlDist: string;
    /** `packages/engine/dist` (the CDN routes). */
    readonly engineDist: string;
    /**
     * What the pinned jsDelivr folder of a release (`@v<version>/cdn/engine/`, M5-interfaces §2.4, §3.6) serves: the
     * committed `cdn/engine/` once a release made it, else `packages/engine/dist` (main.ts decides).
     */
    readonly cdnEngine: string;
}

/** The release a package.json names; a file without one stops the mock at start, before any test runs. */
function packageRelease(text: string): string {
    const version = /"version":\s*"(\d+\.\d+\.\d+)"/.exec(text)?.[1];
    if (version === undefined) throw new Error('mapbox-gl/package.json names no release');
    return version;
}

/**
 * The only Mapbox GL JS release the mock serves: the pinned devDependency's own version, read from its package.json so a
 * bump cannot leave the route behind (the 3.34.1 update did once: every page then failed on a 404 for the library).
 */
const MAPBOX_GL_RELEASE = packageRelease(readFileSync(fileURLToPath(import.meta.resolve('mapbox-gl/package.json')), 'utf8'));
const MAPBOX_GL_PATH = new RegExp(
    `^/mapbox-gl-js/v${MAPBOX_GL_RELEASE.replaceAll('.', '\\.')}/(mapbox-gl(?:-csp|-csp-worker)?\\.(?:js|css)(?:\\.map)?)$`,
);
const STYLE_PATH = /^\/styles\/v1\/([\w.-]+)\/([\w.-]+)$/;
const SPRITE_PATH = /^\/styles\/v1\/[\w.-]+\/[\w.-]+\/sprite(?:@2x)?\.(json|png)$/;
/** Mapbox GL 3.32 also asks a `mapbox://sprites/…` sprite for its vector icon set; an empty message has no icons. */
const ICONSET_PATH = /^\/styles\/v1\/[\w.-]+\/[\w.-]+\/iconset\.pbf$/;
const FONT_PATH = /^\/fonts\/v1\/[\w.-]+\/([^/]+)\/(\d+)-(\d+)\.pbf$/;
const TILEJSON_PATH = /^\/v4\/([\w-]+\.[\w-]+)\.json$/;
const TILE_PATH = /^\/v4\/([\w-]+\.[\w-]+)\/(\d+)\/(\d+)\/(\d+)(@2x)?\.(png|webp)$/;
const XYZ_PATH = /^\/xyz\/([\w-]+)\/(\d+)\/(\d+)\/(\d+)\.png$/;
const ENGINE_CDN_PATH = /^\/(?:npm\/@hcm\/engine@[\w.-]+\/dist|gh\/[\w.-]+\/[\w.-]+@[\w.-]+\/packages\/engine\/dist)\/([\w.-]+)$/;
/**
 * M5: a release's folder on jsDelivr, pinned (`@v1.0.0`, a pre-release `@v1.0.0-beta.1` / `@v1.0.0-rc.1`) or following a
 * major line (`@1`); one folder level (`fonts/`).
 */
const RELEASE_CDN_PATH = /^\/gh\/ventura8\/historic-city-map-maker@(?:v[\w.-]+|\d+)\/cdn\/engine\/((?:[\w-][\w.-]*\/)?[\w-][\w.-]*)$/;

const NOT_FOUND: MockResponse = { status: 404, type: 'text/plain', body: 'not mocked' };
const NO_CONTENT: MockResponse = { status: 204 };

const CONTENT_TYPES: Readonly<Record<string, string>> = {
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.map': 'application/json',
    '.json': 'application/json',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
};

function json(value: unknown): MockResponse {
    return { status: 200, type: 'application/json', body: JSON.stringify(value) };
}

function contentType(file: string): string {
    return CONTENT_TYPES[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream';
}

async function fileResponse(path: string): Promise<MockResponse> {
    try {
        return { status: 200, type: contentType(path), body: await readFile(path) };
    } catch {
        return NOT_FOUND;
    }
}

const cache = new Map<string, Promise<MockResponse>>();

/** Generated answers are deterministic, so each is made once per server. */
function cached(key: string, make: () => Promise<MockResponse>): Promise<MockResponse> {
    const hit = cache.get(key);
    if (hit !== undefined) {
        return hit;
    }
    const made = make();
    cache.set(key, made);
    return made;
}

function tileResponse(colour: Rgb, match: RegExpExecArray, size: number, format: TileFormat): Promise<MockResponse> {
    const [, , z, x, y] = match;
    const label = `${String(z)}/${String(x)}/${String(y)}`;
    return cached(`${colour.join(',')}:${label}:${String(size)}:${format}`, async () => ({
        status: 200,
        type: `image/${format}`,
        body: await rasterTile(colour, label, size, format),
    }));
}

function tileJson(tilesetId: string): MockResponse {
    const known = tilesetColour(tilesetId) !== undefined || tilesetId === E2E_BROKEN_TILESET;
    return known
        ? json({
              tilejson: '2.2.0',
              id: tilesetId,
              name: `e2e ${tilesetId}`,
              scheme: 'xyz',
              format: 'webp',
              minzoom: 0,
              maxzoom: 22,
              bounds: [-180, -85.0511, 180, 85.0511],
              tiles: [`https://api.mapbox.com/v4/${tilesetId}/{z}/{x}/{y}.webp`],
              attribution: 'e2e tiles',
          })
        : NOT_FOUND;
}

/** The broken tileset's tiles: a tile outage (503), which Mapbox GL reports, unlike a 404. */
const TILE_OUTAGE: MockResponse = { status: 503, type: 'text/plain', body: 'tile service unavailable' };

function mapboxTile(match: RegExpExecArray): Promise<MockResponse> | MockResponse {
    const tilesetId = String(match[1]);
    const colour = tilesetColour(tilesetId);
    if (colour === undefined) {
        return tilesetId === E2E_BROKEN_TILESET ? TILE_OUTAGE : NOT_FOUND;
    }
    const size = match[5] === undefined ? 256 : 512;
    return tileResponse(colour, match, size, match[6] === 'png' ? 'png' : 'webp');
}

function font(match: RegExpExecArray): Promise<MockResponse> {
    const fontstack = decodeURIComponent(String(match[1]));
    const start = Number(match[2]);
    return cached(`font:${fontstack}:${String(start)}`, () =>
        Promise.resolve({ status: 200, type: 'application/x-protobuf', body: glyphRange(fontstack, start - (start % RANGE_SIZE)) }),
    );
}

function sprite(extension: string | undefined): Promise<MockResponse> | MockResponse {
    return extension === 'png'
        ? cached('sprite.png', async () => ({ status: 200, type: 'image/png', body: await transparentPixel() }))
        : json({});
}

type Route = readonly [pattern: RegExp, answer: (match: RegExpExecArray, files: MockFiles) => Promise<MockResponse> | MockResponse];

const MAPBOX_ROUTES: readonly Route[] = [
    [MAPBOX_GL_PATH, (match, files) => fileResponse(join(files.mapboxGlDist, String(match[1])))],
    [STYLE_PATH, (match) => json(basemapStyle(String(match[1]), String(match[2])))],
    [SPRITE_PATH, (match) => sprite(match[1])],
    [ICONSET_PATH, () => ({ status: 200, type: 'application/x-protobuf', body: new Uint8Array(0) })],
    [FONT_PATH, font],
    [TILEJSON_PATH, (match) => tileJson(String(match[1]))],
    [TILE_PATH, mapboxTile],
    // Mapbox GL's map-load session (a billed map load), next to the `map.load` event on events.mapbox.com.
    [/^\/map-sessions\/v1$/, () => json({})],
];

const TILE_HOST_ROUTES: readonly Route[] = [
    [
        XYZ_PATH,
        (match) => {
            const colour = XYZ_COLOURS.get(String(match[1]));
            return colour === undefined ? NOT_FOUND : tileResponse(colour, match, 256, 'png');
        },
    ],
];

const CDN_ROUTES: readonly Route[] = [
    [ENGINE_CDN_PATH, (match, files) => fileResponse(join(files.engineDist, String(match[1])))],
    [RELEASE_CDN_PATH, (match, files) => fileResponse(join(files.cdnEngine, String(match[1])))],
];

/**
 * Mapbox's answer to the starter kit's placeholder token (`pk.replace-with-your-token`, valid by the schema): refused, as
 * Mapbox refuses any token it did not issue (M5-interfaces §3.3; S-V27-BAD-PLACEHOLDER-TOKEN).
 */
const TOKEN_REFUSED: MockResponse = {
    status: 401,
    type: 'application/json',
    body: JSON.stringify({ message: 'Not Authorized - Invalid Token' }),
};

function mapbox(request: MockRequest, files: MockFiles): Promise<MockResponse> | MockResponse {
    return request.query.get('access_token') === KIT_PLACEHOLDER_TOKEN ? TOKEN_REFUSED : routed(MAPBOX_ROUTES, request, files);
}

function routed(routes: readonly Route[], request: MockRequest, files: MockFiles): Promise<MockResponse> | MockResponse {
    for (const [pattern, answer] of routes) {
        const match = pattern.exec(request.path);
        if (match !== null) {
            return answer(match, files);
        }
    }
    return NOT_FOUND;
}

const WEB_CONFIG_PATH = /^\/v1alpha\/projects\/-\/apps\/([\w:-]+)\/webConfig$/;

/** GET on an analytics host: the stand-in gtag.js, the Firebase web config of an app, `{}` for anything else. */
function analyticsGet(request: MockRequest): MockResponse {
    if (request.path.startsWith('/gtag/js')) {
        return { status: 200, type: 'text/javascript', body: GTAG_SCRIPT };
    }
    const app = WEB_CONFIG_PATH.exec(request.path);
    return app === null ? json({}) : json(firebaseWebConfig(String(app[1]), E2E_MEASUREMENT_ID));
}

/** GA4 and Firebase: gtag.js and the web config (gtag.ts), beacons accepted, an installation gets a fake id; all recorded. */
function analytics(request: MockRequest): MockResponse {
    if (request.method !== 'POST') {
        return analyticsGet(request);
    }
    if (request.path.endsWith('/installations')) {
        return json({
            name: 'installations/e2e',
            fid: 'e2e-fid',
            refreshToken: 'e2e-refresh',
            authToken: { token: 'e2e-auth', expiresIn: '604800s' },
        });
    }
    return NO_CONTENT;
}

/** The answer for one forwarded request (methods other than GET, HEAD and POST were answered as CORS preflights). */
export function answer(request: MockRequest, files: MockFiles): Promise<MockResponse> | MockResponse {
    const kind: HostKind | null = mockedHostKind(request.host);
    switch (kind) {
        case 'mapbox':
            return mapbox(request, files);
        case 'tiles':
            return routed(TILE_HOST_ROUTES, request, files);
        case 'cdn':
            return routed(CDN_ROUTES, request, files);
        case 'analytics':
            return analytics(request);
        case 'catalogue':
            return catalogue(request);
        case 'mapbox-events':
        case 'telemetry':
            return request.method === 'POST' ? NO_CONTENT : NOT_FOUND;
        case null:
            return NOT_FOUND;
    }
}
