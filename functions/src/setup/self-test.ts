import { SELF_TEST_CHECKS, timestampFromDate, type CallableResponse, type SelfTestCheck, type TimestampLike } from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { failureRecord, upstreamFields } from './failures.js';
import { commitStatus, defined, stampOf, withoutReason, type SetupStatusFields } from './records.js';
import { CHECKS, type CheckContext, type CheckResult, type SelfTestDeps } from './self-test-checks.js';
import { usgsRecord } from './usgs-check.js';
import { toSetupStatusView } from './view.js';

type Response = CallableResponse<'setup.selfTest'>;
type Results = Readonly<Record<SelfTestCheck, CheckResult>>;

/**
 * One check, isolated: a failure becomes its result (and a log line), and the next check still runs. The line names
 * what the upstream answered (service, failure, HTTP status, Google's status and reason; never a body, an address or a
 * token), so a failing check on the real project says why (finding 20).
 */
async function runCheck(deps: SelfTestDeps, id: SelfTestCheck, context: CheckContext): Promise<CheckResult> {
    try {
        return await CHECKS[id](deps, context);
    } catch (error) {
        const failure = failureRecord(error);
        deps.log.warn('self-test check failed', { check: id, code: failure.detail, ...upstreamFields(error) });
        return failure;
    }
}

/** Every check in `SELF_TEST_CHECKS` order, one after the other. */
async function runChecks(deps: SelfTestDeps, context: CheckContext): Promise<Results> {
    return {
        firestore: await runCheck(deps, 'firestore', context),
        secrets: await runCheck(deps, 'secrets', context),
        'private-bucket': await runCheck(deps, 'private-bucket', context),
        'public-bucket': await runCheck(deps, 'public-bucket', context),
        'task-queue': await runCheck(deps, 'task-queue', context),
        events: await runCheck(deps, 'events', context),
        mapbox: await runCheck(deps, 'mapbox', context),
        usgs: await runCheck(deps, 'usgs', context),
        'firebase-management': await runCheck(deps, 'firebase-management', context),
        'error-reporting': await runCheck(deps, 'error-reporting', context),
        ai: await runCheck(deps, 'ai', context),
    };
}

/** A result's state and reason, without the USGS outcome. */
function health(result: CheckResult) {
    return { state: result.state, ...defined('detail', result.detail), ...defined('params', result.params) };
}

/** An area after its check: the new state and reason replace the old ones, the rest of the record stays. */
function checked(current: object | undefined, result: CheckResult, checkedAt: TimestampLike) {
    const fresh = { ...health(result), checkedAt };
    return current === undefined ? fresh : { ...withoutReason(current), ...fresh };
}

/**
 * USGS keeps its role while unreachable, its token's expiry always and since when its approval is awaited (CR-M6-14,
 * S-A59-HAPPY-APPROVAL-PENDING); an outcome brings the next check.
 */
function usgsAfter(current: SetupStatusFields['usgs'], result: CheckResult, now: Date): SetupStatusFields['usgs'] {
    const kept = {
        ...defined('role', current?.role),
        ...defined('tokenExpiresAt', current?.tokenExpiresAt),
        ...defined('pendingSince', current?.pendingSince),
    };
    return result.usgs === undefined ? checked(current, result, timestampFromDate(now)) : usgsRecord(result.usgs, now, kept);
}

/** The Mapbox, USGS and crash records after the checks (the other areas belong to other steps). */
function applyResults(current: SetupStatusFields, results: Results, now: Date): SetupStatusFields {
    const checkedAt = timestampFromDate(now);
    return {
        ...current,
        mapbox: checked(current.mapbox, results.mapbox, checkedAt),
        usgs: usgsAfter(current.usgs, results.usgs, now),
        crash: checked(current.crash, results['error-reporting'], checkedAt),
    };
}

/**
 * `setup.selfTest` (admin; the Setup Assistant's Re-check, scenario S-A03-BAD-SELFTEST-FAILURE): runs every check of
 * `SELF_TEST_CHECKS` in order, each isolated, and records what it found for Mapbox, USGS and crash reporting in
 * `setup/status`. The response lists every check with its state and reason, and the whole screen.
 */
export async function selfTest(deps: SelfTestDeps, caller: VerifiedCaller): Promise<Response> {
    const context = { uid: caller.uid, now: deps.clock.now() };
    const results = await runChecks(deps, context);
    const status = await commitStatus(deps.documents, stampOf(caller.uid, deps), (current) => applyResults(current, results, context.now));
    const failed = SELF_TEST_CHECKS.filter((id) => results[id].state !== 'ok');
    deps.log.info('self-test ran', { uid: caller.uid, failed: failed.join(',') });
    return { checks: SELF_TEST_CHECKS.map((id) => ({ id, ...health(results[id]) })), status: toSetupStatusView(status, context.now) };
}
