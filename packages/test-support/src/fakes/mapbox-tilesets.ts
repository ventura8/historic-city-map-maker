import { fixtureBody, fixtureResponse } from '../api-fixtures/index.js';
import { mapboxAuthorized, type MapboxAnswer, type MapboxJob, type MapboxState } from './mapbox-state.js';
import { jsonResponse, requestObject, route, type Route, type RouteParams } from './routes.js';
import { isZoom, rasterRecipeProblem, recipeRefused, sourceRoutes } from './mapbox-sources.js';
import { sequence } from './service.js';

/**
 * The Mapbox Tilesets API v1 (MTS, the M3 publisher behind its compute-unit guard, docs/research/M3-interfaces.md §7.3)
 * and the styles list: upload a tileset source (read back, deleted), create a tileset with a recipe or replace its
 * recipe, publish it, and poll the job, which moves `queued` → `processing` → its outcome one poll at a time (the next of
 * `jobOutcomes`, else `jobOutcome`); a successful job publishes the tiles (mapbox-tiles.ts). A raster recipe must be
 * exactly `rasterRecipe` of `@hcm/shared` over an existing source of the account (UNVERIFIED shape). Every call needs a
 * secret token of the tileset's owner with the scope Mapbox asks for.
 */

/** The owner of a tileset id (`<user>.<name>`). */
function tilesetOwner(params: RouteParams): string {
    return String(params['tileset']).split('.')[0] ?? '';
}

const NEXT_STAGE: Readonly<Record<MapboxJob['stage'], MapboxJob['stage'] | 'outcome'>> = {
    queued: 'processing',
    processing: 'outcome',
    success: 'success',
    failed: 'failed',
    'failed-internal': 'failed-internal',
};

/** The fixture each stage answers (an internal failure is `failed` with another message). */
const STAGE_FIXTURES = {
    queued: 'mapbox/tilesets.job.queued',
    processing: 'mapbox/tilesets.job.processing',
    success: 'mapbox/tilesets.job.success',
    failed: 'mapbox/tilesets.job.failed',
    'failed-internal': 'mapbox/tilesets.job.failed-internal',
} as const;

type Account = Parameters<MapboxAnswer>[2];

/** The stage a listed job reports (an internal failure is `failed` too). */
const STAGE_NAMES: Readonly<Record<MapboxJob['stage'], string>> = {
    queued: 'queued',
    processing: 'processing',
    success: 'success',
    failed: 'failed',
    'failed-internal': 'failed',
};

/** A successful job publishes its tileset's tiles at the recipe's zoom range (the TileJSON and tiles answer). */
function publishTiles(owner: Account, job: MapboxJob): void {
    const tileset = owner.tilesets.get(job.tilesetId);
    if (tileset === undefined) {
        return;
    }
    const recipe = (tileset.recipe ?? {}) as { readonly minzoom?: unknown; readonly maxzoom?: unknown };
    tileset.published = {
        minzoom: isZoom(recipe.minzoom) ? recipe.minzoom : 0,
        maxzoom: isZoom(recipe.maxzoom) ? recipe.maxzoom : 22,
        jobId: job.id,
    };
}

/** A tileset's publish jobs, newest first (CR-M3-47: a publish whose answer was lost finds its job here). */
const listJobs: MapboxAnswer = (request, params, owner) => {
    const limit = Number(request.url.searchParams.get('limit') ?? 100);
    const template = (fixtureBody('mapbox/tilesets.jobs.list') as Record<string, unknown>[])[0] ?? {};
    const jobs = [...owner.jobs.values()].filter((job) => job.tilesetId === params['tileset']).reverse();
    return jsonResponse(
        jobs
            .slice(0, limit)
            .map((job) => ({ ...template, id: job.id, stage: STAGE_NAMES[job.stage], tilesetId: job.tilesetId, created: job.created })),
    );
};

/** The routes of the Tilesets API and the styles list, served by the `mapbox` fake (mapbox.ts). */
export function tilesetRoutes(state: MapboxState): readonly Route[] {
    const nextJob = sequence('cle2e00job', 16);
    const createTileset: MapboxAnswer = (request, params, owner) => {
        const id = String(params['tileset']);
        if (owner.tilesets.has(id)) {
            return fixtureResponse('mapbox/tilesets.create.exists', { values: { tilesetId: id } });
        }
        const body = requestObject(request);
        if (body['recipe'] === undefined || typeof body['name'] !== 'string') {
            return jsonResponse({ message: 'recipe and name are required' }, 400);
        }
        const problem = rasterRecipeProblem(body['recipe'], tilesetOwner(params), owner);
        if (problem !== '') {
            return recipeRefused(problem);
        }
        owner.tilesets.set(id, { id, name: body['name'], created: new Date().toISOString(), recipe: body['recipe'] });
        return fixtureResponse('mapbox/tilesets.create.ok', { values: { tilesetId: id } });
    };
    const publish: MapboxAnswer = (_request, params, owner) => {
        const id = String(params['tileset']);
        if (!owner.tilesets.has(id)) {
            return fixtureResponse('mapbox/error.not-found');
        }
        const outcome = state.jobOutcomes.shift() ?? state.jobOutcome;
        const job: MapboxJob = { id: nextJob(), tilesetId: id, stage: 'queued', outcome, created: Date.now() };
        owner.jobs.set(job.id, job);
        return fixtureResponse('mapbox/tilesets.publish.ok', { values: { tilesetId: id, jobId: job.id } });
    };
    const poll: MapboxAnswer = (_request, params, owner) => {
        const job = owner.jobs.get(String(params['job']));
        if (job === undefined || job.tilesetId !== params['tileset']) {
            return fixtureResponse('mapbox/error.not-found');
        }
        const answer = fixtureResponse(STAGE_FIXTURES[job.stage], { values: { tilesetId: job.tilesetId, jobId: job.id } });
        const next = NEXT_STAGE[job.stage];
        job.stage = next === 'outcome' ? job.outcome : next;
        if (job.stage === 'success') {
            publishTiles(owner, job);
        }
        return answer;
    };
    const updateRecipe: MapboxAnswer = (request, params, owner) => {
        const tileset = owner.tilesets.get(String(params['tileset']));
        if (tileset === undefined) {
            return fixtureResponse('mapbox/error.not-found');
        }
        const recipe = requestObject(request);
        const problem = rasterRecipeProblem(recipe, tilesetOwner(params), owner);
        if (problem !== '') {
            return recipeRefused(problem);
        }
        tileset.recipe = recipe;
        return new Response(null, { status: 204 });
    };
    const list: MapboxAnswer = (request, _params, owner) => {
        const limit = Number(request.url.searchParams.get('limit') ?? 100);
        const template = (fixtureBody('mapbox/tilesets.list.one') as Record<string, unknown>[])[0] ?? {};
        return jsonResponse(
            [...owner.tilesets.values()]
                .slice(0, limit)
                .map((tileset) => ({ ...template, id: tileset.id, name: tileset.name, created: tileset.created ?? template['created'] })),
        );
    };
    const base = 'https://api.mapbox.com/tilesets/v1';
    const byTileset = { userOf: tilesetOwner };
    return [
        ...sourceRoutes(state, base),
        route(
            'PATCH',
            `${base}/{tileset}/recipe`,
            'mapbox.tilesets.recipe.update',
            mapboxAuthorized(state, 'tilesets:write', updateRecipe, byTileset.userOf),
        ),
        route(
            'POST',
            `${base}/{tileset}/publish`,
            'mapbox.tilesets.publish',
            mapboxAuthorized(state, 'tilesets:write', publish, byTileset.userOf),
        ),
        route(
            'GET',
            `${base}/{tileset}/jobs`,
            'mapbox.tilesets.jobs.list',
            mapboxAuthorized(state, 'tilesets:read', listJobs, byTileset.userOf),
        ),
        route(
            'GET',
            `${base}/{tileset}/jobs/{job}`,
            'mapbox.tilesets.jobs.get',
            mapboxAuthorized(state, 'tilesets:read', poll, byTileset.userOf),
        ),
        route(
            'POST',
            `${base}/{tileset}`,
            'mapbox.tilesets.create',
            mapboxAuthorized(state, 'tilesets:write', createTileset, byTileset.userOf),
        ),
        route(
            'DELETE',
            `${base}/{tileset}`,
            'mapbox.tilesets.delete',
            mapboxAuthorized(
                state,
                'tilesets:write',
                (_request, params, owner) => {
                    return owner.tilesets.delete(String(params['tileset']))
                        ? new Response(null, { status: 204 })
                        : fixtureResponse('mapbox/error.not-found');
                },
                byTileset.userOf,
            ),
        ),
        route('GET', `${base}/{user}`, 'mapbox.tilesets.list', mapboxAuthorized(state, 'tilesets:list', list)),
    ];
}

/** The styles list and creation (Mapbox's Styles API v1). */
export function styleRoutes(state: MapboxState): readonly Route[] {
    const nextStyle = sequence('cle2e00style', 15);
    return [
        route(
            'GET',
            'https://api.mapbox.com/styles/v1/{user}',
            'mapbox.styles.list',
            mapboxAuthorized(state, 'styles:list', () => fixtureResponse('mapbox/styles.list.none')),
        ),
        route(
            'POST',
            'https://api.mapbox.com/styles/v1/{user}',
            'mapbox.styles.create',
            mapboxAuthorized(state, 'styles:write', (request, params) =>
                fixtureResponse('mapbox/styles.create.ok', {
                    values: { mapboxUser: String(params['user']), styleId: nextStyle() },
                    merge: requestObject(request),
                }),
            ),
        ),
    ];
}
