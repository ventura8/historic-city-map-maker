/**
 * Upload a GeoTIFF (`docs/research/M3-interfaces.md` §8.1, §10.3; behaviour A14): a drop zone and Choose a file; a file
 * that is no TIFF (its first bytes) or too large is refused at once; the year comes from the name or the Year field; the
 * resumable upload's progress with Cancel; then the server checks the file and the version's page opens. Used by the
 * Imagery area and by the layer editor's Replace image.
 */
import { html, type TemplateResult } from 'lit';

import { EMPTY } from '../shell/empty.js';
import { contentText, noticeOf } from '../shell/text.js';
import type { ChosenFilePort, UploadStatePort } from './imagery-port.js';
import { when, withValue } from './when.js';
import type { UiLocale } from '@hcm/shared';

export interface UploadHandlers {
    readonly choose: (file: ChosenFilePort) => void;
    readonly setYear: (text: string) => void;
    readonly start: () => void;
    readonly cancel: () => void;
    readonly reset: () => void;
    /** A revoked admin's page: nothing uploads. */
    readonly readOnly: boolean;
}

function picked(event: Event, handlers: UploadHandlers): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file !== undefined) {
        handlers.choose(file);
    }
    input.value = '';
}

function dropped(event: DragEvent, handlers: UploadHandlers): void {
    event.preventDefault();
    (event.currentTarget as HTMLElement).removeAttribute('data-over');
    const file = event.dataTransfer?.files[0];
    if (file !== undefined && !handlers.readOnly) {
        handlers.choose(file);
    }
}

function over(event: DragEvent): void {
    event.preventDefault();
    (event.currentTarget as HTMLElement).setAttribute('data-over', '');
}

/** Opens the hidden file input beside the button (the only control: one Tab stop, a 48 px target). */
function openPicker(event: Event): void {
    const drop = (event.currentTarget as HTMLElement).closest('.drop');
    drop?.querySelector<HTMLInputElement>('input[type="file"]')?.click();
}

function chooser(locale: UiLocale, handlers: UploadHandlers): TemplateResult {
    const leave = (event: Event): void => {
        (event.currentTarget as HTMLElement).removeAttribute('data-over');
    };
    return html`<div
        class="drop"
        @dragover=${over}
        @dragleave=${leave}
        @drop=${(event: DragEvent) => {
            dropped(event, handlers);
        }}
    >
        <p>${contentText(locale, 'adminContent.imagery.upload.drop')}</p>
        <input
            type="file"
            hidden
            accept=".tif,.tiff,image/tiff"
            @change=${(event: Event) => {
                picked(event, handlers);
            }}
        />
        <hcm-button variant="tonal" icon="upload_file" ?disabled=${handlers.readOnly} @click=${openPicker}
            >${contentText(locale, 'adminContent.imagery.upload.choose')}</hcm-button
        >
    </div>`;
}

function yearForm(locale: UiLocale, state: UploadStatePort, handlers: UploadHandlers, id: string): TemplateResult {
    return html`<div class="field">
            <label for=${`${id}-year`}>${contentText(locale, 'adminContent.imagery.upload.year')}</label>
            <input
                id=${`${id}-year`}
                inputmode="numeric"
                .value=${state.year}
                @input=${(event: Event) => {
                    handlers.setYear((event.target as HTMLInputElement).value);
                }}
            />
            <span class="note">${contentText(locale, 'adminContent.imagery.upload.yearHelp')}</span>
        </div>
        <div class="actions">
            <hcm-button
                variant="filled"
                icon="publish"
                ?disabled=${handlers.readOnly || !/^(?:18|19|20)\d\d$/.test(state.year)}
                @click=${() => {
                    handlers.start();
                }}
                >${contentText(locale, 'adminContent.imagery.upload.start')}</hcm-button
            >
        </div>`;
}

function progress(locale: UiLocale, state: UploadStatePort, handlers: UploadHandlers): TemplateResult {
    const percent = String(Math.round(state.progress * 100));
    return html`<hcm-progress
            .value=${state.progress}
            .label=${contentText(locale, 'adminContent.imagery.upload.progress', { percent })}
        ></hcm-progress>
        <p class="note" role="status">${contentText(locale, 'adminContent.imagery.upload.progress', { percent })}</p>
        <div class="actions">
            <hcm-button
                variant="outlined"
                icon="cancel"
                @click=${() => {
                    handlers.cancel();
                }}
                >${contentText(locale, 'adminContent.imagery.upload.cancel')}</hcm-button
            >
        </div>`;
}

function retryButton(locale: UiLocale, handlers: UploadHandlers): TemplateResult {
    return html`<hcm-button
        variant="tonal"
        icon="refresh"
        @click=${() => {
            handlers.start();
        }}
        >${contentText(locale, 'adminContent.common.retry')}</hcm-button
    >`;
}

/** A refused or failed upload says why; a failed one tries again, either starts over with no file. */
function refusal(locale: UiLocale, state: UploadStatePort, handlers: UploadHandlers): TemplateResult {
    return html`<p class="alert" role="alert"><hcm-icon name="error"></hcm-icon><span>${noticeOf(locale, state.refusal)}</span></p>
        <div class="actions">
            ${when(state.phase === 'failed', () => retryButton(locale, handlers))}
            <hcm-button
                variant="text"
                icon="undo"
                @click=${() => {
                    handlers.reset();
                }}
                >${contentText(locale, 'adminContent.imagery.upload.reset')}</hcm-button
            >
        </div>`;
}

function checking(locale: UiLocale): TemplateResult {
    return html`<p class="note" role="status">${contentText(locale, 'adminContent.imagery.upload.checking')}</p>`;
}

type PhaseView = (locale: UiLocale, state: UploadStatePort, handlers: UploadHandlers, id: string) => TemplateResult;

/** The body of each phase. */
const PHASES: Readonly<Record<UploadStatePort['phase'], PhaseView>> = {
    idle: () => EMPTY,
    refused: refusal,
    failed: refusal,
    ready: (locale, state, handlers, id) => when(state.needsYear, () => yearForm(locale, state, handlers, id)),
    uploading: progress,
    checking,
    done: checking,
};

function fileLine(locale: UiLocale, state: UploadStatePort): TemplateResult {
    return withValue(state.fileName, (name) => html`<p data-file>${contentText(locale, 'adminContent.imagery.upload.file', { name })}</p>`);
}

export function uploadPanel(locale: UiLocale, state: UploadStatePort, handlers: UploadHandlers, id = 'imagery-upload'): TemplateResult {
    const busy = state.phase === 'uploading' || state.phase === 'checking';
    const title = state.layerId === null ? 'adminContent.imagery.upload.title' : 'adminContent.imagery.upload.replaceTitle';
    return html`<div class="pane" data-view="upload" data-phase=${state.phase}>
        <h3>${contentText(locale, title)}</h3>
        <p class="note">${contentText(locale, 'adminContent.imagery.upload.note')}</p>
        ${when(!busy, () => chooser(locale, handlers))} ${fileLine(locale, state)} ${PHASES[state.phase](locale, state, handlers, id)}
    </div>`;
}
