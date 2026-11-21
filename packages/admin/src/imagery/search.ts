/**
 * The USGS search as the Imagery area runs it (`docs/research/M3-interfaces.md` §3.1, §3.5): the first time the area
 * opens for a city whose newest harvest is older than `HARVEST_EVERY_DAYS` (or missing), and USGS can search (`ok`, or
 * `pending` while USGS has not approved downloads yet), `imagery.search` runs once by itself; the admin can search again
 * any time. Its answer says how many scenes it found and which datasets did not answer; the scenes themselves arrive
 * through the area's live list.
 */
import {
    FIRESTORE_PATHS,
    HARVEST_EVERY_DAYS,
    harvestStateDocSchema,
    type HarvestDataset,
    type HarvestDatasets,
    type ServiceState,
    type UsgsDataset,
} from '@hcm/shared';

import type { ContentServices } from '../content/services.js';
import type { NoticeInput } from '../state/state.js';
import { callImagery, refusalOf } from './api.js';
import { IMAGERY_SEARCH_TIMEOUT_MS } from './search-timeout.js';
import { harvestIsStale } from './model.js';

type SearchPhase = 'idle' | 'searching' | 'done' | 'failed';

export interface SearchState {
    readonly phase: SearchPhase;
    readonly found: number | null;
    readonly added: number | null;
    /** Datasets M2M did not answer for (the others were harvested). */
    readonly failedDatasets: readonly UsgsDataset[];
    readonly error: NoticeInput | null;
    /** Lesson 676: each dataset's part, live from `ops/harvest-{city}` while searching, then the answer's (absent before). */
    readonly datasets?: readonly SearchPart[];
    /** Lesson 728: the seconds the running search has taken so far (the page says it beside the usual length); absent before. */
    readonly elapsedS?: number;
}

/** Lesson 728: how often the running search's elapsed time is said again. */
const ELAPSED_TICK_MS = 15_000;

export interface SearchPart {
    readonly dataset: UsgsDataset;
    readonly state: HarvestDataset['state'];
    readonly found: number;
    readonly reason?: NonNullable<HarvestDataset['reason']>;
}

/** The record's parts as a list, in the record's order; undefined for none. */
export function partsOf(datasets: HarvestDatasets | undefined): readonly SearchPart[] | undefined {
    const entries = Object.entries(datasets ?? {}) as [UsgsDataset, HarvestDataset][];
    return entries.length === 0
        ? undefined
        : entries.map(([dataset, part]) => ({
              dataset,
              state: part.state,
              found: part.found,
              ...(part.reason === undefined ? {} : { reason: part.reason }),
          }));
}

export const IDLE_SEARCH: SearchState = { phase: 'idle', found: null, added: null, failedDatasets: [], error: null };

const SEARCH_OPTIONS = { timeoutMs: IMAGERY_SEARCH_TIMEOUT_MS } as const;

/**
 * A search that failed with no reason of the server's after this long was cut off by the server's timeout (lesson 646: the
 * browser read only "Something went wrong on the server"); it says so, and what to do next.
 */
export const SEARCH_CUT_OFF_MS = 300_000;
/** The server's failures that carry no reason of their own: a cut-off request, a crash. */
const NO_REASON: ReadonlySet<string> = new Set(['apiError.internal', 'apiError.unavailable']);

/** The notice of a failed search: the server's own reason, else whether it was cut off after `elapsedMs` or failed at once. */
export function searchRefusalOf(error: unknown, elapsedMs: number): NoticeInput {
    const refusal = refusalOf(error);
    if (!NO_REASON.has(refusal.key)) {
        return refusal;
    }
    if (elapsedMs >= SEARCH_CUT_OFF_MS) {
        return { key: 'adminContent.imagery.searchTimedOut', params: { minutes: String(Math.round(elapsedMs / 60_000)) } };
    }
    return { key: 'adminContent.imagery.searchFailed' };
}

/** USGS states in which a search may run (downloads need `ok`). */
const CAN_SEARCH: readonly ServiceState[] = ['ok', 'pending'];

export function usgsCanSearch(usgs: ServiceState | null): boolean {
    return usgs !== null && CAN_SEARCH.includes(usgs);
}

export class HarvestSearch {
    readonly #services: ContentServices;
    readonly #changed: (state: SearchState) => void;
    #state: SearchState = IDLE_SEARCH;
    /** The automatic search ran (or was not needed): it runs at most once a session (the store lives until sign-out). */
    #decided = false;

    constructor(services: ContentServices, changed: (state: SearchState) => void) {
        this.#services = services;
        this.#changed = changed;
    }

    get state(): SearchState {
        return this.#state;
    }

    /**
     * What the area knows: USGS's state (null while reading) and the newest harvest (undefined while reading, null for
     * none). Once both are read, a stale harvest starts the one automatic search.
     */
    known(usgs: ServiceState | null, newest: string | null | undefined): void {
        if (this.#decided || usgs === null || newest === undefined) {
            return;
        }
        this.#decided = true;
        if (this.#wanted(usgs, newest)) {
            void this.search();
        }
    }

    /** USGS can search and the newest harvest is stale. */
    #wanted(usgs: ServiceState, newest: string | null): boolean {
        return usgsCanSearch(usgs) && harvestIsStale(newest, this.#services.clock.now(), HARVEST_EVERY_DAYS);
    }

    async search(): Promise<void> {
        if (this.#state.phase === 'searching') {
            return;
        }
        this.#set({ ...IDLE_SEARCH, phase: 'searching' });
        const started = this.#services.clock.now();
        const stop = this.#watchParts();
        const ticker = setInterval(() => {
            this.#tick(started);
        }, ELAPSED_TICK_MS);
        try {
            const answer = await callImagery(this.#services.callables, 'imagery.search', { cityId: this.#services.cityId }, SEARCH_OPTIONS);
            const datasets = partsOf(answer.datasets);
            const done = {
                phase: 'done',
                found: answer.found,
                added: answer.added,
                failedDatasets: answer.failedDatasets,
                error: null,
            } as const;
            this.#set(datasets === undefined ? done : { ...done, datasets });
        } catch (error) {
            this.#set({ ...IDLE_SEARCH, phase: 'failed', error: searchRefusalOf(error, this.#services.clock.now() - started) });
        } finally {
            clearInterval(ticker);
            stop();
        }
    }

    /** The running search's elapsed seconds, said again (`ELAPSED_TICK_MS`). */
    #tick(started: number): void {
        if (this.#state.phase === 'searching') {
            this.#set({ ...this.#state, elapsedS: Math.round((this.#services.clock.now() - started) / 1000) });
        }
    }

    /** Each dataset's part as the harvest records it, while the search runs (a failed read only leaves the line without them). */
    #watchParts(): () => void {
        return this.#services.store.watchDoc(
            FIRESTORE_PATHS.harvestState(this.#services.cityId),
            harvestStateDocSchema,
            (stored) => {
                const datasets = stored?.data.outcome === 'running' ? partsOf(stored.data.datasets) : undefined;
                if (this.#state.phase === 'searching' && datasets !== undefined) {
                    this.#set({ ...this.#state, datasets });
                }
            },
            () => undefined,
        );
    }

    #set(state: SearchState): void {
        this.#state = state;
        this.#changed(state);
    }
}
