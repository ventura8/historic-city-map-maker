/**
 * `<hcm-run-place>` (`docs/research/M7-local-worker.md` §3, §4.3, §7; behaviours A62, A63), on the page of an unfinished
 * version whose job holds no run (`queued`, `waiting_usgs`, `awaiting_gcps`): where the job runs and the switch to the
 * other place (`imagery.runOn` with the job). A cloud job waiting for the admin's OK past the free tier (`free-tier`)
 * shows the run's estimate and the month's use, with **Run in Google Cloud anyway** (the OK) and **Run on my computer**;
 * a job waiting for the computer (`worker`) says so and links the Jobs page, where the worker's command is. Finding 68 of
 * 2026-11-02: one that waited `WORKER_WAIT_MINUTES` with no computer seen (`overdue`) says so and offers **Run in Google
 * Cloud instead** first.
 */
import { WORKER_WAIT_MINUTES, type JobStatus, type RunPlace } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import type { WorkerJobPort, WorkerViewPort } from './worker-port.js';
import { count, meter, WorkerElement, workerStyles } from './worker-element.js';

export const HCM_RUN_PLACE_TAG = 'hcm-run-place';

/** The statuses of a job that holds no run, whose place may change. */
const PLACEABLE: ReadonlySet<JobStatus> = new Set<JobStatus>(['queued', 'waiting_usgs', 'awaiting_gcps']);

const PLACE_TEXT = { local: 'adminWorker.place.local', cloud: 'adminWorker.place.cloud' } as const;

/** Each button's words: on the computer; in the cloud; in the cloud with the OK past the free tier. */
const BUTTON_TEXT = { local: 'adminWorker.runLocal', cloud: 'adminWorker.runCloud', ok: 'adminWorker.runCloudAnyway' } as const;

/** Run in Google Cloud instead (no computer came), else the place's words, or the OK's past the free tier. */
function labelOf(
    place: RunPlace,
    freeTierOk: boolean,
    instead: boolean,
): (typeof BUTTON_TEXT)[keyof typeof BUTTON_TEXT] | 'adminWorker.runCloudInstead' {
    if (instead) {
        return 'adminWorker.runCloudInstead';
    }
    return BUTTON_TEXT[freeTierOk ? 'ok' : place];
}

/** The feed's job while its place may change, else null. */
function placeable(view: WorkerViewPort | null): WorkerJobPort | null {
    const job = view?.job ?? null;
    return job !== null && PLACEABLE.has(job.status) ? job : null;
}

/** M20: a local-only job (an archive's series, its files only on the computer) is never offered the cloud. */
function offered(job: WorkerJobPort, place: RunPlace): boolean {
    return place === 'local' || job.localOnly !== true;
}

export class HcmRunPlace extends WorkerElement {
    static override readonly properties = { ...WorkerElement.properties, job: { type: String } };

    static override readonly styles = workerStyles;

    /** The version's job id. */
    declare job: string;

    constructor() {
        super();
        this.job = '';
    }

    protected get jobId(): string | null {
        return this.job === '' ? null : this.job;
    }

    override render(): TemplateResult {
        const view = this.view;
        const job = placeable(view);
        if (view === null || job === null) {
            return html``;
        }
        return html`<section aria-labelledby="place-title" data-run-on=${job.runOn ?? 'auto'}>
            <h3 id="place-title">${this.t('adminWorker.place')}</h3>
            ${this.#body(view, job)} ${this.refusal(view)}
        </section>`;
    }

    #body(view: WorkerViewPort, job: WorkerJobPort): TemplateResult {
        if (job.waitReason === 'free-tier') {
            const estimate = { vcpu: count(this.locale, job.estimate.vcpuSeconds), gib: count(this.locale, job.estimate.gibSeconds) };
            return html`<p>${this.t('adminWorker.freeTier')}</p>
                <p>${this.t('adminWorker.estimate', estimate)}</p>
                ${meter(this.locale, view.usage)}
                <div class="actions">${this.#button(view, 'cloud', true, false)} ${this.#button(view, 'local', false, false)}</div>`;
        }
        if (job.waitReason === 'worker') {
            return this.#waiting(view, job);
        }
        const places: readonly RunPlace[] = (['local', 'cloud'] as const).filter((place) => place !== job.runOn && offered(job, place));
        return html`<p>${this.t(job.runOn === null ? 'adminWorker.place.auto' : PLACE_TEXT[job.runOn])}</p>
            <div class="actions">${places.map((place) => this.#button(view, place, false, false))}</div>`;
    }

    /** Waiting for the computer; past `WORKER_WAIT_MINUTES` without one, the cloud offered first (finding 68). */
    #waiting(view: WorkerViewPort, job: WorkerJobPort): TemplateResult {
        const overdue = job.overdue
            ? html`<p class="alert" data-overdue>${this.t('adminWorker.waitOverdue', { minutes: String(WORKER_WAIT_MINUTES) })}</p>`
            : html``;
        return html`<p>${this.t('adminWorker.waitWorker')}</p>
            ${overdue}
            <a class="external" href="#/jobs">${this.t('adminWorker.startWorker')}</a>
            ${this.#cloudOffer(view, job)}`;
    }

    /** Run in Google Cloud (instead, once no computer came), unless the job's files are only on the computer. */
    #cloudOffer(view: WorkerViewPort, job: WorkerJobPort): TemplateResult {
        if (!offered(job, 'cloud')) {
            return html``;
        }
        return html`<div class="actions">${this.#button(view, 'cloud', false, job.overdue)}</div>`;
    }

    /** Run on my computer, Run in Google Cloud (instead, filled, once no computer came), or Run in Google Cloud anyway. */
    #button(view: WorkerViewPort, place: RunPlace, freeTierOk: boolean, instead: boolean): TemplateResult {
        const label = labelOf(place, freeTierOk, instead);
        return html`<hcm-button
            variant=${freeTierOk || instead ? 'filled' : 'tonal'}
            icon=${place === 'local' ? 'play_arrow' : 'cloud'}
            ?disabled=${view.acting}
            @click=${() => void this.feed?.intents.runJob(place, freeTierOk)}
            >${this.t(label)}</hcm-button
        >`;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-run-place': HcmRunPlace;
    }
}
