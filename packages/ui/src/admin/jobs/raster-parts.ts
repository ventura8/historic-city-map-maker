/**
 * The Jobs page's raster parts (`docs/research/M3-interfaces.md` §10.6; CR-M3-5): why an unfinished job waits, in
 * words (with the date it tries again), **Run it again** on a failed pipeline or publish job with attempts left, **Run again with
 * the latest pipeline** on a scene's import (lesson 728), and
 * the georeferencer on a job awaiting its points. Text only. Also the job's steps, and Pause all and Resume all (2026-11-13).
 */
import type { UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { waitText, wordedWait } from '../imagery/imagery-text.js';
import { when, withValue } from '../imagery/when.js';
import { EMPTY } from '../shell/empty.js';
import { contentText } from '../shell/text.js';
import { stepNameText, stepStateText } from './job-text.js';
import type { JobItemPort } from './jobs-port.js';

export interface RasterActions {
    readonly retrying: boolean;
    readonly readOnly: boolean;
    readonly retry: () => void;
    /** Lesson 728: Run again with the latest pipeline (`imagery.import` with `again`) and whether it is on its way. */
    readonly rerunning: boolean;
    readonly runAgain: () => void;
}

/** Why the unfinished job is not running, or nothing. */
export function waitLine(locale: UiLocale, job: JobItemPort): TemplateResult {
    if (job.finished) {
        return EMPTY;
    }
    return withValue(wordedWait(job.waitReason), (reason) => html`<p data-wait=${reason}>${waitText(locale, reason, job.retryAt)}</p>`);
}

/** The version a job awaiting its points opens in the georeferencer, or null. */
function awaitingPoints(job: JobItemPort): string | null {
    return job.status === 'awaiting_gcps' ? job.versionId : null;
}

function retryButton(locale: UiLocale, actions: RasterActions): TemplateResult {
    return html`<hcm-button
        variant="tonal"
        icon="replay"
        ?disabled=${actions.retrying || actions.readOnly}
        @click=${() => {
            actions.retry();
        }}
        >${contentText(locale, actions.retrying ? 'adminContent.jobs.retrying' : 'adminContent.jobs.retry')}</hcm-button
    >`;
}

/** Lesson 728: a scene's import that failed, was cancelled or waits for approval, downloaded again and run on the latest pipeline. */
function runAgainButton(locale: UiLocale, actions: RasterActions): TemplateResult {
    const label = actions.rerunning ? 'adminContent.imagery.importing' : 'adminContent.imagery.runAgain';
    return html`<hcm-button
            variant="tonal"
            icon="refresh"
            data-run-again
            ?disabled=${actions.rerunning || actions.readOnly}
            @click=${() => {
                actions.runAgain();
            }}
            >${contentText(locale, label)}</hcm-button
        >
        <p class="note">${contentText(locale, 'adminContent.imagery.runAgainHint')}</p>`;
}

/** Retry on a failed raster job, Run again on a scene's import, the georeferencer on one awaiting points; nothing for the others. */
export function rasterActions(locale: UiLocale, job: JobItemPort, actions: RasterActions): TemplateResult {
    const versionId = awaitingPoints(job);
    return when(
        job.retryable || versionId !== null || job.rerunScene !== null,
        () =>
            html`<div class="actions">
                ${when(job.retryable, () => retryButton(locale, actions))}
                ${when(job.rerunScene !== null, () => runAgainButton(locale, actions))}
                ${withValue(
                    versionId,
                    // A 48 px target (the kit's a.external): a bare link was 19 px high (CR-M3-35 h).
                    (id) =>
                        html`<a class="external" href=${['#/georef', id].join('/')}
                            >${contentText(locale, 'adminContent.jobs.openGeoref')}</a
                        >`,
                )}
            </div>`,
    );
}

/** The job's steps in the order its type runs them, with each one's state; nothing before the first. */
export function stepsList(locale: UiLocale, job: JobItemPort): TemplateResult {
    if (job.steps.length === 0) {
        return EMPTY;
    }
    return html`<h3>${contentText(locale, 'adminContent.jobs.steps')}</h3>
        <dl class="facts">
            ${job.steps.map(
                (step) =>
                    html`<dt>${stepNameText(locale, step.name)}</dt>
                        <dd>${stepStateText(locale, step.status)}</dd>`,
            )}
        </dl>`;
}

/** Pause all and Resume all (the owner's request of 2026-11-13): every queued or running job of the city, said in a notice. */
export function pauseAllActions(locale: UiLocale, off: boolean, act: (action: 'pause' | 'resume') => void): TemplateResult {
    return html`<div class="actions" data-pause-all>
        <hcm-button
            variant="text"
            icon="pause"
            ?disabled=${off}
            @click=${() => {
                act('pause');
            }}
            >${contentText(locale, 'adminContent.jobs.pauseAll')}</hcm-button
        >
        <hcm-button
            variant="text"
            icon="play_arrow"
            ?disabled=${off}
            @click=${() => {
                act('resume');
            }}
            >${contentText(locale, 'adminContent.jobs.resumeAll')}</hcm-button
        >
    </div>`;
}
