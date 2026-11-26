/**
 * What an install card shows of its target (`docs/research/M6-interfaces.md` §1.7), derived from what Google says:
 * the installed release (the functions' `HCM_RELEASE`, the jobs' `hcm-release` label, the site's `/release.json`) and
 * the target's newest build (its status, its steps, the last `HCM_INSTALL` events of its log). Pure functions over
 * plain data: the flows (`install-flow.ts`) observe, these decide.
 */
import {
    CLOUD_BUILD_FREE_MINUTES,
    compareRelease,
    INSTALL_ESTIMATES,
    INSTALL_RUNNING_STATES,
    INSTALL_STEPS,
    RELEASE_PATTERN,
    SITE_PUBLISH_TRANSFER_MB,
    type InstallLogEvent,
    type InstallState,
    type InstallStepId,
    type InstallTarget,
    type ProvisionItem,
    type TransientDeployReason,
} from '@hcm/shared';

import type { CloudBuild, CloudBuildStatus } from '../google/cloud-build.js';
import type { SetupMessage } from '../setup/messages.js';

/** What the card says of one build step. */
type StepProgressState = 'done' | 'now' | 'waiting' | 'failed';

export interface StepProgress {
    readonly id: InstallStepId;
    readonly state: StepProgressState;
}

/** A message the card shows (a key of the Setup Assistant's or the API's catalogue, with its values). */
export type InstallMessage = SetupMessage;

/** What is installed of a target now. */
export interface InstalledInfo {
    /** The target is in place (every function `ACTIVE`, both jobs, a public site). */
    readonly complete: boolean;
    /** Its release; null when it names none (a deploy from before M6) or nothing is installed. */
    readonly release: string | null;
    /** Its release's build time (finding 39 of 2026-11-01); null or absent when the installed parts name none. */
    readonly releaseTime?: number | null;
    /**
     * Part of it is in place but not all (some functions, one job): a server from before M6 that lacks the new functions,
     * or an install that stopped half way. It is offered as an update, never as a first install (finding 1 of the M6
     * review). Absent: false.
     */
    readonly partial?: boolean;
    /**
     * The newest release any installed part names, complete or not (absent: `release`). An admin older than it never
     * submits: the deploy's `--force` would delete the newer release's functions (finding 2 of the M6 security review).
     */
    readonly newest?: string | null;
    /** `newest`'s build time; null or absent when it names none. */
    readonly newestTime?: number | null;
    /**
     * The pipeline only (finding 74 of 2026-11-03): the digest of the image the job `raster-pipeline` runs, which the
     * build that set its release label pushed; null or absent when it runs none by digest (or for another target).
     */
    readonly image?: string | null;
}

/** One target as the card shows it. */
export interface InstallTargetView {
    readonly target: InstallTarget;
    readonly state: InstallState;
    readonly installedRelease: string | null;
    /** The installed release's build time (finding 39), or null when it names none. */
    readonly installedReleaseTime: number | null;
    /** The build the card follows or last saw (null: none yet), and its page in the Google Cloud console. */
    readonly buildId: string | null;
    readonly consoleUrl: string | null;
    /** When that build was created, and when it finished (ISO 8601, Google's clock). */
    readonly startedAt: string | null;
    readonly finishedAt: string | null;
    /**
     * When the build started work, on the browser's clock (`install-flow.ts`), or null while it is queued or ended: the
     * live finding of 2026-11-08, the card set Google's creation time against the browser's clock and said "Running for
     * 3 min." the moment Update the map was clicked.
     */
    readonly runningSince: string | null;
    readonly steps: readonly StepProgress[];
    /** The step a failed build stopped at. */
    readonly failedStep: InstallStepId | null;
    /** A failed build's step's last lines (redacted, as text). */
    readonly log: readonly string[];
    /**
     * The failed build's log says the installer lacks a permission Prepare the project grants (finding 28 of 2026-10-31,
     * `fixedInProvision`): the card sends the owner to step c's Retry what failed before Try again.
     */
    readonly fixInProvision: boolean;
    /** The quota a failed `jobs` step named (finding 47 of 2026-11-01), or null. */
    readonly quota: InstallQuota | null;
    /** `verify`'s missing or failed functions. */
    readonly missing: readonly string[];
    /** `retrying`: why, and when the build tries again (ISO 8601). */
    readonly retryReason: TransientDeployReason | null;
    readonly retryAt: string | null;
    /** Why the card's button is off (not provisioned, no repository, nothing to show), or null. */
    readonly blocker: InstallMessage | null;
    /** A click is being handled (the submit, or the consent before it). */
    readonly busy: boolean;
    /** The last action's or check's failure, shown until the next one. */
    readonly error: InstallMessage | null;
    /** ISO 8601 of the last observation. */
    readonly checkedAt: string | null;
    /**
     * The view is a record's (`setup/status.install` or the bootstrap record), not this session's look at Cloud Build:
     * the live finding of 2026-11-08, a build recorded at work was shown "Installing" with every step "next" until the
     * first look said "An update is ready", so a card shows a recorded build at work as being checked, not as running.
     */
    readonly recorded: boolean;
    /** A look at Cloud Build is under way (a recorded build at work reads "Checking the installation…" only then). */
    readonly looking: boolean;
    /**
     * M7 (`docs/research/M7-local-worker.md` §1.1): the pipeline image's digest, which the local worker's command names:
     * finding 74 of 2026-11-03, the one the job `raster-pipeline` runs (`InstalledInfo.image`), else the one its build's
     * log named (the `image` event), else the one shown before for the same release; null until one is known.
     */
    readonly image: string | null;
}

/** A target nothing is known of yet. */
export function initialTargetView(target: InstallTarget): InstallTargetView {
    return {
        target,
        state: 'notInstalled',
        installedRelease: null,
        installedReleaseTime: null,
        buildId: null,
        consoleUrl: null,
        startedAt: null,
        finishedAt: null,
        runningSince: null,
        steps: INSTALL_STEPS[target].map((id) => ({ id, state: 'waiting' })),
        failedStep: null,
        log: [],
        fixInProvision: false,
        quota: null,
        missing: [],
        retryReason: null,
        retryAt: null,
        blocker: null,
        busy: false,
        error: null,
        checkedAt: null,
        recorded: false,
        looking: false,
        image: null,
    };
}

const QUEUED: ReadonlySet<CloudBuildStatus> = new Set(['STATUS_UNKNOWN', 'PENDING', 'QUEUED']);
const FAILED: ReadonlySet<CloudBuildStatus> = new Set(['FAILURE', 'TIMEOUT', 'CANCELLED', 'INTERNAL_ERROR', 'EXPIRED']);
/** Google's side ended the build, not the build itself: the flow submits it again once, without a click (§1.5). */
const GOOGLE_ENDED: ReadonlySet<CloudBuildStatus> = new Set(['INTERNAL_ERROR', 'EXPIRED']);

const RELEASE_TAG_PREFIX = 'hcm-r-';

/** The build's release slug, from the tag `hcm-r-<slug>` it carries. */
export function buildSlug(build: CloudBuild): string | null {
    const tag = build.tags.find((candidate) => candidate.startsWith(RELEASE_TAG_PREFIX));
    return tag === undefined ? null : tag.slice(RELEASE_TAG_PREFIX.length);
}

/** The admin's own release and its build time: what an install installs (finding 39 of 2026-11-01). */
export interface BundleStamp {
    readonly release: string;
    readonly time: number | null;
}

/** An installed release against the admin's: negative when older, 0 when the same, positive when newer. */
function orderAgainst(release: string, time: number | null | undefined, bundle: BundleStamp): number {
    return compareRelease(release, bundle.release, { installed: time ?? null, bundle: bundle.time });
}

/** Some installed part names a release newer than the admin's, whether or not the target is complete. */
function newerThanBundle(installed: InstalledInfo, bundle: BundleStamp): boolean {
    const newest = installed.newest ?? null;
    if (newest !== null) {
        return orderAgainst(newest, installed.newestTime, bundle) > 0;
    }
    return installed.release !== null && orderAgainst(installed.release, installed.releaseTime, bundle) > 0;
}

/** The order of an installed release against the admin's: newer (whatever is missing), partial, installed or update. */
function installedState(installed: InstalledInfo, bundle: BundleStamp): InstallState {
    if (newerThanBundle(installed, bundle)) {
        return 'newerInstalled';
    }
    if (!installed.complete) {
        return installed.partial === true ? 'updateAvailable' : 'notInstalled';
    }
    return completeState(installed, bundle);
}

/** The state of an installed release against the admin's: the same, behind it (Update) or ahead of it. */
export function releaseState(order: number): InstallState {
    if (order === 0) {
        return 'installed';
    }
    return order < 0 ? 'updateAvailable' : 'newerInstalled';
}

/** A complete target's release against the admin's (one naming none is from before M6: an update replaces it). */
function completeState(installed: InstalledInfo, bundle: BundleStamp): InstallState {
    return releaseState(installed.release === null ? -1 : orderAgainst(installed.release, installed.releaseTime, bundle));
}

/** What a record keeps of a target's release (`installRecordSchema`'s state, release and build time). */
export interface RecordedRelease {
    readonly state: InstallState;
    readonly release?: string | undefined;
    readonly releaseTime?: number | undefined;
}

/** The recorded states that say a release is in place: they are read again against this admin's release. */
const RECORDED_IN_PLACE: ReadonlySet<InstallState> = new Set<InstallState>(['installed', 'updateAvailable', 'newerInstalled']);

/**
 * A recorded target's state against this admin (finding 39): a release in place is ordered against the admin's own
 * release and build time; any other state (a build under way or stopped, nothing installed) is kept as recorded, and so
 * is every state for an admin without a release of its own (`dev`, the e2e world's `e2e`), which cannot order one.
 */
export function recordedState(record: RecordedRelease, bundle: BundleStamp): InstallState {
    if (record.release === undefined || !RECORDED_IN_PLACE.has(record.state) || !RELEASE_PATTERN.test(bundle.release)) {
        return record.state;
    }
    return releaseState(orderAgainst(record.release, record.releaseTime, bundle));
}

export interface StateInput {
    readonly installed: InstalledInfo;
    /** The target's newest build, or null. */
    readonly build: CloudBuild | null;
    /** The admin's own release (its bundle's) with its build time, and its slug. */
    readonly bundle: BundleStamp;
    readonly bundleSlug: string;
    /** The build's last `HCM_INSTALL` event is a retry it still waits on. */
    readonly retrying: boolean;
    /** `verify` printed missing or failed functions. */
    readonly missing: readonly string[];
}

/** A build that is queued or working. */
function isActive(build: CloudBuild | null): build is CloudBuild {
    return build !== null && (QUEUED.has(build.status) || build.status === 'WORKING');
}

/** The newest build is the admin's own and failed, or it succeeded while `verify` named missing functions. */
function failedOwnBuild(input: StateInput): boolean {
    const { build } = input;
    if (build === null) {
        return false;
    }
    const ownFailed = FAILED.has(build.status) && buildSlug(build) === input.bundleSlug;
    return ownFailed || (build.status === 'SUCCESS' && input.missing.length > 0);
}

/** States that mean the admin's release (or a newer one) is in place: a failed build before them no longer matters. */
const IN_PLACE: ReadonlySet<InstallState> = new Set<InstallState>(['installed', 'newerInstalled']);

/**
 * The target's state (§1.7): a build that runs decides first; then a failed build of the admin's own release that left
 * the target short of that release; then what is installed against the admin's release.
 */
export function deriveInstallState(input: StateInput): InstallState {
    if (isActive(input.build)) {
        return runningState(input.build, input.retrying);
    }
    const settled = installedState(input.installed, input.bundle);
    return failedOwnBuild(input) && !IN_PLACE.has(settled) ? 'failed' : settled;
}

/** A build that runs: queued, at work, or waiting on a retry it printed. */
function runningState(build: CloudBuild, retrying: boolean): InstallState {
    if (QUEUED.has(build.status)) {
        return 'queued';
    }
    return retrying ? 'retrying' : 'working';
}

/** True while a build of the target is queued or working (a click follows it instead of submitting another). */
export function isRunning(state: InstallState): boolean {
    return INSTALL_RUNNING_STATES.has(state);
}

function stepState(status: CloudBuildStatus | undefined, current: boolean): StepProgressState {
    if (status === 'SUCCESS') {
        return 'done';
    }
    if (status !== undefined && FAILED.has(status)) {
        return 'failed';
    }
    return current ? 'now' : 'waiting';
}

/** The step under way: the first one not done, while the build works. */
function currentStep(target: InstallTarget, build: CloudBuild | null, statuses: ReadonlyMap<string, CloudBuildStatus>): string | undefined {
    if (build?.status !== 'WORKING') {
        return undefined;
    }
    return INSTALL_STEPS[target].find((id) => statuses.get(id) !== 'SUCCESS');
}

/** Each step of the target's definition with its progress in `build` (the first one not done is `now` while it runs). */
export function stepsOf(target: InstallTarget, build: CloudBuild | null): readonly StepProgress[] {
    const statuses = new Map((build === null ? [] : build.steps).map((step) => [step.id, step.status]));
    const current = currentStep(target, build, statuses);
    return INSTALL_STEPS[target].map((id) => ({ id, state: stepState(statuses.get(id), id === current) }));
}

/** The step a failed build stopped at: the first failed one, else the first not done. */
export function failedStepOf(target: InstallTarget, build: CloudBuild): InstallStepId | null {
    const steps = stepsOf(target, build);
    return (steps.find((step) => step.state === 'failed') ?? steps.find((step) => step.state !== 'done'))?.id ?? null;
}

/**
 * What firebase-tools prints when a check refuses the installer a permission that Prepare the project's `iam` item
 * grants: its own `checkServiceAccountIam` (actAs on the App Engine default account) and `checkHttpIam`
 * (`cloudfunctions.functions.setIamPolicy` for a new HTTPS function), finding 28 of 2026-10-31; and the Cloud Functions
 * API's 403 for each function it builds as the Compute Engine default account ("Caller is missing permission
 * 'iam.serviceaccounts.actAs'", finding 33), which the second pattern also matches. Each pattern is linear.
 */
const PROVISION_FIX_PATTERNS: readonly RegExp[] = [
    /Missing permissions required for functions deploy/i,
    /iam\.serviceAccounts\.actAs/i,
    /to deploy new HTTPS functions/i,
];

/** Whether a stopped step's lines name a permission Prepare the project grants (Retry what failed in step c). */
export function fixedInProvision(log: readonly string[]): boolean {
    return log.some((line) => PROVISION_FIX_PATTERNS.some((pattern) => pattern.test(line)));
}

/** The last retry the log names, if it is the build's last event (a later event means the build moved on). */
export function pendingRetry(events: readonly InstallLogEvent[]): Extract<InstallLogEvent, { event: 'retry' }> | null {
    const last = events.at(-1);
    return last?.event === 'retry' ? last : null;
}

/** A `quota` event of the log: the quota Google refused for (finding 47 of 2026-11-01). */
export type InstallQuota = Extract<InstallLogEvent, { event: 'quota' }>;

/** The last quota the log named, or null. */
export function namedQuota(events: readonly InstallLogEvent[]): InstallQuota | null {
    return events.findLast((event): event is InstallQuota => event.event === 'quota') ?? null;
}

/** The pipeline image's digest the log's last `image` event named, or null. */
export function pushedImage(events: readonly InstallLogEvent[]): string | null {
    return events.findLast((event): event is Extract<InstallLogEvent, { event: 'image' }> => event.event === 'image')?.digest ?? null;
}

/** The functions `verify` named, in the order it named them, once each. */
export function missingFunctions(events: readonly InstallLogEvent[]): readonly string[] {
    return [...new Set(events.flatMap((event) => (event.event === 'missing' || event.event === 'failed' ? [event.name] : [])))];
}

/** Whether a build ended on Google's side (resubmitted once, §1.5). */
export function endedByGoogle(build: CloudBuild | null): boolean {
    return build !== null && GOOGLE_ENDED.has(build.status);
}

/** An ISO 8601 time in ms, or NaN. */
function timeOf(iso: string | undefined): number {
    return iso === undefined ? Number.NaN : Date.parse(iso);
}

/**
 * How long a started build has worked at least, on Google's own clock (ms): its latest step time after its start, 0
 * without one. The browser's clock may be minutes from Google's (the live finding of 2026-11-08), so the card counts the
 * rest on the browser's clock from the look that saw the build at work.
 */
export function elapsedOnGoogle(build: CloudBuild): number {
    const start = timeOf(build.startTime);
    const times = build.steps.flatMap((step) => [timeOf(step.startTime), timeOf(step.endTime)]).filter((time) => !Number.isNaN(time));
    return Number.isNaN(start) ? 0 : Math.max(start, ...times) - start;
}

/**
 * Where the browser's clock puts the start of a build at work (ms; the review of the running-time line): Google's start
 * time, but never before the browser saw the build queued (`queuedAt`: a clock ahead of Google's, the live finding of
 * 2026-11-08) nor after `now` less what it has worked at least on Google's own clock (a clock behind Google's, or a start
 * that is no time). A build first seen at work, partway through a long step, counts from its start, not from its last
 * step time. A clock ahead of Google's still adds its lead for a build this tab never saw queued.
 */
export function workStartOnBrowser(build: CloudBuild, now: number, queuedAt = Number.NEGATIVE_INFINITY): number {
    const latest = now - elapsedOnGoogle(build);
    const stated = timeOf(build.startTime);
    return Number.isNaN(stated) ? latest : Math.min(latest, Math.max(queuedAt, stated));
}

/** Whether a build has ended, one way or another. */
export function hasEnded(build: CloudBuild | null): boolean {
    return build !== null && (build.status === 'SUCCESS' || FAILED.has(build.status));
}

/** The Setup Assistant's install slice: the admin's release, where the map is published, the costs, each target. */
export interface InstallSlice {
    /** The admin's own release (what Install and Update install). */
    readonly release: string;
    /** Its build time (finding 39 of 2026-11-01), or null when the build knows none: recorded states are read against it. */
    readonly releaseTime: number | null;
    /** `https://<project>.web.app/`: where Publish the map puts the public map. */
    readonly address: string;
    /** Cloud Build's free minutes a month, and each target's estimate (§1.9). */
    readonly freeMinutes: number;
    readonly estimates: Readonly<Record<InstallTarget, number>>;
    /** What one Publish the map moves out of Hosting's free daily transfer, in MB (§1.9). */
    readonly siteTransferMegabytes: number;
    readonly server: InstallTargetView;
    readonly pipeline: InstallTargetView;
    readonly site: InstallTargetView;
    /**
     * Why this admin's bundle cannot install the imagery pipeline (`apiError.install.notAvailable`: no Docker builder
     * digest, §67e), or null when it can or is not read yet. Finding 43 of 2026-11-01: known from the admin's own origin
     * without a token, so the pipeline card offers no button that could only be refused, whatever a record says.
     */
    readonly pipelineOff: InstallMessage | null;
    /**
     * Finding 65 of 2026-11-02: the Provision items whose definition changed since the project was last prepared; the
     * server card's Update the map applies them in the same click (empty: none, or never prepared).
     */
    readonly provisionDue: readonly ProvisionItem[];
}

/** Nothing observed yet. */
export function initialInstallSlice(release: string, address: string, releaseTime: number | null = null): InstallSlice {
    return {
        release,
        releaseTime,
        address,
        freeMinutes: CLOUD_BUILD_FREE_MINUTES,
        estimates: {
            server: INSTALL_ESTIMATES.server.buildMinutes,
            pipeline: INSTALL_ESTIMATES.pipeline.buildMinutes,
            site: INSTALL_ESTIMATES.site.buildMinutes,
        },
        siteTransferMegabytes: SITE_PUBLISH_TRANSFER_MB,
        server: initialTargetView('server'),
        pipeline: initialTargetView('pipeline'),
        site: initialTargetView('site'),
        pipelineOff: null,
        provisionDue: [],
    };
}
