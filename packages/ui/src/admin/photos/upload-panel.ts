/**
 * The uploads of the photo list (`docs/research/M2c-interfaces.md` §6.2): each file with its progress, where it stands
 * (waiting, uploading with its percentage, processing, done, refused with the server's reason, interrupted), Retry,
 * Cancel and Hide, a link to the photo it created or repeats, and the line saying what new photos get (the sticky
 * author, source and licence). File names and reasons are text.
 */
import type { UiLocale } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import { EMPTY } from '../shell/empty.js';
import { messageText, phaseText, photoText, stickyText } from './photo-text.js';
import type { PhotosIntentsPort, StickyPort, UploadItemPort } from './photos-port.js';

const RUNNING: ReadonlySet<string> = new Set(['queued', 'uploading', 'processing']);

/** An interrupted upload, or a write that failed; never a file the server refused (it would refuse it again). */
function canRetry(item: UploadItemPort): boolean {
    const refusedByServer = item.error?.startsWith('apiError.photo.') === true;
    return item.phase === 'interrupted' || (item.phase === 'failed' && !refusedByServer);
}

export interface UploadPanelInput {
    readonly locale: UiLocale;
    readonly items: readonly UploadItemPort[];
    readonly sticky: StickyPort;
    readonly intents: PhotosIntentsPort | null;
    /** The address of a photo (`#/photos/<id>`). */
    readonly href: (photoId: string) => string;
}

function progress(locale: UiLocale, item: UploadItemPort): TemplateResult {
    const label = photoText(locale, 'adminContent.photos.uploads.status', { name: item.name, status: phaseText(locale, item) });
    if (item.phase === 'uploading') {
        return html`<hcm-progress .value=${item.percent / 100} .label=${label}></hcm-progress>`;
    }
    return item.phase === 'processing' || item.phase === 'queued'
        ? html`<hcm-progress indeterminate .label=${label}></hcm-progress>`
        : EMPTY;
}

function reason(locale: UiLocale, item: UploadItemPort): TemplateResult {
    return item.error === null ? EMPTY : html`<p class="alert">${messageText(locale, item.error, item.params)}</p>`;
}

function links(input: UploadPanelInput, item: UploadItemPort): TemplateResult[] {
    const { locale, href } = input;
    const out: TemplateResult[] = [];
    if (item.duplicateOf !== null) {
        out.push(html`<a href=${href(item.duplicateOf)}>${photoText(locale, 'adminContent.photos.openDuplicate')}</a>`);
    }
    if (item.photoId !== null && item.phase === 'done') {
        out.push(html`<a href=${href(item.photoId)}>${photoText(locale, 'adminContent.photos.upload.open', { name: item.name })}</a>`);
    }
    return out;
}

function buttons(input: UploadPanelInput, item: UploadItemPort): TemplateResult[] {
    const { locale, intents } = input;
    const name = { name: item.name };
    const out: TemplateResult[] = [];
    if (canRetry(item)) {
        out.push(
            html`<hcm-icon-button
                icon="refresh"
                .label=${photoText(locale, 'adminContent.photos.upload.retry', name)}
                @click=${() => intents?.retryUpload(item.key)}
            ></hcm-icon-button>`,
        );
    }
    if (RUNNING.has(item.phase)) {
        out.push(
            html`<hcm-icon-button
                icon="cancel"
                .label=${photoText(locale, 'adminContent.photos.upload.cancel', name)}
                @click=${() => intents?.cancelUpload(item.key)}
            ></hcm-icon-button>`,
        );
    } else {
        out.push(
            html`<hcm-icon-button
                icon="close"
                .label=${photoText(locale, 'adminContent.photos.upload.dismiss', name)}
                @click=${() => intents?.dismissUpload(item.key)}
            ></hcm-icon-button>`,
        );
    }
    return out;
}

function itemTemplate(input: UploadPanelInput, item: UploadItemPort): TemplateResult {
    const extra = links(input, item);
    return html`<li class="upload" data-phase=${item.phase}>
        <div class="upload-head">
            <span class="upload-name">${item.name}</span>
            <span class="note">${phaseText(input.locale, item)}</span>
            <span class="actions">${buttons(input, item)}</span>
        </div>
        ${progress(input.locale, item)} ${reason(input.locale, item)}
        ${extra.length === 0 ? nothing : html`<p class="actions">${extra}</p>`}
    </li>`;
}

function clearButton(input: UploadPanelInput): TemplateResult {
    const finished = input.items.some((item) => !RUNNING.has(item.phase));
    return finished
        ? html`<div class="actions">
              <hcm-button variant="text" icon="close" @click=${() => input.intents?.clearUploads()}
                  >${photoText(input.locale, 'adminContent.photos.uploads.clear')}</hcm-button
              >
          </div>`
        : EMPTY;
}

/** The uploads, or only the sticky line when there are none. */
export function uploadPanel(input: UploadPanelInput): TemplateResult {
    const { locale, items } = input;
    const list =
        items.length === 0
            ? EMPTY
            : html`<h3>${photoText(locale, 'adminContent.photos.uploads.title')}</h3>
                  <ul class="uploads">
                      ${items.map((item) => itemTemplate(input, item))}
                  </ul>
                  ${clearButton(input)}`;
    return html`<p class="note">${stickyText(locale, input.sticky)}</p>
        ${list}`;
}
