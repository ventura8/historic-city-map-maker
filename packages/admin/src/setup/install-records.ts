/**
 * Where the install cards' last known states are kept (`docs/research/M6-interfaces.md` §1.7): in start-up mode the
 * bootstrap record's `install` (`sessionStorage`), after the claim `setup/status.install` through `setup.recordCloud`.
 * A record holds a target's state, release (with its build time), build id and reason only: no token, address, secret
 * or log line. A target the cards already observed in this session keeps what they saw when it is newer than the record.
 *
 * A record's state says where the target stood against the admin that wrote it (finding 39 of 2026-11-01: the admin
 * 1.0.0+9e2e6b5 recorded its server `installed`; after the redeploy of 1.0.0+457201e the card still said installed and
 * offered no update). A recorded release in place is therefore read again against this admin's own release and build
 * time (`recordedState`): the same release is installed, an older one an update, a newer one newer than this admin.
 */
import {
    installRecordSchema,
    isApiErrorCode,
    type InstallRecord,
    type InstallTarget,
    type ServiceState,
    type SetupInstall,
} from '@hcm/shared';

import { recordedState, type BundleStamp, type InstallTargetView } from '../install/model.js';
import { INSTALL_CHIP, INSTALL_STEP_OF } from './install-steps.js';
import { withStep, type SetupState } from './state.js';

const TARGETS: readonly InstallTarget[] = ['server', 'pipeline', 'site'];

/** The view's reason as a record keeps it: an API code with its values, or nothing. */
function reasonOf(view: InstallTargetView): Pick<InstallRecord, 'detail' | 'params'> {
    const reason = view.error ?? view.blocker;
    if (reason === null || !isApiErrorCode(reason.key)) {
        return {};
    }
    return reason.params === undefined ? { detail: reason.key } : { detail: reason.key, params: reason.params };
}

/** The view's release with its build time (when `timed` and known). */
function releaseOf(view: InstallTargetView, timed: boolean): Pick<InstallRecord, 'release' | 'releaseTime'> {
    if (view.installedRelease === null) {
        return {};
    }
    const time = timed ? view.installedReleaseTime : null;
    return time === null ? { release: view.installedRelease } : { release: view.installedRelease, releaseTime: time };
}

/** The view's release and build, when it names them. */
function buildOf(view: InstallTargetView, timed: boolean): Pick<InstallRecord, 'release' | 'releaseTime' | 'buildId'> {
    const release = releaseOf(view, timed);
    return view.buildId === null ? release : { ...release, buildId: view.buildId };
}

/**
 * What a view keeps of its target for a record (a reason only when it is an API code). `timed` false leaves the build
 * time out: a server from before the build times refuses a record that names one (its schema is strict), so an admin
 * session sends one only once its server is known to read them (`install.ts`).
 */
export function installRecordOf(view: InstallTargetView, now: string, timed = true): InstallRecord {
    const image = view.image === null ? {} : { image: view.image };
    return { state: view.state, ...buildOf(view, timed), ...image, checkedAt: view.checkedAt ?? now, ...reasonOf(view) };
}

/** The targets the cards observed, as records that validate (the bootstrap record's `install`). */
export function observedInstall(state: SetupState, now: string): SetupInstall | undefined {
    const records = TARGETS.flatMap((target) => {
        const view = state.install[target];
        if (view.checkedAt === null) {
            return [];
        }
        const record = installRecordOf(view, now);
        return installRecordSchema.safeParse(record).success ? [[target, record] as const] : [];
    });
    return records.length === 0 ? undefined : Object.fromEntries(records);
}

function newer(record: InstallRecord, view: InstallTargetView): boolean {
    return view.checkedAt === null || Date.parse(record.checkedAt) > Date.parse(view.checkedAt);
}

/** A recorded reason as a message, when it is an API code. */
function codeReason(detail: string | undefined, params: InstallRecord['params']): InstallTargetView['error'] {
    if (detail === undefined || !isApiErrorCode(detail)) {
        return null;
    }
    return params === undefined ? { key: detail } : { key: detail, params };
}

/** A stopped target's recorded reason, as the card shows it. */
function recordedError(record: InstallRecord): InstallTargetView['error'] {
    return record.state === 'failed' ? codeReason(record.detail, record.params) : null;
}

/** A recorded target as the card shows it until the next look. */
function fromRecord(view: InstallTargetView, record: InstallRecord, bundle: BundleStamp): InstallTargetView {
    return {
        ...view,
        state: recordedState(record, bundle),
        installedRelease: record.release ?? null,
        installedReleaseTime: record.releaseTime ?? null,
        buildId: record.buildId ?? null,
        checkedAt: record.checkedAt,
        recorded: true,
        error: recordedError(record),
        image: record.image ?? view.image,
    };
}

function chipOf(view: InstallTargetView): ServiceState {
    return INSTALL_CHIP[view.state];
}

/** `state` with the recorded targets that are newer than what the cards saw (the pipeline's and site's chips with them). */
export function withRecordedInstall(state: SetupState, recorded: SetupInstall | undefined): SetupState {
    return TARGETS.reduce((current, target) => {
        const record = recorded?.[target];
        const view = current.install[target];
        if (record === undefined || !newer(record, view)) {
            return current;
        }
        const next = fromRecord(view, record, { release: current.install.release, time: current.install.releaseTime });
        const installed = { ...current, install: { ...current.install, [target]: next } };
        return target === 'server'
            ? installed
            : withStep(installed, INSTALL_STEP_OF[target], { state: chipOf(next), checkedAt: next.checkedAt });
    }, state);
}
