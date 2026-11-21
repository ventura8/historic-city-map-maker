/**
 * The crash reports area (`docs/research/M2c-interfaces.md` §9.4; behaviour A22): the Error Reporting groups of a
 * period (24 hours, 7 days, 30 days) through `telemetry.listGroups`, More for the next page, and the selected group's
 * detail (count, first and last seen, the redacted message as text, the release and service). A disabled Error
 * Reporting API answers `apiError.cloud.apiDisabled`, which the page explains with the way to enable it (Setup's
 * analytics card). The selected group is page state: Error Reporting's group ids are never routed.
 */
import type { ListGroupsRequest, ListGroupsResponse } from '@hcm/shared';

import { outcomeOf } from '../app/services.js';
import type { AreaModule, AreaStore } from '../content/areas.js';
import type { LoadStatus } from '../content/list.js';
import type { ContentServices } from '../content/services.js';
import type { NoticeInput } from '../state/state.js';
import { Store } from '../state/store.js';
import { createStatistics, STATISTICS_INITIAL, type StatisticsDays, type StatisticsState } from './statistics.js';

/** The periods Error Reporting is asked about, in hours. */
type CrashPeriod = 24 | 168 | 720;

type CrashGroup = ListGroupsResponse['groups'][number];

/** Groups per page. */
export const CRASH_PAGE_SIZE = 20;

export interface CrashesState {
    readonly period: CrashPeriod;
    readonly status: LoadStatus;
    readonly groups: readonly CrashGroup[];
    readonly nextPageToken: string | null;
    readonly loadingMore: boolean;
    readonly failure: NoticeInput | null;
    /** The failure is a disabled Error Reporting API: the page links to Setup's analytics card, which enables it. */
    readonly apiDisabled: boolean;
    readonly selected: string | null;
    /** §203: the Statistics view's numbers from Google Analytics (`./statistics.ts`). */
    readonly statistics: StatisticsState;
}

export interface CrashesIntents {
    setPeriod(period: CrashPeriod): void;
    more(): Promise<void>;
    retry(): void;
    select(groupId: string | null): void;
    /** §203: **Show the numbers here** (Google's consent window, then the numbers). */
    showNumbers(): void;
    /** §203: the Statistics view's period; the error groups follow it (Error Reporting keeps 30 days at most). */
    setStatisticsDays(days: StatisticsDays): void;
    refreshStatistics(): void;
}

/** The error groups' period for a Statistics period: a week, else Error Reporting's longest, 30 days. */
function periodOfDays(days: StatisticsDays): CrashPeriod {
    return days === 7 ? 168 : 720;
}

const INITIAL: CrashesState = {
    period: 168,
    status: 'loading',
    groups: [],
    nextPageToken: null,
    loadingMore: false,
    failure: null,
    apiDisabled: false,
    selected: null,
    statistics: STATISTICS_INITIAL,
};

function pageRequest(hours: CrashPeriod, pageToken: string | null): ListGroupsRequest {
    return pageToken === null ? { hours, pageSize: CRASH_PAGE_SIZE } : { hours, pageSize: CRASH_PAGE_SIZE, pageToken };
}

/** A page answered: the first replaces the groups, More appends. */
function loaded(state: CrashesState, page: ListGroupsResponse, more: boolean): Partial<CrashesState> {
    const groups = more ? [...state.groups, ...page.groups] : page.groups;
    return { status: 'ready', loadingMore: false, groups, nextPageToken: page.nextPageToken ?? null };
}

function failed(failure: NoticeInput): Partial<CrashesState> {
    return { status: 'error', loadingMore: false, failure, apiDisabled: failure.key === 'apiError.cloud.apiDisabled' };
}

class CrashesStore implements AreaStore<CrashesState, CrashesIntents> {
    readonly #services: ContentServices;
    readonly #cell: Store<CrashesState>;
    /** Each request's number: an older answer never replaces a newer one (a period switched mid-request). */
    #request = 0;
    #opened = false;
    readonly intents: CrashesIntents;

    constructor(services: ContentServices) {
        this.#services = services;
        this.#cell = new Store<CrashesState>(INITIAL, services.log);
        const statistics = createStatistics(
            services.statistics,
            () => this.#cell.state.statistics,
            (patch) => {
                this.#cell.update({ statistics: { ...this.#cell.state.statistics, ...patch } });
            },
        );
        const setPeriod = (period: CrashPeriod): void => {
            this.#cell.update({ period, selected: null });
            void this.#load(null);
        };
        this.intents = {
            setPeriod,
            showNumbers: () => {
                statistics.showNumbers();
            },
            setStatisticsDays: (days) => {
                statistics.setDays(days);
                if (periodOfDays(days) !== this.#cell.state.period) {
                    setPeriod(periodOfDays(days));
                }
            },
            refreshStatistics: () => {
                statistics.refresh();
                void this.#load(null);
            },
            more: () => this.#more(),
            retry: () => {
                void this.#load(null);
            },
            select: (selected) => {
                this.#cell.update({ selected });
            },
        };
    }

    get state(): CrashesState {
        return this.#cell.state;
    }

    subscribe(listener: (state: CrashesState) => void): () => void {
        return this.#cell.subscribe(listener);
    }

    open(): void {
        if (!this.#opened) {
            this.#opened = true;
            void this.#load(null);
        }
    }

    close(): void {
        this.#opened = false;
    }

    hasUnsavedChanges(): boolean {
        return false;
    }

    destroy(): void {
        this.close();
        this.#request += 1;
        this.#cell.update(INITIAL);
    }

    async #more(): Promise<void> {
        const token = this.#cell.state.nextPageToken;
        if (token !== null && !this.#cell.state.loadingMore) {
            await this.#load(token);
        }
    }

    async #load(pageToken: string | null): Promise<void> {
        this.#request += 1;
        const request = this.#request;
        this.#cell.update(pageToken === null ? { status: 'loading', failure: null, apiDisabled: false } : { loadingMore: true });
        const page = pageRequest(this.#cell.state.period, pageToken);
        const outcome = await outcomeOf(() => this.#services.callables.call('telemetry.listGroups', page));
        if (request === this.#request) {
            this.#cell.update(outcome.ok ? loaded(this.#cell.state, outcome.value, pageToken !== null) : failed(outcome.error));
        }
    }
}

export const CRASHES_MODULE: AreaModule<CrashesState, CrashesIntents> = {
    area: 'crashes',
    create: (services) => new CrashesStore(services),
};
