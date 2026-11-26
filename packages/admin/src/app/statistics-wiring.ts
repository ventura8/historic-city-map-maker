/**
 * The Statistics view's source of numbers (`../crashes/statistics.ts`, `DECISIONS-for-review.md` §203): Google's consent
 * for the read-only Analytics scope through the shell's `GoogleAccessService` (the admin's Firebase Auth Google sign-in
 * with `addScope`, the token in memory only), the project's measurement id from `setup.analyticsConfig` (as Setup's
 * analytics card reads it), and the GA4 Data API from the lazy `analytics-data` chunk.
 */
import type { Logger } from '@hcm/shared';

import type { GoogleAccessService } from '../auth/google-service.js';
import type { StatisticsSource, StatisticsToken } from '../crashes/statistics.js';
import type { CallablesPort } from '../firebase/ports.js';
import type { Clock } from './ports.js';
import type { Measure } from './telemetry.js';

/** A token used for a batch of reads must live at least this long. */
const MIN_LIFE_MS = 5 * 60_000;

export interface StatisticsWiringDeps {
    readonly google: Pick<GoogleAccessService, 'request' | 'live'>;
    readonly callables: CallablesPort;
    readonly cityId: () => string;
    readonly fetch: typeof fetch;
    readonly clock: Clock;
    readonly log: Logger;
    /** The admin's consent-gated measurements: a statistics problem is one `ui_error` with its reason code. */
    readonly measure?: Measure;
}

/** The token without its scope list (the flow needs only the value and when it ends). */
function tokenOf(access: { readonly token: string; readonly expiresAt: number }): StatisticsToken {
    return { token: access.token, expiresAt: access.expiresAt };
}

export function statisticsSourceOf(deps: StatisticsWiringDeps): StatisticsSource {
    // The last answer, in memory only, for Home's Visitors card (it never asks Google itself).
    let latest: ReturnType<NonNullable<StatisticsSource['latest']>> = null;
    return {
        latest: () => latest,
        ask: async () => {
            const outcome = await deps.google.request('analyticsRead');
            if (!outcome.granted) {
                return { granted: false, failure: outcome.failure };
            }
            return outcome.access === null ? { granted: false, failure: 'failed' } : { granted: true, access: tokenOf(outcome.access) };
        },
        live: () => {
            const access = deps.google.live('analyticsRead', MIN_LIFE_MS);
            return access === null ? null : tokenOf(access);
        },
        measurementId: async () => {
            const config = await deps.callables.call('setup.analyticsConfig', { cityId: deps.cityId() });
            return config.analytics.state === 'ok' ? config.measurementId : null;
        },
        report: (code) => {
            deps.log.warn('statistics problem', { code, cityId: deps.cityId() });
            deps.measure?.({ name: 'ui_error', params: { code, route: 'crashes' } });
        },
        // A lazy chunk (`analytics-data`), fetched on the first read only.
        read: async (access, measurementId, days) => {
            const numbers = await (
                await import('../google/analytics-data.js')
            ).readStatistics(
                {
                    fetch: (...args) => deps.fetch(...args),
                    token: () => access.token,
                    sleep: (ms) =>
                        new Promise((resolve) => {
                            deps.clock.setTimeout(resolve, ms);
                        }),
                    log: deps.log.child('statistics'),
                },
                measurementId,
                days,
                async (...args) => (await import('../google/analytics-summary.js')).summaryOf(...args),
            );
            latest = { days, numbers };
            return numbers;
        },
    };
}
