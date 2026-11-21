/**
 * Home's reminders (`docs/research/M6-interfaces.md` §4.1 and §3.1, setup-ux; findings 16, 18 and 24 of the live test of
 * 2026-10-25): what Setup left open, read from `setup/status` (live) and the clock:
 *
 * - **USGS later** (A59): the owner chose Do it later: historical imagery search is off, with Set up USGS;
 * - **USGS waiting** (A59): the saved token waits for USGS's M2M approval (days), since when;
 * - **a likely free trial** (A60): an account that appeared while Setup's billing card waited (no Google API says it is a
 *   trial, `DECISIONS-for-review.md` §67f) is reminded 14 days before its 90th day, with the link to upgrade it in Google
 *   Cloud and "It is a paid account", which removes it for good.
 *
 * - **the map's installation** (installer, A55–A57, `home.update-tile`): a target recorded `updateAvailable` (the admin is
 *   newer than what is installed) or `failed` (its last build stopped), with the Setup step whose card offers Update the
 *   map or Try again. A recorded release in place is read again against this admin's own release and build time
 *   (finding 39 of 2026-11-01: an `installed` written by an older build of the same version is an update for this one).
 *   Finding 65 of 2026-11-02: also a project prepared before Provision's items last changed (the update applies them).
 */
import {
    INSTALL_TARGETS,
    provisionDue,
    timestampToDate,
    usgsReadiness,
    type InstallState,
    type SetupStatusDoc,
    type TimestampLike,
} from '@hcm/shared';

import { isoOf } from '../content/list.js';
import { recordedState, type BundleStamp } from '../install/model.js';
import { INSTALL_STEP_OF } from '../setup/install-steps.js';
import { SETUP_LINK_URLS } from '../setup/links.js';

/** Google's free trial for a new customer: 90 days (finding 18). */
export const TRIAL_DAYS = 90;
/** Home reminds this many days before the trial's end. */
export const TRIAL_REMINDER_DAYS = 14;

const DAY_MS = 86_400_000;

export type HomeReminder =
    | { readonly kind: 'usgsLater' }
    | { readonly kind: 'usgsPending'; readonly since: string | null }
    | { readonly kind: 'trial'; readonly endsAt: string; readonly upgradeUrl: string }
    // [section install] owner: installer
    | { readonly kind: 'installUpdate' | 'installFailed'; readonly step: string };
// [end install]

type UsgsArea = NonNullable<SetupStatusDoc['usgs']>;
type BillingArea = NonNullable<SetupStatusDoc['billing']>;

function isoOrNull(timestamp: TimestampLike | undefined): string | null {
    return timestamp === undefined ? null : isoOf(timestamp);
}

/** USGS postponed, or waiting for the approval of its saved token. */
function usgsReminder(usgs: UsgsArea | undefined): readonly HomeReminder[] {
    const readiness = usgsReadiness(usgs);
    if (readiness === 'postponed') {
        return [{ kind: 'usgsLater' }];
    }
    return readiness === 'approvalPending' ? [{ kind: 'usgsPending', since: isoOrNull(usgs?.pendingSince) }] : [];
}

/** When a likely trial not called paid ends (epoch ms), or null. */
function trialEnd(billing: BillingArea | undefined): number | null {
    const since = billing?.trialSince;
    if (since === undefined || billing?.trialPaidAt !== undefined) {
        return null;
    }
    return timestampToDate(since).getTime() + TRIAL_DAYS * DAY_MS;
}

/** A likely trial not called paid, from 14 days before its 90th day on. */
function trialReminder(billing: BillingArea | undefined, now: number): readonly HomeReminder[] {
    const endsAt = trialEnd(billing);
    if (endsAt === null || now < endsAt - TRIAL_REMINDER_DAYS * DAY_MS) {
        return [];
    }
    return [{ kind: 'trial', endsAt: new Date(endsAt).toISOString(), upgradeUrl: SETUP_LINK_URLS['gcp.billingAccounts'] }];
}

// [section install] owner: installer
type InstallRecords = SetupStatusDoc['install'];

/** A target's recorded state, read against the admin's release when it is known (else as recorded). */
function stateOf(install: InstallRecords, target: (typeof INSTALL_TARGETS)[number], bundle: BundleStamp | null): InstallState | undefined {
    const record = install?.[target];
    if (record === undefined || bundle === null) {
        return record?.state;
    }
    return recordedState(record, bundle);
}

/** The first target in `state`, as a reminder of `kind` opening its Setup step. */
function installTile(install: InstallRecords, state: 'updateAvailable' | 'failed', bundle: BundleStamp | null): readonly HomeReminder[] {
    const target = INSTALL_TARGETS.find((candidate) => stateOf(install, candidate, bundle) === state);
    return target === undefined ? [] : [{ kind: state === 'failed' ? 'installFailed' : 'installUpdate', step: INSTALL_STEP_OF[target] }];
}

/**
 * Finding 65 of 2026-11-02: an installed map whose project was prepared before Provision's items last changed: Update the
 * map on the server's card applies them, so it is an update too.
 */
function provisionTile(status: SetupStatusDoc): readonly HomeReminder[] {
    const due = preparedAndInstalled(status) ? provisionDue(status.provision?.setVersion) : [];
    return due.length > 0 ? [{ kind: 'installUpdate', step: INSTALL_STEP_OF.server }] : [];
}

/** A project prepared (its doctor's items recorded) with its server installed. */
function preparedAndInstalled(status: SetupStatusDoc): boolean {
    const items = status.provision?.items ?? [];
    return items.length > 0 && status.install?.server !== undefined;
}

/** A stopped installation first (it needs a look), else an update the admin's release brings, else Provision's changes. */
function installReminder(status: SetupStatusDoc, bundle: BundleStamp | null): readonly HomeReminder[] {
    const failed = installTile(status.install, 'failed', bundle);
    const update = failed.length > 0 ? failed : installTile(status.install, 'updateAvailable', bundle);
    return update.length > 0 ? update : provisionTile(status);
}
// [end install]

/**
 * The reminders `setup/status` calls for at `now` (none before it is read); `bundle` is the admin's own release and build
 * time, which the recorded installs are read against (null: a build without a release reads them as recorded).
 */
export function remindersOf(status: SetupStatusDoc | null, now: number, bundle: BundleStamp | null = null): readonly HomeReminder[] {
    if (status === null) {
        return [];
    }
    return [...installReminder(status, bundle), ...usgsReminder(status.usgs), ...trialReminder(status.billing, now)];
}
