import { timestampFromDate, type TimestampLike } from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import type { VerifiedCaller } from '../api/access.js';
import type { Ports } from '../ports/index.js';
import { failureRecord, type FailureRecord } from './failures.js';
import { commitStatus, holdsConfiguration, stampOf, type SetupStatusFields } from './records.js';

/** A failure as an area stores it: the reason and when it was found. */
type FailedAttempt = FailureRecord & { readonly checkedAt: TimestampLike };

type AttemptDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

/**
 * Keeps the reason a save failed in `setup/status` (the Mapbox chip turns `invalid` for a revoked token,
 * S-A06-BAD-REVOKED; the USGS chip `unavailable` during maintenance), unless the area already holds a working or
 * approval-pending configuration, which a bad paste must not hide. Only `ApiError`s are recorded (an unexpected
 * error is logged by the plumbing); a failure to record is logged and never replaces the original error.
 */
export async function recordFailedAttempt(
    deps: AttemptDeps,
    caller: VerifiedCaller,
    error: unknown,
    change: { readonly area: 'mapbox' | 'usgs'; readonly apply: (current: SetupStatusFields, failed: FailedAttempt) => SetupStatusFields },
): Promise<void> {
    if (!(error instanceof ApiError)) {
        return;
    }
    const failed = { ...failureRecord(error), checkedAt: timestampFromDate(deps.clock.now()) };
    try {
        await commitStatus(deps.documents, stampOf(caller.uid, deps), (current) =>
            holdsConfiguration(current[change.area]) ? current : change.apply(current, failed),
        );
    } catch (recordError) {
        deps.log.warn('the failed setup attempt was not recorded', { area: change.area, error: String(recordError) });
    }
}
