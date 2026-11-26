/**
 * `<hcm-worker-panel>` (`docs/research/M7-local-worker.md` §1.1, §4.4, §7; behaviours A62, A63), on the Jobs page and the
 * pipeline card: whether the city's computer is connected (when it was last seen, the job it works on or how its last one
 * ended), the docker command that starts a worker with the pipeline's image by digest (Copy, said in a polite region; the
 * worker's local page; the work folder and the gcloud alternative), or, without a recorded digest, "update the imagery
 * pipeline first" and no command; the city's choice of where new jobs run; and this month's Cloud Run use.
 *
 * Findings 66–68 of 2026-11-02 ("make all of this automagic"): the command is one line that needs no preparation (a
 * Docker named volume, not a folder; detached, named, `--restart unless-stopped`; it first removes an older worker, so
 * the same line also updates it), written for the owner's system (Linux or macOS, Windows PowerShell), with a one-time
 * pairing code that signs the computer in (no browser sign-in), and "Docker is not installed? Get Docker". A connected
 * worker shows its job's step and progress live, says when its image is outdated, and has Disconnect this computer.
 *
 * Finding 72 of 2026-11-02 ("I should not have to copy and paste"): the computer's part is `<hcm-worker-local>` of the
 * lazy `worker-local` chunk (the starter file, the auto-pair, Stop using this computer, the command behind Advanced),
 * asked of the feed once the image's digest is known and stopped with the panel. W5: below it, the city's computers
 * (`<hcm-worker-household>` of the lazy `worker-household` chunk: the list, Add another computer, Remove this computer). M10 (`docs/research/M10-local-ai.md`): the computer's
 * local AI: graphics card, processor only, comes when a frame needs it, or unavailable and why.
 */
import { RUN_CHOICES, type RunChoice, type WorkerAi } from '@hcm/shared';
import { trackFunnel } from '@hcm/shared/funnels';
import { html, type PropertyValues, type TemplateResult } from 'lit';

import { errorTemplate, formatWhen } from '../editing/states.js';
import type { HouseholdPort, LocalPort, PauseLengthPort, WorkerSeenPort, WorkerViewPort } from './worker-port.js';
import { meter, WorkerElement, workerStyles } from './worker-element.js';
import { workerFunnel } from './worker-funnel.js';

export const HCM_WORKER_PANEL_TAG = 'hcm-worker-panel';

const CHOICE_TEXT = {
    auto: 'adminWorker.choice.auto',
    local: 'adminWorker.choice.local',
    cloud: 'adminWorker.choice.cloud',
} as const satisfies Readonly<Record<RunChoice, string>>;

/** Nothing: an outdated computer's version is said in its alert. */
const EMPTY_LINE = html``;

export class HcmWorkerPanel extends WorkerElement {
    static override readonly properties = {
        ...WorkerElement.properties,
        project: { type: String },
        level: { type: Number },
        self: { type: String },
        local: { state: true },
        household: { state: true },
    };

    static override readonly styles = workerStyles;

    /** The project the command names. */
    declare project: string;
    /** The panel's heading level (2 on the Jobs page, 3 in a Setup card). */
    declare level: number;
    /** The signed-in admin's uid ('' when unknown): their own pause says "by you". */
    declare self: string;
    /** This computer's part (finding 72), once the lazy chunk answered. */
    declare local: LocalPort | null;
    /** W5: the city's computers, once the lazy chunk answered. */
    declare household: HouseholdPort | null;
    protected readonly jobId = null;
    /** The computer's part was asked of this feed. */
    #localAsked = false;

    constructor() {
        super();
        this.project = '';
        this.level = 2;
        this.self = '';
        this.local = null;
        this.household = null;
    }

    protected override updated(changed: PropertyValues): void {
        super.updated(changed);
        this.#trackFunnel();
        if (typeof this.view?.image === 'string' && !this.#localAsked && this.feed !== null) {
            this.#localAsked = true;
            void this.#askLocal();
        }
    }

    /** The card's funnel (§200): what changed since the last render, as codes. */
    #trackFunnel(): void {
        if (this.view !== null) {
            trackFunnel(this, workerFunnel(this.view));
        }
    }

    protected override detach(): void {
        super.detach();
        this.local?.stop();
        this.local = null;
        this.household?.stop();
        this.household = null;
        this.#localAsked = false;
    }

    async #askLocal(): Promise<void> {
        const feed = this.feed;
        if (feed === null) {
            return;
        }
        const [local, household] = await Promise.all([
            feed.intents.local(this.project).catch(() => null),
            feed.intents.household(this.project).catch(() => null),
        ]);
        local?.start();
        household?.start();
        this.local = local;
        this.household = household;
    }

    /** W5: the city's computers, once their chunk answered. */
    #household(view: WorkerViewPort): TemplateResult {
        return this.household === null
            ? html``
            : html`<hcm-worker-household
                  .household=${this.household}
                  .locale=${this.locale}
                  .city=${view.city}
                  .level=${this.level + 1}
              ></hcm-worker-household>`;
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return html``;
        }
        return html`<section aria-labelledby="worker-title" data-worker=${view.connected ? 'connected' : 'none'}>
            <div class="title" role="heading" aria-level=${this.level} id="worker-title">${this.t('adminWorker.title')}</div>
            ${this.#status(view)} ${this.#command(view)}
            <p id="choice">${this.t('adminWorker.choice')}</p>
            <hcm-segmented-button
                .label=${this.t('adminWorker.choice')}
                .options=${RUN_CHOICES.map((value) => ({ value, label: this.t(CHOICE_TEXT[value]) }))}
                .value=${view.choice}
                @hcm-change=${(event: CustomEvent<{ value: RunChoice }>) => void this.feed?.intents.setChoice(event.detail.value)}
            ></hcm-segmented-button>
            ${this.refusal(view)} ${meter(this.locale, view.usage)}
        </section>`;
    }

    #status(view: WorkerViewPort): TemplateResult {
        if (view.status === 'error') {
            return errorTemplate(this.locale, view.failure, () => this.feed?.intents.retry());
        }
        const worker = view.worker;
        if (worker === null) {
            return html`<p>${this.t('adminWorker.none')}</p>`;
        }
        const when = formatWhen(this.locale, worker.seenAt);
        return html`${this.#presence(view, worker, when)} ${this.#job(view, worker)} ${this.#ai(view, worker)}
        ${this.#outdated(view, worker)} ${this.#pause(view, worker)} ${this.#disconnect(view, worker)}`;
    }

    /**
     * Connected, or silent: a computer whose last word was "busy on a job" is in a long step (it answers when the step
     * ends), never "not connected" (the owner's report of 2026-11-12); one that was idle is not connected.
     */
    #presence(view: WorkerViewPort, worker: WorkerSeenPort, when: string): TemplateResult {
        if (view.connected) {
            const version = worker.outdated
                ? EMPTY_LINE
                : html`<p data-worker-version>${this.t('adminWorker.version', { version: worker.version })}</p>`;
            return html`<p>${this.t('adminWorker.connected', { when })}</p>
                ${version}`;
        }
        if (worker.state === 'busy' && worker.jobId !== null) {
            return html`<p data-worker-silent="busy">${this.t('adminWorker.busySilent', { when })}</p>
                <p><a href="#/jobs">${this.t('adminWorker.busyHelp')}</a></p>`;
        }
        return html`<p>${this.t('adminWorker.none')} ${this.t('adminWorker.lastSeen', { when })}</p>`;
    }

    /**
     * M10: whether a frame the votes miss can ask the AI on this computer, on which device, or why not. M18 item 9: a starter
     * file older than the local AI is said as what to do and what it unlocks; the one action is Use this computer below.
     */
    #ai(view: WorkerViewPort, { ai }: WorkerSeenPort): TemplateResult {
        if (!view.connected || ai === null) {
            return html``;
        }
        return ai.why === 'old-starter'
            ? html`<p class="alert" data-ai="old-starter">${this.t('adminWorker.ai.oldStarter')}</p>`
            : html`<p class="note" data-ai=${ai.state}>${this.#aiWords(ai)}</p>`;
    }

    #aiWords({ state, why, ...on }: WorkerAi): string {
        if (state === 'unavailable') {
            return this.t('adminWorker.ai.unavailable', { why: this.t(`adminWorker.ai.why.${why ?? 'no-answer'}`) });
        }
        return state === 'ready' ? this.#aiDevice(on) : this.t(`adminWorker.ai.${state}`);
    }

    #aiDevice({ device, deviceName }: Pick<WorkerAi, 'device' | 'deviceName'>): string {
        return device === 'gpu' ? this.t('adminWorker.ai.gpu', { name: deviceName ?? '' }) : this.t('adminWorker.ai.cpu');
    }

    /** Finding 67: a connected worker whose image is not the installed one takes no job until the command runs again. */
    #outdated(view: WorkerViewPort, worker: WorkerSeenPort): TemplateResult {
        return view.connected && worker.outdated
            ? html`<p class="alert" data-outdated>${this.t('adminWorker.outdated', { version: worker.version })}</p>`
            : html``;
    }

    /**
     * Pause this computer (the owner's request of 2026-11-13): Until I resume, For 1 hour, Until tomorrow; a paused one says who paused it,
     * until when, that it took no new work and gave its job back, and offers Resume. Not for a disconnected computer.
     */
    #pause(view: WorkerViewPort, worker: WorkerSeenPort): TemplateResult {
        if (worker.revoked) {
            return html``;
        }
        const paused = worker.paused;
        if (paused === null) {
            const lengths: readonly PauseLengthPort[] = ['forever', 'hour', 'tomorrow'];
            return html`<p id="pause-title">${this.t('adminWorker.pause.computer')}</p>
                <div class="actions" role="group" aria-labelledby="pause-title" data-computer-pause>
                    ${lengths.map(
                        (length) =>
                            html`<hcm-button
                                variant="tonal"
                                icon="pause"
                                ?disabled=${view.acting}
                                @click=${() => void this.feed?.intents.pauseComputer(length)}
                                >${this.t(`adminWorker.pause.${length}`)}</hcm-button
                            >`,
                    )}
                </div>`;
        }
        const until = paused.until === null ? '' : ` ${this.t('adminWorker.pause.until', { when: formatWhen(this.locale, paused.until) })}`;
        return html`<p data-computer-paused=${paused.by === 'computer' ? 'computer' : 'admin'}>
                ${this.#pausedBy(paused.by)}${until} ${this.t('adminWorker.pause.what')}
            </p>
            <div class="actions">
                <hcm-button
                    variant="filled"
                    icon="play_arrow"
                    ?disabled=${view.acting}
                    @click=${() => void this.feed?.intents.pauseComputer(null)}
                    >${this.t('adminWorker.pause.resume')}</hcm-button
                >
            </div>`;
    }

    /** Who paused it: the person at the computer, the signed-in admin, or another admin. */
    #pausedBy(by: string): string {
        if (by === 'computer') {
            return this.t('adminWorker.pause.byComputer');
        }
        return this.t(by === this.self ? 'adminWorker.pause.byYou' : 'adminWorker.pause.byOther');
    }

    /** Disconnect this computer (`worker.revoke`): for a worker not disconnected yet. */
    #disconnect(view: WorkerViewPort, worker: WorkerSeenPort): TemplateResult {
        if (worker.revoked) {
            return html`<p class="note">${this.t('adminWorker.disconnected')}</p>`;
        }
        return html`<div class="actions">
            <hcm-button variant="text" icon="cancel" ?disabled=${view.acting} @click=${() => void this.feed?.intents.disconnect()}
                >${this.t('adminWorker.disconnect')}</hcm-button
            >
        </div>`;
    }

    /** The job it works on (a link, its step and progress live), else how its last one ended. */
    #job(view: WorkerViewPort, worker: WorkerSeenPort): TemplateResult {
        if (worker.state === 'busy' && worker.jobId !== null) {
            const href = ['#/jobs', worker.jobId].join('/');
            return html`<p>${this.t('adminWorker.working')} <a href=${href}>${worker.jobId}</a></p>
                ${this.#progress(view, worker.jobId)}`;
        }
        const last = worker.lastJob;
        if (last === null) {
            return html``;
        }
        const key = last.outcome === 'done' ? 'adminWorker.lastDone' : 'adminWorker.lastFailed';
        return html`<p class="note">${this.t(key, { when: formatWhen(this.locale, last.at) })}</p>`;
    }

    /** Finding 68: the connected worker's job as it runs: its step and how far it got. */
    #progress(view: WorkerViewPort, jobId: string): TemplateResult {
        const job = view.job;
        if (job?.id !== jobId || job.step === null) {
            return html``;
        }
        const progress = job.progress ?? 0;
        const said = this.t('adminWorker.progress', { step: job.step, percent: String(Math.round(progress * 100)) });
        return html`<hcm-progress .value=${progress} .label=${said}></hcm-progress>
            <p class="note" data-progress>${said}</p>`;
    }

    /** This computer's part, or, without a recorded digest, "update the imagery pipeline first" (nothing while asked). */
    #command(view: WorkerViewPort): TemplateResult {
        const image = view.image;
        if (image === null) {
            return html`<p>${this.t('adminWorker.noImage')}</p>
                <a class="external" href="#/setup/pipeline">${this.t('adminWorker.openSetup')}</a>`;
        }
        return image === undefined || this.local === null
            ? html``
            : html`<hcm-worker-local
                      .local=${this.local}
                      .locale=${this.locale}
                      .project=${this.project}
                      .city=${view.city}
                      .image=${image}
                  ></hcm-worker-local>
                  ${this.#household(view)}`;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-worker-panel': HcmWorkerPanel;
    }
}
