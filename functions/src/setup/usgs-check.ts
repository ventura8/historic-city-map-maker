import { API_ERRORS, USGS_RECHECK_HOURS, timestampFromDate, usgsRoleFromPermissions, type ApiErrorCode, type UsgsRole } from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import { UpstreamError } from '../ports/errors.js';
import type { UsgsApi } from '../ports/usgs-api.js';
import { mapFailure, type FailureMap } from './failures.js';
import { defined, type SetupStatusFields } from './records.js';

/**
 * One USGS M2M check with a username and an application token (onboarding review §2C, usgs_m2m_skill): `login-token`,
 * `permissions`, and `logout` always. What it finds:
 * - `ok` with the `download` role: M2M access is approved;
 * - `pending` with the `search` role: the credentials work but USGS has not granted M2M downloads yet (no download
 *   permission, or a login refused with `AUTH_UNAUTHORIZED`): the Setup Assistant shows "Awaiting approval" and the
 *   role is checked again every `USGS_RECHECK_HOURS`;
 * - `unavailable` (maintenance, an outage, the rate limit): nothing is wrong with the credentials, so they are kept and
 *   checked again later, never shown as a failure;
 * - a bad username or token throws `apiError.usgs.credentials`.
 */
export type UsgsOutcome =
    | { readonly state: 'ok'; readonly role: UsgsRole }
    | { readonly state: 'pending'; readonly role: UsgsRole; readonly detail: typeof ACCESS_PENDING }
    | { readonly state: 'unavailable'; readonly detail: ApiErrorCode };

/** The reason a `pending` card shows (CR-M2-16): USGS has not granted this account M2M downloads yet. */
const ACCESS_PENDING = 'apiError.usgs.accessPending';

const USGS_FAILURES: FailureMap = {
    unauthorized: ['apiError.usgs.credentials'],
    maintenance: ['apiError.usgs.maintenance'],
    unavailable: ['apiError.usgs.unavailable'],
    rateLimited: ['apiError.rateLimited'],
};

const MS_PER_HOUR = 3_600_000;

/** A refused or failed call as an outcome; a credentials problem (or anything unexpected) is thrown. */
function failureOutcome(error: unknown): UsgsOutcome {
    if (error instanceof UpstreamError && error.failure === 'forbidden') {
        return { state: 'pending', role: 'search', detail: ACCESS_PENDING };
    }
    const mapped = mapFailure(error, USGS_FAILURES);
    if (mapped instanceof ApiError && API_ERRORS[mapped.code].retryable) {
        return { state: 'unavailable', detail: mapped.code };
    }
    throw mapped;
}

export async function checkUsgs(usgs: UsgsApi, username: string, applicationToken: string): Promise<UsgsOutcome> {
    const apiKey = await usgs.login(username, applicationToken).catch((error: unknown) => failureOutcome(error));
    if (typeof apiKey !== 'string') {
        return apiKey;
    }
    try {
        const role = usgsRoleFromPermissions(await usgs.permissions(apiKey));
        return role === 'download' ? { state: 'ok', role } : { state: 'pending', role, detail: ACCESS_PENDING };
    } catch (error) {
        return failureOutcome(error);
    } finally {
        await usgs.logout(apiKey);
    }
}

type UsgsRecord = NonNullable<SetupStatusFields['usgs']>;

type KeptUsgs = Pick<UsgsRecord, 'role' | 'tokenExpiresAt' | 'pendingSince'>;

/**
 * M6 setup-ux (`docs/research/M6-interfaces.md` §4.1, S-A59-HAPPY-APPROVAL-PENDING): since when the saved token waits for
 * USGS's approval: from the first `pending` check on, kept while USGS does not answer, gone once approved.
 */
function pendingSinceOf(outcome: UsgsOutcome, now: Date, kept: KeptUsgs): Pick<UsgsRecord, 'pendingSince'> {
    if (outcome.state === 'pending') {
        return { pendingSince: kept.pendingSince ?? timestampFromDate(now) };
    }
    return defined('pendingSince', outcome.state === 'ok' ? undefined : kept.pendingSince);
}

/**
 * The `setup/status.usgs` record of an outcome checked at `now`: the role when it is known (else the one `kept`), the
 * next check while waiting, the reason while unavailable, the token's expiry from `kept`, and since when the approval
 * is awaited.
 */
export function usgsRecord(outcome: UsgsOutcome, now: Date, kept: KeptUsgs): UsgsRecord {
    const base = {
        state: outcome.state,
        checkedAt: timestampFromDate(now),
        ...defined('role', 'role' in outcome ? outcome.role : kept.role),
        ...defined('tokenExpiresAt', kept.tokenExpiresAt),
        ...defined('detail', 'detail' in outcome ? outcome.detail : undefined),
        ...pendingSinceOf(outcome, now, kept),
    };
    return outcome.state === 'ok'
        ? base
        : { ...base, nextCheckAt: timestampFromDate(new Date(now.getTime() + USGS_RECHECK_HOURS * MS_PER_HOUR)) };
}
