/**
 * One dataset's search of a harvest, page by page, inside the run's time (lesson 676). The run has three ends (`HarvestBudget`):
 * no page is asked for once `searchEnd` has passed; each page's request gets its own timeout (at most `PAGE_TIMEOUT_MS`, never past
 * `pagesEnd`, which leaves time to store what was found); and the whole run is done by `runEnd`, well inside the callable's 540 s.
 * A search that stops early (out of time, a request that took too long, a page USGS refused) keeps every record it read and says
 * where it stopped (`next`, M2M's `startingNumber`): the dataset is stored at once and the next run resumes it there.
 */
import type { ApiErrorCode, HarvestDataset, Logger, UsgsDataset } from '@hcm/shared';

import { TIMED_OUT_REASON } from '../adapters/upstream-http.js';
import { ApiError } from '../api/api-error.js';
import type { Ports } from '../ports/index.js';
import { UpstreamError } from '../ports/errors.js';
import { searchOf } from './harvest-landsat.js';
import { MAX_SCENES_PER_DATASET, withTargetYears, type SearchWindow } from './harvest-target.js';
import type { SceneRecord } from './scene-record.js';
import { usgsError } from './usgs-session.js';

type PagesDeps = Pick<Ports, 'clock' | 'scenes'> & { readonly log: Pick<Logger, 'warn'> };

const PAGE_SIZE = 100;
/** One `scene-search` request takes at most this long (M2M's full metadata of 100 records is slow on a bad day). */
export const PAGE_TIMEOUT_MS = 60_000;
/** A page whose request would get less than this is not asked for: it could not answer in time. */
const MIN_PAGE_MS = 5_000;

/** The run's ends, epoch ms. */
export interface HarvestBudget {
    /** No further page is asked for. */
    readonly searchEnd: number;
    /** Every page's request is over (its timeout ends here at the latest): what follows is storing. */
    readonly pagesEnd: number;
    /** The run is done: the writes of the tail (re-ranking, browse copies, the date plan) are skipped past it. */
    readonly runEnd: number;
}

type StopReason = NonNullable<HarvestDataset['reason']>;

/** What one search read: its records, and when it stopped early, why, where it resumes, and the error. */
interface Pages {
    readonly records: readonly SceneRecord[];
    readonly stop?: { readonly reason: StopReason; readonly next: number; readonly error?: ApiErrorCode };
}

/** One dataset's part: what it found, and its record for `ops/harvest-{city}`. */
export interface DatasetSearch {
    readonly dataset: UsgsDataset;
    readonly records: readonly SceneRecord[];
    readonly part: HarvestDataset;
}

type SearchRequest = Omit<Parameters<PagesDeps['scenes']['search']>[1], 'startingNumber' | 'timeoutMs'>;

/** The time the next page's request may take, or undefined when none may be asked for any more. */
function pageTimeout(budget: HarvestBudget, now: number): number | undefined {
    const timeoutMs = Math.min(PAGE_TIMEOUT_MS, budget.pagesEnd - now);
    return now >= budget.searchEnd || timeoutMs < MIN_PAGE_MS ? undefined : timeoutMs;
}

function timedOut(error: unknown): boolean {
    return error instanceof UpstreamError && error.reason === TIMED_OUT_REASON;
}

function codeOf(error: unknown): ApiErrorCode {
    const mapped = usgsError(error);
    return mapped instanceof ApiError ? mapped.code : 'apiError.usgs.unavailable';
}

/** One search: its request, from which record, and the run's budget. */
interface PagesSearch {
    readonly base: SearchRequest;
    readonly from: number;
    readonly budget: HarvestBudget;
}

type PageRead = { readonly records: readonly SceneRecord[]; readonly next: number | undefined } | NonNullable<Pages['stop']>;

/** One page from `next`: its records and the next page, or why the search stops there. */
async function readOnce(deps: PagesDeps, apiKey: string, search: PagesSearch, next: number): Promise<PageRead> {
    const timeoutMs = pageTimeout(search.budget, deps.clock.now().getTime());
    if (timeoutMs === undefined) {
        deps.log.warn('usgs search out of time, kept what it found', {
            dataset: search.base.dataset,
            next,
            reasonCode: 'harvest.outOfTime',
        });
        return { reason: 'outOfTime', next };
    }
    try {
        const page = await deps.scenes.search(apiKey, { ...search.base, startingNumber: next, timeoutMs });
        return { records: page.records, next: page.records.length === 0 ? undefined : page.next };
    } catch (error) {
        const reason: StopReason = timedOut(error) ? 'requestTimedOut' : 'usgsFailed';
        deps.log.warn('usgs page not read, kept what it found', {
            dataset: search.base.dataset,
            reasonCode: `harvest.${reason}`,
            timeoutMs,
        });
        return { reason, next, error: codeOf(error) };
    }
}

/** A page USGS refused for too many requests is asked again this many times, after `RATE_LIMIT_WAIT_MS` times the attempt. */
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_WAIT_MS = 5_000;

function rateLimited(read: PageRead): boolean {
    return 'reason' in read && read.error === 'apiError.rateLimited';
}

/**
 * One page from `next`, asked again after a short wait while USGS answers "too many requests" (2026-11-13: six datasets at once
 * met M2M's `RATE_LIMIT`), as long as the run has time.
 */
async function readPage(deps: PagesDeps, apiKey: string, search: PagesSearch, next: number): Promise<PageRead> {
    let read = await readOnce(deps, apiKey, search, next);
    for (let attempt = 1; attempt <= RATE_LIMIT_RETRIES && rateLimited(read) && deps.clock.sleep !== undefined; attempt += 1) {
        await deps.clock.sleep(RATE_LIMIT_WAIT_MS * attempt);
        read = await readOnce(deps, apiKey, search, next);
    }
    return read;
}

/** Every page of one search from `from` on, up to {@link MAX_SCENES_PER_DATASET} records, inside the budget. */
async function searchPages(deps: PagesDeps, apiKey: string, search: PagesSearch): Promise<Pages> {
    const records: SceneRecord[] = [];
    let next: number | undefined = search.from;
    while (next !== undefined && records.length < MAX_SCENES_PER_DATASET) {
        const read = await readPage(deps, apiKey, search, next);
        if ('reason' in read) {
            return { records, stop: read };
        }
        records.push(...read.records);
        next = read.next;
    }
    return { records: records.slice(0, MAX_SCENES_PER_DATASET) };
}

export interface DatasetRun {
    readonly cityId: string;
    readonly bounds: { readonly west: number; readonly south: number; readonly east: number; readonly north: number };
    readonly window: SearchWindow;
    readonly targetYears: readonly number[];
    readonly budget: HarvestBudget;
}

/** The part a search's end makes: done, or stopped with records (partial) or without (failed). */
function partOf(pages: Pages, found: number): HarvestDataset {
    if (pages.stop === undefined) {
        return { state: 'done', found };
    }
    const { reason, next, error } = pages.stop;
    return { state: found > 0 ? 'partial' : 'failed', found, next, reason, ...(error === undefined ? {} : { error }) };
}

/**
 * One dataset's frames from `planned.from` on: its search, and when that reached the cap, its search per target year (M8). It never
 * throws: a search that stopped early says so in its part.
 */
export async function searchDataset(
    deps: PagesDeps,
    apiKey: string,
    run: DatasetRun,
    planned: { readonly dataset: UsgsDataset; readonly from: number },
): Promise<DatasetSearch> {
    const { dataset } = planned;
    const base = (within: SearchWindow): SearchRequest => ({
        dataset,
        bounds: run.bounds,
        maxResults: PAGE_SIZE,
        ...searchOf(dataset, within),
    });
    const first = await searchPages(deps, apiKey, { base: base(run.window), from: planned.from, budget: run.budget });
    const yearPages = async (within: SearchWindow): Promise<readonly SceneRecord[]> => {
        const pages = await searchPages(deps, apiKey, { base: base(within), from: 1, budget: run.budget });
        return pages.records;
    };
    const context = { log: deps.log, cityId: run.cityId, dataset, targetYears: run.targetYears, window: run.window };
    const records = first.stop === undefined ? await withTargetYears(context, first.records, yearPages) : first.records;
    return { dataset, records, part: partOf(first, records.length) };
}
