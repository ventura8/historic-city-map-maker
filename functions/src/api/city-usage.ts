/**
 * A city's share of the project's budgets (M5, `docs/research/M5-interfaces.md` §1.8): its month-to-date counters,
 * `cities/{city}/usage/{YYYY-MM}`, read and written inside the transaction that counts the project's own (the AI drafts'
 * `usage/ai-YYYY-MM`, the title suggestions' `ops/assist`), so a city never spends past its share. A city without
 * `limits` (Bucharest, created before M5) is held by the project's caps alone, and nothing is counted for it.
 */
import {
    FIRESTORE_PATHS,
    cityUsageDocSchema,
    queuedOn,
    systemWriter,
    timestampFromDate,
    type CityDoc,
    type CityUsageDoc,
} from '@hcm/shared';

import type { DocumentTransaction } from '../ports/documents.js';

/** The city a counter is kept for, and its limits. */
export interface CityShare {
    readonly cityId: string;
    readonly limits: NonNullable<CityDoc['limits']>;
}

/** The share of `city`, or undefined when it has no limits (the project's caps alone hold it). */
export function shareOf(cityId: string, city: Pick<CityDoc, 'limits'>): CityShare | undefined {
    return city.limits === undefined ? undefined : { cityId, limits: city.limits };
}

/** The city's counters of `month` as they stand (zero when nothing was counted yet). */
export async function readCityUsage(transaction: DocumentTransaction, share: CityShare, month: string): Promise<CityUsageDoc> {
    const stored = await transaction.get(FIRESTORE_PATHS.cityUsage(share.cityId, month), cityUsageDocSchema);
    return (
        stored ?? { month, computeUnits: 0, aiRequests: 0, updatedBy: systemWriter('cities'), updatedAt: timestampFromDate(new Date(0)) }
    );
}

/** Writes the city's counters of their month, stamped by `writer` at `now`. */
export async function writeCityUsage(
    transaction: DocumentTransaction,
    share: CityShare,
    usage: CityUsageDoc,
    stamp: Pick<CityUsageDoc, 'updatedBy' | 'updatedAt'>,
): Promise<void> {
    await transaction.set(FIRESTORE_PATHS.cityUsage(share.cityId, usage.month), cityUsageDocSchema, { ...usage, ...stamp });
}

/** How many title-suggestion cells the city queued on `day`. */
export function geocodedOn(usage: Pick<CityUsageDoc, 'geocodeDay' | 'geocodeToday'>, day: string): number {
    return queuedOn({ queuedDay: usage.geocodeDay, queuedToday: usage.geocodeToday }, day);
}
