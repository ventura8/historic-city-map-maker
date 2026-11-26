import '../global-options.js';

import {
    PROBE_LIMITS,
    layerSourceRefusal,
    type ApiErrorCode,
    type CallableRequest,
    type CallableResponse,
    type CityDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { UpstreamError, type UpstreamFailure } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';
import { imageTypeOf, type ImageType } from './magic.js';
import { requireCity, requireTilesToken } from './records.js';

/**
 * `imagery.probeTiles` (admin; `docs/research/M3-interfaces.md` §8.2, §8.3; S-A15-HAPPY-PROBED, S-A15-BAD-PRIVATE-ADDRESS):
 * Check in the Link a layer dialog. After `layerSourceRefusal` (the city's own Mapbox account, no credential in the
 * address), one tile at the city's centre is asked server-side through `RemoteFiles`, which refuses anything but a public
 * https address and follows no redirect: a PNG, JPEG or WebP answer passes; a 404, another type or no answer is said in
 * words. A Mapbox tileset's TileJSON is read first with the tiles token, for its zoom range.
 */
export type ProbeDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'remote' | 'secrets' | 'tilesets'>;

type Request = CallableRequest<'imagery.probeTiles'>;
type Tile = CallableResponse<'imagery.probeTiles'>['tile'];

const TILE_TYPES: readonly ImageType[] = ['image/png', 'image/jpeg', 'image/webp'];

/** The zoom a probe asks when the source says nothing better (a city plan's tiles start around here). */
const DEFAULT_PROBE_ZOOM = 12;

/** Why a tile could not be read, by the remote fetch's failure. */
const FAILURE_CODES: Readonly<Partial<Record<UpstreamFailure, ApiErrorCode>>> = {
    notFound: 'apiError.imagery.tilesNotFound',
};

/** The tile at `zoom` that holds the city's centre (Web Mercator tile numbering). */
export function tileAt(city: CityDoc, zoom: number): Tile {
    const lng = city.center?.lng ?? (city.bounds.west + city.bounds.east) / 2;
    const lat = city.center?.lat ?? (city.bounds.south + city.bounds.north) / 2;
    const scale = 2 ** zoom;
    const rad = (lat * Math.PI) / 180;
    const x = Math.floor(((lng + 180) / 360) * scale);
    const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * scale);
    return { z: zoom, x, y };
}

function zoomWithin(city: CityDoc, minzoom: number, maxzoom: number): number {
    return Math.min(maxzoom, Math.max(minzoom, Math.round(city.zoom ?? DEFAULT_PROBE_ZOOM)));
}

function filled(template: string, tile: Tile): string {
    return template.replaceAll('{z}', String(tile.z)).replaceAll('{x}', String(tile.x)).replaceAll('{y}', String(tile.y));
}

interface Target {
    readonly url: string;
    readonly tile: Tile;
    readonly allowedHosts?: readonly string[];
}

/** The tile of a Mapbox tileset: its TileJSON (with the tiles token) gives the zoom range. */
async function mapboxTarget(deps: ProbeDeps, city: CityDoc, tilesetId: string): Promise<Target> {
    const token = await requireTilesToken(deps.secrets);
    const range = await deps.tilesets.tileJson(token, tilesetId).catch((error: unknown) => {
        throw error instanceof UpstreamError && error.failure === 'notFound' ? new ApiError('apiError.imagery.tilesNotFound') : error;
    });
    const tile = tileAt(city, zoomWithin(city, range.minzoom, range.maxzoom));
    const url = `https://api.mapbox.com/v4/${tilesetId}/${String(tile.z)}/${String(tile.x)}/${String(tile.y)}.png?access_token=${token}`;
    return { url, tile, allowedHosts: ['api.mapbox.com'] };
}

async function targetOf(deps: ProbeDeps, city: CityDoc, source: Request['source']): Promise<Target> {
    if (source.type === 'mapbox') {
        return mapboxTarget(deps, city, source.tilesetId);
    }
    const tile = tileAt(city, zoomWithin(city, 0, 22));
    return { url: filled(source.type === 'xyz' ? String(source.tiles[0]) : source.url, tile), tile };
}

/** A refused address (the guard: no status) is `addressRefused`; a 404 `tilesNotFound`; anything else unreachable. */
function upstreamProbeCode(error: UpstreamError): ApiErrorCode {
    if (error.failure === 'forbidden' && error.status === undefined) {
        return 'apiError.imagery.addressRefused';
    }
    return FAILURE_CODES[error.failure] ?? 'apiError.imagery.tilesUnreachable';
}

function probeError(error: unknown): Error {
    if (!(error instanceof UpstreamError)) {
        return error instanceof Error ? error : new Error(String(error));
    }
    return new ApiError(upstreamProbeCode(error));
}

/** `layerSourceRefusal`'s answer for the city's own Mapbox account (a foreign tileset, a credential in the address). */
function refuseSource(city: CityDoc, source: Request['source']): void {
    const refusal = layerSourceRefusal(source, city.mapbox?.user ?? null);
    if (refusal !== null) {
        throw new ApiError(refusal.code, 'params' in refusal ? refusal.params : undefined);
    }
}

/** One tile, fetched behind the address guard, by its magic bytes. */
async function probe(deps: ProbeDeps, city: CityDoc, source: Request['source']): Promise<CallableResponse<'imagery.probeTiles'>> {
    const target = await targetOf(deps, city, source);
    const limits = { ...PROBE_LIMITS, ...(target.allowedHosts === undefined ? {} : { allowedHosts: target.allowedHosts }) };
    const contentType = imageTypeOf((await deps.remote.get(target.url, limits)).bytes, TILE_TYPES);
    if (contentType === undefined) {
        throw new ApiError('apiError.imagery.tilesNotImage');
    }
    return { contentType, tile: target.tile };
}

async function imageryProbeTiles(
    deps: ProbeDeps,
    caller: VerifiedCaller,
    request: Request,
): Promise<CallableResponse<'imagery.probeTiles'>> {
    const city = await requireCity(deps.documents, request.cityId);
    refuseSource(city, request.source);
    try {
        const result = await probe(deps, city, request.source);
        deps.log.info('tiles probed', {
            uid: caller.uid,
            cityId: request.cityId,
            source: request.source.type,
            contentType: result.contentType,
        });
        return result;
    } catch (error) {
        throw probeError(error);
    }
}

/** The `imagery-probeTiles` callable. */
export function probeTilesFunction(getDeps: () => ProbeDeps & CallableDeps) {
    return defineCallable('imagery.probeTiles', imageryProbeTiles, getDeps);
}
