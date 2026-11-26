/**
 * The crash reports area as its page reads it (`docs/research/M2c-interfaces.md` §9.4), mirroring
 * `packages/admin/src/crashes/crashes.ts` (checked at compile time by `packages/admin/test/app/admin-port.test.ts`).
 */
import type { ListGroupsResponse } from '@hcm/shared';

import type { AdminNoticeInputPort } from '../notice-port.js';
import type { LoadStatusPort } from '../area-port.js';

export type CrashPeriodPort = 24 | 168 | 720;

export type CrashGroupPort = ListGroupsResponse['groups'][number];

/** §203: the Statistics view's periods, in days. */
export type StatisticsDaysPort = 7 | 28 | 90;

/** §203: why the numbers could not be shown (`packages/admin/src/crashes/statistics.ts`). */
export type StatisticsProblemPort =
    | 'consent'
    | 'popupBlocked'
    | 'wrongAccount'
    | 'apiDisabled'
    | 'noProperty'
    | 'noAccess'
    | 'refused'
    | 'notSetUp'
    | 'unavailable'
    | 'blocked'
    | 'server';

export interface NamedCountPort {
    readonly name: string;
    readonly count: number;
}

export interface StepNumbersPort {
    readonly wizard: string;
    readonly step: string;
    readonly visitors: number;
    readonly averageMs: number | null;
    readonly errors: readonly NamedCountPort[];
}

export interface DayNumbersPort {
    readonly date: string;
    readonly visitors: number;
    readonly sessions: number;
}

export interface SurfaceNumbersPort {
    readonly surface: string;
    readonly visitors: number;
    readonly sessions: number;
    readonly daily: readonly DayNumbersPort[];
}

/** Why the apps, the admin screens or the wizards' steps are incomplete (`packages/admin/src/google/analytics-fields.ts`). */
export interface StatisticsPendingPort {
    readonly reason: 'notRegistered' | 'notReady' | 'noData';
    readonly names: readonly string[];
}

export interface StatisticsNumbersPort {
    readonly visitors: number;
    readonly sessions: number;
    readonly pages: readonly NamedCountPort[];
    readonly screens: readonly NamedCountPort[];
    readonly events: readonly NamedCountPort[];
    readonly devices: readonly NamedCountPort[];
    readonly countries: readonly NamedCountPort[];
    readonly surfaces: readonly SurfaceNumbersPort[];
    readonly steps: readonly StepNumbersPort[];
    readonly pending: StatisticsPendingPort | null;
}

export interface StatisticsViewState {
    readonly days: StatisticsDaysPort;
    readonly status: 'idle' | 'loading' | 'ready' | 'error';
    readonly problem: StatisticsProblemPort | null;
    readonly notice: AdminNoticeInputPort | null;
    readonly numbers: StatisticsNumbersPort | null;
}

export interface CrashesViewState {
    readonly period: CrashPeriodPort;
    readonly status: LoadStatusPort;
    readonly groups: readonly CrashGroupPort[];
    readonly nextPageToken: string | null;
    readonly loadingMore: boolean;
    readonly failure: AdminNoticeInputPort | null;
    readonly apiDisabled: boolean;
    readonly selected: string | null;
    readonly statistics: StatisticsViewState;
}

export interface CrashesIntentsPort {
    setPeriod(period: CrashPeriodPort): void;
    more(): Promise<void>;
    retry(): void;
    select(groupId: string | null): void;
    showNumbers(): void;
    setStatisticsDays(days: StatisticsDaysPort): void;
    refreshStatistics(): void;
}
