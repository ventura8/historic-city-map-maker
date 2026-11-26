/**
 * Home's Monthly costs card (the owner, 2026-11-16: "the admin sees on the dashboard every monthly cost"): one row per paid
 * service the map uses, with this month's spend so far, the forecast for the whole month and a link to the service's own
 * console, then the total against the budget. Measured where the backend already counts it: Mapbox's compute units
 * (`usage/mapbox-<month>`, the publish guard's counter), Cloud Run's vCPU and memory seconds (`usage/cloudrun-<month>`, M7's
 * free-tier meter), the AI drafts' dollars (`usage/ai-<month>`) and the Google Cloud budget alert's cost so far (`ops/guard`).
 * Everything else is an estimate, said as such with its reason: Google does not tell the map what Hosting, Functions,
 * Firestore and Storage cost (M28's platform range), Mapbox's map loads are not counted by the map, and a USGS scan is paid
 * per purchase, never monthly. A counter that cannot be read falls back to its estimate, with that reason.
 */
import {
    aiUsageDocSchema,
    CLOUD_RUN_FREE_TIER,
    cloudRunUsageDocSchema,
    FIRESTORE_PATHS,
    MAPBOX_FREE_COMPUTE_UNITS,
    opsGuardDocSchema,
    USD_PER_COMPUTE_UNIT,
    usageDocSchema,
    usageMonth,
    type AiUsageDoc,
    type CloudRunUsageDoc,
    type OpsGuardDoc,
    type UsageDoc,
} from '@hcm/shared';
import { PLATFORM_MONTHLY_USD, type UsdRange } from '@hcm/shared/sources';

export { defineHcmHomeCosts } from '@hcm/ui/admin/home/costs';

import { budgetAmountFor, DEFAULT_BUDGET_CURRENCY } from '../setup/budget.js';
import { LiveDoc, LOADING_DOC, type DocState } from '../content/doc.js';
import type { ContentServices } from '../content/services.js';

type CostService = 'mapbox' | 'firebase' | 'cloudRun' | 'ai' | 'usgs';

/** Where a row's number comes from: counted by the map, or estimated (with why). */
type CostBasis = 'measured' | 'estimate' | 'unread';

interface CostRow {
    readonly service: CostService;
    readonly basis: CostBasis;
    /** The share of the free tier used so far (0..∞), when the service has one the map counts; else null. */
    readonly freeUsed: number | null;
    readonly usd: UsdRange;
    readonly forecastUsd: UsdRange;
    /** The service's own console, where its real bill is. */
    readonly console: string;
}

export interface MonthlyCosts {
    readonly month: string;
    readonly loading: boolean;
    readonly rows: readonly CostRow[];
    readonly total: UsdRange;
    readonly forecast: UsdRange;
    /** The budget: the alert's own numbers once one came (measured), else Setup's default budget. */
    readonly budget: { readonly amount: number; readonly currency: string; readonly spent: number | null };
    /** The forecast's high end passes the budget (or the alert's cost so far already did). */
    readonly overBudget: boolean;
}

/** Each service's console (a new tab). */
const COST_CONSOLES: Readonly<Record<CostService, string>> = {
    mapbox: 'https://console.mapbox.com/account/statistics/',
    firebase: 'https://console.firebase.google.com/project/_/usage',
    cloudRun: 'https://console.cloud.google.com/run/jobs',
    ai: 'https://console.cloud.google.com/vertex-ai',
    usgs: 'https://earthexplorer.usgs.gov/order/index/',
};

/** Cloud Run jobs' list prices past the free tier (Tier 1, USD a second). */
const CLOUD_RUN_USD = { vcpuSecond: 0.000018, gibSecond: 0.000002 } as const;

/** The counters the card reads, each as its live document (null: absent, no use this month). */
export interface CostInputs {
    readonly mapbox: DocState<UsageDoc>;
    readonly cloudRun: DocState<CloudRunUsageDoc>;
    readonly ai: DocState<AiUsageDoc>;
    readonly guard: DocState<OpsGuardDoc>;
}

const round = (value: number): number => Math.round(value * 100) / 100;
const range = (value: number): UsdRange => ({ low: round(value), high: round(value) });
const ZERO: UsdRange = { low: 0, high: 0 };

/** How much of the month has passed (UTC), never below one day, so an early forecast is not a blow-up. */
export function monthElapsed(now: number): number {
    const at = new Date(now);
    const start = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1);
    const end = Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1);
    const day = 86_400_000;
    return Math.min(1, Math.max(day, now - start) / (end - start));
}

function measured(service: CostService, usd: number, freeUsed: number | null, elapsed: number): CostRow {
    return { service, basis: 'measured', freeUsed, usd: range(usd), forecastUsd: range(usd / elapsed), console: COST_CONSOLES[service] };
}

function estimated(service: CostService, basis: CostBasis, monthly: UsdRange, elapsed: number): CostRow {
    const usd = { low: round(monthly.low * elapsed), high: round(monthly.high * elapsed) };
    return { service, basis, freeUsed: null, usd, forecastUsd: monthly, console: COST_CONSOLES[service] };
}

/** The document once read (null: none this month), or undefined while reading or when it failed. */
function dataOf<T>(state: DocState<T>): T | null | undefined {
    if (state.status !== 'ready') {
        return undefined;
    }
    return state.doc === null ? null : state.doc.data;
}

function basisOf(state: DocState<unknown>): CostBasis {
    return state.status === 'error' ? 'unread' : 'estimate';
}

function mapboxRow(state: DocState<UsageDoc>, elapsed: number): CostRow {
    const usage = dataOf(state);
    if (usage === undefined) {
        return estimated('mapbox', basisOf(state), ZERO, elapsed);
    }
    // No document yet: no publish this month, the free units whole.
    const { computeUnitBudget: free, computeUnits: units } = usage ?? { computeUnitBudget: MAPBOX_FREE_COMPUTE_UNITS, computeUnits: 0 };
    const share = free > 0 ? units / free : null;
    return measured('mapbox', Math.max(0, units - free) * USD_PER_COMPUTE_UNIT, share, elapsed);
}

function cloudRunRow(state: DocState<CloudRunUsageDoc>, elapsed: number): CostRow {
    const usage = dataOf(state);
    if (usage === undefined) {
        return estimated('cloudRun', basisOf(state), ZERO, elapsed);
    }
    const { vcpuSeconds: vcpu, gibSeconds: gib } = usage ?? { vcpuSeconds: 0, gibSeconds: 0 };
    const usd =
        Math.max(0, vcpu - CLOUD_RUN_FREE_TIER.vcpuSeconds) * CLOUD_RUN_USD.vcpuSecond +
        Math.max(0, gib - CLOUD_RUN_FREE_TIER.gibSeconds) * CLOUD_RUN_USD.gibSecond;
    return measured('cloudRun', usd, Math.max(vcpu / CLOUD_RUN_FREE_TIER.vcpuSeconds, gib / CLOUD_RUN_FREE_TIER.gibSeconds), elapsed);
}

function aiRow(state: DocState<AiUsageDoc>, elapsed: number): CostRow {
    const usage = dataOf(state);
    if (usage === undefined) {
        return estimated('ai', basisOf(state), ZERO, elapsed);
    }
    return measured('ai', usage?.usd ?? 0, null, elapsed);
}

function budgetOf(state: DocState<OpsGuardDoc>): MonthlyCosts['budget'] {
    const spend = dataOf(state)?.spend;
    if (spend === undefined) {
        return { amount: budgetAmountFor(DEFAULT_BUDGET_CURRENCY), currency: DEFAULT_BUDGET_CURRENCY, spent: null };
    }
    return { amount: spend.budgetAmount, currency: spend.currency ?? DEFAULT_BUDGET_CURRENCY, spent: spend.costAmount };
}

function sum(ranges: readonly UsdRange[]): UsdRange {
    return { low: round(ranges.reduce((all, one) => all + one.low, 0)), high: round(ranges.reduce((all, one) => all + one.high, 0)) };
}

/** The card from the four counters at `now`. */
export function monthlyCostsOf(inputs: CostInputs, now: number): MonthlyCosts {
    const elapsed = monthElapsed(now);
    const rows: CostRow[] = [
        mapboxRow(inputs.mapbox, elapsed),
        estimated('firebase', 'estimate', PLATFORM_MONTHLY_USD, elapsed),
        cloudRunRow(inputs.cloudRun, elapsed),
        aiRow(inputs.ai, elapsed),
        // A scan is bought one at a time, each with its own OK (`ONE_SCAN_USD`, said in the row's note): nothing a month by itself.
        estimated('usgs', 'estimate', ZERO, elapsed),
    ];
    const budget = budgetOf(inputs.guard);
    const forecast = sum(rows.map((row) => row.forecastUsd));
    const loading = [inputs.mapbox, inputs.cloudRun, inputs.ai, inputs.guard].some((state) => state.status === 'loading');
    return {
        ...{ month: usageMonth(new Date(now)), loading, rows, total: sum(rows.map((row) => row.usd)), forecast, budget },
        overBudget: forecast.high > budget.amount || (budget.spent ?? 0) > budget.amount,
    };
}

/** The four counters, live while the dashboard is open; `changed` gets the card on every change. */
export class CostsWatch {
    readonly #docs: { readonly [K in keyof CostInputs]: LiveDoc<CostInputs[K] extends DocState<infer T> ? T : never> };
    readonly #services: ContentServices;

    constructor(services: ContentServices, changed: (costs: MonthlyCosts) => void) {
        this.#services = services;
        const { store, clock } = services;
        const deps = {
            store,
            clock,
            denied: (): void => undefined,
            changed: (): void => {
                changed(monthlyCostsOf(this.#inputs(), clock.now()));
            },
        };
        this.#docs = {
            mapbox: new LiveDoc({ ...deps, schema: usageDocSchema }),
            cloudRun: new LiveDoc({ ...deps, schema: cloudRunUsageDocSchema }),
            ai: new LiveDoc({ ...deps, schema: aiUsageDocSchema }),
            guard: new LiveDoc({ ...deps, schema: opsGuardDocSchema }),
        };
    }

    show(): void {
        const month = usageMonth(new Date(this.#services.clock.now()));
        this.#docs.mapbox.show(FIRESTORE_PATHS.usage(month));
        this.#docs.cloudRun.show(FIRESTORE_PATHS.cloudRunUsage(month));
        this.#docs.ai.show(FIRESTORE_PATHS.aiUsage(month));
        this.#docs.guard.show(FIRESTORE_PATHS.opsGuard);
    }

    retry(): void {
        Object.values(this.#docs).forEach((doc) => {
            doc.retry();
        });
    }

    stop(): void {
        Object.values(this.#docs).forEach((doc) => {
            doc.stop();
        });
    }

    #inputs(): CostInputs {
        const { mapbox, cloudRun, ai, guard } = this.#docs;
        return { mapbox: mapbox.state, cloudRun: cloudRun.state, ai: ai.state, guard: guard.state };
    }
}

/** Before the dashboard opens: every counter loading. */
export const LOADING_COSTS: MonthlyCosts = monthlyCostsOf(
    { mapbox: LOADING_DOC, cloudRun: LOADING_DOC, ai: LOADING_DOC, guard: LOADING_DOC },
    0,
);
