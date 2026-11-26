/**
 * `<hcm-job-pause>` (the owner's request of 2026-11-13; `docs/research/M7-local-worker.md` → *Pause*; behaviour A170), on the Jobs
 * page's job and a version's page: **Pause** on a pipeline job that is queued or running, and **Resume** on a paused one. A paused
 * job says who paused it and when, and that Resume puts it back in the queue to go on from the step where it stopped; a running one
 * asked to pause says it stops after the step it is on.
 */
import type { JobStatus } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { formatWhen } from '../editing/states.js';
import type { WorkerJobPort, WorkerViewPort } from './worker-port.js';
import { WorkerElement, workerStyles } from './worker-element.js';

export const HCM_JOB_PAUSE_TAG = 'hcm-job-pause';

/** The statuses of a job Pause may stop (the server's `PAUSABLE`). */
const PAUSABLE: ReadonlySet<JobStatus> = new Set<JobStatus>(['queued', 'starting', 'running']);

/** The feed's job while Pause or Resume applies to it, else null. */
function shown(view: WorkerViewPort | null): WorkerJobPort | null {
    const job = view?.job ?? null;
    return job !== null && applies(job) ? job : null;
}

/** Paused, or in a status Pause may stop. */
function applies(job: WorkerJobPort): boolean {
    return job.paused !== null || PAUSABLE.has(job.status);
}

export class HcmJobPause extends WorkerElement {
    static override readonly properties = { ...WorkerElement.properties, job: { type: String }, self: { type: String } };

    static override readonly styles = workerStyles;

    /** The job's id. */
    declare job: string;
    /** The signed-in admin's uid ('' when unknown): their own pause says "you". */
    declare self: string;

    constructor() {
        super();
        this.job = '';
        this.self = '';
    }

    protected get jobId(): string | null {
        return this.job === '' ? null : this.job;
    }

    override render(): TemplateResult {
        const view = this.view;
        const job = shown(view);
        if (view === null || job === null) {
            return html``;
        }
        return html`<section data-job-pause=${job.paused === null ? 'running' : 'paused'}>
            ${this.#said(job)}
            <div class="actions">${this.#button(view, job)}</div>
            ${this.refusal(view)}
        </section>`;
    }

    /** Who paused it and when, and what happens now; nothing while it is not paused. */
    #said(job: WorkerJobPort): TemplateResult {
        const paused = job.paused;
        if (paused === null) {
            return html``;
        }
        const who = this.t(paused.by === this.self ? 'adminWorker.job.you' : 'adminWorker.job.other');
        const words = { who, when: formatWhen(this.locale, paused.at) };
        const key = job.status === 'queued' ? 'adminWorker.job.paused' : 'adminWorker.job.pausing';
        return html`<p class="note" data-paused>${this.t(key, words)}</p>`;
    }

    #button(view: WorkerViewPort, job: WorkerJobPort): TemplateResult {
        const action = job.paused === null ? 'pause' : 'resume';
        return html`<hcm-button
            variant=${action === 'resume' ? 'filled' : 'tonal'}
            icon=${action === 'resume' ? 'play_arrow' : 'pause'}
            ?disabled=${view.acting}
            @click=${() => void this.feed?.intents.pauseJob(action)}
            >${this.t(action === 'resume' ? 'adminWorker.job.resume' : 'adminWorker.job.pause')}</hcm-button
        >`;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-job-pause': HcmJobPause;
    }
}
