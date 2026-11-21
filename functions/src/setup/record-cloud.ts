import {
    PROVISION_ITEMS,
    timestampFromDate,
    type CallableRequest,
    type CallableResponse,
    type ProvisionItem,
    type ServiceState,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import type { Ports } from '../ports/index.js';
import { commitStatus, stampOf, type SetupStatusFields } from './records.js';
import { applyInstallReport } from './record-install.js';
import { applyLaterParts } from './record-later.js';
import { toSetupStatusView } from './view.js';

export type RecordCloudDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Request = CallableRequest<'setup.recordCloud'>;
type Response = CallableResponse<'setup.recordCloud'>;
type ProvisionRecord = NonNullable<SetupStatusFields['provision']>;
type ProvisionItemRecord = NonNullable<ProvisionRecord['items']>[number];
type Timestamp = ReturnType<typeof timestampFromDate>;

/** Worst first: the provisioning doctor's area takes the worst state of its items. */
const SEVERITY: readonly ServiceState[] = ['invalid', 'unavailable', 'missing', 'pending', 'ok'];

/** The worst of `states` (`ok` for none). */
function worstState(states: readonly ServiceState[]): ServiceState {
    return states.reduce<ServiceState>((worst, state) => (SEVERITY.indexOf(state) < SEVERITY.indexOf(worst) ? state : worst), 'ok');
}

/** The item whose resource only the first deploy creates (`ops.tick`'s Cloud Scheduler job). */
const AFTER_DEPLOY_ITEM: ProvisionItem = 'scheduler';

/** An item's weight in the area's state: a scheduler still waiting for the first deploy counts as done. */
function itemState(id: ProvisionItem, state: ServiceState): ServiceState {
    return id === AFTER_DEPLOY_ITEM && state === 'pending' ? 'ok' : state;
}

/** The reported items (the last report of an id wins) replace the stored ones with the same id; the others stay. */
function mergeItems(
    stored: readonly ProvisionItemRecord[],
    reported: NonNullable<Request['provision']>,
    checkedAt: Timestamp,
): ProvisionItemRecord[] {
    const fresh = [...new Map(reported.items.map((item) => [item.id, { ...item, checkedAt }])).values()];
    const kept = stored.filter((item) => !fresh.some((report) => report.id === item.id));
    return [...kept, ...fresh].sort((left, right) => PROVISION_ITEMS.indexOf(left.id) - PROVISION_ITEMS.indexOf(right.id));
}

function provisionRecord(
    current: ProvisionRecord | undefined,
    reported: NonNullable<Request['provision']>,
    checkedAt: Timestamp,
): ProvisionRecord {
    const items = mergeItems(current?.items ?? [], reported, checkedAt);
    // An item never reported counts as `missing`, so the area is `ok` only once every item is; the scheduler's job is
    // created by the first deploy, so its `pending` (waiting for that deploy) does not hold the area back (CR-M2b-21 b).
    const states = PROVISION_ITEMS.map((id) => itemState(id, items.find((item) => item.id === id)?.state ?? 'missing'));
    return { state: worstState(states), checkedAt, items, ...setVersionOf(current, reported) };
}

/** Finding 65: the item set's version the run brought the project to; a run that does not say keeps the recorded one. */
function setVersionOf(
    current: ProvisionRecord | undefined,
    reported: NonNullable<Request['provision']>,
): Pick<ProvisionRecord, 'setVersion'> {
    const setVersion = reported.setVersion ?? current?.setVersion;
    return setVersion === undefined ? {} : { setVersion };
}

function applyReport(current: SetupStatusFields, request: Request, checkedAt: Timestamp): SetupStatusFields {
    const provision =
        request.provision === undefined ? {} : { provision: provisionRecord(current.provision, request.provision, checkedAt) };
    // [section setup-ux] M6 (docs/research/M6-interfaces.md §4.1, §3.1): billing (its likely trial kept), USGS later.
    const reported = applyLaterParts(current, request, checkedAt);
    // [end setup-ux]
    // [section install] owner: installer (M6, §1.7): each install target's last known state.
    return applyInstallReport({ ...reported, ...provision }, request);
    // [end install]
}

/**
 * `setup.recordCloud` (admin; PLAN Addendum 1, scenario A04): the browser-side Google Cloud steps (billing and the $5
 * budget through `cloudbilling` and `billingbudgets`, the "Provision cloud" doctor, all with the admin's own token)
 * report what they found; the server stamps the caller and stores it. The provisioning area is as good as its worst
 * item, and every one of `PROVISION_ITEMS` must be reported `ok` before it is.
 */
export async function recordCloud(deps: RecordCloudDeps, caller: VerifiedCaller, request: Request): Promise<Response> {
    const now = deps.clock.now();
    const checkedAt = timestampFromDate(now);
    const status = await commitStatus(deps.documents, stampOf(caller.uid, deps), (current) => applyReport(current, request, checkedAt));
    deps.log.info('cloud setup recorded', { uid: caller.uid, billing: request.billing?.state, provision: status.provision?.state });
    return { status: toSetupStatusView(status, now) };
}
