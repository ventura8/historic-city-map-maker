/**
 * One install target as its card follows it (`docs/research/M6-interfaces.md` §1.5, §1.7): with the owner's live
 * token it looks every 10 s while a build runs and every 60 s otherwise (the tab visible; the injected clock), reads
 * the build's log only when it matters (a server build at work, for the retry lines; a build that stopped, for its
 * step's last lines and `verify`'s missing functions), and derives the card's state. A click installs, updates or
 * tries again: one click, the consent popup only when the token is gone; a build already queued or working is
 * followed, never doubled, and a target newer than the admin is never replaced. A build Google itself ended
 * (`INTERNAL_ERROR`, `EXPIRED`) is submitted again once, without a click.
 */
import {
    installReleaseSlug,
    parseInstallLogLine,
    type InstallLogEvent,
    type InstallState,
    type InstallStepId,
    type InstallTarget,
    type Logger,
} from '@hcm/shared';

import type { CloudBuild } from '../google/cloud-build.js';
import { stepTail, type BuildLogLine } from '../google/logging.js';
import { googleFailure } from '../setup/messages.js';
import { createPoller, type PollOutcome, type Poller } from '../setup/poll.js';
import type { SetupClock, VisibilityPort } from '../setup/ports.js';
import { InstallBundleError } from './bundle.js';
import {
    deriveInstallState,
    endedByGoogle,
    failedStepOf,
    fixedInProvision,
    hasEnded,
    initialTargetView,
    isRunning,
    missingFunctions,
    namedQuota,
    pushedImage,
    pendingRetry,
    stepsOf,
    workStartOnBrowser,
    type InstallTargetView,
} from './model.js';
import type { InstallAccess, InstallerPort, ServerProgress, TargetObservation } from './ports.js';

/** How often the card looks while a build runs, and otherwise (§1.7). */
export const RUNNING_LOOK_MS = 10_000;
export const IDLE_LOOK_MS = 60_000;
/** The one blocker a card re-checks without a Google token (`InstallerPort.localBlocker`). */
const LOCAL_BLOCKER = 'apiError.install.nothingToShow';
/** How long a card follows its target after the last start (a build may queue for an hour and run for another). */
const WATCH_FOR_MS = 3 * 60 * 60_000;

/** The states a click may install from (anything else is in place, running, or newer than the admin). */
const SUBMITTABLE: ReadonlySet<InstallState> = new Set<InstallState>(['notInstalled', 'updateAvailable', 'failed', 'unavailable']);

export interface InstallFlowDeps {
    readonly target: InstallTarget;
    readonly installer: InstallerPort;
    readonly clock: SetupClock;
    readonly visibility: VisibilityPort;
    readonly log: Logger;
    /** The admin's own release. */
    readonly release: string;
    /** Its build time (`runtime.json`'s `releaseTime`, finding 39 of 2026-11-01), or null when the build knows none. */
    readonly releaseTime: number | null;
    /** The live `cloudPlatform` token with enough life left, or null (no popup). */
    readonly liveAccess: () => InstallAccess | null;
    /** From a click: the live token, else Google's consent, opened in the call's synchronous part; null without one. */
    readonly clickAccess: () => Promise<InstallAccess | null>;
    /** Every new view, with the server's functions (the server only). */
    readonly report: (view: InstallTargetView, progress: ServerProgress | null) => void;
    /** Google refused the token (401): the card offers Continue. */
    readonly expired: () => void;
    /**
     * A build is at work but the page holds no live token (its hour ran out, or the page was reloaded): the watch cannot
     * look, so the card says so and offers Continue instead of freezing on its last look (the live finding of 2026-11-14).
     */
    readonly paused: () => void;
}

export interface InstallFlow {
    /** Follows the target with the live token (no click); a running watch goes on. */
    watch(): void;
    /** One look now with the live token (Check again); none without one. */
    refresh(): Promise<void>;
    /** Install, Update or Try again: one click (and the consent when the token is gone). */
    install(): Promise<void>;
    /** As `install`, with a token the caller already holds (Update the map asks once for every target). */
    installWith(access: InstallAccess): Promise<void>;
    /**
     * The owner's confirmed override (the live finding of 2026-11-12): installs the admin's own release over a newer one
     * (a rollback); in any other state it does what `installWith` does.
     */
    installOver(access: InstallAccess): Promise<void>;
    view(): InstallTargetView;
    dispose(): void;
}

/** What the log of the build the card shows says. */
interface LogSummary {
    readonly retry: Extract<InstallLogEvent, { event: 'retry' }> | null;
    /** When the retry line was written (ISO 8601), or ''. */
    readonly retryLineAt: string;
    readonly missing: readonly string[];
    readonly failedStep: InstallStepId | null;
    readonly tail: readonly string[];
    /**
     * Any line of the stopped step names a permission Prepare the project grants (`fixedInProvision`): every line, not the
     * tail, since the Cloud Functions API's 403 of finding 33 comes before one summary line per function.
     */
    readonly fixInProvision: boolean;
    /** The quota the `jobs` step named (finding 47 of 2026-11-01). */
    readonly quota: InstallTargetView['quota'];
    /** M7: the pipeline image's digest the `push` step named. */
    readonly image: string | null;
}

const NO_LOG: LogSummary = {
    retry: null,
    retryLineAt: '',
    missing: [],
    failedStep: null,
    tail: [],
    fixInProvision: false,
    quota: null,
    image: null,
};

function eventsOf(lines: readonly BuildLogLine[]): { readonly events: InstallLogEvent[]; readonly lastAt: string } {
    const events: InstallLogEvent[] = [];
    let lastAt = '';
    for (const line of lines) {
        const event = parseInstallLogLine(line.text);
        if (event !== null) {
            events.push(event);
            lastAt = line.time;
        }
    }
    return { events, lastAt };
}

/** A build that ended without success (its log names why). */
function stoppedBuild(build: CloudBuild): boolean {
    return hasEnded(build) && build.status !== 'SUCCESS';
}

/**
 * The release the card names: the installed one, or, for a target newer than the admin, the newest any part names (a
 * newer server missing a function has no complete release, yet the card says which release it is: finding 2 of the M6
 * security review).
 */
function shownRelease(observation: TargetObservation, state: InstallState): ShownRelease {
    const { installed } = observation;
    const newest = installed.newest ?? null;
    if (state === 'newerInstalled' && newest !== null) {
        return { installedRelease: newest, installedReleaseTime: knownTime(installed.newestTime) };
    }
    return { installedRelease: installed.release, installedReleaseTime: knownTime(installed.releaseTime) };
}

type ShownRelease = Pick<InstallTargetView, 'installedRelease' | 'installedReleaseTime'>;

/**
 * The pipeline image's digest the card keeps (finding 74 of 2026-11-03): the one the job `raster-pipeline` runs, else the
 * one the build's log named, else the one it kept, but only while the release it was kept for is still the one shown.
 * Before, the log was the only source; Cloud Logging lags a build's end, so the first look at a finished update read a
 * log without its last line (the `image` event), cached that summary, and recorded the new release beside the old digest.
 */
function imageOf(observation: TargetObservation, summary: LogSummary, kept: InstallTargetView, release: string | null): string | null {
    const known = observation.installed.image ?? summary.image;
    if (known !== null) {
        return known;
    }
    return kept.installedRelease === release ? kept.image : null;
}

/** A build time an observation may leave out, as the card keeps it. */
function knownTime(time: number | null | undefined): number | null {
    return time ?? null;
}

/** A failed build's step and its last lines; nothing for any other state. */
function failureFields(
    summary: LogSummary,
    state: InstallState,
): Pick<InstallTargetView, 'failedStep' | 'log' | 'fixInProvision' | 'quota'> {
    return state === 'failed'
        ? { failedStep: summary.failedStep, log: summary.tail, fixInProvision: summary.fixInProvision, quota: summary.quota }
        : { failedStep: null, log: [], fixInProvision: false, quota: null };
}

/** When a retry that `waitSeconds` after `writtenAt` tries again, or null without a time. */
function retryTime(writtenAt: string, waitSeconds: number): string | null {
    const written = Date.parse(writtenAt);
    return Number.isNaN(written) ? null : new Date(written + waitSeconds * 1000).toISOString();
}

/** A retrying build's reason and when it tries again; nothing for any other state. */
function retryFields(summary: LogSummary, state: InstallState): Pick<InstallTargetView, 'retryReason' | 'retryAt'> {
    const retry = state === 'retrying' ? summary.retry : null;
    if (retry === null) {
        return { retryReason: null, retryAt: null };
    }
    return { retryReason: retry.reason, retryAt: retryTime(summary.retryLineAt, retry.waitSeconds) };
}

/** What a view takes from the build it follows. */
type BuildField = 'buildId' | 'consoleUrl' | 'startedAt' | 'finishedAt' | 'runningSince' | 'steps';

class TargetFlow implements InstallFlow {
    readonly #deps: InstallFlowDeps;
    readonly #slug: string;
    readonly #poller: Poller;
    #view: InstallTargetView;
    #lastLook = Number.NEGATIVE_INFINITY;
    /** The summaries of builds that ended (their log does not change). */
    readonly #ended = new Map<string, LogSummary>();
    /** Builds Google ended that were submitted again: once since the last click (a second such ending stays failed). */
    readonly #resubmitted = new Set<string>();
    #resubmitAllowed = true;
    /**
     * Where the browser's clock puts the start of each build seen at work (ms), set by the look that first saw it work
     * (`workStartOnBrowser`: the live finding of 2026-11-08, Google's creation time against the browser's clock said
     * "Running for 3 min." the moment Update the map was clicked).
     */
    readonly #workingSince = new Map<string, number>();
    /** When this tab last saw each build queued, on the browser's clock (ms): the build started work after it. */
    readonly #queuedAt = new Map<string, number>();

    constructor(deps: InstallFlowDeps) {
        this.#deps = deps;
        this.#slug = installReleaseSlug(deps.release);
        this.#view = initialTargetView(deps.target);
        this.#poller = createPoller(
            deps,
            { intervalMs: RUNNING_LOOK_MS, stopAfterMs: WATCH_FOR_MS },
            () => this.#tick(),
            () => undefined,
        );
    }

    watch(): void {
        if (!this.#poller.isRunning()) {
            this.#poller.start(true);
        }
    }

    async refresh(): Promise<void> {
        const access = this.#deps.liveAccess();
        if (access !== null) {
            await this.#guarded(() => this.#look(access));
        }
    }

    async install(): Promise<void> {
        const pending = this.#deps.clickAccess();
        this.#set({ busy: true, error: null });
        const access = await pending;
        if (access === null) {
            this.#set({ busy: false });
            return;
        }
        await this.installWith(access);
    }

    installWith(access: InstallAccess): Promise<void> {
        return this.#installWith(access, false);
    }

    installOver(access: InstallAccess): Promise<void> {
        return this.#installWith(access, true);
    }

    async #installWith(access: InstallAccess, over: boolean): Promise<void> {
        this.#set({ busy: true, error: null });
        this.#resubmitAllowed = true;
        await this.#guarded(async () => {
            await this.#look(access);
            const replaces = over && this.#view.state === 'newerInstalled';
            if ((replaces || SUBMITTABLE.has(this.#view.state)) && this.#view.blocker === null) {
                this.#applyBuild(await this.#submit(access, replaces));
            }
        });
        this.#set({ busy: false });
        // A click restarts the watch: its next look comes one running interval later, whatever wait a failed look before
        // the click (an API not on yet, a missing account) had set.
        this.#poller.start(false);
    }

    view(): InstallTargetView {
        return this.#view;
    }

    /** Submits the admin's build; the owner's override is logged with what it replaces (the log crash reports carry). */
    #submit(access: InstallAccess, over: boolean): Promise<CloudBuild> {
        const { target, release, installer } = this.#deps;
        if (!over) {
            return installer.submit(target, access);
        }
        this.#deps.log.warn('install over a newer release', { target, installed: this.#view.installedRelease ?? '', release });
        return installer.submit(target, access, { over: true });
    }

    dispose(): void {
        this.#poller.stop();
    }

    async #tick(): Promise<PollOutcome> {
        const access = this.#deps.liveAccess();
        if (access === null) {
            return this.#withoutToken();
        }
        const wait = isRunning(this.#view.state) ? RUNNING_LOOK_MS : IDLE_LOOK_MS;
        if (this.#deps.clock.now() - this.#lastLook < wait) {
            return 'next';
        }
        return (await this.#guarded(() => this.#look(access))) ? 'next' : this.#afterFailure();
    }

    /**
     * With no Google token the card cannot look at Google: a build at work says so (`paused`, the card offers Continue);
     * a blocker of its own data can still lift (the first city
     * published while the token was gone, finding 13's journey): the watch goes on, once an idle interval, until it has.
     */
    #withoutToken(): Promise<PollOutcome> {
        return isRunning(this.#view.state) ? Promise.resolve(this.#pause()) : this.#lookWithoutToken();
    }

    /** A build at work the watch cannot look at without a token: the card says so and offers Continue. */
    #pause(): PollOutcome {
        this.#deps.log.warn('install watch paused: no live Google token', { target: this.#deps.target, state: this.#view.state });
        this.#deps.paused();
        return 'stop';
    }

    async #lookWithoutToken(): Promise<PollOutcome> {
        if (this.#view.blocker?.key !== LOCAL_BLOCKER) {
            return 'stop';
        }
        if (this.#deps.clock.now() - this.#lastLook < IDLE_LOOK_MS) {
            return 'next';
        }
        this.#lastLook = this.#deps.clock.now();
        const blocker = await this.#deps.installer.localBlocker(this.#deps.target).catch(() => this.#view.blocker);
        this.#set({ blocker });
        return blocker === null ? 'stop' : 'next';
    }

    /** Runs `work`; a failure is shown on the card. True when it worked. */
    async #guarded(work: () => Promise<void>): Promise<boolean> {
        try {
            await work();
            return true;
        } catch (error) {
            this.#fail(error);
            return false;
        }
    }

    #afterFailure(): PollOutcome {
        return this.#view.error?.key === 'adminShell.session.googleExpired' ? 'stop' : 'backoff';
    }

    #fail(error: unknown): void {
        if (error instanceof InstallBundleError) {
            this.#set({ error: error.notice(), looking: false });
            return;
        }
        const failure = googleFailure(error);
        this.#deps.log.warn('install check failed', { target: this.#deps.target, key: failure.message.key });
        if (failure.expired) {
            this.#deps.expired();
        }
        // A failed read says nothing of a build at work: as `unavailable` it no longer counted as running, so Provision's
        // record and the site went in before the server's build settled, and Update the map came back (the review of the
        // stale fixes, finding 71's race).
        const unavailable = failure.state === 'unavailable' && !isRunning(this.#view.state);
        this.#set({ error: failure.message, looking: false, ...(unavailable ? { state: 'unavailable' as const } : {}) });
    }

    async #look(access: InstallAccess): Promise<void> {
        this.#set({ looking: true });
        const observation = await this.#deps.installer.observe(this.#deps.target, access);
        this.#lastLook = this.#deps.clock.now();
        const summary = await this.#summary(observation.build, access);
        const state = deriveInstallState({
            installed: observation.installed,
            build: observation.build,
            bundle: { release: this.#deps.release, time: this.#deps.releaseTime },
            bundleSlug: this.#slug,
            retrying: summary.retry !== null,
            missing: summary.missing,
        });
        this.#show(this.#viewOf(observation, summary, state), observation.progress);
        await this.#resubmitIfGoogleEnded(observation.build, state, access);
    }

    #viewOf(observation: TargetObservation, summary: LogSummary, state: InstallState): InstallTargetView {
        const release = shownRelease(observation, state);
        return {
            ...this.#view,
            state,
            ...release,
            ...this.#buildFields(observation.build),
            ...failureFields(summary, state),
            missing: summary.missing,
            ...retryFields(summary, state),
            blocker: observation.blocker,
            error: null,
            looking: false,
            checkedAt: new Date(this.#deps.clock.now()).toISOString(),
            image: imageOf(observation, summary, this.#view, release.installedRelease),
        };
    }

    #buildFields(build: CloudBuild | null): Pick<InstallTargetView, BuildField> {
        const steps = stepsOf(this.#deps.target, build);
        if (build === null) {
            return { buildId: null, consoleUrl: null, startedAt: null, finishedAt: null, runningSince: null, steps };
        }
        const times = {
            startedAt: build.createTime ?? null,
            finishedAt: build.finishTime ?? null,
            runningSince: this.#runningSince(build),
        };
        return { buildId: build.id, consoleUrl: this.#deps.installer.consoleUrl(build.id), ...times, steps };
    }

    /** When a build at work started, on the browser's clock (ISO 8601); null while it is queued or once it ended. */
    #runningSince(build: CloudBuild): string | null {
        if (build.status === 'QUEUED') {
            this.#queuedAt.set(build.id, this.#deps.clock.now());
        }
        if (build.status !== 'WORKING' || build.startTime === undefined) {
            return null;
        }
        const since = this.#workingSince.get(build.id) ?? workStartOnBrowser(build, this.#deps.clock.now(), this.#queuedAt.get(build.id));
        this.#workingSince.set(build.id, since);
        return new Date(since).toISOString();
    }

    /** The log's summary for `build`: read while a server build works (its retries) and once a build stopped. */
    async #summary(build: CloudBuild | null, access: InstallAccess): Promise<LogSummary> {
        if (build === null || !this.#readsLog(build)) {
            return NO_LOG;
        }
        return this.#ended.get(build.id) ?? (await this.#readSummary(build, access));
    }

    /**
     * A stopped build's log, and a working one's for its retries (the site's prints none; finding 47: the pipeline's may);
     * M7: a pipeline build that ended well too, once, for its image's digest.
     */
    #readsLog(build: CloudBuild): boolean {
        const target = this.#deps.target;
        return stoppedBuild(build) || (target === 'pipeline' && hasEnded(build)) || (build.status === 'WORKING' && target !== 'site');
    }

    async #readSummary(build: CloudBuild, access: InstallAccess): Promise<LogSummary> {
        const summary = this.#summarise(build, await this.#deps.installer.buildLog(build.id, access), stoppedBuild(build));
        if (hasEnded(build)) {
            this.#ended.set(build.id, summary);
        }
        return summary;
    }

    #summarise(build: CloudBuild, lines: readonly BuildLogLine[], stopped: boolean): LogSummary {
        const { events, lastAt } = eventsOf(lines);
        const failedStep = stopped ? failedStepOf(this.#deps.target, build) : null;
        return {
            retry: stopped ? null : pendingRetry(events),
            retryLineAt: lastAt,
            missing: missingFunctions(events),
            failedStep,
            tail: failedStep === null ? [] : stepTail(lines, failedStep),
            fixInProvision: failedStep !== null && fixedInProvision(stepTail(lines, failedStep, Number.POSITIVE_INFINITY)),
            quota: namedQuota(events),
            image: pushedImage(events),
        };
    }

    /** A failed build of the admin's own release that Google ended (its state says so) and that was not resubmitted yet. */
    #googleEnded(build: CloudBuild | null, state: InstallState): build is CloudBuild {
        return this.#resubmitAllowed && build !== null && state === 'failed' && endedByGoogle(build) && !this.#resubmitted.has(build.id);
    }

    async #resubmitIfGoogleEnded(build: CloudBuild | null, state: InstallState, access: InstallAccess): Promise<void> {
        if (!this.#googleEnded(build, state)) {
            return;
        }
        this.#resubmitted.add(build.id);
        this.#resubmitAllowed = false;
        this.#deps.log.warn('install build ended by Google: submitted again', { target: this.#deps.target, status: build.status });
        this.#applyBuild(await this.#deps.installer.submit(this.#deps.target, access));
    }

    /** A build just submitted: queued, its steps waiting. */
    #applyBuild(build: CloudBuild): void {
        this.#show(
            {
                ...this.#view,
                state: 'queued',
                ...this.#buildFields(build),
                failedStep: null,
                log: [],
                fixInProvision: false,
                quota: null,
                missing: [],
                retryReason: null,
                retryAt: null,
                error: null,
            },
            null,
        );
        this.#lastLook = this.#deps.clock.now();
    }

    #set(patch: Partial<InstallTargetView>): void {
        this.#show({ ...this.#view, ...patch }, null);
    }

    #show(view: InstallTargetView, progress: ServerProgress | null): void {
        this.#view = view;
        this.#deps.report(view, progress);
    }
}

/** The flow of one install target. */
export function createInstallFlow(deps: InstallFlowDeps): InstallFlow {
    return new TargetFlow(deps);
}
