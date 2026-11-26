/**
 * Settings → The city's budget (M5, `docs/research/M5-interfaces.md` §1.8; behaviour A52): the city's share of the
 * project's budgets (`cities/{city}.limits`) beside what the city used (`cities/{city}/usage/{month}`), open only while
 * the section shows. The project's owner changes the five limits (`cities.setLimits`: Save plus one input per field
 * moved); every other admin sees them read-only. A city without limits (created before M5) is held by the project's caps
 * alone: what its owner leaves empty saves at the maximum (`draftLimits`).
 */
import {
    FIRESTORE_PATHS,
    MAX_CITY_LIMITS,
    adminDocSchema,
    cityDocSchema,
    cityLimitsSchema,
    cityUsageDocSchema,
    usageMonth,
    utcDay,
    type AdminDoc,
    type CityDoc,
    type CityLimits,
    type CityUsageDoc,
} from '@hcm/shared';

import { outcomeOf } from '../app/services.js';
import { LiveDoc, type DocState } from '../content/doc.js';
import type { LoadStatus } from '../content/list.js';
import type { ContentServices, StoreFailure } from '../content/services.js';
import type { NoticeInput } from '../state/state.js';

const LIMIT_FIELDS = ['computeUnitsPerMonth', 'rasterJobsPerDay', 'aiRequestsPerMonth', 'geocodeCellsPerDay', 'exportsPerDay'] as const;

type LimitField = (typeof LIMIT_FIELDS)[number];

/** What the city used of a limit, where it is counted (jobs and exports are counted by their own records, not here). */
export type BudgetUsed = Partial<Record<LimitField, number>>;

export interface BudgetSectionState {
    readonly status: LoadStatus;
    readonly failure: StoreFailure | null;
    /** The signed-in admin owns the project: only the project's owner changes a city's budget. */
    readonly owner: boolean;
    /** The saved limits, or null for a city the project's caps alone hold. */
    readonly limits: CityLimits | null;
    /** What the owner typed, by field, until Save or Discard. */
    readonly draft: Partial<Record<LimitField, string>>;
    readonly used: BudgetUsed;
    readonly saving: boolean;
    /** Why the limits were not saved (a typed value out of range, a refusal). */
    readonly error: NoticeInput | null;
}

export const NO_BUDGET_SECTION: BudgetSectionState = {
    status: 'loading',
    failure: null,
    owner: false,
    limits: null,
    draft: {},
    used: {},
    saving: false,
    error: null,
};

export interface BudgetIntents {
    setLimit(field: LimitField, text: string): void;
    /** Saves the typed limits; true once saved. */
    saveLimits(): Promise<boolean>;
    discardLimits(): void;
    retryBudget(): void;
}

/** What the city used this month: compute units spent and held, AI drafts, today's title suggestions. */
export function usedOf(usage: CityUsageDoc | null, now: Date): BudgetUsed {
    if (usage === null) {
        return {};
    }
    const held = Object.values(usage.reservations ?? {}).reduce((sum, reservation) => sum + reservation.computeUnits, 0);
    return {
        computeUnitsPerMonth: usage.computeUnits + held,
        aiRequestsPerMonth: usage.aiRequests,
        geocodeCellsPerDay: usage.geocodeDay === utcDay(now) ? (usage.geocodeToday ?? 0) : 0,
    };
}

/** A typed limit as a number (an empty field is none: NaN, which the schema refuses). */
function typedNumber(text: string): number {
    return text.trim() === '' ? Number.NaN : Number(text);
}

/** A followed document's data, or null (none yet, or none at all). */
function dataOf<T>(state: DocState<T>): T | null {
    return state.doc?.data ?? null;
}

/**
 * The limits the draft makes over the saved ones, or why it cannot. A city without limits starts from the maxima
 * (`MAX_CITY_LIMITS`), so the one limit an owner types never brings the other four (`docs/LESSONS.md` 256).
 */
export function draftLimits(
    state: Pick<BudgetSectionState, 'limits' | 'draft'>,
): { readonly limits: CityLimits } | { readonly error: NoticeInput } {
    const base: Record<LimitField, number> = { ...(state.limits ?? MAX_CITY_LIMITS) };
    for (const field of LIMIT_FIELDS) {
        const typed = state.draft[field];
        if (typed !== undefined) {
            base[field] = typedNumber(typed);
        }
    }
    const parsed = cityLimitsSchema.safeParse(base);
    return parsed.success ? { limits: parsed.data } : { error: { key: 'adminContent.budgets.invalid' } };
}

interface Listeners {
    readonly city: LiveDoc<CityDoc>;
    readonly usage: LiveDoc<CityUsageDoc>;
    readonly admin: LiveDoc<AdminDoc>;
}

function failureOf(states: readonly DocState<unknown>[]): Pick<BudgetSectionState, 'status' | 'failure'> {
    const failed = states.find((state) => state.status === 'error');
    if (failed !== undefined) {
        return { status: 'error', failure: failed.failure };
    }
    return { status: states.every((state) => state.status === 'ready') ? 'ready' : 'loading', failure: null };
}

export class BudgetSection {
    readonly #services: ContentServices;
    readonly #changed: (state: BudgetSectionState) => void;
    readonly #listeners: Listeners;
    #state: BudgetSectionState = NO_BUDGET_SECTION;
    readonly intents: BudgetIntents;

    constructor(services: ContentServices, changed: (state: BudgetSectionState) => void) {
        this.#services = services;
        this.#changed = changed;
        const { store, clock } = services;
        const deps = {
            ...{ store, clock },
            denied: () => {
                services.denied();
            },
            changed: () => {
                this.#listened();
            },
        };
        this.#listeners = {
            city: new LiveDoc({ ...deps, schema: cityDocSchema }),
            usage: new LiveDoc({ ...deps, schema: cityUsageDocSchema }),
            admin: new LiveDoc({ ...deps, schema: adminDocSchema }),
        };
        this.intents = {
            setLimit: (field, text) => {
                this.#set({ draft: { ...this.#state.draft, [field]: text }, error: null });
            },
            saveLimits: () => this.#save(),
            discardLimits: () => {
                this.#set({ draft: {}, error: null });
            },
            retryBudget: () => {
                this.#each().forEach((listener) => {
                    listener.retry();
                });
            },
        };
    }

    get state(): BudgetSectionState {
        return this.#state;
    }

    /** The section shows: the city, its month's counters and the admin's own document are followed. */
    open(): void {
        const { cityId, clock } = this.#services;
        this.#listeners.city.show(FIRESTORE_PATHS.city(cityId));
        this.#listeners.usage.show(FIRESTORE_PATHS.cityUsage(cityId, usageMonth(new Date(clock.now()))));
        const uid = this.#services.user()?.uid;
        if (uid !== undefined) {
            this.#listeners.admin.show(FIRESTORE_PATHS.admin(uid));
        }
    }

    close(): void {
        this.#each().forEach((listener) => {
            listener.stop();
        });
        this.#state = NO_BUDGET_SECTION;
        this.#changed(this.#state);
    }

    /** The three listeners, each retried or stopped alike. */
    #each(): readonly { retry(): void; stop(): void }[] {
        const { city, usage, admin } = this.#listeners;
        return [city, usage, admin];
    }

    #listened(): void {
        const { city, usage, admin } = this.#listeners;
        this.#set({
            ...failureOf([city.state, usage.state, admin.state]),
            owner: dataOf(admin.state)?.role === 'owner',
            limits: dataOf(city.state)?.limits ?? null,
            used: usedOf(dataOf(usage.state), new Date(this.#services.clock.now())),
        });
    }

    #set(patch: Partial<BudgetSectionState>): void {
        this.#state = { ...this.#state, ...patch };
        this.#changed(this.#state);
    }

    async #save(): Promise<boolean> {
        const made = draftLimits(this.#state);
        if ('error' in made) {
            this.#set({ error: made.error });
            return false;
        }
        this.#set({ saving: true, error: null });
        const { cityId } = this.#services;
        const outcome = await outcomeOf(() => this.#services.callables.call('cities.setLimits', { cityId, limits: made.limits }));
        this.#set({ saving: false, ...(outcome.ok ? { draft: {}, limits: outcome.value.limits } : { error: outcome.error }) });
        if (outcome.ok) {
            this.#services.notify({ key: 'adminContent.budgets.saved' });
        }
        return outcome.ok;
    }
}
