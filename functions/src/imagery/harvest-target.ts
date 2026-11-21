/**
 * A dataset that reaches the harvest's cap (`docs/research/M8-join-interfaces.md` §1) was truncated silently: USGS answers in
 * its own order, so a targeted date could be past the 500th record. Such a dataset is named in the log and searched once more per
 * target year, inside the request's window, so a targeted date cannot be lost to the cap. A year's search that fails costs only
 * that year: what the first search found stays.
 */
import type { Logger, UsgsDataset } from '@hcm/shared';

import type { SceneRecord } from './scene-record.js';

/** At most this many records from one search of one dataset. */
export const MAX_SCENES_PER_DATASET = 500;
/**
 * How long a harvest asks USGS for pages (lessons 646 and 676): what is found by then is stored, and the callable answers well inside
 * its timeout (`CALLABLE_TIMEOUT_SECONDS` of `functions/src/api/callable.ts`, 540 s): the page asked last ends by `PAGES_BUDGET_MS`
 * and the run by `RUN_BUDGET_MS` (`harvest.ts`). A target year not searched in time waits for the next harvest.
 */
export const SEARCH_BUDGET_MS = 300_000;
/** Target years searched at once. */
const YEAR_CONCURRENCY = 2;

/** `work` over `items`, `size` at a time, in order. */
export async function inBatches<T>(items: readonly T[], size: number, work: (item: T) => Promise<unknown>): Promise<void> {
    for (let start = 0; start < items.length; start += size) {
        await Promise.all(items.slice(start, start + size).map(work));
    }
}

export interface SearchWindow {
    readonly from?: string;
    readonly to?: string;
}

export interface TargetSearch {
    readonly log: Pick<Logger, 'warn'>;
    readonly cityId: string;
    readonly dataset: UsgsDataset;
    readonly targetYears: readonly number[];
    /** The request's own window. */
    readonly window: SearchWindow;
}

/** The later of two ISO dates, an absent one open. */
function later(left: string, right: string | undefined): string {
    return right !== undefined && right > left ? right : left;
}

/** The earlier of two ISO dates, an absent one open. */
function earlier(left: string, right: string | undefined): string {
    return right !== undefined && right < left ? right : left;
}

/** The target year inside the request's window, or undefined when it lies outside. */
function yearWindow(year: number, window: SearchWindow): Required<SearchWindow> | undefined {
    const from = later(`${String(year)}-01-01`, window.from);
    const to = earlier(`${String(year)}-12-31`, window.to);
    return from <= to ? { from, to } : undefined;
}

/** The windows of the target years. */
function windowsOf({ targetYears, window }: TargetSearch): Required<SearchWindow>[] {
    return targetYears.flatMap((year) => yearWindow(year, window) ?? []);
}

/** One more search of one year; a failure is logged and finds nothing. */
async function yearRecords(
    context: TargetSearch,
    window: Required<SearchWindow>,
    search: (window: SearchWindow) => Promise<readonly SceneRecord[]>,
): Promise<readonly SceneRecord[]> {
    try {
        return await search(window);
    } catch (error) {
        context.log.warn('usgs target year not searched', {
            cityId: context.cityId,
            dataset: context.dataset,
            ...window,
            error: String(error),
        });
        return [];
    }
}

/** `records` when under the cap; at the cap, also what one search per target year finds, each record once. */
export async function withTargetYears(
    context: TargetSearch,
    records: readonly SceneRecord[],
    search: (window: SearchWindow) => Promise<readonly SceneRecord[]>,
): Promise<readonly SceneRecord[]> {
    if (records.length < MAX_SCENES_PER_DATASET) {
        return records;
    }
    context.log.warn('usgs dataset reached the harvest cap', {
        cityId: context.cityId,
        dataset: context.dataset,
        cap: MAX_SCENES_PER_DATASET,
    });
    const byEntity = new Map(records.map((record) => [record.entityId, record]));
    const windows = windowsOf(context);
    const years: (readonly SceneRecord[])[] = [];
    await inBatches(windows, YEAR_CONCURRENCY, async (window) => {
        years[windows.indexOf(window)] = await yearRecords(context, window, search);
    });
    for (const record of years.flat()) {
        byEntity.set(record.entityId, record);
    }
    return [...byEntity.values()];
}
