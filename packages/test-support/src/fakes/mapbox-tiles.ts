import { fixtureResponse } from '../api-fixtures/index.js';
import type { MapboxState, PublishedTiles } from './mapbox-state.js';
import { solidPng, type Bytes, type Rgb } from './png.js';
import { route, type Route, type RouteParams } from './routes.js';

/**
 * The tiles of the tilesets the fake MTS published (docs/research/M3-interfaces.md §7.3, §13): `GET /v4/<tileset>.json`
 * (the publisher's smoke test, the viewer, the admin map) and `GET /v4/<tileset>/<z>/<x>/<y>[@2x].<png|webp|jpg>`, one solid
 * colour per tileset (`publishedTileColour`), so a pixel probe of the viewer knows the layer it shows. Only the fake's
 * accounts' tilesets (`<user>.<name>`), and only after a publish job succeeded: before that, and for a tile outside the
 * recipe's zooms, Mapbox's 404. Tiles are public: any `access_token` reads them.
 */

/** Distinct, saturated colours, none of them the e2e basemap's or a fixed e2e layer's. */
const PALETTE: readonly Rgb[] = [
    [214, 120, 30],
    [150, 60, 170],
    [20, 140, 150],
    [190, 30, 110],
    [110, 150, 20],
    [40, 70, 160],
    [170, 120, 90],
    [230, 190, 40],
];

/** The colour every tile of a published tileset is painted with (FNV-1a of its id into `PALETTE`). */
export function publishedTileColour(tilesetId: string): Rgb {
    let hash = 0x81_1c_9d_c5;
    for (const byte of new TextEncoder().encode(tilesetId)) {
        hash = Math.imul(hash ^ byte, 0x01_00_01_93) >>> 0;
    }
    return PALETTE[hash % PALETTE.length] ?? [0, 0, 0];
}

const TILE = /^(\d+)@?(2x)?\.(png|webp|jpg|jpeg)$/;
const tiles = new Map<string, Promise<Bytes>>();

/** One tile's PNG, made once per colour and size. */
function tileOf(colour: Rgb, size: number): Promise<Bytes> {
    const key = `${colour.join(',')}:${String(size)}`;
    const made = tiles.get(key) ?? solidPng(size, colour);
    tiles.set(key, made);
    return made;
}

function publishedOf(state: MapboxState, user: string, tilesetId: string): PublishedTiles | undefined {
    return state.accounts.get(user)?.tilesets.get(tilesetId)?.published;
}

function withinZooms(published: PublishedTiles, zoom: number): boolean {
    return zoom >= published.minzoom && zoom <= published.maxzoom;
}

/** The TileJSON and tile routes of one account's tilesets. */
function accountRoutes(state: MapboxState, user: string): Route[] {
    const tilesetOf = (params: RouteParams): string => `${user}.${String(params['name'])}`;
    const tileJson: Route['answer'] = (_request, params) => {
        const tilesetId = tilesetOf(params);
        const published = publishedOf(state, user, tilesetId);
        return published === undefined
            ? fixtureResponse('mapbox/error.not-found')
            : fixtureResponse('mapbox/tilejson.published', {
                  values: { tilesetId, tilesetName: String(params['name']) },
                  merge: { minzoom: published.minzoom, maxzoom: published.maxzoom, center: [0, 0, published.minzoom] },
              });
    };
    const tile: Route['answer'] = async (_request, params) => {
        const tilesetId = tilesetOf(params);
        const published = publishedOf(state, user, tilesetId);
        const match = TILE.exec(String(params['tile']));
        if (published === undefined || match === null || !withinZooms(published, Number(params['z']))) {
            return fixtureResponse('mapbox/error.not-found');
        }
        const png = await tileOf(publishedTileColour(tilesetId), match[2] === undefined ? 256 : 512);
        return new Response(png, { status: 200, headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
    };
    return [
        route('GET', `https://api.mapbox.com/v4/${user}.{name}.json`, 'mapbox.tiles.tilejson', tileJson),
        route('GET', `https://api.mapbox.com/v4/${user}.{name}/{z}/{x}/{tile}`, 'mapbox.tiles.tile', tile),
    ];
}

/** The routes of every account the fake knows when it is created. */
export function tileRoutes(state: MapboxState): Route[] {
    return [...state.accounts.keys()].flatMap((user) => accountRoutes(state, user));
}
