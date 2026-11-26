/**
 * Step (c), Provision cloud (`docs/research/M2b-interfaces.md` §3.3 c, §3.4): one click and one `cloudPlatform`
 * consent run the provisioner, which reports every doctor item as it settles; Retry what failed (one click) runs only
 * the items that are not `ok`; Continue after an expired token does the same. The scheduler item stays `pending` until
 * the first deploy creates its job, and the doctor checks it once step (d) is done. In normal mode the card's Re-check
 * runs the read-only doctor, and every result is recorded at once with `setup.recordCloud`.
 *
 * Finding 34 of 2026-11-01 (`docs/research/manual-test-2026-10-25.md`): what a run records is what it reported, `missing`
 * included (an item that went back to missing is recorded so, and the server's record follows reality both ways), never
 * an item Google refused with 401 (an expired token says nothing about the item). Without a Google token Re-check
 * changes nothing: the step keeps its recorded state and says when it was last checked.
 */
import { isApiErrorCode, PROVISION_ITEMS, type ProvisionItem, type RecordCloudRequest } from '@hcm/shared';

import type { SetupContext } from './context.js';
import { googleAccess, liveAccess } from './google-access.js';
import { apiFailure, googleFailure, setupMessage } from './messages.js';
import type { GoogleAccess, ProvisionItemResult } from './ports.js';
import { reachedVersion, updateItems } from './provision-version.js';
import { itemMessage } from './records.js';
import { provisionHealth, type ProvisionItemState, type SetupState } from './state.js';

export interface ProvisionFlow {
    /** "Prepare the project", "Retry what failed" and Continue: one click, one consent. */
    run(): Promise<void>;
    /** Normal mode's Re-check: the read-only doctor (one click, one consent). */
    recheck(): Promise<void>;
    /** After the deployment, with the live token: the scheduler's job now exists. */
    checkScheduler(): Promise<void>;
    /**
     * Finding 65 of 2026-11-02: an update's part, with the update click's token: the items whose definition changed since
     * the project was last prepared (`updateItems`), then the set version reached recorded, once `recordAfter` settled
     * (finding 71: the server the same update installs). Nothing when none is due.
     */
    update(access: GoogleAccess, recordAfter?: Promise<void>): Promise<void>;
}

/** The reason of an item Google refused with 401: the step's token expired. */
const EXPIRED = 'adminShell.session.googleExpired';

type Runner = (
    access: GoogleAccess,
    only: readonly ProvisionItem[] | null,
    onItem: (item: ProvisionItemResult) => void,
) => Promise<unknown>;

function withItem(state: SetupState, item: ProvisionItemResult): SetupState {
    const detail = itemMessage(item);
    const items = state.provision.items.map((current): ProvisionItemState =>
        current.id === item.id ? { id: item.id, state: item.state, detail } : current,
    );
    return { ...state, provision: { ...state.provision, items } };
}

/** An item no run reported (`missing` with no reason): the record predates it, or the doctor found it absent. */
function unreported(item: ProvisionItemState): boolean {
    return item.state === 'missing' && item.detail === null;
}

/**
 * The items a rerun touches: those not `ok`; every item (null) when none is `ok` yet, or when one was never reported
 * (`unreported`). A record from before an item existed is stale as a whole: Provision's items of M6 also changed what an
 * `ok` of before meant (the installer's account in `service-accounts`, its roles and `roles/run.invoker` in `iam`), so
 * re-running only the new item would never create them (finding 2 of the M6 review). Every item is idempotent.
 */
function pendingItems(items: readonly ProvisionItemState[]): readonly ProvisionItem[] | null {
    const todo = items.filter((item) => item.state !== 'ok');
    const stale = todo.length === items.length || todo.some(unreported);
    return stale ? null : todo.map((item) => item.id);
}

type RecordedItem = NonNullable<RecordCloudRequest['provision']>['items'][number];

/** An item as `setup.recordCloud` accepts it: its reason only when that is an API error code. */
function recordedItem(item: ProvisionItemResult): RecordedItem {
    const { id, state, detail, params } = item;
    if (detail === undefined || !isApiErrorCode(detail)) {
        return { id, state };
    }
    return params === undefined ? { id, state, detail } : { id, state, detail, params };
}

/** An item Google refused with 401: the token expired, which says nothing about the item. */
function refused(item: ProvisionItemResult): boolean {
    return item.detail === EXPIRED;
}

/**
 * `setup.recordCloud`'s request: the items this run reported, `missing` ones included (finding 34), never one refused
 * with 401, in screen order, with the item set's version when the run brought every item due since `recorded` to `ok`
 * (finding 65); null when there is none.
 */
function provisionRequest(reported: readonly ProvisionItemResult[], recorded: number | undefined): RecordCloudRequest | null {
    const items = reported.filter((item) => !refused(item)).sort((a, b) => PROVISION_ITEMS.indexOf(a.id) - PROVISION_ITEMS.indexOf(b.id));
    const setVersion = reachedVersion(items, recorded);
    const version = setVersion === undefined ? {} : { setVersion };
    return items.length === 0 ? null : { provision: { items: items.map(recordedItem), ...version } };
}

/** How a click runs: Prepare the project and Retry what failed (`run`), or normal mode's read-only Re-check (`doctor`). */
interface RunMode {
    readonly onlyPending: boolean;
    readonly doctor: boolean;
    /** The items an update runs (finding 65); otherwise every item or the pending ones. */
    readonly only?: readonly ProvisionItem[];
    /** Finding 71: the record waits for this (the server an update installs, which knows the item set's version). */
    readonly recordAfter?: Promise<void>;
}

const RUN: RunMode = { onlyPending: true, doctor: false };
const DOCTOR: RunMode = { onlyPending: false, doctor: true };

class Provision implements ProvisionFlow {
    constructor(private readonly ctx: SetupContext) {}

    async run(): Promise<void> {
        await this.start((access, only, onItem) => this.ctx.deps.cloud.provision(access, only, onItem), RUN);
    }

    async recheck(): Promise<void> {
        await this.start((access, _only, onItem) => this.ctx.deps.cloud.doctor(access, null, onItem), DOCTOR);
    }

    async update(access: GoogleAccess, recordAfter: Promise<void> = Promise.resolve()): Promise<void> {
        const due = updateItems(this.ctx.state().provision);
        if (due.length === 0) {
            return;
        }
        this.ctx.patchStep('provision', { busy: true, error: null });
        const run: Runner = (granted, only, onItem) => this.ctx.deps.cloud.provision(granted, only, onItem);
        await this.runWith(run, access, { onlyPending: false, doctor: false, only: due, recordAfter });
    }

    async checkScheduler(): Promise<void> {
        const access = liveAccess(this.ctx, 'cloudReadOnly');
        if (access === null) {
            return;
        }
        try {
            await this.ctx.deps.cloud.doctor(access, ['scheduler'], (item) => {
                this.onItem(item, true);
            });
            this.settle();
        } catch (error) {
            this.ctx.deps.log.warn('scheduler not checked', { reason: googleFailure(error).message.key });
        }
    }

    private async start(runner: Runner, mode: RunMode): Promise<void> {
        this.ctx.count('provision', 'inputs');
        this.ctx.patchStep('provision', { busy: true, error: null });
        const access = await this.access(mode);
        if (access !== null) {
            await this.runWith(runner, access, mode);
        }
    }

    /** The token for the click; without one, a Re-check leaves the recorded state and says when it was last checked. */
    private async access(mode: RunMode): Promise<GoogleAccess | null> {
        const access = await googleAccess(this.ctx, 'provision', 'cloudPlatform', true);
        if (access === null && mode.doctor) {
            this.keepRecorded();
        }
        return access;
    }

    /**
     * Finding 34 of 2026-11-01: no token, so nothing was checked: the chip keeps what the server recorded, and a closed
     * consent says "Last checked <time>; sign in to Google Cloud to check again" (any other refusal keeps its own reason).
     */
    private keepRecorded(): void {
        const step = this.ctx.state().steps.provision;
        if (step.error?.key === 'adminShell.oauth.popupClosed' && step.checkedAt !== null) {
            this.ctx.patchStep('provision', { error: setupMessage('adminSetup.provision.lastChecked', { time: step.checkedAt }) });
        }
    }

    private async runWith(runner: Runner, access: GoogleAccess, mode: RunMode): Promise<void> {
        const only = mode.only ?? (mode.onlyPending ? pendingItems(this.ctx.state().provision.items) : null);
        const reported = new Map<ProvisionItem, ProvisionItemResult>();
        try {
            await runner(access, only, (item) => {
                reported.set(item.id, item);
                this.onItem(item, mode.doctor);
            });
            // The card stays busy until the run is recorded: a Retry what failed clicked while the record is on its way
            // could be overwritten by it, the server applying the older run last (S-A04-BAD-API-STILL-DISABLED).
            this.settle(true);
            await mode.recordAfter;
            await this.record([...reported.values()]);
            this.ctx.patchStep('provision', { busy: false });
            this.failIfExpired([...reported.values()]);
        } catch (error) {
            this.settle();
            this.ctx.fail('provision', googleFailure(error));
        }
    }

    /**
     * The provisioner stopped at an item Google answered 401 (the token expired mid-run, S-A04-BAD-TOKEN-EXPIRED-MID-RUN):
     * the token is dropped and the card offers Continue, which asks Google again and runs what is not done.
     */
    private failIfExpired(reported: readonly ProvisionItemResult[]): void {
        if (reported.some(refused)) {
            this.ctx.fail('provision', googleFailure({ kind: 'unauthorized' }));
        }
    }

    /** An item's result on its row; the doctor's 401 is no news of the item (finding 34): its row keeps what it showed. */
    private onItem(item: ProvisionItemResult, doctor: boolean): void {
        if (!(doctor && refused(item))) {
            this.ctx.update((state) => withItem(state, item));
        }
    }

    /** The step's state from its items; `busy` while what follows the run (its record) is still on its way. */
    private settle(busy = false): void {
        const state = provisionHealth(this.ctx.state().provision.items);
        this.ctx.patchStep('provision', { state, busy, checkedAt: this.ctx.nowIso() });
    }

    private async record(reported: readonly ProvisionItemResult[]): Promise<void> {
        const request = provisionRequest(reported, this.ctx.state().provision.setVersion);
        if (this.ctx.state().mode !== 'normal' || request === null) {
            return;
        }
        try {
            const { status } = await this.ctx.deps.backend.recordCloud(request);
            this.ctx.applyStatus(status);
        } catch (error) {
            this.ctx.fail('provision', apiFailure(error));
        }
    }
}

export function createProvisionFlow(ctx: SetupContext): ProvisionFlow {
    return new Provision(ctx);
}
