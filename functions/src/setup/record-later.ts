import { timestampFromDate, timestampToDate, type CallableRequest, type TimestampLike } from '@hcm/shared';

import { omit } from '../api/objects.js';
import type { SetupStatusFields } from './records.js';

/**
 * What `setup.recordCloud` records for the M6 setup-ux steps (`docs/research/M6-interfaces.md` §4.1 and §3.1; findings
 * 16 and 18 of the live test of 2026-10-25): **Do it later** on the USGS card (`usgs.postponedAt`, which `setupDone`
 * reads; the area's own state and reason stay as they were) and a likely free-trial billing account (`billing.trialSince`,
 * never moved once set; `billing.trialPaidAt` once the owner says it is paid, until the owner says it is a trial after
 * all). A billing report replaces the billing
 * record whole, so the trial fields it does not carry are kept.
 */
type Request = CallableRequest<'setup.recordCloud'>;
type Timestamp = TimestampLike;
type BillingRecord = NonNullable<SetupStatusFields['billing']>;
type UsgsRecord = NonNullable<SetupStatusFields['usgs']>;

/** An area never recorded reads as not done. */
const NOT_DONE = { state: 'missing' } as const satisfies UsgsRecord & BillingRecord;

const TRIAL_FIELDS = ['trialSince', 'trialPaidAt'] as const;

/** The trial fields of `billing`, to carry over a billing report. */
function trialOf(billing: BillingRecord | undefined): Pick<BillingRecord, (typeof TRIAL_FIELDS)[number]> {
    const kept = Object.entries(billing ?? {}).filter(([key]) => (TRIAL_FIELDS as readonly string[]).includes(key));
    return Object.fromEntries(kept);
}

/** USGS postponed (`true`: since now) or taken back (`false`). */
function postponedUsgs(current: UsgsRecord | undefined, postponed: boolean, at: Timestamp): UsgsRecord {
    const record: UsgsRecord = current ?? NOT_DONE;
    const rest = omit(record, ['postponedAt']);
    return postponed ? { ...rest, postponedAt: at } : rest;
}

/** The earlier of the reported day and now: a trial never starts in the future. */
function startOf(since: string, at: Timestamp): Timestamp {
    const reported = Date.parse(since);
    return reported < timestampToDate(at).getTime() ? timestampFromDate(new Date(reported)) : at;
}

/**
 * A trial from `since`: the first report wins, unless the account was said to be paid, when the owner's later word that
 * it is a trial ("This account is a free trial", finding 6 of the M6 review) starts it again from that day.
 */
function sinceBilling(billing: BillingRecord, since: string, at: Timestamp): BillingRecord {
    if (billing.trialPaidAt !== undefined) {
        return { ...omit(billing, ['trialPaidAt']), trialSince: startOf(since, at) };
    }
    return billing.trialSince === undefined ? { ...billing, trialSince: startOf(since, at) } : billing;
}

/** A likely trial from `since`, or the owner's word that the account is paid. */
function trialBilling(billing: BillingRecord, trial: NonNullable<Request['trial']>, at: Timestamp): BillingRecord {
    return 'paid' in trial ? { ...billing, trialPaidAt: at } : sinceBilling(billing, trial.since, at);
}

/** The billing record after a report: the reported record with the stored trial kept, then the trial part applied. */
function billingAfter(current: SetupStatusFields, request: Request, checkedAt: Timestamp): BillingRecord | undefined {
    const reported = request.billing === undefined ? current.billing : { ...request.billing, checkedAt, ...trialOf(current.billing) };
    if (request.trial === undefined) {
        return reported;
    }
    return trialBilling(reported ?? NOT_DONE, request.trial, checkedAt);
}

/** `current` with the request's billing, postponed and trial parts applied (the other areas as they were). */
export function applyLaterParts(current: SetupStatusFields, request: Request, checkedAt: Timestamp): SetupStatusFields {
    const billing = billingAfter(current, request, checkedAt);
    const usgs = request.postponed === undefined ? current.usgs : postponedUsgs(current.usgs, request.postponed.usgs, checkedAt);
    return { ...current, ...(billing === undefined ? {} : { billing }), ...(usgs === undefined ? {} : { usgs }) };
}
