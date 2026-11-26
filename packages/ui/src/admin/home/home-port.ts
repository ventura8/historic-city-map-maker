/**
 * The dashboard as its page reads it (`#/home`), mirroring `packages/admin/src/home/home.ts` (checked at compile time by
 * `packages/admin/test/app/admin-port.test.ts`).
 */
import type { ValidationCode } from '@hcm/shared';

import type { AdminNoticeInputPort } from '../notice-port.js';
import type { DocStatePort, LoadStatusPort } from '../area-port.js';

export type HomeCountPort =
    | 'photos'
    | 'pois'
    | 'categories'
    | 'layers'
    | 'rightsReviews'
    | 'unpublishedPhotos'
    | 'activeJobs'
    | 'failedJobs'
    | 'versionsToApprove'
    | 'versionsNeedingPoints'
    | 'roleRequests'
    | 'suggestionsToReview'
    | 'storiesToReview'
    | 'photosToReview'
    | 'placesToReview';

type SetupAreaPort = 'billing' | 'provision' | 'mapbox' | 'usgs' | 'analytics' | 'crash';

type ServiceStatePort = 'missing' | 'pending' | 'ok' | 'invalid' | 'unavailable';

export interface HealthChipPort {
    readonly area: SetupAreaPort;
    readonly state: ServiceStatePort;
    readonly detail: AdminNoticeInputPort | null;
}

/** A document the public map left out: what it is, its id, its first issue (a validation code at a path). */
export interface SkippedDocumentPort {
    readonly entity: 'layer' | 'photo' | 'poi' | 'poiCategory' | 'story';
    readonly id: string;
    readonly code: ValidationCode;
    readonly path: string;
}

export interface PublicMapPort {
    readonly status: 'idle' | 'queued' | 'building' | 'failed';
    readonly builtAt: string | null;
    readonly skipped: readonly SkippedDocumentPort[];
    readonly error: AdminNoticeInputPort | null;
}

/** M6 setup-ux: what Setup left open (`packages/admin/src/home/reminders.ts`). */
export type HomeReminderPort =
    | { readonly kind: 'usgsLater' }
    | { readonly kind: 'usgsPending'; readonly since: string | null }
    | { readonly kind: 'trial'; readonly endsAt: string; readonly upgradeUrl: string }
    // M6 installer (A55–A57): a stopped installation or an update, with the Setup step whose card acts on it.
    | { readonly kind: 'installUpdate' | 'installFailed'; readonly step: string };

/** This month's costs (`packages/admin/src/home/costs.ts`). */
export interface UsdRangePort {
    readonly low: number;
    readonly high: number;
}

type CostServicePort = 'mapbox' | 'firebase' | 'cloudRun' | 'ai' | 'usgs';

export interface CostRowPort {
    readonly service: CostServicePort;
    readonly basis: 'measured' | 'estimate' | 'unread';
    readonly freeUsed: number | null;
    readonly usd: UsdRangePort;
    readonly forecastUsd: UsdRangePort;
    readonly console: string;
}

export interface MonthlyCostsPort {
    readonly month: string;
    readonly loading: boolean;
    readonly rows: readonly CostRowPort[];
    readonly total: UsdRangePort;
    readonly forecast: UsdRangePort;
    readonly budget: { readonly amount: number; readonly currency: string; readonly spent: number | null };
    readonly overBudget: boolean;
}

interface NamedCountPort {
    readonly name: string;
    readonly count: number;
}

/** Home's Visitors card: the Statistics page's last numbers of this session (`packages/admin/src/google/analytics-data.ts`). */
export interface VisitorsPort {
    readonly days: 7 | 28 | 90;
    readonly numbers: {
        readonly visitors: number;
        readonly sessions: number;
        readonly devices: readonly NamedCountPort[];
        readonly countries: readonly NamedCountPort[];
        readonly summary?: {
            readonly daily: readonly { readonly date: string; readonly visitors: number; readonly sessions: number }[];
            readonly previous: { readonly visitors: number; readonly sessions: number };
            readonly newVsReturning: readonly NamedCountPort[];
            readonly languages: readonly NamedCountPort[];
            readonly years: readonly NamedCountPort[];
            readonly layers: readonly NamedCountPort[];
            readonly photos: readonly NamedCountPort[];
        };
    };
}

export interface HomeViewState {
    readonly countsStatus: LoadStatusPort;
    readonly counts: Readonly<Record<HomeCountPort, number | null>> | null;
    readonly health: { readonly status: LoadStatusPort; readonly chips: readonly HealthChipPort[]; readonly reconnecting: boolean };
    readonly publicMap: DocStatePort<PublicMapPort>;
    readonly reminders: readonly HomeReminderPort[];
    readonly dismissing: boolean;
    /** Null until the lazy `costs` chunk has loaded. */
    readonly costs: MonthlyCostsPort | null;
    readonly visitors: VisitorsPort | null;
}

export interface HomeIntentsPort {
    refresh(): Promise<void>;
    retry(): void;
    /** "It is a paid account" on the free-trial reminder (M6 setup-ux, A60). */
    dismissTrial(): Promise<void>;
}
