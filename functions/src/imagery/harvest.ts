/**
 * The USGS harvest (`docs/research/M3-interfaces.md` §3.1–§3.5; S-A11-*): every frame over the city's bounds in the declassified
 * datasets (`corona2`, `declassii`, `declassiii`) and (M25, `docs/research/M25-landsat.md` §1) the three Landsat ones, in summer
 * months under a cloud cap (`harvest-landsat.ts`), 100 a page, at most 500 per dataset, each kept as a `usgsScenes/{entityId}`
 * document (`harvest-store.ts`). A dataset that fails is named in `failedDatasets` and the others are harvested; when every dataset
 * fails USGS did not answer, and the search says so (`apiError.usgs.maintenance` when every failure was maintenance, else
 * `apiError.usgs.unavailable`) instead of "nothing found". M4: every scene records EarthExplorer's id of its dataset
 * (`dataset-search`, once a run). M8: a dataset at the cap is searched again per target year (`harvest-target.ts`), and the plan of
 * whole-city dates is rewritten (`join-plan.ts`).
 *
 * Lesson 646: the datasets are searched at once. Lesson 676 (no Landsat over Bucharest: the run was all or nothing, and a run past
 * the callable's 540 s stored nothing and recorded nothing): each dataset is stored as soon as its own search ends; each USGS
 * request has its own timeout inside the run's time (`harvest-pages.ts`); the run ends by `RUN_BUDGET_MS` with a margin; the attempt
 * is recorded `running` at the start and as each dataset is stored (`harvest-state.ts`), and a dataset not searched to its end is
 * resumed where it stopped by the next run (the admin's or the tick's, `HARVEST_RESUME_MINUTES` later).
 */
import {
    EE_DATASET_ID_PATTERN,
    FIRESTORE_PATHS,
    USGS_DATASETS,
    imagerySettingsOf,
    usgsSceneDocSchema,
    type ApiErrorCode,
    type CityDoc,
    type HarvestDataset,
    type HarvestDatasets,
    type HarvestStateDoc,
    type ImagerySearchRequest,
    type ImagerySearchResponse,
    type UsgsDataset,
} from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import { compact } from '../api/objects.js';
import type { Ports } from '../ports/index.js';
import { searchDataset, type DatasetRun, type HarvestBudget } from './harvest-pages.js';
import { HarvestProgress, harvestStateOf, wasKilled } from './harvest-state.js';
import { prefetchBrowse, rerankUnseen, StoreTally, storeDataset, type RankWorld } from './harvest-store.js';
import { SEARCH_BUDGET_MS, inBatches } from './harvest-target.js';
import { rewriteDatePlan } from './join-plan.js';
import { requireCity } from './records.js';
import { requireUsgs, withUsgs } from './usgs-session.js';
import { shownYears } from './versions.js';

export type HarvestDeps = Pick<
    Ports,
    'documents' | 'clock' | 'log' | 'secrets' | 'usgs' | 'scenes' | 'setup' | 'remote' | 'blobs' | 'images'
>;

/** Every page's request is over by then (the rest of the run stores what was found). */
const PAGES_BUDGET_MS = 360_000;
/** The whole run is done by then: 2 min inside the callable's 540 s (`CALLABLE_TIMEOUT_SECONDS`) for the last writes and logout. */
const RUN_BUDGET_MS = 420_000;

/**
 * Datasets searched at once: M2M answers `RATE_LIMIT` to more concurrent requests (2026-11-13: six at once, and the dataset ids,
 * were all refused); the others wait their turn, each stored as soon as it ends.
 */
const DATASET_CONCURRENCY = 2;

/** One dataset of a run and the M2M `startingNumber` it starts from (1, or where an earlier run stopped). */
type Planned = readonly [dataset: UsgsDataset, from: number];

interface Plan {
    readonly datasets: readonly Planned[];
    /** The parts an earlier, unfinished run already finished (kept in the record, not searched again). */
    readonly carried: HarvestDatasets;
}

/** The codes a search that no dataset answered keeps as they are (each says what to do). */
const NO_ANSWER_CODES: ReadonlySet<ApiErrorCode> = new Set<ApiErrorCode>(['apiError.usgs.maintenance', 'apiError.rateLimited']);

/** The code a whole search fails with when no dataset answered: their shared code, else USGS not answering. */
function noAnswer(codes: readonly ApiErrorCode[]): ApiError {
    const unique = new Set(codes);
    const [only] = unique;
    return new ApiError(unique.size === 1 && only !== undefined && NO_ANSWER_CODES.has(only) ? only : 'apiError.usgs.unavailable');
}

/** A request for the whole harvest (no datasets or window of its own): the one an unfinished run's resumption may serve. */
function wholeHarvest(request: ImagerySearchRequest): boolean {
    return request.datasets === undefined && request.from === undefined && request.to === undefined;
}

/** True when this run may resume the attempt before it: a whole harvest after a `partial` run, or one the server stopped. */
function resumes(request: ImagerySearchRequest, previous: HarvestStateDoc | undefined, killed: boolean): boolean {
    return (previous?.outcome === 'partial' || killed) && wholeHarvest(request);
}

/** The parts of the attempt before this run when it resumes it; none otherwise. */
function resumableParts(
    request: ImagerySearchRequest,
    previous: HarvestStateDoc | undefined,
    killed: boolean,
): [UsgsDataset, HarvestDataset][] {
    return resumes(request, previous, killed) ? (Object.entries(previous?.datasets ?? {}) as [UsgsDataset, HarvestDataset][]) : [];
}

/**
 * What this run searches: after an unfinished run, only its datasets not finished, each from where it stopped; else every requested
 * dataset from the start.
 */
function planOf(request: ImagerySearchRequest, previous: HarvestStateDoc | undefined, killed: boolean): Plan {
    const parts = resumableParts(request, previous, killed);
    const unfinished = parts.filter(([, part]) => part.state !== 'done');
    if (unfinished.length === 0) {
        return { datasets: (request.datasets ?? USGS_DATASETS).map((dataset): Planned => [dataset, 1]), carried: {} };
    }
    return {
        datasets: unfinished.map(([dataset, part]): Planned => [dataset, part.next ?? 1]),
        carried: Object.fromEntries(parts.filter(([, part]) => part.state === 'done')),
    };
}

/**
 * M4 (`docs/research/M4-interfaces.md` §1.6): EarthExplorer's id of each declassified dataset (`dataset-search`), kept
 * when it has the id's shape; a failure only leaves them unknown (the card then names the entity id to search for).
 */
async function earthExplorerIds(deps: HarvestDeps, apiKey: string): Promise<ReadonlyMap<string, string>> {
    try {
        const datasets = await deps.scenes.datasets(apiKey);
        return new Map(datasets.filter((each) => EE_DATASET_ID_PATTERN.test(each.datasetId)).map((each) => [each.alias, each.datasetId]));
    } catch (error) {
        deps.log.warn('usgs dataset ids not read', { error: String(error) });
        return new Map();
    }
}

interface Run extends DatasetRun {
    readonly world: Omit<RankWorld, 'eeIds'>;
    readonly tally: StoreTally;
    readonly progress: HarvestProgress;
}

/** The USGS session of a run: its key, and EarthExplorer's dataset ids once read. */
interface Session {
    readonly apiKey: string;
    readonly eeIds: Promise<ReadonlyMap<string, string>>;
}

/** One dataset searched and stored at once, its part recorded; returns its part. */
async function harvestDataset(deps: HarvestDeps, session: Session, planned: Planned, run: Run): Promise<HarvestDataset> {
    const [dataset, from] = planned;
    // Not awaited: the search starts at once; the record's writes stay in order (`HarvestProgress`).
    void recordPart(deps, run, dataset, partOf('searching', from));
    const search = await searchDataset(deps, session.apiKey, run, { dataset, from });
    const world: RankWorld = { ...run.world, eeIds: await session.eeIds };
    const stored = await storeDataset(deps, { cityId: run.cityId, world, tally: run.tally }, search);
    const part: HarvestDataset = { ...search.part, found: stored };
    deps.log.info('usgs dataset stored', { cityId: run.cityId, dataset, ...part, reasonCode: `harvest.${part.reason ?? 'done'}` });
    await recordPart(deps, run, dataset, part);
    return part;
}

/** A dataset's part from where it starts: `queued` until its turn (lesson 728), then `searching`. */
function partOf(state: 'queued' | 'searching', from: number): HarvestDataset {
    return { state, found: 0, ...(from > 1 ? { next: from } : {}) };
}

/** Writes one dataset's part (`running`); a failed write only leaves the record behind. */
async function recordPart(deps: HarvestDeps, run: Run, dataset: UsgsDataset, part: HarvestDataset): Promise<void> {
    await run.progress.running({ [dataset]: part }).catch((error: unknown) => {
        deps.log.warn('harvest progress not recorded', { cityId: run.cityId, dataset, error: String(error) });
    });
}

/**
 * Lesson 728: a tail step that started in time may still run past the callable's 540 s (the browse copies, one at a time), and the
 * server then stopped the run before its outcome was written: the admin's Search read "Searching…" to its own timeout. The run
 * waits for a step only until `runEnd`; what is left the next run does.
 */
async function withinRun(work: Promise<void>, deps: HarvestDeps, run: Run): Promise<'done' | 'outOfTime'> {
    const left = run.budget.runEnd - deps.clock.now().getTime();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<'outOfTime'>((resolve) => {
        timer = setTimeout(() => {
            resolve('outOfTime');
        }, left);
    });
    try {
        return await Promise.race([work.then(() => 'done' as const), late]);
    } finally {
        clearTimeout(timer);
    }
}

/** Re-ranking, browse copies and the date plan, each only while the run has time (else the next run does them). */
async function tail(deps: HarvestDeps, run: Run, world: RankWorld): Promise<void> {
    const steps: readonly (readonly [string, () => Promise<void>])[] = [
        ['rerank', () => rerankUnseen(deps, run.cityId, world, run.tally)],
        ['browse', () => prefetchBrowse(deps, run.cityId, run.tally)],
        ['datePlan', () => rewriteDatePlan(deps, run.cityId)],
    ];
    for (const [step, work] of steps) {
        if (deps.clock.now().getTime() >= run.budget.runEnd) {
            deps.log.warn('harvest step skipped, out of time', { cityId: run.cityId, step, reasonCode: 'harvest.tailSkipped' });
            continue;
        }
        const ran = work().catch((error: unknown) => {
            deps.log.warn('harvest step failed, the scenes are stored', { cityId: run.cityId, step, error: String(error) });
        });
        if ((await withinRun(ran, deps, run)) === 'outOfTime') {
            deps.log.warn('harvest step cut short, out of time', { cityId: run.cityId, step, reasonCode: 'harvest.tailCut' });
        }
    }
}

/** Throws when every dataset of the run failed with USGS's own refusal (nothing stored: USGS did not answer). */
function refuseNoAnswer(parts: readonly HarvestDataset[]): void {
    const refused = parts.filter((part) => part.state === 'failed' && part.reason === 'usgsFailed');
    if (parts.length > 0 && refused.length === parts.length) {
        throw noAnswer(refused.map((part) => part.error ?? 'apiError.usgs.unavailable'));
    }
}

async function runOf(deps: HarvestDeps, request: ImagerySearchRequest, city: CityDoc, progress: HarvestProgress): Promise<Run> {
    const start = deps.clock.now().getTime();
    const budget: HarvestBudget = { searchEnd: start + SEARCH_BUDGET_MS, pagesEnd: start + PAGES_BUDGET_MS, runEnd: start + RUN_BUDGET_MS };
    const { targetYears } = imagerySettingsOf(city.imagery);
    const existing = await deps.documents.query(FIRESTORE_PATHS.usgsScenes(request.cityId), usgsSceneDocSchema);
    const known = new Map(existing.documents.map((scene) => [scene.id, scene.data]));
    const shown = await shownYears(deps.documents, request.cityId);
    const window = compact<{ from?: string; to?: string }>({ from: request.from, to: request.to });
    return {
        cityId: request.cityId,
        bounds: city.bounds,
        window,
        targetYears,
        budget,
        world: { targetYears, shown, bounds: city.bounds, known },
        tally: new StoreTally(),
        progress,
    };
}

async function harvestIn(deps: HarvestDeps, request: ImagerySearchRequest, run: Run, plan: Plan): Promise<ImagerySearchResponse> {
    const searchedAt = deps.clock.now();
    const { parts, eeIds } = await withUsgs(deps, async (apiKey) => {
        const session: Session = { apiKey, eeIds: Promise.resolve(await earthExplorerIds(deps, apiKey)) };
        const searched: HarvestDataset[] = [];
        await inBatches(plan.datasets, DATASET_CONCURRENCY, async (planned) => {
            searched[plan.datasets.indexOf(planned)] = await harvestDataset(deps, session, planned, run);
        });
        return { parts: searched, eeIds: await session.eeIds };
    });
    refuseNoAnswer(parts);
    await tail(deps, run, { ...run.world, eeIds });
    const found = parts.reduce((sum, part) => sum + part.found, 0);
    const failedDatasets = plan.datasets.filter((_planned, index) => parts[index]?.state === 'failed').map(([dataset]) => dataset);
    deps.log.info('usgs harvest finished', { cityId: request.cityId, found, added: run.tally.added, failedDatasets });
    return {
        found,
        added: run.tally.added,
        updated: run.tally.updated,
        failedDatasets,
        searchedAt: searchedAt.toISOString(),
        datasets: run.progress.datasets,
    };
}

/** The outcome of a run that answered: `partial` while a dataset is not finished, else scenes found or none. */
function outcomeOf(response: ImagerySearchResponse): HarvestStateDoc['outcome'] {
    if (Object.values(response.datasets ?? {}).some((part) => part.state !== 'done')) {
        return 'partial';
    }
    return response.found > 0 ? 'ok' : 'empty';
}

/** The attempt before this run; one the server stopped is logged and counted as unfinished. */
async function previousOf(deps: HarvestDeps, cityId: string, now: Date) {
    const previous = await harvestStateOf(deps, cityId);
    const killed = wasKilled(previous, now);
    if (previous === undefined || !killed) {
        return { previous, killed };
    }
    deps.log.error('usgs harvest was stopped before it finished', { cityId, reasonCode: 'harvest.killed', datasets: previous.datasets });
    return { previous: { ...previous, failures: previous.failures + 1 }, killed };
}

/** Every planned dataset `queued` (from where it resumes), beside the parts an earlier run finished. */
function startingParts(plan: Plan): HarvestDatasets {
    const queued = plan.datasets.map(([dataset, from]) => [dataset, partOf('queued', from)]);
    return { ...plan.carried, ...(Object.fromEntries(queued) as HarvestDatasets) };
}

/** Harvests the city (`imagery.search`, and `imagery.tick` once a month), the attempt recorded whatever happened. */
export async function harvestCity(deps: HarvestDeps, request: ImagerySearchRequest): Promise<ImagerySearchResponse> {
    const city = await requireCity(deps.documents, request.cityId);
    await requireUsgs(deps.setup);
    const at = deps.clock.now();
    const { previous, killed } = await previousOf(deps, request.cityId, at);
    const plan = planOf(request, previous, killed);
    const progress = new HarvestProgress(deps, request.cityId, { at, previous });
    await progress.running(startingParts(plan));
    try {
        const response = await harvestIn(deps, request, await runOf(deps, request, city, progress), plan);
        await progress.finish(outcomeOf(response));
        return response;
    } catch (error) {
        await progress.finish('failed', error instanceof ApiError ? error.code : 'apiError.internal');
        throw error;
    }
}
