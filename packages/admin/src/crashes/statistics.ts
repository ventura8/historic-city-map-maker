/**
 * The Statistics view's numbers (`#/crashes/statistics`, `DECISIONS-for-review.md` §203): **Show the numbers here** asks
 * Google once for the owner's read-only Analytics permission (incremental consent through the admin's Google sign-in, the
 * token kept in memory only, `../auth/google-access.ts`), then reads the GA4 Data API from this browser
 * (`../google/analytics-data.ts`) for 7, 28 or 90 days. Each period's answer is kept for this session (in memory only):
 * switching back costs no call, Refresh asks again, and nothing is read before a click or on a timer. Every failure is one
 * plain problem the page explains with its fix (`StatisticsProblem` of the page's port).
 */
import type { NoticeInput } from '../state/state.js';
import { GoogleApiError } from '../google/failure.js';
import type { StatisticsDays, StatisticsNumbers } from '../google/analytics-data.js';
import { CallableFailure } from '../firebase/ports.js';

export type { StatisticsDays } from '../google/analytics-data.js';

/** What went wrong, as the page explains it (each with its own words, fix and link). */
type StatisticsProblemKind =
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

export interface StatisticsState {
    readonly days: StatisticsDays;
    readonly status: 'idle' | 'loading' | 'ready' | 'error';
    readonly problem: StatisticsProblemKind | null;
    /** The server's own message (`server`: `setup.analyticsConfig` refused or failed). */
    readonly notice: NoticeInput | null;
    readonly numbers: StatisticsNumbers | null;
}

export const STATISTICS_INITIAL: StatisticsState = { days: 28, status: 'idle', problem: null, notice: null, numbers: null };

/** A Google token as the source hands it (memory only). */
export interface StatisticsToken {
    readonly token: string;
    readonly expiresAt: number;
}

export type StatisticsConsent =
    | { readonly granted: true; readonly access: StatisticsToken }
    | { readonly granted: false; readonly failure: 'popupBlocked' | 'popupClosed' | 'scopeDenied' | 'wrongAccount' | 'network' | 'failed' };

/** Where the numbers come from (`../app/statistics-wiring.ts` builds the real one). */
export interface StatisticsSource {
    /** Google's consent window for the read-only Analytics scope: the first await of a click. */
    ask(): Promise<StatisticsConsent>;
    /** The live read-only token with a few minutes left, or null. */
    live(): StatisticsToken | null;
    /** The project's GA4 measurement id (`setup.analyticsConfig`), or null when Google Analytics is not set up. */
    measurementId(): Promise<string | null>;
    read(access: StatisticsToken, measurementId: string, days: StatisticsDays): Promise<StatisticsNumbers>;
    /**
     * Logs and measures why the numbers are missing or incomplete, as one reason code (`statistics_refused`,
     * `statistics_notReady` …): a `ui_error` with the code, never Google's words.
     */
    report?(code: string): void;
    /** The last numbers read this session and their period (Home's Visitors card), or null before any. */
    latest?(): { readonly days: StatisticsDays; readonly numbers: StatisticsNumbers } | null;
}

const CONSENT_PROBLEMS: Readonly<Record<Exclude<StatisticsConsent, { granted: true }>['failure'], StatisticsProblemKind>> = {
    popupBlocked: 'popupBlocked',
    popupClosed: 'consent',
    scopeDenied: 'consent',
    wrongAccount: 'wrongAccount',
    network: 'unavailable',
    failed: 'unavailable',
};

const NOT_SET_UP: ReadonlySet<string> = new Set(['apiError.analytics.notEnabled', 'apiError.analytics.noWebApp']);

/** Google's failures that name one problem by their kind alone. */
const GOOGLE_PROBLEMS: Readonly<Partial<Record<GoogleApiError['kind'], StatisticsProblemKind>>> = {
    unauthorized: 'consent',
    notFound: 'noProperty',
    // Any other 400: the names are checked against the property's metadata first, so this is a request GA4 refuses.
    invalid: 'refused',
};

/** A refused Google call as the page's problem: a 403 names the disabled API or the missing access. */
function googleProblem({ failure }: GoogleApiError): StatisticsProblemKind {
    if (failure.kind === 'forbidden') {
        return failure.api === undefined ? 'noAccess' : 'apiDisabled';
    }
    return GOOGLE_PROBLEMS[failure.kind] ?? (failure.host === undefined ? 'unavailable' : 'blocked');
}

/** The server's refusal: Google Analytics not set up, or its own message. */
function callableProblem({ details }: CallableFailure): Pick<StatisticsState, 'problem' | 'notice'> {
    const { code, params } = details;
    if (NOT_SET_UP.has(code)) {
        return { problem: 'notSetUp', notice: null };
    }
    return { problem: 'server', notice: params === undefined ? { key: code } : { key: code, params } };
}

/**
 * A `StatisticsProblem` of the lazy `analytics-data` chunk (`../google/statistics-problem.ts`), told by its name so this
 * chunk never imports that module.
 */
function isStatisticsProblem(error: unknown): error is Error & { readonly problem: 'noAccess' | 'noProperty' } {
    return error instanceof Error && error.name === 'StatisticsProblem';
}

/** Any failure of a read as the page's problem and, for the server's own refusals, its message. */
export function problemOf(error: unknown): Pick<StatisticsState, 'problem' | 'notice'> {
    if (isStatisticsProblem(error)) {
        return { problem: error.problem, notice: null };
    }
    if (error instanceof GoogleApiError) {
        return { problem: googleProblem(error), notice: null };
    }
    return error instanceof CallableFailure ? callableProblem(error) : { problem: 'unavailable', notice: null };
}

/** No source (a build without Google sign-in): every click says Google could not be asked. */
export const NO_STATISTICS_SOURCE: StatisticsSource = {
    ask: () => Promise.resolve({ granted: false, failure: 'failed' }),
    live: () => null,
    measurementId: () => Promise.resolve(null),
    read: () => Promise.reject(Object.assign(new Error('statistics: noProperty'), { name: 'StatisticsProblem', problem: 'noProperty' })),
};

export interface StatisticsIntents {
    showNumbers(): void;
    setDays(days: StatisticsDays): void;
    refresh(): void;
}

const CLEAR = { problem: null, notice: null } as const;

/** The numbers' flow over one area cell (`update` merges into the page's `statistics` slice). */
class StatisticsFlow implements StatisticsIntents {
    readonly #cache = new Map<StatisticsDays, StatisticsNumbers>();
    #measurement: string | null = null;
    /** Each read's number: an older answer never replaces a newer period's. */
    #request = 0;

    constructor(
        private readonly source: StatisticsSource,
        private readonly get: () => StatisticsState,
        private readonly update: (patch: Partial<StatisticsState>) => void,
    ) {}

    showNumbers(): void {
        void this.#withConsent(this.get().days);
    }

    setDays(days: StatisticsDays): void {
        const cached = this.#cache.get(days);
        const live = this.source.live();
        this.update({ days });
        if (cached !== undefined) {
            this.#request += 1;
            this.update({ status: 'ready', numbers: cached, ...CLEAR });
        } else if (live === null) {
            this.update({ status: 'idle', numbers: null, ...CLEAR });
        } else {
            void this.#load(live, days);
        }
    }

    refresh(): void {
        this.#cache.delete(this.get().days);
        void this.#withConsent(this.get().days);
    }

    /** The live token, else Google's window (the first await of the click). */
    async #withConsent(days: StatisticsDays): Promise<void> {
        const live = this.source.live();
        const consent = live === null ? await this.source.ask() : { granted: true as const, access: live };
        if (consent.granted) {
            await this.#load(consent.access, days);
            return;
        }
        this.#report(CONSENT_PROBLEMS[consent.failure]);
        this.update({ status: 'error', numbers: null, notice: null, problem: CONSENT_PROBLEMS[consent.failure] });
    }

    #report(reason: string): void {
        this.source.report?.(`statistics_${reason}`);
    }

    async #load(access: StatisticsToken, days: StatisticsDays): Promise<void> {
        this.#request += 1;
        const mine = this.#request;
        this.update({ status: 'loading', ...CLEAR });
        try {
            const numbers = await this.source.read(access, await this.#measurementId(), days);
            this.#cache.set(days, numbers);
            if (numbers.pending !== null) {
                this.#report(numbers.pending.reason);
            }
            this.#answer(mine, { status: 'ready', numbers });
        } catch (error) {
            const problem = problemOf(error);
            this.#report(problem.problem ?? 'unavailable');
            this.#answer(mine, { status: 'error', numbers: null, ...problem });
        }
    }

    /** The project's measurement id, asked once a session; none is Google Analytics not set up. */
    async #measurementId(): Promise<string> {
        this.#measurement ??= await this.source.measurementId();
        if (this.#measurement === null) {
            throw new CallableFailure('failed-precondition', { code: 'apiError.analytics.notEnabled' });
        }
        return this.#measurement;
    }

    #answer(request: number, patch: Partial<StatisticsState>): void {
        if (request === this.#request) {
            this.update(patch);
        }
    }
}

export function createStatistics(
    given: StatisticsSource | null | undefined,
    get: () => StatisticsState,
    update: (patch: Partial<StatisticsState>) => void,
): StatisticsIntents {
    return new StatisticsFlow(given ?? NO_STATISTICS_SOURCE, get, update);
}
