/**
 * A version's page (`#/imagery/version/<versionId>`, `docs/research/M3-interfaces.md` §2.2–§2.4, §10.2; behaviours A12,
 * A14, A17, A18, A42): its state, its job's progress and steps (live), why it waits, its error with what cures it (CR-M3-47:
 * **Try again** when a retry can, Setup's Mapbox step for a token or its scopes, **Upload another file** for an upload the
 * server refused), **Locate again** for a frame waiting for points, the georeferencer, the approval card once it is rendered, the
 * preview's opacity on the map, the job's log as text, and **Cancel** while it runs (asked first; once Mapbox was asked
 * to publish, its processing cannot be stopped). M8: a join's frames, and a frame's offer to join its date's others. M9: how the
 * frame was found, or that it was not (`calibration-card.ts`). **Delete this version** for a version that never reached the map
 * (failed, cancelled or rejected) or an archive series waiting for points (`imagery.deleteVersion`, asked first; the page then returns to the list). M12: what the map shows of it, its share of the city, Actual pixels and See
 * the image (`image-view.ts`). M16: Calibrate again, and a recalibration's figures (`recalibrate/`). Lesson 728: Run again with the
 * latest pipeline (`run-again.ts`).
 */
import { JOB_MAX_ATTEMPTS, type AdminContentKey, type UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { errorTemplate, formatWhen, loadingTemplate, reconnectingStatus } from '../editing/states.js';
import { stepNameText, stepStateText } from '../jobs/job-text.js';
import { contentText, noticeOf } from '../shell/text.js';
import { approvalCard, guardStop } from './approval-card.js';
import type { ImageryContext } from './context.js';
import { imageView as imageControls } from './image-view.js';
import type { AdminNoticeInputPort } from '../notice-port.js';
import type { JobLogLinePort, JobViewPort, VersionPagePort, VersionViewPort } from './imagery-port.js';
import { labelText, numberText, versionStateText, waitText, wordedWait } from './imagery-text.js';
import { liveJoin, versionMark } from './join/live-join.js';
import { lazyJoin } from './join/lazy-card.js';
import { notFoundPane } from './not-found.js';
import { lazyRecalibrate } from './recalibrate/lazy-recalibrate.js';
import { versionRunAgain } from './run-again.js';
import { when, withValue } from './when.js';
import { loadWorkerElements } from '../worker/load.js';

/** Setup's Mapbox step, where the secret token and its scopes are pasted again. */
const MAPBOX_SETUP_HREF = '#/setup/mapbox';

/** Versions the georeferencer opens: waiting for points, rendered, or published (**Edit points**: saving there makes a new version). */
const GEOREF_STATES: ReadonlySet<VersionViewPort['state']> = new Set(['needs_gcps', 'awaiting_approval', 'published']);

const TONES: Readonly<Partial<Record<VersionViewPort['state'], 'error' | 'good'>>> = {
    failed: 'error',
    rejected: 'error',
    published: 'good',
};

/** What the page shows: the version (null while only its job exists: an upload being checked) and its job. */
interface Shown {
    readonly context: ImageryContext;
    readonly page: VersionPagePort;
    readonly version: VersionViewPort | null;
    readonly job: JobViewPort | null;
}

function percentOf(job: JobViewPort): string | null {
    return job.progress === null ? null : String(Math.round(job.progress * 100));
}

function bar(locale: UiLocale, job: JobViewPort): TemplateResult {
    return withValue(
        percentOf(job),
        (percent) =>
            html`<hcm-progress
                .value=${job.progress}
                .label=${contentText(locale, 'adminContent.jobs.progress', { percent })}
            ></hcm-progress>`,
    );
}

function waiting(locale: UiLocale, job: JobViewPort): TemplateResult {
    return withValue(
        // M8: a join waiting for its frames says so above them (`join/join-card.ts`).
        wordedWait(job.waitReason === 'parts' ? null : job.waitReason),
        (reason) => html`<p class="note" data-wait=${reason}>${waitText(locale, reason, job.retryAt)}</p>`,
    );
}

function progress(locale: UiLocale, job: JobViewPort | null): TemplateResult {
    return withValue(job, (running) => when(!running.finished, () => html`${bar(locale, running)} ${waiting(locale, running)}`));
}

const GB = 1e9;

/** A running transfer's bytes on its step line, ` · 1.2 of 3.4 GB` (` · 1.2 GB` while its total is unknown), else nothing. */
function transferText(locale: UiLocale, transfer: JobViewPort['steps'][number]['transfer']): string {
    if (transfer === null) {
        return '';
    }
    const gb = (bytes: number): string => numberText(locale, bytes / GB, 2);
    const { received, total } = transfer;
    return ` · ${total === null ? gb(received) : contentText(locale, 'adminContent.imagery.bytesOf', { received: gb(received), total: gb(total) })} GB`;
}

function steps(locale: UiLocale, job: JobViewPort | null): TemplateResult {
    return withValue(
        job,
        (shown) =>
            html`<h3>${contentText(locale, 'adminContent.jobs.steps')}</h3>
                <ol class="steps" aria-label=${contentText(locale, 'adminContent.jobs.steps')}>
                    ${shown.steps.map(
                        (step) =>
                            html`<li data-state=${step.status}>
                                <span>${stepNameText(locale, step.name)}</span>
                                <span class="note">${stepStateText(locale, step.status)}${transferText(locale, step.transfer)}</span>
                            </li>`,
                    )}
                </ol>`,
    );
}

/** The job's error code as a notice, or null. */
function jobNotice(job: JobViewPort | null): AdminNoticeInputPort | null {
    return job?.error?.notice ?? null;
}

/** The version's error, else its job's. */
function errorNotice(version: VersionViewPort | null, job: JobViewPort | null): AdminNoticeInputPort | null {
    return version?.error ?? jobNotice(job);
}

/** The redacted technical detail of the job's error ('' for none). */
function errorDetail(job: JobViewPort | null): string {
    return job?.error?.message ?? '';
}

function failure({ context, version, job }: Shown): TemplateResult {
    const detail = errorDetail(job);
    return withValue(
        errorNotice(version, job),
        (notice) =>
            html`<div class="alert" role="alert" data-state="failed">
                <hcm-icon name="error"></hcm-icon>
                <div class="alert-body">
                    <p>${noticeOf(context.locale, notice)}</p>
                    ${when(detail !== '', () => html`<p class="detail">${detail}</p>`)}
                </div>
            </div>`,
    );
}

/** A button of the page's row, off while another action runs or for a revoked admin. */
function action(
    { context, page }: Shown,
    spec: { offered: boolean; icon: string; label: AdminContentKey; variant?: string },
    click: () => unknown,
): TemplateResult {
    return when(
        spec.offered,
        () =>
            html`<hcm-button
                variant=${spec.variant ?? 'tonal'}
                icon=${spec.icon}
                ?disabled=${page.acting !== null || context.readOnly}
                @click=${click}
                >${contentText(context.locale, spec.label)}</hcm-button
            >`,
    );
}

function retryButton(shown: Shown): TemplateResult {
    const { job, context } = shown;
    const offered = (job?.status === 'failed' || job?.status === 'cancelled') && job.retryable;
    return action(shown, { offered, icon: 'replay', label: 'adminContent.common.retry' }, () => context.intents?.retryJob());
}

/**
 * M18 item 3: the job failed while cutting the frame out or placing it (the server's `CROP_STEPS`), with runs left: a crop that
 * fails each time stops at `JOB_MAX_ATTEMPTS`, as Retry does (`imagery.locateAgain` refuses it then).
 */
function failedCrop(job: JobViewPort): boolean {
    const cropStep = job.steps.some((step) => step.status === 'failed' && (step.name === 'stitch' || step.name === 'locate'));
    return job.status === 'failed' && cropStep && job.attempt < JOB_MAX_ATTEMPTS;
}

/**
 * A USGS frame waiting for points searches for its place again (`imagery.locateAgain`): a newer pipeline may now find it.
 * M18 item 3: a frame whose crop failed is offered the same, before a new import. M22: an archive series waiting for points places
 * itself again, which also makes its stitched picture for the georeferencer (one parked before that had none).
 */
function locatable(version: VersionViewPort, job: JobViewPort): boolean {
    if (version.origin === 'archive') {
        // M20 (§216): or published with pieces left out of its overview mosaic, laid on it again in a new version.
        return [parked(version, job), version.restitchable].some(Boolean);
    }
    return version.origin === 'usgs' && (parked(version, job) || (version.state === 'failed' && failedCrop(job)));
}

/** Waiting for points, its job too. */
function parked(version: VersionViewPort, job: JobViewPort): boolean {
    return version.state === 'needs_gcps' && job.status === 'awaiting_gcps';
}

function locateButton(shown: Shown): TemplateResult {
    const { version, job, context } = shown;
    const offered = version !== null && job !== null && locatable(version, job);
    return action(shown, { offered, icon: 'replay', label: 'adminContent.imagery.locateAgain' }, () => context.intents?.locateAgain());
}

/** An upload the server refused: the Upload view again, with nothing chosen. */
function uploadAnother({ context, job }: Shown): TemplateResult {
    const again = (): void => {
        context.intents?.resetUpload();
        context.intents?.setTab('upload');
        context.go([]);
    };
    return when(
        job?.refusedUpload === true,
        () =>
            html`<hcm-button variant="tonal" icon="upload_file" ?disabled=${context.readOnly} @click=${again}
                >${contentText(context.locale, 'adminContent.imagery.uploadAnother')}</hcm-button
            >`,
    );
}

/** A Mapbox token or scope failure: Setup's Mapbox step, where the token is pasted again. */
function mapboxSetupLink({ context, version, job }: Shown): TemplateResult {
    const key = errorNotice(version, job)?.key ?? '';
    return when(
        job?.status === 'failed' && key.startsWith('apiError.mapbox.'),
        () => html`<a href=${MAPBOX_SETUP_HREF}>${contentText(context.locale, 'adminContent.imagery.openMapboxSetup')}</a>`,
    );
}

/**
 * Ended without reaching the map: failed, cancelled or rejected. A failed one offers Delete this version in place of the old
 * Dismiss (`imagery.reject`, which only took it out of "Waiting for you"): one Delete on the page, and it deletes.
 */
const NEVER_SHOWN: ReadonlySet<VersionViewPort['state']> = new Set(['failed', 'cancelled', 'rejected']);

/** An archive series waiting for points, which the owner may start over. */
function parkedSeries(version: VersionViewPort | null, job: JobViewPort | null): boolean {
    return version?.origin === 'archive' && job !== null && parked(version, job);
}

/** Never on the map, and nothing runs for it any more (its job finished, or gone). */
function neverShown(version: VersionViewPort, job: JobViewPort | null): boolean {
    return NEVER_SHOWN.has(version.state) && job?.finished !== false;
}

/** Another version of the list was made from this one (`basedOn`): the server refuses its deletion (`apiError.imagery.deleteInUse`). */
function builtOn({ context }: Shown, version: VersionViewPort): boolean {
    return context.view.versions.items.some((item) => item.basedOn === version.id);
}

/**
 * `imagery.deleteVersion` takes it: never on the map and nothing running for it, or a parked series; never a frame a live join
 * holds, nor a version another one is built on.
 */
function deletable(shown: Shown): boolean {
    const { version, job } = shown;
    if (version === null || heldByJoin(shown) || builtOn(shown, version)) {
        return false;
    }
    return parkedSeries(version, job) || neverShown(version, job);
}

/** Delete this version: the version, its job, its log and its own files go for good (asked first). */
function deleteVersionButton(shown: Shown): TemplateResult {
    const { context } = shown;
    const spec = {
        offered: deletable(shown),
        icon: 'delete_forever',
        label: 'adminContent.imagery.deleteVersion',
        variant: 'outlined',
    } as const;
    return action(shown, spec, () => {
        context.ask('deleteVersion');
    });
}

/** The georeferencer, for a version with a scan in a state it takes; never for a series whose tiles wait (the preview is no scan). */
function georefLink({ context, version }: Shown): TemplateResult {
    const offered = version !== null && version.hasScan && GEOREF_STATES.has(version.state) && version.layoutCheck !== true;
    const target = offered ? version : null;
    return withValue(
        target,
        (shown) =>
            html`<a
                class="external"
                data-action=${shown.state === 'published' ? 'edit-points' : 'open-georef'}
                href=${['#/georef', shown.id].join('/')}
                >${contentText(context.locale, shown.state === 'published' ? 'adminContent.imagery.editPoints' : 'adminContent.imagery.openGeoref')}</a
            >`,
    );
}

/** An archive series whose tiles wait for the owner: the tile-import wizard (`docs/research/M20-import-local.md` §19.11). */
function tilesLink({ context, version }: Shown): TemplateResult {
    return withValue(
        version?.layoutCheck === true ? version : null,
        (shown) =>
            html`<a class="external" href=${['#/help', shown.id, 'tiles'].join('/')}
                >${contentText(context.locale, 'adminContent.imagery.openTiles')}</a
            >`,
    );
}

function opacity({ context, version }: Shown): TemplateResult {
    const { locale, view, intents } = context;
    const percent = Math.round(view.previewOpacity * 100);
    const label = contentText(locale, 'adminContent.imagery.previewOpacity');
    const valueText = contentText(locale, 'adminContent.layers.percent', { percent: String(percent) });
    const set = (event: Event): void => {
        intents?.setPreviewOpacity((event as CustomEvent<{ value: number }>).detail.value);
    };
    return withValue(
        version?.output ?? null,
        () =>
            html`<div class="slider-row">
                <span aria-hidden="true">${label}</span>
                <span aria-hidden="true">${valueText}</span>
                <hcm-slider
                    min="0"
                    max="100"
                    step="1"
                    .value=${percent}
                    label=${label}
                    value-text=${valueText}
                    @hcm-input=${set}
                    @hcm-change=${set}
                ></hcm-slider>
            </div>`,
    );
}

/** M12: what the page says of the picture on the map, once the version has one (`image-view.ts`). */
function imageView({ context, version }: Shown): TemplateResult {
    return withValue(version, (known) => withValue(known.output, (output) => imageControls(context, output, known.state)));
}

function line(locale: UiLocale, entry: JobLogLinePort): TemplateResult {
    const step = entry.step === null ? '' : `${stepNameText(locale, entry.step)}: `;
    return html`<li class="note" data-seq=${entry.seq}>${formatWhen(locale, entry.at)} · ${step}${entry.message}</li>`;
}

function logs(locale: UiLocale, lines: readonly JobLogLinePort[]): TemplateResult {
    if (lines.length === 0) {
        return html`<p class="note">${contentText(locale, 'adminContent.jobs.noLog')}</p>`;
    }
    return html`<ol class="rows log" aria-label=${contentText(locale, 'adminContent.jobs.log')}>
        ${lines.map((entry) => line(locale, entry))}
    </ol>`;
}

/** The job may be asked to stop: unfinished, and Mapbox not asked to publish yet (its processing cannot be stopped). */
function stoppable(job: JobViewPort | null): job is JobViewPort {
    return job !== null && !job.finished && !job.atMapbox;
}

/** M8: a frame a live join holds does not stop (`functions/src/imagery/cancel.ts`): its page links the join, which does. */
function heldByJoin({ context, version }: Shown): boolean {
    return liveJoin(context.view.versions.items, version?.partOf ?? null);
}

function cancelOff({ context, page }: Shown, job: JobViewPort): boolean {
    return job.cancelRequested || page.acting !== null || context.readOnly;
}

/**
 * The job offers Cancel: it may stop, no live join holds it, and it is no parked archive series (Delete this version deletes that
 * one: `deleteVersionButton`, so the page shows one Delete).
 */
function cancellable(shown: Shown): JobViewPort | null {
    const { job } = shown;
    return stoppable(job) && !heldByJoin(shown) && !parkedSeries(shown.version, job) ? job : null;
}

function cancel(shown: Shown): TemplateResult {
    const { context } = shown;
    const job = cancellable(shown);
    if (job === null) {
        return html``;
    }
    // M18 item 5: a frame waiting for its points is deleted as at every other stage (`drop`: Delete this image?).
    const waiting = job.status === 'awaiting_gcps';
    const label = waiting ? 'adminContent.imagery.reject' : 'adminContent.jobs.cancel';
    const off = cancelOff(shown, job);
    return html`<div class="actions">
        <hcm-button
            variant="outlined"
            icon="cancel"
            ?disabled=${off}
            @click=${() => {
                context.ask(waiting ? 'drop' : 'cancel');
            }}
            >${contentText(context.locale, job.cancelRequested ? 'adminContent.jobs.stopping' : label)}</hcm-button
        >
    </div>`;
}

function refusal({ context, page }: Shown): TemplateResult {
    return withValue(
        page.refusal,
        (notice) =>
            html`<p class="alert" role="alert"><hcm-icon name="error"></hcm-icon><span>${noticeOf(context.locale, notice)}</span></p>`,
    );
}

/**
 * The card waits for a decision: a rendered version before Approve, or an approved one (by the admin or by the policy)
 * whose publish the compute-unit guard stopped, which waits for one of its three choices (CR-M3-33).
 */
function awaitsDecision(context: ImageryContext, version: VersionViewPort): boolean {
    return version.state === 'awaiting_approval' || (version.state === 'approved' && guardStop(context, version) !== null);
}

/**
 * M7 (`docs/research/M7-local-worker.md` §7): where an unfinished job runs, and its switch (the lazy `worker` chunk's
 * `<hcm-run-place>`, which shows itself only while the job holds no run); Pause and Resume of the job (2026-11-13, `<hcm-job-pause>`).
 */
function runPlace({ context, job }: Shown): TemplateResult {
    return withValue(job?.finished === false ? job : null, (open) => {
        loadWorkerElements(context.app);
        return html`<hcm-job-pause .app=${context.app} .locale=${context.locale} job=${open.id} self=${context.self ?? ''}></hcm-job-pause>
            <hcm-run-place .app=${context.app} .locale=${context.locale} job=${open.id}></hcm-run-place>`;
    });
}

/** The approval card while it waits, the layer's link once published. */
function outcome(shown: Shown): TemplateResult {
    const { context, page, version } = shown;
    if (version !== null && awaitsDecision(context, version)) {
        return approvalCard(context, page, version);
    }
    return withValue(
        version?.state === 'published' ? version : null,
        (published) =>
            html`<p>
                <a href=${['#/layers', published.layerId].join('/')}>${contentText(context.locale, 'adminContent.imagery.openLayer')}</a>
            </p>`,
    );
}

/** The version's title: its label, and its year when the label does not say it already ("KH-4A Corona, 12 July 1966"). */
function titleOf(version: VersionViewPort, locale: UiLocale): string {
    const label = labelText(version.label, locale);
    const year = String(version.year);
    const mark = versionMark(locale, version.origin, version.entityId ?? undefined);
    return [label, ...(label.includes(year) ? [] : [year]), ...(mark === null ? [] : [mark])].join(' · ');
}

function heading({ context, version }: Shown): TemplateResult {
    const { locale } = context;
    if (version === null) {
        return html`<h2 tabindex="-1" data-detail-heading>${contentText(locale, 'adminContent.imagery.versionChecking')}</h2>`;
    }
    return html`<h2 tabindex="-1" data-detail-heading>${titleOf(version, locale)}</h2>
        <div class="chips">
            <span class="tag" data-tone=${TONES[version.state] ?? 'wait'}>${versionStateText(locale, version.state)}</span>
        </div>`;
}

/** What the page is in: the version's state, else its job's status. */
function stateOf(version: VersionViewPort | null, job: JobViewPort | null): string {
    return version?.state ?? job?.status ?? '';
}

function body(shown: Shown): TemplateResult {
    const { context, page, version, job } = shown;
    const { locale } = context;
    const reconnecting = page.version.reconnecting || page.job.reconnecting;
    return html`<div class="pane" data-version=${page.id} data-state=${stateOf(version, job)}>
        ${heading(shown)} ${reconnectingStatus(locale, reconnecting)} ${progress(locale, job)} ${failure(shown)}
        <div class="actions">
            ${retryButton(shown)} ${locateButton(shown)} ${uploadAnother(shown)} ${mapboxSetupLink(shown)} ${tilesLink(shown)}
            ${georefLink(shown)} ${deleteVersionButton(shown)}
        </div>
        ${versionRunAgain(context, version)} ${runPlace(shown)} ${refusal(shown)}
        ${withValue(version, (known) => lazyJoin(context, known, (chunk) => chunk.versionJoin(context, known, job)))} ${imageView(shown)}
        ${withValue(version, (known) => lazyRecalibrate(context, page, known))} ${outcome(shown)} ${opacity(shown)} ${steps(locale, job)}
        <h3>${contentText(locale, 'adminContent.jobs.log')}</h3>
        ${logs(locale, page.logs.items)} ${cancel(shown)}
    </div>`;
}

function notFound(context: ImageryContext): TemplateResult {
    return notFoundPane(context, 'adminContent.imagery.versionNotFound');
}

/** Read: the version's listener answered (or failed). */
function settled(page: VersionPagePort): boolean {
    return page.version.status !== 'loading' && page.job.status !== 'loading';
}

function shownOf(context: ImageryContext, page: VersionPagePort): Shown {
    return { context, page, version: page.version.doc?.data ?? null, job: page.job.doc?.data ?? null };
}

function readPage(context: ImageryContext, page: VersionPagePort): TemplateResult {
    if (page.version.status === 'error') {
        return errorTemplate(context.locale, page.version.failure, () => context.intents?.retry());
    }
    const shown = shownOf(context, page);
    return shown.version === null && shown.job === null ? notFound(context) : body(shown);
}

export function versionDetail(context: ImageryContext, page: VersionPagePort | null): TemplateResult {
    return page !== null && settled(page) ? readPage(context, page) : loadingTemplate(context.locale);
}
