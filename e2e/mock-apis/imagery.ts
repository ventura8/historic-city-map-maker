import type { UpstreamExtension } from '@hcm/test-support/fakes/http';

import { resolve } from 'node:path';

import { useSyntheticScenes, type ImageryRunner, type ImageryScript } from '../admin/support/imagery-runner.js';
import { E2E_TILE_HOST } from '../fixtures/world.js';
import type { MockExtension } from './server.js';
import type { MockResponse } from './router.js';

/**
 * The M3 imagery routes of the mock APIs (docs/research/M3-interfaces.md §13):
 *
 * - the raster pipeline runner's control endpoints, per city (a spec's own, or the project's in a locked spec):
 *   `POST /__imagery/script?city=` (an `ImageryScript`), `POST /__imagery/release?city=` (runs held at their `holdAt`
 *   step go on), `GET /__imagery/runs?city=` (what the runner played), `POST /__imagery/reset[?city=]`, and
 *   `POST /__imagery/synthetic?dir=` (the server's world answers the synthetic scene a spec generated in `dir`, a folder
 *   under `reports/`: its delivery, its Sentinel-2 window and its OpenStreetMap lines, until the world is reset), and
 *   `POST /__imagery/frames?ids=` (M8: USGS answers these frames as scanned, though the catalogue does not list them);
 * - the tiles of the tilesets the fake MTS published, for every page: the publish happens in the server's world (the
 *   shared partition `''`, which the Functions emulator reaches), and tiles are public, so a page's request for a tileset
 *   of the fake's accounts (`/v4/e2e-mapbox.*`) is answered from that world, wherever the page is (the viewer showing a
 *   layer the admin just published, the admin map);
 * - two XYZ layers of the e2e tile host that `imagery.probeTiles` must refuse (`S-A15-BAD-INVALID-URL`): `e2e-not-image`
 *   answers HTML with 200, `e2e-down` answers 503 (an unknown layer answers 404 from router.ts).
 */

const JSON_TYPE = 'application/json';
const NO_CONTENT: MockResponse = { status: 204 };

function json(value: unknown, status = 200): MockResponse {
    return { status, type: JSON_TYPE, body: JSON.stringify(value) };
}

/** A tileset of the fake Mapbox's accounts (`e2e-mapbox`, `e2e-mapbox-trial`, ...). */
const SERVER_TILES = /^\/v4\/e2e-mapbox(?:-[a-z]+)?\./;

function parsedScript(body: string): ImageryScript | undefined {
    try {
        const script = JSON.parse(body) as Partial<ImageryScript>;
        return Array.isArray(script.attempts) ? (script as ImageryScript) : undefined;
    } catch {
        return undefined;
    }
}

interface ControlContext {
    readonly runner: ImageryRunner;
    readonly upstream: UpstreamExtension;
    readonly query: URLSearchParams;
}

type Control = (runner: ImageryRunner, city: string, body: string, context: ControlContext) => MockResponse;

/** A spec's generated scene folder: under the repository's git-ignored `reports/`, never anywhere else. */
const SYNTHETIC_DIR = /^reports\/[\w./-]+$/;
const REPO_ROOT = resolve(import.meta.dirname, '../..');

function synthetic(context: ControlContext): MockResponse {
    const dir = context.query.get('dir') ?? '';
    if (!SYNTHETIC_DIR.test(dir) || dir.includes('..')) {
        return json({ message: 'dir must be a folder under reports/' }, 400);
    }
    useSyntheticScenes(context.upstream.partitions.get(''), resolve(REPO_ROOT, dir));
    return NO_CONTENT;
}

/** A frame of a date's set the stand-in imports: USGS says it is scanned; the stand-in never fetches its bytes. */
function scannedFrames(context: ControlContext): MockResponse {
    const { deliveries } = context.upstream.partitions.get('').state.usgs;
    (context.query.get('ids') ?? '').split(',').forEach((entityId) => {
        deliveries.set(entityId, () => new Uint8Array(1));
    });
    return NO_CONTENT;
}

const CONTROL: Readonly<Record<string, Control>> = {
    'POST script': (runner, city, body) => {
        const script = parsedScript(body);
        if (script === undefined || city === '') {
            return json({ message: 'a city and a script with attempts are required' }, 400);
        }
        runner.script(city, script);
        return NO_CONTENT;
    },
    'POST release': (runner, city) => json({ released: runner.release(city) }),
    'GET runs': (runner, city) => json(runner.runs(city)),
    'POST reset': (runner, city) => {
        runner.reset(city === '' ? null : city);
        return NO_CONTENT;
    },
    'POST synthetic': (_runner, _city, _body, context) => synthetic(context),
    'POST frames': (_runner, _city, _body, context) => scannedFrames(context),
};

/** The e2e tile host's layers that are not tiles (`/xyz/<layer>/…`). */
const BROKEN_XYZ: Readonly<Record<string, MockResponse>> = {
    'e2e-not-image': { status: 200, type: 'text/html; charset=utf-8', body: '<!doctype html><title>Not a tile</title>' },
    'e2e-down': { status: 503, type: 'text/plain', body: 'tile service unavailable' },
};

function brokenXyz(request: Parameters<MockExtension['answer']>[0]): MockResponse | undefined {
    const layer = /^\/xyz\/([\w-]+)\//.exec(request.path)?.[1];
    return request.host === E2E_TILE_HOST && layer !== undefined ? BROKEN_XYZ[layer] : undefined;
}

/** The imagery extension: the runner's control, the published tiles from the server's world, the broken XYZ layers. */
export function createImageryExtension(runner: ImageryRunner, upstream: UpstreamExtension): MockExtension {
    return {
        answer: async (request) => {
            if (request.host !== 'api.mapbox.com' || request.method !== 'GET' || !SERVER_TILES.test(request.path)) {
                return brokenXyz(request);
            }
            return upstream.answer({ ...request, test: '' });
        },
        control: (request) => {
            const match = /^\/__imagery\/(\w+)$/.exec(request.path);
            const action = match === null ? undefined : CONTROL[`${request.method.toUpperCase()} ${String(match[1])}`];
            const context = { runner, upstream, query: request.query };
            return Promise.resolve(action?.(runner, request.query.get('city') ?? '', request.body, context));
        },
    };
}
