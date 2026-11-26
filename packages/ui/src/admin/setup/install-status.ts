/**
 * What every install card shows of its target (`docs/research/M6-interfaces.md` §1.7, §1.8): the target's state with
 * an icon (never colour alone), what is installed, the build's steps while it runs (the one under way named), Google's
 * retry while a first-deploy race settles, a stopped build's step, its log's last lines (redacted by the admin, shown as
 * text only) and its page in the Google Cloud console, why the card's button is off, and the cost line. The cards'
 * bodies (`hcm-setup-deploy`, `hcm-setup-pipeline`, `hcm-setup-site`) render it with their own button.
 */
import type { InstallState, InstallTarget, UiLocale } from '@hcm/shared';
import { css, html, nothing, type TemplateResult } from 'lit';

import { EMPTY } from '../shell/empty.js';
import type { InstallSliceView, InstallTargetViewPort, SetupIntentsPort, SetupMessage, SetupStepId, SetupViewState } from './setup-port.js';
import { formatDateTime, setupLabel, setupText } from './setup-text.js';

/** The state's icon. */
const STATE_ICONS: Readonly<Record<InstallState, string>> = {
    notInstalled: 'info',
    queued: 'schedule',
    working: 'pending',
    retrying: 'schedule',
    installed: 'check_circle',
    updateAvailable: 'arrow_upward',
    newerInstalled: 'info',
    failed: 'error',
    unavailable: 'warning',
};

const STEP_ICONS: Readonly<Record<InstallTargetViewPort['steps'][number]['state'], string>> = {
    done: 'check_circle',
    now: 'pending',
    waiting: 'schedule',
    failed: 'error',
};

/** The states in which a click installs (the card's own button: Install, Publish, Try again). */
export const INSTALLABLE_STATES: ReadonlySet<InstallState> = new Set<InstallState>(['notInstalled', 'failed', 'unavailable']);

/** The pipeline card's states whose button is Try again. */
const PIPELINE_TRY_AGAIN: ReadonlySet<InstallState> = new Set<InstallState>(['failed', 'unavailable']);

/** The server card's own button: an installable state the card has seen (a done step offers nothing before a look). */
export function serverOffersInstall(state: SetupViewState): boolean {
    const view = state.install.server;
    const looked = state.steps.deploy.state !== 'ok' || view.checkedAt !== null;
    return looked && INSTALLABLE_STATES.has(view.state);
}

/** The bundle's reason the pipeline cannot be installed from this admin (§67e), as a look at Google also reports it. */
const PIPELINE_NOT_AVAILABLE = 'apiError.install.notAvailable';

/**
 * Why this admin cannot install the pipeline at all (finding 43 of 2026-11-01): its bundle's answer, read without a token
 * (`pipelineOff`), or the same answer from the card's last look; null when nothing says so.
 */
export function pipelineOffReason(install: InstallSliceView): SetupMessage | null {
    const looked = install.pipeline.blocker;
    return install.pipelineOff ?? (looked?.key === PIPELINE_NOT_AVAILABLE ? looked : null);
}

/**
 * The pipeline installs on its own click: looked at, not installed, and the server's click is no longer what starts it
 * (the server is in place or was installed some other way). Never while this admin cannot install it.
 */
export function pipelineInstallsAlone(state: SetupViewState): boolean {
    const { server, pipeline } = state.install;
    const alone = pipeline.state === 'notInstalled' && pipeline.checkedAt !== null && server.state !== 'notInstalled';
    return alone && pipelineOffReason(state.install) === null;
}

/** The pipeline card's Try again: after a stopped build, or a look Google could not answer; never while it is off. */
export function pipelineTriesAgain(state: SetupViewState): boolean {
    return PIPELINE_TRY_AGAIN.has(state.install.pipeline.state) && pipelineOffReason(state.install) === null;
}

/**
 * The pipeline as its card shows it: with this admin's reason it cannot install it as the card's blocker ("Not available
 * yet: …", known without a look at Google), else as the last look saw it.
 */
export function pipelineShown(install: InstallSliceView): InstallTargetViewPort {
    const off = pipelineOffReason(install);
    return off === null ? install.pipeline : { ...install.pipeline, blocker: off };
}

/** What each install card's body offers that asks Google: its own button, or Update the map. */
const CARD_BUTTONS: Readonly<Record<InstallTarget, (state: SetupViewState) => boolean>> = {
    server: serverOffersInstall,
    pipeline: (state) => pipelineTriesAgain(state) || pipelineInstallsAlone(state),
    site: (state) => INSTALLABLE_STATES.has(state.install.site.state),
};

/** The states whose card offers a button that asks Google: Update the map, or Install this admin's version anyway. */
const ASKING_STATES: ReadonlySet<InstallState> = new Set<InstallState>(['updateAvailable', 'newerInstalled']);

/** The install cards' steps and their targets. */
const STEP_TARGETS: Partial<Readonly<Record<SetupStepId, InstallTarget>>> = { deploy: 'server', pipeline: 'pipeline', site: 'site' };

/**
 * Finding 40 of 2026-11-01: whether an install card's body shows a button that asks Google for its token (Install,
 * Publish, Try again, Install the pipeline, Update the map), so Google's consent note goes with it. A card with nothing
 * to do (installed, no update; a build under way) shows no note; one newer than this admin offers the override, which
 * asks (the live finding of 2026-11-12). Its Check again still asks Google, as Continue does after an expired token, beside which the frame keeps the note. Any other step: true.
 */
export function installCardAsks(state: SetupViewState, step: SetupStepId): boolean {
    const target = STEP_TARGETS[step];
    if (target === undefined) {
        return true;
    }
    return ASKING_STATES.has(state.install[target].state) || CARD_BUTTONS[target](state);
}

/** The blockers whose fix is Prepare the project (step c): the card links it. */
const FIXED_IN_PROVISION: ReadonlySet<string> = new Set(['apiError.install.notProvisioned', 'apiError.install.noRepository']);

const RUNNING: ReadonlySet<InstallState> = new Set<InstallState>(['queued', 'working', 'retrying']);

export const installStatusStyles = css`
    .install {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .install-state {
        display: flex;
        gap: 8px;
        align-items: center;
        margin: 0;
        font-weight: var(--md-sys-typescale-label-large-weight);

        --hcm-icon-size: 20px;
    }

    .install-state[data-state='installed'] hcm-icon,
    .build-steps [data-state='done'] hcm-icon {
        color: var(--md-sys-color-primary);
    }

    .install-state[data-state='failed'] hcm-icon,
    .build-steps [data-state='failed'] hcm-icon {
        color: var(--md-sys-color-error);
    }

    .build-steps {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .build-steps li {
        display: grid;
        grid-template-columns: 20px minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
        min-block-size: 32px;

        --hcm-icon-size: 18px;
    }

    .build-steps .step-state {
        color: var(--md-sys-color-on-surface-variant);
    }

    .build-steps [data-state='now'] {
        font-weight: var(--md-sys-typescale-label-large-weight);
    }

    .log {
        box-sizing: border-box;
        max-inline-size: 100%;
        max-block-size: 320px;
        margin: 0;
        padding: 8px 12px;
        overflow: auto;
        border-radius: var(--md-sys-shape-corner-small);
        background: var(--md-sys-color-surface-container-highest);
        color: var(--md-sys-color-on-surface);
        font-family: ui-monospace, monospace;
        font-size: var(--md-sys-typescale-body-small-size);
        line-height: var(--md-sys-typescale-body-small-line-height);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }

    /* Every link and disclosure of the install cards is a 48 px target (M3's minimum on a compact or medium window). */
    .install a,
    a.public-map {
        display: inline-flex;
        align-items: center;
        min-block-size: 48px;
        color: var(--md-sys-color-primary);
    }

    /* A disclosure keeps its marker (display: list-item): 14 px above and below its 20 px line make 48 px. */
    details.github > summary {
        box-sizing: border-box;
        min-block-size: 48px;
        padding-block: 14px;
        cursor: pointer;
    }

    .blocker {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 8px;
        align-items: center;
    }
`;

/** What a card renders the status with: its target, the slice, the language and the intents. */
export interface InstallStatusInput {
    readonly target: InstallTarget;
    readonly slice: InstallSliceView;
    readonly locale: UiLocale;
    readonly intents: SetupIntentsPort | null;
    /** The card's step (Update the map counts its click there). */
    readonly step: SetupStepId;
}

function label(input: InstallStatusInput, key: Parameters<typeof setupLabel>[1], params?: Readonly<Record<string, string>>): string {
    return setupLabel(input.locale, key, params);
}

function text(input: InstallStatusInput, message: SetupMessage): string {
    return setupText(input.locale, message);
}

/** The view of the input's target. */
function targetOf(input: Pick<InstallStatusInput, 'target' | 'slice'>): InstallTargetViewPort {
    return input.slice[input.target];
}

/** True while a build of the target is queued or working. */
function installRunning(view: InstallTargetViewPort): boolean {
    return RUNNING.has(view.state);
}

/**
 * A build a record says is at work and no look has confirmed yet (the live finding of 2026-11-08): it may have ended
 * since, so the card says when it was last seen (and that it is checking, while a look runs) instead of "Installing" and
 * steps all "next".
 */
function unconfirmed(view: InstallTargetViewPort): boolean {
    return view.recorded === true && installRunning(view);
}

/** The card's own button may install now: an installable state, no blocker, no click in progress. */
export function mayInstall(view: InstallTargetViewPort): boolean {
    return INSTALLABLE_STATES.has(view.state) && view.blocker === null && !view.busy;
}

/** When a recorded build was last seen at work, as the page formats it. */
function lastSeen(input: InstallStatusInput, view: InstallTargetViewPort): string {
    return view.checkedAt === null ? '' : formatDateTime(input.locale, view.checkedAt);
}

/**
 * A recorded build at work, until a look says where it is now: "Checking the installation…" only while a look runs (the
 * review of 6858f8a: with no Google token nothing looks, and the card said it was checking for good); otherwise when it
 * was last seen and Check again.
 */
function recordedLine(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    const date = lastSeen(input, view);
    if (view.looking !== true) {
        return html`<p class="install-state" data-state="lastSeen" role="status">
            <hcm-icon name="schedule"></hcm-icon>${label(input, 'adminSetup.install.lastSeenCheckAgain', { date })}
        </p>`;
    }
    return html`<p class="install-state" data-state="checking" role="status">
            <hcm-icon name="schedule"></hcm-icon>${label(input, 'adminSetup.install.state.checking')}
        </p>
        <p class="note">${label(input, 'adminSetup.install.lastSeenRunning', { date })}</p>`;
}

function stateLine(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    if (unconfirmed(view)) {
        return recordedLine(input, view);
    }
    return html`<p class="install-state" data-state=${view.state} role="status">
        <hcm-icon name=${STATE_ICONS[view.state]}></hcm-icon>${label(input, `adminSetup.install.state.${view.state}`)}
    </p>`;
}

function installedLine(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    const release = view.installedRelease;
    if (release === null || view.state === 'newerInstalled') {
        return EMPTY;
    }
    // A release recorded or installed elsewhere (GitHub Actions) has no build of this admin to date it.
    const text =
        view.finishedAt === null
            ? label(input, 'adminSetup.install.installedRelease', { release })
            : label(input, 'adminSetup.install.installed', { release, date: formatDateTime(input.locale, view.finishedAt) });
    return html`<p class="note">${text}</p>`;
}

function stepsList(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    return html`<ol class="build-steps" aria-label=${label(input, 'adminSetup.install.steps')}>
        ${view.steps.map(
            (step) =>
                html`<li data-step=${step.id} data-state=${step.state} aria-current=${step.state === 'now' ? 'step' : nothing}>
                    <hcm-icon name=${STEP_ICONS[step.state]}></hcm-icon><span>${label(input, `adminSetup.install.step.${step.id}`)}</span
                    ><span class="step-state">${label(input, `adminSetup.install.stepState.${step.state}`)}</span>
                </li>`,
        )}
    </ol>`;
}

function minutesBetween(from: string | null, to: string | null): number | null {
    if (from === null || to === null) {
        return null;
    }
    const minutes = Math.floor((Date.parse(to) - Date.parse(from)) / 60_000);
    return Number.isNaN(minutes) ? null : Math.max(0, minutes);
}

/**
 * How long the build has been at work, on the browser's clock from when it started work (`runningSince`): nothing while
 * it is queued (the live finding of 2026-11-08: Google's creation time against the browser's clock said "Running for 3
 * min." the moment Update the map was clicked).
 */
function runningFor(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    const minutes = minutesBetween(view.runningSince ?? null, view.checkedAt);
    return minutes === null
        ? EMPTY
        : html`<p class="note">${label(input, 'adminSetup.install.runningFor', { minutes: String(minutes) })}</p>`;
}

function retryLine(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    if (view.state !== 'retrying' || view.retryReason === null) {
        return EMPTY;
    }
    const what = label(input, `adminSetup.install.retry.${view.retryReason}`);
    const time = view.retryAt === null ? '' : formatDateTime(input.locale, view.retryAt);
    return html`<p class="note retrying">${label(input, 'adminSetup.install.retrying', { what, time })}</p>`;
}

function running(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    if (!installRunning(view) || unconfirmed(view)) {
        return EMPTY;
    }
    return html`${stepsList(input, view)}${runningFor(input, view)}${retryLine(input, view)}`;
}

function consoleLink(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    if (view.consoleUrl === null) {
        return EMPTY;
    }
    return html`<a href=${view.consoleUrl} target="_blank" rel="noopener noreferrer"
        >${label(input, 'adminSetup.install.openBuild')}<span class="visually-hidden"> ${label(input, 'adminSetup.newTab')}</span></a
    >`;
}

function logLines(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    if (view.log.length === 0) {
        return html`<p class="note">${label(input, 'adminSetup.install.logEmpty')}</p>`;
    }
    return html`<p class="note">${label(input, 'adminSetup.install.logTitle')}</p>
        <pre class="log" tabindex="0" aria-label=${label(input, 'adminSetup.install.logTitle')}>${view.log.join('\n')}</pre>`;
}

function missingLine(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    return view.missing.length === 0
        ? EMPTY
        : html`<p class="missing">${label(input, 'adminSetup.install.missing', { names: view.missing.join(', ') })}</p>`;
}

function stopped(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    if (view.state !== 'failed') {
        return EMPTY;
    }
    const step = view.failedStep === null ? '' : label(input, `adminSetup.install.step.${view.failedStep}`);
    return html`<p class="failed-at">${label(input, 'adminSetup.install.failedAt', { step })}</p>
        ${fixLine(input, view)} ${quotaLine(input, view)} ${missingLine(input, view)} ${logLines(input, view)} ${consoleLink(input, view)}`;
}

/**
 * The Google Cloud console's Quotas page of `projectId`, filtered to the API `service`: the link `gcp.quotas` of
 * `packages/admin/src/setup/links.json`, which the weekly contract check probes (`packages/admin/test/setup/links.test.ts`
 * keeps this copy equal to it).
 */
export function quotasUrl(projectId: string, service: string): string {
    return `https://console.cloud.google.com/iam-admin/quotas?project=${encodeURIComponent(projectId)}&service=${encodeURIComponent(service)}`;
}

/**
 * A build Google stopped for a quota (finding 47 of 2026-11-01, the `jobs` step's `quota` line): Try again alone meets the
 * same limit, so the card names the quota, says a free-trial project has lower ones, and links its Quotas page (the
 * project is the one of the build's console page).
 */
function quotaLine(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    const { quota } = view;
    if (quota === null) {
        return EMPTY;
    }
    const project = new URL(view.consoleUrl ?? 'https://console.cloud.google.com/').searchParams.get('project') ?? '';
    return html`<p class="blocker" data-fix="quota">
        <span
            >${label(input, 'adminSetup.install.quota', { metric: quota.metric, limit: quota.limit })}
            ${label(input, 'adminSetup.install.quotaFix')}</span
        >
        <a href=${quotasUrl(project, quota.service)} target="_blank" rel="noopener noreferrer"
            >${label(input, 'adminSetup.install.openQuotas')}<span class="visually-hidden"> ${label(input, 'adminSetup.newTab')}</span></a
        >
    </p>`;
}

/**
 * A build that stopped because the installer lacks a permission Prepare the project grants (finding 28 of 2026-10-31,
 * firebase-tools' actAs check): Try again alone would stop the same way, so the card offers step c's Retry what failed
 * first, from here (it reruns the `iam` item only), then Try again.
 */
function fixLine(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    if (!view.fixInProvision) {
        return EMPTY;
    }
    return html`<p class="blocker fix" data-fix="provision">
        <span>${label(input, 'adminSetup.install.fixInProvision')}</span>
        <hcm-button
            variant="outlined"
            icon="cloud"
            @click=${() => {
                input.intents?.provision();
            }}
            >${label(input, 'adminSetup.install.retryProvision')}</hcm-button
        >
    </p>`;
}

/**
 * Finding 65 of 2026-11-02: the server card's update also applies the Provision items changed since the project was
 * last prepared; the card names them (their state is step c's rows).
 */
function provisionDueLine(input: InstallStatusInput): TemplateResult {
    const due = input.target === 'server' ? input.slice.provisionDue : [];
    if (due.length === 0) {
        return EMPTY;
    }
    const items = due.map((id) => label(input, `adminSetup.provision.item.${id}`)).join(', ');
    return html`<p class="note" data-provision-due>${label(input, 'adminSetup.install.provisionDue', { items })}</p>`;
}

/**
 * A build of any target is queued or at work, or a click on one is on its way (Update the map's click starts them all).
 * A build only a record says is at work does not hide Update the map (2026-11-14: the pipeline's record of 23:20 hid it with no
 * word why, until the owner found Check again on another card); the click looks at such builds first with its own token and
 * goes on only once none is at work (`updateMap`), so Provision's record still waits for the server (the race of finding 71).
 */
function building(slice: InstallSliceView): boolean {
    return [slice.server, slice.pipeline, slice.site].some((target) => (installRunning(target) && !unconfirmed(target)) || target.busy);
}

/**
 * An update is offered: the release is behind, or (the server's card) Provision's items changed; never while a build runs
 * (finding 70 of 2026-11-02: the card showed Update the map and the Provision line beside the build it had started).
 */
function updateOffered(input: InstallStatusInput, view: InstallTargetViewPort): boolean {
    const due = view.state === 'updateAvailable' || (input.target === 'server' && input.slice.provisionDue.length > 0);
    return due && !building(input.slice);
}

/**
 * A target newer than this admin (the live finding of 2026-11-12): no Update (the downgrade guard), but the owner may
 * install this admin's release anyway after a confirmation (`<hcm-install-over>`), never while a build runs.
 */
function newerLine(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    const installed = view.installedRelease ?? '';
    return html`<p class="note">${label(input, 'adminSetup.install.newer', { release: installed })}</p>
        <hcm-install-over
            .target=${input.target}
            .locale=${input.locale}
            .installed=${installed}
            .release=${input.slice.release}
            .intents=${input.intents}
            ?disabled=${view.busy || building(input.slice)}
        ></hcm-install-over>`;
}

function updateLine(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    if (view.state === 'newerInstalled') {
        return newerLine(input, view);
    }
    if (!updateOffered(input, view)) {
        return EMPTY;
    }
    const release =
        view.state === 'updateAvailable'
            ? html`<p>${label(input, 'adminSetup.install.update', { release: input.slice.release })}</p>`
            : EMPTY;
    return html`${release} ${provisionDueLine(input)}
        <div class="actions">
            <hcm-button
                variant="filled"
                icon="arrow_upward"
                ?disabled=${view.busy}
                @click=${() => {
                    input.intents?.updateMap(input.step);
                }}
                >${label(input, 'adminSetup.install.updateAction')}</hcm-button
            >
        </div>`;
}

/** Why the button is off, with a link to step c when Prepare the project fixes it. */
export function blockerLine(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    const { blocker } = view;
    if (blocker === null) {
        return EMPTY;
    }
    const toProvision = FIXED_IN_PROVISION.has(blocker.key);
    return html`<p class="blocker" data-blocker=${blocker.key}>
        <span>${label(input, 'adminSetup.install.offReason')}</span><span>${text(input, blocker)}</span>
        ${
            toProvision
                ? html`<hcm-button
                      variant="text"
                      @click=${() => {
                          input.intents?.open('provision');
                      }}
                      >${label(input, 'adminSetup.install.openProvision')}</hcm-button
                  >`
                : nothing
        }
    </p>`;
}

/** The frame's cost line of each install card's step (the frame leaves it to the card: one cost line per card). */
const STEP_COST: Readonly<Record<InstallTarget, 'adminSetup.cost.deploy' | 'adminSetup.cost.pipeline' | 'adminSetup.cost.site'>> = {
    server: 'adminSetup.cost.deploy',
    pipeline: 'adminSetup.cost.pipeline',
    site: 'adminSetup.cost.site',
};

/** What one Publish the map moves out of Hosting's free daily transfer (the site's card only). */
function transferText(input: InstallStatusInput): string {
    return input.target === 'site'
        ? ` ${label(input, 'adminSetup.install.site.transfer', { megabytes: String(input.slice.siteTransferMegabytes) })}`
        : '';
}

/**
 * The card's one cost line (finding 10 of the M6 review: the frame's and the body's were two): the step's running cost,
 * the target's build minutes against Cloud Build's free minutes a month and, for the public map, the Hosting transfer
 * each publish moves (finding 4 of the M6 security review).
 */
export function costLine(input: InstallStatusInput): TemplateResult {
    const free = new Intl.NumberFormat(input.locale === 'ro' ? 'ro-RO' : 'en-GB').format(input.slice.freeMinutes);
    const minutes = String(input.slice.estimates[input.target]);
    const build = label(input, 'adminSetup.install.cost', { minutes, free });
    return html`<p class="note cost">${label(input, STEP_COST[input.target])} ${build}${transferText(input)}</p>`;
}

/** The status of the input's target: every part that applies to its state. */
export function installStatus(input: InstallStatusInput): TemplateResult {
    const view = targetOf(input);
    return html`<div class="install" data-target=${input.target} data-state=${view.state}>
        ${stateLine(input, view)} ${installedLine(input, view)} ${running(input, view)} ${stopped(input, view)} ${updateLine(input, view)}
        <div role="alert">${view.error === null ? nothing : html`<p class="alert">${text(input, view.error)}</p>`}</div>
    </div>`;
}
