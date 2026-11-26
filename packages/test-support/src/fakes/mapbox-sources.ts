import { fixtureResponse } from '../api-fixtures/index.js';
import { mapboxAuthorized, type MapboxAnswer, type MapboxState } from './mapbox-state.js';
import { route, type Route } from './routes.js';

/**
 * MTS tileset sources (docs/research/M3-interfaces.md §7.3): the publisher streams a version's COG into
 * `sources/<user>/<source>` (its size recorded), reads it back to skip an upload Mapbox already has, and deletes it with
 * the layer; and the check every raster recipe passes before Mapbox takes it (UNVERIFIED shape: exactly `rasterRecipe`
 * of `@hcm/shared` over an existing source of the account).
 */

type Account = Parameters<MapboxAnswer>[2];

export function isZoom(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 22;
}

interface RasterRecipe {
    readonly version?: unknown;
    readonly sources?: unknown;
    readonly minzoom?: unknown;
    readonly maxzoom?: unknown;
}

/** The recipe's only source address ('' unless it has exactly one). */
function onlySourceUri(recipe: RasterRecipe): string {
    const sources = Array.isArray(recipe.sources) ? (recipe.sources as { uri?: unknown }[]) : [];
    const uri = sources.length === 1 ? sources[0]?.uri : undefined;
    return typeof uri === 'string' ? uri : '';
}

/** True when the recipe's one source is an existing source of `user`'s account. */
function namesASource(recipe: RasterRecipe, user: string, owner: Account): boolean {
    const uri = onlySourceUri(recipe);
    const prefix = `mapbox://tileset-source/${user}/`;
    return uri.startsWith(prefix) && owner.sources.has(uri.slice(prefix.length));
}

function zoomsInOrder(recipe: RasterRecipe): boolean {
    return isZoom(recipe.minzoom) && isZoom(recipe.maxzoom) && recipe.minzoom <= recipe.maxzoom;
}

function recipeOf(value: unknown): RasterRecipe & { readonly type?: unknown } {
    return typeof value === 'object' && value !== null ? value : {};
}

/** Why Mapbox refuses a raster recipe of `owner` ('' when it is valid; recipes of other types are not checked). */
export function rasterRecipeProblem(recipe: unknown, user: string, owner: Account): string {
    const raster = recipeOf(recipe);
    if (raster.type !== 'raster') {
        return '';
    }
    const checks: readonly (readonly [boolean, string])[] = [
        [raster.version === 1, 'version must be 1'],
        [namesASource(raster, user, owner), 'sources[0].uri must name an existing tileset source of the account'],
        [zoomsInOrder(raster), 'minzoom and maxzoom must be zooms 0-22, minzoom first'],
    ];
    return checks.find(([valid]) => !valid)?.[1] ?? '';
}

/** A recipe Mapbox refuses (400 with the reason). */
export function recipeRefused(problem: string): Response {
    return fixtureResponse('mapbox/tilesets.recipe.invalid', { values: { recipeError: problem } });
}

const NO_CONTENT = (): Response => new Response(null, { status: 204 });

/** The source routes: upload (the bytes Mapbox received counted), read back, delete. */
export function sourceRoutes(state: MapboxState, base: string): Route[] {
    const values = (user: string, source: string) => ({ mapboxUser: user, sourceId: source });
    const upload: MapboxAnswer = (request, params, owner) => {
        const size = new TextEncoder().encode(request.body).length;
        owner.sources.set(String(params['source']), { files: 1, size });
        return fixtureResponse('mapbox/tilesets.source.created', {
            values: values(String(params['user']), String(params['source'])),
            merge: { file_size: size, source_size: size },
        });
    };
    const read: MapboxAnswer = (_request, params, owner) => {
        const source = owner.sources.get(String(params['source']));
        return source === undefined
            ? fixtureResponse('mapbox/error.not-found')
            : fixtureResponse('mapbox/tilesets.source.get', {
                  values: values(String(params['user']), String(params['source'])),
                  merge: { files: source.files, size: source.size },
              });
    };
    const remove: MapboxAnswer = (_request, params, owner) =>
        owner.sources.delete(String(params['source'])) ? NO_CONTENT() : fixtureResponse('mapbox/error.not-found');
    const path = `${base}/sources/{user}/{source}`;
    return [
        route('POST', path, 'mapbox.tilesets.sources.create', mapboxAuthorized(state, 'tilesets:write', upload)),
        route('GET', path, 'mapbox.tilesets.sources.get', mapboxAuthorized(state, 'tilesets:read', read)),
        route('DELETE', path, 'mapbox.tilesets.sources.delete', mapboxAuthorized(state, 'tilesets:write', remove)),
    ];
}
