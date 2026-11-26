/**
 * The e2e world: the loopback servers, the generated test values and the synthetic raster layers that the mock APIs
 * draw and the fixture manifest names (docs/research/design-review-testability.md §4.1–§4.2, M1-interfaces.md §10).
 * One table, imported by the mock server, the fixture manifest and the specs, so a colour a probe expects is the
 * colour the tile server paints.
 */

/** The static site server (`dist/e2e-site`): the only origin the pages under test load from. */
export const SITE_PORT = 4310;
export const SITE_ORIGIN = `http://127.0.0.1:${String(SITE_PORT)}`;

/** The mock APIs (Mapbox, analytics, the crash endpoint, the CDN); the browser reaches them only through routes. */
export const MOCK_API_PORT = 4311;
export const MOCK_API_ORIGIN = `http://127.0.0.1:${String(MOCK_API_PORT)}`;

/** The header a forwarded request carries so `/__calls` can answer per test while workers run in parallel. */
export const TEST_HEADER = 'x-hcm-test';

/** Where the e2e build writes the sites (`npm run build:site:e2e`). */
export const E2E_SITE_DIR = 'dist/e2e-site';

/**
 * The Bucharest site's city (`sites/bucharest/config.js`), which is the project's (`infra/project.json`): the fixture
 * manifest names it, as every manifest the backend builds does (the legacy manifest's own `bucuresti` is renamed by the
 * site build, `DECISIONS-for-review.md` §35b).
 */
export const E2E_CITY_ID = 'bucharest';

/**
 * The public bucket the e2e site `bucharest-bucket` reads its manifest from (`HCM_PUBLIC_BUCKET` of the site build,
 * DECISIONS-for-review.md §51e): a generated name no project has; the specs answer its requests themselves.
 */
export const E2E_PUBLIC_BUCKET = 'e2e-hcm-public';

/** Generated test values that encode the scenario, never real ones (`quality/testing_strategy_skill.md`). */
export const E2E_TOKEN = 'pk.e2e-fake-token';
export const E2E_MEASUREMENT_ID = 'G-E2E0000000';

/**
 * The Firebase web app ids of the analytics scenarios (CR-9: `city.analytics.firebase`), generated test values. The
 * API key is assembled at run time so the source never holds a string shaped like a Google API key (gitleaks).
 */
export const E2E_FIREBASE_APP = {
    apiKey: `${['AI', 'za'].join('')}${'E2eFakeKey'.padEnd(35, '0')}`,
    appId: '1:123456789012:web:0e2e0e2e',
    projectId: 'demo-hcm-e2e',
} as const;

/** Hosts that exist only in tests (`.test` is reserved, RFC 2606) and are answered by the mock APIs. */
export const E2E_TILE_HOST = 'tiles.e2e.test';
export const E2E_TELEMETRY_HOST = 'telemetry.e2e.test';
export const E2E_ERROR_ENDPOINT = `https://${E2E_TELEMETRY_HOST}/report`;

export type Rgb = readonly [red: number, green: number, blue: number];

/**
 * A basemap without Standard's configuration (`mapbox://styles/<owner>/e2e-plain`): a plain style with the three slots
 * and no `schema`, so the engine must leave its 3D-objects switch alone (S-V03-BAD-STYLE-WITHOUT-CONFIG) and offer no
 * map-label switches (S-V31-BAD-CUSTOM-BASEMAP).
 */
export const E2E_PLAIN_STYLE_ID = 'e2e-plain';

/** A basemap with Standard's configuration whose own default leaves street names off, with no `basemap.config` to say so (S-V31-*-STYLE-DEFAULT). */
export const E2E_ROADS_OFF_STYLE_ID = 'e2e-roads-off';

/** The basemap's background (the mock style), what a probe sees where no layer draws. */
export const BASEMAP_BACKGROUND: Rgb = [242, 239, 233];

interface E2eLayerBase {
    readonly id: string;
    readonly year: number;
    /** The solid colour of every tile of the layer (a z/x/y label sits in each tile's top-left corner). */
    readonly colour: Rgb;
}

/** A `mapbox://` tileset served by the mock APIs as TileJSON and tiles. */
export interface E2eTilesetLayer extends E2eLayerBase {
    readonly tilesetId: string;
}

/** An `xyz` source on the e2e tile host. */
export interface E2eXyzLayer extends E2eLayerBase {
    readonly tiles: string;
}

export const E2E_TILESET_LAYER: E2eTilesetLayer = { id: 'e2e-1966', year: 1966, colour: [200, 40, 40], tilesetId: 'ventura86.e2e-1966' };

export const E2E_XYZ_LAYER: E2eXyzLayer = {
    id: 'e2e-1980',
    year: 1980,
    colour: [40, 150, 70],
    tiles: `https://${E2E_TILE_HOST}/xyz/e2e-1980/{z}/{x}/{y}.png`,
};

/**
 * A tileset whose TileJSON exists but whose every tile answers 503 (a tile outage, scenario S-V03-BAD-TILE404). Not
 * 404: Mapbox GL treats a 404 tile as "no imagery here" and never reports it (docs/LESSONS.md).
 */
export const E2E_BROKEN_TILESET = 'ventura86.e2e-broken';

/** Tileset id → colour, for the mock tile server. */
const TILESET_COLOURS: ReadonlyMap<string, Rgb> = new Map([[E2E_TILESET_LAYER.tilesetId, E2E_TILESET_LAYER.colour]]);

/**
 * The Mapbox account of the admin tier's cities (`cities/<city>.mapbox.user`): every tileset of it is one solid colour,
 * so the admin map draws any layer the pipeline would have published there (`e2e-user.corona-1968`) and a probe of the
 * admin map knows what it shows.
 */
const E2E_MAPBOX_USER = 'e2e-user';
export const E2E_USER_TILESET_COLOUR: Rgb = [60, 90, 200];

/** The colour the mock tile server paints a tileset with, or undefined for one it does not know. */
export function tilesetColour(tilesetId: string): Rgb | undefined {
    return TILESET_COLOURS.get(tilesetId) ?? (tilesetId.startsWith(`${E2E_MAPBOX_USER}.`) ? E2E_USER_TILESET_COLOUR : undefined);
}

/** xyz layer id (the path segment after `/xyz/`) → colour. */
export const XYZ_COLOURS: ReadonlyMap<string, Rgb> = new Map([[E2E_XYZ_LAYER.id, E2E_XYZ_LAYER.colour]]);
