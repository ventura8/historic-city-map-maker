/**
 * The Setup Assistant's install cards (`docs/research/M6-interfaces.md` §1.7, §1.8, §4.1): Install the server (d), the
 * imagery pipeline (d3, started by the same click) and Publish the map (i), each over one install flow
 * (`../install/install-flow.ts`). Each flow's view lands in the state's `install` slice; the pipeline's and the site's
 * steps take their chip from it (the server's step is the deployment's, `deploy.ts`, which also claims). Update the map
 * submits every target that is behind with one click (one consent without a live token): the server first, then the
 * pipeline and the site once the server is installed (2026-11-12: a pipeline image that went in before its server made
 * the local worker's claims refused until the server caught up). Finding 65 of 2026-11-02: the same click and consent also apply the
 * Provision items whose definition changed since the project was last prepared (`provisionDue` on the slice; the
 * pipeline's public pull and the 7-day raw delivery of M7, for one), beside the builds.
 */
import { INSTALL_TARGETS, type InstallState, type InstallTarget, type ServiceState } from '@hcm/shared';

import { createInstallFlow, type InstallFlow } from '../install/install-flow.js';
import { isRunning, type InstallTargetView } from '../install/model.js';
import type { InstallAccess } from '../install/ports.js';
import type { GoogleAccess } from './ports.js';
import type { SetupContext } from './context.js';
import { googleAccess, liveAccess } from './google-access.js';
import { installRecordOf } from './install-records.js';
import { INSTALL_CHIP, INSTALL_STEP_OF } from './install-steps.js';
import type { ProvisionItemState, SetupState } from './state.js';
import type { SetupStepId } from './steps.js';

export interface InstallCards {
    /** Follows `targets` with the live token (no click). */
    watch(targets: readonly InstallTarget[]): void;
    /** Install the server (d): one click; the same click starts the imagery pipeline (d3). */
    installServer(): Promise<void>;
    /** Publish the map, or Try again on a card: one click. */
    install(target: InstallTarget): Promise<void>;
    /** Update the map: one click (and one consent without a live token), counted on `step`'s card. */
    updateMap(step: SetupStepId): Promise<void>;
    /**
     * "Install this admin's version anyway" on the card of a target newer than the admin, once the owner confirmed it (a
     * rollback, the live finding of 2026-11-12): the button and the confirmation (and one consent without a live token).
     */
    installOver(target: InstallTarget): Promise<void>;
    /** Check again on an install card: one look (the consent popup without a live token). */
    recheck(target: InstallTarget): Promise<void>;
    dispose(): void;
}

function accessOf(access: { readonly token: string } | null): InstallAccess | null {
    return access === null ? null : { token: access.token };
}

/** The states Update the map installs from: behind the admin, or stopped (its Try again, finding 1 of the M6 review). */
const UPDATE_STATES: ReadonlySet<InstallState> = new Set<InstallState>(['updateAvailable', 'failed']);

/**
 * Whether Update the map installs `view`'s target: behind or stopped, and the imagery pipeline also when a look found it
 * not installed with nothing in its way (an owner whose server came from GitHub Actions, or whose pipeline was blocked
 * at the first click: finding 3 of the M6 review). The public map's first publish stays its own click (step i). A pipeline
 * this admin's bundle cannot install (`pipelineOff`, finding 43 of 2026-11-01) is never submitted.
 */
function updates(view: InstallTargetView, pipelineOff: boolean): boolean {
    if (view.target === 'pipeline' && pipelineOff) {
        return false;
    }
    return UPDATE_STATES.has(view.state) || missingPipeline(view);
}

/** A pipeline a look found not installed with nothing in its way. */
function missingPipeline(view: InstallTargetView): boolean {
    return view.target === 'pipeline' && view.state === 'notInstalled' && view.checkedAt !== null && view.blocker === null;
}

/** The notices the cards set themselves while an update cannot go on; a look that answers lifts them. */
type WaitNotice = 'adminSetup.install.followPaused' | 'adminSetup.install.waitsForSignIn' | 'adminSetup.install.serverStopped';
const WAIT_NOTICES: ReadonlySet<string> = new Set<WaitNotice>([
    'adminSetup.install.followPaused',
    'adminSetup.install.waitsForSignIn',
    'adminSetup.install.serverStopped',
]);

/**
 * Whether a look lifts `notice`: any answered look a paused watch's or a held update's (the update starts with that
 * token); the server's stop only once the target builds again or is in place.
 */
function lifts(notice: string, view: InstallTargetView): boolean {
    return answered(view) && (notice === 'adminSetup.install.serverStopped' ? buildingOrInPlace(view) : WAIT_NOTICES.has(notice));
}

/** A look that answered: done, without an error. */
function answered(view: InstallTargetView): boolean {
    return view.checkedAt !== null && !view.looking && view.error === null;
}

function buildingOrInPlace(view: InstallTargetView): boolean {
    return isRunning(view.state) || view.state === 'installed';
}

/**
 * The step's chip: a card that shows an error (an update refused, as `adminOutdated` when the admin was redeployed while
 * the server built) never wears the "done" chip that kept it closed (the live finding of 2026-11-14).
 */
function chipOf(view: InstallTargetView): ServiceState {
    const chip = INSTALL_CHIP[view.state];
    return chip === 'ok' && view.error !== null ? 'invalid' : chip;
}

/** The pipeline's reason, kept when it is the bundle's `notAvailable` (any other local answer says nothing of the bundle). */
const PIPELINE_NOT_AVAILABLE = 'apiError.install.notAvailable';

/**
 * The states never recorded: a passing Google outage says nothing of what is installed, and recording it would make
 * Setup look not done until the next look with a token (finding 5 of the M6 review).
 */
const UNRECORDED: ReadonlySet<InstallState> = new Set<InstallState>(['unavailable']);

/**
 * A target a look saw settled: neither running, nor clicked, nor `unavailable` (a read Google could not answer says
 * nothing of the build: the review of the stale fixes, one failed read let Provision's record go to the old server).
 */
function settled(view: InstallTargetView): boolean {
    return view.checkedAt !== null && !isRunning(view.state) && !UNRECORDED.has(view.state) && !view.busy;
}

/**
 * Finding 28 of 2026-10-31: a server build stopped at a permission Prepare the project grants (firebase-tools' actAs check
 * on the App Engine default account): step c's `iam` item is not done after all, so Retry what failed (offered on the
 * server's card) runs that item only. The step's own chip is left as it is: steps (d) onwards wait for (c), and the server
 * card, which says what to do, must stay open.
 */
function needsInstallerPermission(state: SetupState): SetupState {
    const items = state.provision.items.map((item): ProvisionItemState =>
        item.id === 'iam' ? { id: item.id, state: 'invalid', detail: { key: 'adminSetup.provision.installerPermission' } } : item,
    );
    return { ...state, provision: { ...state.provision, items } };
}

/** What a record is made again for: the target's state and, finding 74 of 2026-11-03, the pipeline image it runs. */
function recordKey(view: InstallTargetView): string {
    return `${view.state} ${view.image ?? ''}`;
}

/**
 * Provision's part of an update (`ProvisionFlow.update`), with the update click's token; its record waits for `recordAfter`
 * (the server the same update installs: finding 71).
 */
export type ProvisionUpdate = (access: GoogleAccess, recordAfter: Promise<void>) => Promise<void>;

class Cards implements InstallCards {
    readonly #ctx: SetupContext;
    readonly #provisionUpdate: ProvisionUpdate;
    readonly #flows: Readonly<Record<InstallTarget, InstallFlow>>;
    /**
     * The targets Update the map submits once the server it installs is in: the site (its pages call the new functions)
     * and the pipeline (2026-11-12: the job's image is what `worker.image` hands the local worker, whose claims an older
     * server refuses).
     */
    #afterServerTargets: readonly InstallTarget[] = [];
    /** The state (and image) last recorded of each target (`setup.recordCloud`, an admin session only). */
    readonly #recorded = new Map<InstallTarget, string>();
    /** The records under way, one after another: concurrent ones contend for `setup/status` and may land out of order. */
    #recording: Promise<void> = Promise.resolve();
    /** The stopped server build whose missing permission step c was told of (once: a Retry what failed may follow). */
    #permissionFor: string | null = null;
    /** Finding 71: Update the map's server build settled (installed, failed or stopped); Provision's record waits for it. */
    #serverSettled: (() => void) | null = null;
    /** The one read of whether this admin's bundle can install the pipeline (finding 43 of 2026-11-01). */
    #pipelineChecked: Promise<void> | null = null;

    constructor(ctx: SetupContext, provisionUpdate: ProvisionUpdate) {
        this.#ctx = ctx;
        this.#provisionUpdate = provisionUpdate;
        this.#flows = {
            server: this.#flow('server'),
            pipeline: this.#flow('pipeline'),
            site: this.#flow('site'),
        };
    }

    watch(targets: readonly InstallTarget[]): void {
        if (targets.includes('pipeline')) {
            void this.#checkPipeline();
        }
        targets.forEach((target) => {
            this.#flows[target].watch();
        });
        this.#offerContinueOverRecords(targets);
    }

    /**
     * Lesson 721 (2026-11-14): a page opened without a Google token (the admin reloads itself after a deploy) shows a build
     * that only the record says is at work; its flow has never looked, so it never paused, and step d3 said "Last seen
     * installing" with no button. Such a card now says the follow is paused and offers Continue, whose token looks again.
     */
    #offerContinueOverRecords(targets: readonly InstallTarget[]): void {
        if (this.#live() !== null) {
            return;
        }
        const { install } = this.#ctx.state();
        const stale = targets.filter((target) => install[target].recorded && isRunning(install[target].state));
        this.#tellWaiting(stale, 'adminSetup.install.followPaused', true);
    }

    async installServer(): Promise<void> {
        this.#ctx.count('deploy', 'inputs');
        await this.#flows.server.install();
        await this.#checkPipeline();
        const access = this.#live();
        if (access !== null && this.#pipelineMayInstall()) {
            await this.#flows.pipeline.installWith(access);
        }
    }

    async install(target: InstallTarget): Promise<void> {
        this.#ctx.count(INSTALL_STEP_OF[target], 'inputs');
        await this.#flows[target].install();
    }

    async updateMap(step: SetupStepId): Promise<void> {
        this.#ctx.count(step, 'inputs');
        await this.#checkPipeline();
        // What the cards show: a target recorded behind (`setup/status.install`) counts before its flow has looked.
        if (this.#due().length === 0 && this.#ctx.state().install.provisionDue.length === 0) {
            return;
        }
        const access = await googleAccess(this.#ctx, step, 'cloudPlatform', true);
        // 2026-11-14: a build only a record says is at work no longer hides the update; the click looks at it with its token
        // first and goes on only when no build is at work (finding 71: Provision's record waits for the server's build).
        if (access !== null && (await this.#settledRecords())) {
            await this.#update(this.#due(), this.#ctx.state().install.provisionDue.length > 0, access);
        }
    }

    #due(): readonly InstallTarget[] {
        const { install } = this.#ctx.state();
        return INSTALL_TARGETS.filter((target) => updates(install[target], install.pipelineOff !== null));
    }

    async #settledRecords(): Promise<boolean> {
        const atWork = (target: InstallTarget): boolean => isRunning(this.#ctx.state().install[target].state);
        const stale = INSTALL_TARGETS.filter((target) => this.#ctx.state().install[target].recorded && atWork(target));
        await Promise.all(stale.map((target) => this.#flows[target].refresh()));
        return !INSTALL_TARGETS.some(atWork);
    }

    /**
     * The targets behind built (the pipeline and the site after the server) beside Provision's changed items, with the
     * click's token.
     * Finding 71 of 2026-11-02: Provision's record (`setup.recordCloud` with the item set's version) waits until the server
     * this update installs has settled: the server before it refuses a record naming the set's version (its request schema
     * is strict), so the version reached was never recorded and the card kept offering the update.
     */
    async #update(behind: readonly InstallTarget[], provisionDue: boolean, access: GoogleAccess): Promise<void> {
        this.#afterServerTargets = behind.includes('server') ? behind.filter((target) => target !== 'server') : [];
        const now = behind.filter((target) => !this.#afterServerTargets.includes(target));
        const recordAfter = now.includes('server') ? this.#serverSettles() : Promise.resolve();
        const provision = provisionDue ? [this.#provisionUpdate(access, recordAfter)] : [];
        await Promise.all([...provision, ...now.map((target) => this.#flows[target].installWith({ token: access.token }))]);
    }

    /** Settles once the server's build (which this update submits) has settled; a later update replaces the wait. */
    #serverSettles(): Promise<void> {
        this.#serverSettled?.();
        return new Promise((settled) => {
            this.#serverSettled = settled;
        });
    }

    async installOver(target: InstallTarget): Promise<void> {
        const step = INSTALL_STEP_OF[target];
        this.#ctx.count(step, 'inputs');
        const access = accessOf(await googleAccess(this.#ctx, step, 'cloudPlatform', true));
        if (access !== null) {
            await this.#flows[target].installOver(access);
        }
    }

    async recheck(target: InstallTarget): Promise<void> {
        this.#ctx.count(INSTALL_STEP_OF[target], 'inputs');
        const access = accessOf(await googleAccess(this.#ctx, INSTALL_STEP_OF[target], 'cloudPlatform', true));
        if (access !== null) {
            // An update held for a token (`waitsForSignIn`) goes on: the server's look with this token starts it.
            if (target !== 'server' && this.#afterServerTargets.includes(target)) {
                await this.#flows.server.refresh();
            }
            await this.#flows[target].refresh();
            this.#flows[target].watch();
        }
    }

    dispose(): void {
        INSTALL_TARGETS.forEach((target) => {
            this.#flows[target].dispose();
        });
        this.#serverSettled?.();
        this.#serverSettled = null;
    }

    #live(): InstallAccess | null {
        return accessOf(liveAccess(this.#ctx, 'cloudPlatform'));
    }

    /** Nothing in the pipeline's way: neither this admin's bundle nor its card's last look. */
    #pipelineMayInstall(): boolean {
        return this.#ctx.state().install.pipelineOff === null && this.#flows.pipeline.view().blocker === null;
    }

    /**
     * Reads once, without a token, whether this admin's bundle can install the pipeline (the admin's own origin): when it
     * cannot, the slice says why and the card offers no button (finding 43 of 2026-11-01). A failed read says nothing.
     */
    #checkPipeline(): Promise<void> {
        this.#pipelineChecked ??= this.#ctx.deps.installer
            .localBlocker('pipeline')
            .catch(() => null)
            .then((reason) => {
                if (reason?.key === PIPELINE_NOT_AVAILABLE) {
                    this.#ctx.update((state) => ({ ...state, install: { ...state.install, pipelineOff: reason } }));
                }
            });
        return this.#pipelineChecked;
    }

    #flow(target: InstallTarget): InstallFlow {
        const step = INSTALL_STEP_OF[target];
        const { deps } = this.#ctx;
        return createInstallFlow({
            target,
            installer: deps.installer,
            clock: deps.clock,
            visibility: deps.visibility,
            log: deps.log.child(`install-${target}`),
            release: deps.host.release,
            releaseTime: deps.host.releaseTime,
            liveAccess: () => this.#live(),
            clickAccess: async () => accessOf(await googleAccess(this.#ctx, step, 'cloudPlatform', true)),
            report: (view) => {
                this.#report(view);
            },
            expired: () => {
                this.#ctx.deps.google.drop();
                this.#ctx.patchStep(step, { needsContinue: true });
            },
            paused: () => {
                this.#ctx.patchStep(step, { needsContinue: true, error: { key: 'adminSetup.install.followPaused' } });
            },
        });
    }

    #report(reported: InstallTargetView): void {
        const view = this.#shown(reported);
        this.#ctx.update((state) => ({ ...state, install: { ...state.install, [view.target]: view } }));
        this.#record(view);
        const step = INSTALL_STEP_OF[view.target];
        this.#clearWaitNotice(step, view);
        if (view.target === 'server') {
            this.#ctx.patchStep(step, { busy: view.busy });
            this.#permissionToProvision(view);
            this.#afterServer(view);
            this.#settledServer(view);
            return;
        }
        this.#ctx.patchStep(step, { state: chipOf(view), busy: view.busy, checkedAt: view.checkedAt });
    }

    /** A look that answered lifts the card's own notice of a paused watch or a held update (the step's Continue too). */
    #clearWaitNotice(step: SetupStepId, view: InstallTargetView): void {
        const notice = this.#ctx.state().steps[step].error?.key;
        if (notice !== undefined && lifts(notice, view) && !this.#afterServerTargets.includes(view.target)) {
            this.#ctx.patchStep(step, { needsContinue: false, error: null });
        }
    }

    /**
     * Finding 59 of 2026-11-02: a flow that has not looked at Google yet (an update clicked right after Setup opened, or
     * from Home's tile) reports its first view, "Not installed", with the click's `busy`; the card keeps what it showed
     * (the recorded target) and takes only the click's `busy`, `error`, `blocker` and whether a look runs until the first
     * look. A look Google could not answer shows `unavailable` with its error (the review of 6858f8a: the recorded
     * view won, and a recorded build at work stayed "Checking the installation…" after the read had failed), except over a
     * build recorded at work, which may still run (the review of the stale fixes: as `unavailable` it no longer held back
     * Update the map).
     */
    #shown(view: InstallTargetView): InstallTargetView {
        const known = this.#ctx.state().install[view.target];
        if (view.checkedAt !== null || known.checkedAt === null) {
            return view;
        }
        const failed = view.state === 'unavailable' && !isRunning(known.state) ? { state: view.state } : {};
        return { ...known, busy: view.busy, error: view.error, blocker: view.blocker, looking: view.looking, ...failed };
    }

    /**
     * In an admin session, a target whose state changed is recorded in `setup/status` (Home reads it without a token); in
     * start-up mode the bootstrap record keeps it (`install-records.ts`).
     */
    #record(view: InstallTargetView): void {
        if (!this.#records(view)) {
            return;
        }
        this.#recorded.set(view.target, recordKey(view));
        // Finding 39: a server from before the build times refuses a record naming one; it reads them once it names its own.
        const timed = this.#ctx.state().install.server.installedReleaseTime !== null;
        const install = { [view.target]: installRecordOf(view, this.#ctx.nowIso(), timed) };
        this.#recording = this.#recording
            .then(async () => {
                await this.#ctx.deps.backend.recordCloud({ install });
            })
            .catch((error: unknown) => {
                this.#ctx.deps.log.warn('install state not recorded', { target: view.target, error: String(error) });
            });
    }

    /**
     * An admin session records an observed target whose state (or image, finding 74) changed, but never a passing outage
     * nor a view that is itself a record's (it says nothing new).
     */
    #records(view: InstallTargetView): boolean {
        const changed = view.checkedAt !== null && !view.recorded && this.#recorded.get(view.target) !== recordKey(view);
        return this.#ctx.state().mode === 'normal' && changed && !UNRECORDED.has(view.state);
    }

    /** A stopped server build that lacks a permission of step c marks c's `iam` item to run again, once per build. */
    #permissionToProvision(view: InstallTargetView): void {
        if (!view.fixInProvision || view.buildId === this.#permissionFor) {
            return;
        }
        this.#permissionFor = view.buildId;
        this.#ctx.update(needsInstallerPermission);
    }

    /** Update the map waits for the server, whose build has settled. */
    #afterServerDue(view: InstallTargetView): boolean {
        return this.#afterServerTargets.length > 0 && settled(view);
    }

    /** Finding 71: the server's build, which Provision's record waits for, has settled (see `settled`). */
    #settledServer(view: InstallTargetView): void {
        if (this.#serverSettled !== null && settled(view)) {
            this.#serverSettled();
            this.#serverSettled = null;
        }
    }

    /**
     * Update the map's pipeline and site, once the server they waited for is installed, with the live token; without one
     * they stay held and their cards offer Continue, whose token starts them (2026-11-14). A server that stopped submits
     * neither (a pipeline image ahead of its server would make the local worker's claims refused): their cards say so.
     */
    #afterServer(view: InstallTargetView): void {
        if (!this.#afterServerDue(view)) {
            return;
        }
        const targets = this.#afterServerTargets;
        const access = view.state === 'installed' ? this.#live() : null;
        if (view.state === 'installed' && access === null) {
            // The live finding of 2026-11-14: the update was dropped here with an info line only, so the pipeline never
            // started and its card said nothing. It now stays due, and its card offers Continue, whose token starts it.
            this.#ctx.deps.log.warn('update waits for a live token', { targets: targets.join(',') });
            this.#tellWaiting(targets, 'adminSetup.install.waitsForSignIn', true);
            return;
        }
        this.#releaseAfterServer(view, access);
    }

    /** The held targets go: with the token once the server is in, else (the server stopped) each card says why. */
    #releaseAfterServer(view: InstallTargetView, access: InstallAccess | null): void {
        const targets = this.#afterServerTargets;
        this.#afterServerTargets = [];
        if (access === null) {
            this.#ctx.deps.log.warn('update not started: the server stopped', { targets: targets.join(','), server: view.state });
            this.#tellWaiting(targets, 'adminSetup.install.serverStopped', false);
            return;
        }
        targets.forEach((target) => {
            void this.#flows[target].installWith(access);
        });
    }

    /** Each target an update holds back says why on its card (with Continue when a new token is what it waits for). */
    #tellWaiting(targets: readonly InstallTarget[], key: WaitNotice, needsContinue: boolean): void {
        targets.forEach((target) => {
            this.#ctx.patchStep(INSTALL_STEP_OF[target], { needsContinue, error: { key } });
        });
    }
}

/** The install cards over the Setup Assistant's context. */
export function createInstallCards(ctx: SetupContext, provisionUpdate: ProvisionUpdate): InstallCards {
    return new Cards(ctx, provisionUpdate);
}
