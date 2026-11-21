import { fixtureBody, fixtureResponse, type FixtureName } from '../api-fixtures/index.js';
import { requestObject, type Route } from './routes.js';

/**
 * The fake USGS's scenes over Bucharest (docs/research/M3-interfaces.md §3, §13): the `scene-search` results of the three
 * declassified datasets with full metadata (`usgs/scene-search.<dataset>.json`), searched the way M2M searches them: by
 * dataset, the minimum bounding rectangle of `sceneFilter.spatialFilter`, the acquisition window of
 * `sceneFilter.acquisitionFilter`, in pages of `maxResults` from `startingNumber`. The five frames M3 targets (1966,
 * 1976, 1977, 1978, 1980) are free; a 1968 frame has a paid-only twin and a 1974 KH-9 panoramic strip must be ordered.
 */

/** The datasets the fake knows, with the fixture of each one's results. */
const DATASET_FIXTURES: Readonly<Record<string, FixtureName>> = {
    corona2: 'usgs/scene-search.corona2',
    declassii: 'usgs/scene-search.declassii',
    declassiii: 'usgs/scene-search.declassiii',
};

/**
 * M25 (`docs/research/M25-landsat.md` §8): Landsat 5 TM's scenes over the city, which a search answers only once a spec asks for them
 * (`usgs.landsatScenes`: every other spec's harvest stays the declassified one), and Landsat 8 and 9 OLI's (a 2016 and a 2023 scene);
 * Landsat 7 has none.
 */
const LANDSAT_FIXTURES: Readonly<Record<string, FixtureName>> = {
    landsat_tm_c2_l1: 'usgs/scene-search.landsat',
    landsat_ot_c2_l1: 'usgs/scene-search.landsat-ot',
};

/** One `scene-search` result as M2M sends it (the fields the fake reads; the rest pass through). */
export interface SceneResult {
    readonly entityId: string;
    readonly displayId: string;
    readonly options: { readonly download: boolean };
    readonly spatialBounds: { readonly coordinates: readonly (readonly (readonly [number, number])[])[] };
    readonly temporalCoverage: { readonly startDate: string };
    readonly browse: readonly { readonly browsePath: string; readonly thumbnailPath: string }[];
    readonly metadata: readonly unknown[];
}

/** A scene of the catalogue and the dataset it belongs to. */
export interface CatalogueScene {
    readonly dataset: string;
    readonly result: SceneResult;
}

interface SearchData {
    readonly results: readonly SceneResult[];
}

function resultsOf(name: FixtureName): readonly SceneResult[] {
    return (fixtureBody(name) as { data: SearchData }).data.results;
}

/** Every scene of the three datasets and (M25) Landsat's, in fixture order. */
export function catalogueScenes(): readonly CatalogueScene[] {
    return Object.entries({ ...DATASET_FIXTURES, ...LANDSAT_FIXTURES }).flatMap(([dataset, name]) =>
        resultsOf(name).map((result) => ({ dataset, result })),
    );
}

/** The scene with `entityId`, or undefined. */
export function catalogueScene(entityId: string): CatalogueScene | undefined {
    return catalogueScenes().find((scene) => scene.result.entityId === entityId);
}

/** The acquisition date (`YYYY-MM-DD`) of a result. */
export function acquisitionDate(result: SceneResult): string {
    return result.temporalCoverage.startDate.slice(0, 10);
}

interface Rectangle {
    readonly west: number;
    readonly south: number;
    readonly east: number;
    readonly north: number;
}

function rectangleOf(result: SceneResult): Rectangle {
    const ring = result.spatialBounds.coordinates[0] ?? [];
    const lngs = ring.map((point) => point[0]);
    const lats = ring.map((point) => point[1]);
    return { west: Math.min(...lngs), south: Math.min(...lats), east: Math.max(...lngs), north: Math.max(...lats) };
}

/** A `{latitude, longitude}` corner of the filter, or undefined. */
function cornerAt(spatial: Readonly<Record<string, unknown>>, key: string): { readonly lat: number; readonly lng: number } | undefined {
    const corner = (spatial[key] ?? {}) as { latitude?: unknown; longitude?: unknown };
    return typeof corner.latitude === 'number' && typeof corner.longitude === 'number'
        ? { lat: corner.latitude, lng: corner.longitude }
        : undefined;
}

/** The request's `mbr` spatial filter, or undefined for none (every scene matches). */
function filterRectangle(filter: Readonly<Record<string, unknown>>): Rectangle | undefined {
    const spatial = (filter['spatialFilter'] ?? {}) as Readonly<Record<string, unknown>>;
    const lowerLeft = cornerAt(spatial, 'lowerLeft');
    const upperRight = cornerAt(spatial, 'upperRight');
    return lowerLeft === undefined || upperRight === undefined
        ? undefined
        : { west: lowerLeft.lng, south: lowerLeft.lat, east: upperRight.lng, north: upperRight.lat };
}

function intersects(a: Rectangle, b: Rectangle): boolean {
    return a.west <= b.east && b.west <= a.east && a.south <= b.north && b.south <= a.north;
}

function dateField(filter: Readonly<Record<string, unknown>>, key: 'start' | 'end'): string | undefined {
    const window = filter['acquisitionFilter'] as Record<string, unknown> | undefined;
    const value = window?.[key];
    return typeof value === 'string' ? value.slice(0, 10) : undefined;
}

function inWindow(result: SceneResult, filter: Readonly<Record<string, unknown>>): boolean {
    const date = acquisitionDate(result);
    return date >= (dateField(filter, 'start') ?? '0000-00-00') && date <= (dateField(filter, 'end') ?? '9999-99-99');
}

/** True when the result passes the request's scene filter: its place and its acquisition window. */
function matches(result: SceneResult, filter: Readonly<Record<string, unknown>>): boolean {
    const rectangle = filterRectangle(filter);
    return (rectangle === undefined || intersects(rectangleOf(result), rectangle)) && inWindow(result, filter);
}

function positiveInteger(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

/** What the search may change: no scene at all, datasets that fail (502) while the others answer, and (M25) Landsat's scenes listed. */
export interface SceneSearchState {
    noScenes: boolean;
    readonly failingDatasets: Set<string>;
    landsat: boolean;
}

/** The fixture of a dataset's results, Landsat's only while the state lists them. */
function fixtureOf(dataset: string, state: SceneSearchState): FixtureName | undefined {
    return DATASET_FIXTURES[dataset] ?? (state.landsat ? LANDSAT_FIXTURES[dataset] : undefined);
}

function stringField(body: Readonly<Record<string, unknown>>, key: string): string {
    const value = body[key];
    return typeof value === 'string' ? value : '';
}

function objectField(body: Readonly<Record<string, unknown>>, key: string): Readonly<Record<string, unknown>> {
    const value = body[key];
    return typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : {};
}

/** The `scene-search` answer for a request body (already authenticated). */
export function sceneSearch(request: Parameters<Route['answer']>[0], state: SceneSearchState): Response {
    const body = requestObject(request);
    const dataset = stringField(body, 'datasetName');
    if (state.failingDatasets.has(dataset)) {
        return fixtureResponse('usgs/error.unavailable');
    }
    const name = fixtureOf(dataset, state);
    if (name === undefined || state.noScenes) {
        return fixtureResponse('usgs/scene-search.empty');
    }
    const filter = objectField(body, 'sceneFilter');
    const full = body['metadataType'] === 'full';
    const found = resultsOf(name)
        .filter((result) => matches(result, filter))
        .map((result) => (full ? result : { ...result, metadata: [] }));
    const startingNumber = positiveInteger(body['startingNumber'], 1);
    const page = found.slice(startingNumber - 1, startingNumber - 1 + positiveInteger(body['maxResults'], 100));
    return fixtureResponse(name, {
        merge: {
            data: {
                ...(fixtureBody(name) as { data: Record<string, unknown> }).data,
                results: page,
                recordsReturned: page.length,
                totalHits: found.length,
                startingNumber,
                nextRecord: startingNumber + page.length,
            },
        },
    });
}
