/**
 * What Settings → The city's budget reads of the settings area (M5, `docs/research/M5-interfaces.md` §1.8), mirrored
 * structurally from `packages/admin/src/cities/budget-section.ts`; `packages/admin/test/app/admin-port.test.ts` checks
 * that the real store satisfies the settings port that holds it.
 */
import type { CityLimits } from '@hcm/shared';

import type { LoadStatusPort, StoreFailurePort } from '../area-port.js';
import type { AdminNoticeInputPort } from '../notice-port.js';

export type LimitFieldPort = 'computeUnitsPerMonth' | 'rasterJobsPerDay' | 'aiRequestsPerMonth' | 'geocodeCellsPerDay' | 'exportsPerDay';

export interface BudgetSectionPort {
    readonly status: LoadStatusPort;
    readonly failure: StoreFailurePort | null;
    readonly owner: boolean;
    readonly limits: CityLimits | null;
    readonly draft: Partial<Record<LimitFieldPort, string>>;
    readonly used: Partial<Record<LimitFieldPort, number>>;
    readonly saving: boolean;
    readonly error: AdminNoticeInputPort | null;
}

export interface BudgetIntentsPort {
    setLimit(field: LimitFieldPort, text: string): void;
    saveLimits(): Promise<boolean>;
    discardLimits(): void;
    retryBudget(): void;
}
