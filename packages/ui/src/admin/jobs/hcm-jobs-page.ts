/**
 * `<hcm-jobs-page>`: `#/jobs` and `#/jobs/<jobId>` (`docs/research/M2c-interfaces.md` §9.3; behaviour A18). The list of
 * the city's jobs, live, newest first, filtered by status chips; the open job's status, progress, steps, error and log
 * lines (text only), with **Cancel** while it runs (asked first). A job waiting for its date says when it may run. The
 * list and the job say "Reconnecting…" while their listener lost the server, and keep what they showed. From M3
 * (CR-M3-5, `raster-parts.ts`): why a raster job waits, Run it again on a failed one, the georeferencer on one awaiting
 * its points; while the budget guard pauses the raster work, the list pane says so with the spend and offers Resume
 * processing, asked first (CR-M3-47, `../imagery/guard-banner.ts`). Pause (2026-11-13): Pause all and Resume all over the list, a paused
 * job's row reads Paused, and the open job has Pause or Resume (`<hcm-job-pause>`, the lazy `worker` chunk).
 */
import type { UiLocale } from '@hcm/shared';
import { css, html, nothing, type TemplateResult } from 'lit';

import type { AdminRouteIdPort } from '../admin-port.js';
import type { AreaPort, ContentPort } from '../content-port.js';
import { AreaPage } from '../editing/area-page.js';
import { editingStyles } from '../editing/editing-styles.js';
import { current, errorTemplate, formatWhen, listBody, loadingTemplate, reconnectingStatus, whoText } from '../editing/states.js';
import { guardBanner } from '../imagery/guard-banner.js';
import { EMPTY } from '../shell/empty.js';
import { contentText } from '../shell/text.js';
import { FILTERS, jobStatusText, jobTypeText, levelText, percentOf, statusTone, stepNameText } from './job-text.js';
import type { JobFilterPort, JobItemPort, JobLogLinePort, JobsIntentsPort, JobsViewState } from './jobs-port.js';
import { pauseAllActions, rasterActions, stepsList, waitLine } from './raster-parts.js';
import { loadWorkerElements } from '../worker/load.js';

export const HCM_JOBS_PAGE_TAG = 'hcm-jobs-page';

const FILTER_ORDER: readonly JobFilterPort[] = ['all', 'active', 'failed', 'done'];

/** The open job's listeners lost the server (the job's or its log's). */
function isReconnecting(detail: JobsViewState['detail']): boolean {
    return detail !== null && (detail.job.reconnecting || detail.logs.reconnecting);
}

export class HcmJobsPage extends AreaPage<JobsViewState, JobsIntentsPort> {
    static override readonly properties = { ...AreaPage.properties, confirming: { state: true }, resumeAsked: { state: true } };

    static override readonly styles = [
        ...editingStyles,
        /*
         * Batch 4 (the owner, 2026-11-09: the worker card squeezed the list): the computer, where new jobs run and the Cloud Run meter
         * are a full-width card above the list and the job, which it can collapse; the list and the job share the rest.
         */
        css`
            :host {
                display: flex;
                flex-direction: column;
                min-block-size: 0;
            }

            hcm-list-detail {
                flex: 1 1 auto;
                min-block-size: 0;
            }

            details {
                flex: none;
                max-block-size: 50%;
                overflow-y: auto;
                margin: 16px 16px 8px;
                border-radius: var(--md-sys-shape-corner-medium);
                background: var(--md-sys-color-surface-container-low);
            }

            summary {
                display: flex;
                align-items: center;
                min-block-size: 48px;
                padding-inline: 16px;
                cursor: pointer;
                font-size: var(--md-sys-typescale-title-small-size);
                font-weight: var(--md-sys-typescale-title-small-weight);
            }

            /* Pause all and Resume all keep the filter chips' 48 px reach (M3's target size on a phone). */
            [data-pause-all] {
                margin-block-start: 16px;
            }

            hcm-worker-panel {
                display: block;
                padding: 0 16px 16px;
            }
        `,
    ];

    protected readonly route: AdminRouteIdPort = 'jobs';
    /** The Cancel question is open. */
    declare confirming: boolean;
    /** The Resume processing question is open. */
    declare resumeAsked: boolean;
    /** The `worker` chunk's elements were asked for. */
    #workerLoaded = false;
    /** Batch 4: the computer's card is open (the session's choice; open at first). */
    #computerOpen = true;

    constructor() {
        super();
        this.confirming = false;
        this.resumeAsked = false;
    }

    protected storeOf(content: ContentPort): AreaPort<JobsViewState, JobsIntentsPort> | null {
        return content.jobs;
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        const locale = this.locale;
        const back = (): void => {
            this.go([]);
        };
        return html`${this.#computer(locale)}
            <hcm-list-detail
                split-from="large"
                ?detail=${view.detail !== null}
                .detailKey=${view.detail?.id ?? ''}
                .listLabel=${contentText(locale, 'adminContent.jobs.listLabel')}
                .detailLabel=${contentText(locale, 'adminContent.jobs.detailLabel')}
                .backLabel=${contentText(locale, 'adminContent.common.back')}
                .closeLabel=${contentText(locale, 'adminContent.common.close')}
                @hcm-back=${back}
            >
                <div slot="list">${this.#list(locale, view)}</div>
                <div slot="detail">${this.#detail(locale, view)}</div>
            </hcm-list-detail>
            ${this.#resumeQuestion(locale)}`;
    }

    /** Resume processing, asked first (it lets the raster work spend again this month). */
    #resumeQuestion(locale: UiLocale): TemplateResult {
        const close = (): void => {
            this.resumeAsked = false;
        };
        return html`<hcm-confirm-dialog
            .open=${this.resumeAsked}
            .headline=${contentText(locale, 'adminContent.imagery.confirm.resume')}
            .body=${contentText(locale, 'adminContent.imagery.confirm.resumeBody')}
            .confirmLabel=${contentText(locale, 'adminContent.imagery.guard.resume')}
            .cancelLabel=${contentText(locale, 'adminContent.common.cancel')}
            .closeLabel=${contentText(locale, 'adminContent.common.close')}
            @hcm-confirm=${() => {
                close();
                void this.intents?.resumeGuard();
            }}
            @hcm-cancel=${close}
        ></hcm-confirm-dialog>`;
    }

    #list(locale: UiLocale, view: JobsViewState): TemplateResult {
        const intents = this.intents;
        return html`<div class="list-head">
                <div class="chips" role="group" aria-label=${contentText(locale, 'adminContent.jobs.filterLabel')}>
                    ${FILTER_ORDER.map((filter) => this.#chip(locale, view.filter, filter))}
                </div>
                ${reconnectingStatus(locale, view.list.reconnecting)}
            </div>
            ${pauseAllActions(locale, view.pausingAll || this.readOnly, (action) => void this.intents?.pauseAll(action))}
            ${guardBanner(locale, view.guard, {
                off: view.resuming || this.readOnly,
                resume: () => {
                    this.resumeAsked = true;
                },
            })}
            ${listBody(
                locale,
                view.list,
                { empty: 'adminContent.jobs.empty', emptyHint: 'adminContent.jobs.emptyHint', icon: 'pending_actions' },
                {
                    retry: () => intents?.retry(),
                    more: () => intents?.more(),
                    items: (items) =>
                        html`<ul class="rows">
                            ${items.map((job) => this.#row(locale, job, job.id === view.detail?.id))}
                        </ul>`,
                },
            )}`;
    }

    /**
     * M7: the local worker's panel (docs/research/M7-local-worker.md §7), its elements the lazy `worker` chunk's; batch 4: in a card above the
     * list and the job that the admin can collapse.
     */
    #computer(locale: UiLocale): TemplateResult {
        if (!this.#workerLoaded && this.app !== null) {
            this.#workerLoaded = true;
            loadWorkerElements(this.app);
        }
        const toggled = (event: Event): void => {
            this.#computerOpen = (event.currentTarget as HTMLDetailsElement).open;
        };
        return html`<details ?open=${this.#computerOpen} @toggle=${toggled} data-computer>
            <summary>${contentText(locale, 'adminContent.jobs.computerTitle')}</summary>
            <hcm-worker-panel
                .app=${this.app}
                .locale=${locale}
                project=${this.state?.projectId ?? ''}
                self=${this.#selfId()}
            ></hcm-worker-panel>
        </details>`;
    }

    #chip(locale: UiLocale, selected: JobFilterPort, filter: JobFilterPort): TemplateResult {
        const choose = (event: Event): void => {
            // One filter at a time: pressing the pressed chip keeps it pressed.
            (event.currentTarget as HTMLElement & { selected: boolean }).selected = true;
            this.intents?.setFilter(filter);
        };
        return html`<hcm-chip
            .label=${contentText(locale, FILTERS[filter])}
            .selected=${filter === selected}
            @hcm-change=${choose}
        ></hcm-chip>`;
    }

    #row(locale: UiLocale, job: JobItemPort, selected: boolean): TemplateResult {
        const percent = percentOf(job);
        const status = job.paused ? contentText(locale, 'adminContent.jobs.status.paused') : jobStatusText(locale, job.status);
        const detail =
            percent === null || job.finished
                ? status
                : contentText(locale, 'adminContent.jobs.statusPercent', { status, percent: String(percent) });
        return html`<li>
            <a class="row" href=${this.href([job.id])} aria-current=${current(selected)}>
                <span class="row-title">${jobTypeText(locale, job.type)}</span>
                <span class="row-detail">${detail} · ${formatWhen(locale, job.createdAt)}</span>
            </a>
        </li>`;
    }

    #detail(locale: UiLocale, view: JobsViewState): TemplateResult {
        const detail = view.detail;
        if (detail === null) {
            return html`<hcm-empty-state
                icon="pending_actions"
                .text=${contentText(locale, 'adminContent.jobs.choose')}
            ></hcm-empty-state>`;
        }
        const job = detail.job;
        if (job.status === 'error') {
            return errorTemplate(locale, job.failure, () => this.intents?.retry());
        }
        if (job.doc === null) {
            return job.status === 'loading' ? loadingTemplate(locale) : this.#notFound(locale);
        }
        return this.#job(locale, view, job.doc.data, detail.logs);
    }

    #notFound(locale: UiLocale): TemplateResult {
        return html`<div class="pane">
            <h2 tabindex="-1" data-detail-heading>${contentText(locale, 'adminContent.jobs.notFound')}</h2>
            <p><a href=${this.href([])}>${contentText(locale, 'adminContent.jobs.backToList')}</a></p>
        </div>`;
    }

    #job(locale: UiLocale, view: JobsViewState, job: JobItemPort, logs: NonNullable<JobsViewState['detail']>['logs']): TemplateResult {
        const started = contentText(locale, 'adminContent.jobs.started', {
            who: whoText(locale, job.createdBy, this.#self()),
            date: formatWhen(locale, job.createdAt),
        });
        return html`<div class="pane">
            <h2 tabindex="-1" data-detail-heading>${jobTypeText(locale, job.type)}</h2>
            <div class="chips">
                <span class="tag" data-tone=${statusTone(job)}>${jobStatusText(locale, job.status)}</span>
                ${job.paused ? html`<span class="tag" data-paused>${contentText(locale, 'adminContent.jobs.status.paused')}</span>` : nothing}
            </div>
            <p class="note">${started}</p>
            ${this.#waiting(locale, job)} ${waitLine(locale, job)} ${this.#progress(locale, job)} ${this.#error(locale, job)}
            ${this.#raster(locale, view, job)} ${this.#place(locale, job)} ${stepsList(locale, job)}
            ${reconnectingStatus(locale, isReconnecting(view.detail))}
            <h3>${contentText(locale, 'adminContent.jobs.log')}</h3>
            ${this.#logs(locale, logs.items)} ${this.#cancel(locale, view, job)}
        </div>`;
    }

    #raster(locale: UiLocale, view: JobsViewState, job: JobItemPort): TemplateResult {
        const retry = (): void => {
            void this.intents?.retryJob();
        };
        const runAgain = (): void => {
            void this.intents?.runAgain();
        };
        return rasterActions(locale, job, { retrying: view.retrying, readOnly: this.readOnly, retry, rerunning: view.rerunning, runAgain });
    }

    /**
     * M7: where an unfinished job runs and its switch (`<hcm-run-place>` shows itself only for a pipeline job holding no run); Pause and
     * Resume (2026-11-13, `<hcm-job-pause>`: a pipeline job queued, running or paused).
     */
    #place(locale: UiLocale, job: JobItemPort): TemplateResult {
        return job.finished
            ? EMPTY
            : html`<hcm-job-pause .app=${this.app} .locale=${locale} job=${job.id} self=${this.#selfId()}></hcm-job-pause>
                  <hcm-run-place .app=${this.app} .locale=${locale} job=${job.id}></hcm-run-place>`;
    }

    #self(): string | null {
        return this.state?.user?.uid ?? null;
    }

    /** The signed-in admin's uid, '' when unknown (an attribute's value). */
    #selfId(): string {
        return this.#self() ?? '';
    }

    #waiting(locale: UiLocale, job: JobItemPort): TemplateResult {
        return job.dispatchAt === null || job.finished
            ? EMPTY
            : html`<p>${contentText(locale, 'adminContent.jobs.waiting', { date: formatWhen(locale, job.dispatchAt) })}</p>`;
    }

    #progress(locale: UiLocale, job: JobItemPort): TemplateResult {
        const percent = percentOf(job);
        if (percent === null || job.finished) {
            return EMPTY;
        }
        return html`<hcm-progress
            .value=${job.progress ?? 0}
            .label=${contentText(locale, 'adminContent.jobs.progress', { percent: String(percent) })}
        ></hcm-progress>`;
    }

    #error(locale: UiLocale, job: JobItemPort): TemplateResult {
        return job.error === null
            ? EMPTY
            : html`<p class="alert">
                  <hcm-icon name="error"></hcm-icon
                  ><span>${contentText(locale, 'adminContent.jobs.error', { message: job.error.message })}</span>
              </p>`;
    }

    #logs(locale: UiLocale, lines: readonly JobLogLinePort[]): TemplateResult {
        if (lines.length === 0) {
            return html`<p class="note">${contentText(locale, 'adminContent.jobs.noLog')}</p>`;
        }
        return html`<ol class="rows log" aria-label=${contentText(locale, 'adminContent.jobs.log')}>
            ${lines.map(
                (line) =>
                    html`<li class="note" data-seq=${line.seq}>
                        ${formatWhen(locale, line.at)} ·
                        ${levelText(locale, line.level)}${line.step === null ? nothing : html` · ${stepNameText(locale, line.step)}`}:
                        ${line.message}
                    </li>`,
            )}
        </ol>`;
    }

    #cancel(locale: UiLocale, view: JobsViewState, job: JobItemPort): TemplateResult {
        if (job.finished) {
            return EMPTY;
        }
        const ask = (): void => {
            this.confirming = true;
        };
        const confirm = (): void => {
            this.confirming = false;
            void this.intents?.cancel();
        };
        const dismiss = (): void => {
            this.confirming = false;
        };
        const label = job.cancelRequested ? 'adminContent.jobs.stopping' : 'adminContent.jobs.cancel';
        return html`<div class="actions">
                <hcm-button
                    variant="outlined"
                    icon="cancel"
                    ?disabled=${job.cancelRequested || view.cancelling || this.readOnly}
                    @click=${ask}
                    >${contentText(locale, label)}</hcm-button
                >
            </div>
            <hcm-confirm-dialog
                destructive
                .open=${this.confirming}
                .headline=${contentText(locale, 'adminContent.jobs.cancelConfirm')}
                .body=${contentText(locale, 'adminContent.jobs.cancelBody')}
                .confirmLabel=${contentText(locale, 'adminContent.jobs.cancel')}
                .cancelLabel=${contentText(locale, 'adminContent.jobs.keepRunning')}
                .closeLabel=${contentText(locale, 'adminContent.common.close')}
                @hcm-confirm=${confirm}
                @hcm-cancel=${dismiss}
            ></hcm-confirm-dialog>`;
    }
}

/** Registers `<hcm-jobs-page>` (its kit elements are the editing kit's, `defineEditingElements`). */
export function defineHcmJobsPage(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_JOBS_PAGE_TAG) === undefined) {
        registry.define(HCM_JOBS_PAGE_TAG, HcmJobsPage);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-jobs-page': HcmJobsPage;
    }
}
