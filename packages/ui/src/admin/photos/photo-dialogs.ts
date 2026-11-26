/**
 * The photos page's dialogs (`docs/research/M2c-interfaces.md` §9.5, §1.5): the delete confirmation (one photo by its
 * title, or the count; what follows: it leaves the public map within about a minute and can be brought back from
 * History), the skipped photos of the last bulk action ("See why"), and Author, source and licence for the selection
 * (an empty field stays as it is).
 */
import type { FirestoreLicense, UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { textOf } from './editor-fields.js';
import { LICENSE_ORDER, licenseText, partId, photoHref, photoText, skipText } from './photo-text.js';
import type { BulkReportPort, PhotosViewState, StickyPort } from './photos-port.js';

export function deleteDialog(
    locale: UiLocale,
    confirm: PhotosViewState['confirm'],
    handlers: { readonly confirm: () => void; readonly cancel: () => void },
): TemplateResult {
    const { ids, title } = confirm ?? { ids: [], title: null };
    const headline =
        title === null
            ? photoText(locale, 'adminContent.photos.delete.titleMany', { count: String(ids.length) })
            : photoText(locale, 'adminContent.photos.delete.titleOne', { title });
    return html`<hcm-confirm-dialog
        destructive
        .open=${confirm !== null}
        .headline=${headline}
        .body=${photoText(locale, 'adminContent.photos.delete.body')}
        .confirmLabel=${photoText(locale, 'adminContent.photos.delete.confirm')}
        .cancelLabel=${photoText(locale, 'adminContent.photos.delete.cancel')}
        @hcm-confirm=${handlers.confirm}
        @hcm-cancel=${handlers.cancel}
    ></hcm-confirm-dialog>`;
}

export function reportDialog(locale: UiLocale, report: BulkReportPort | null, close: () => void): TemplateResult {
    return html`<hcm-dialog
        class="report"
        .open=${report !== null}
        .headline=${photoText(locale, 'adminContent.photos.report.title')}
        .closeLabel=${photoText(locale, 'adminContent.photos.report.close')}
        @hcm-close=${close}
    >
        <p>${photoText(locale, 'adminContent.photos.report.intro')}</p>
        <ul class="skipped">
            ${(report?.skipped ?? []).map((skip) => html`<li><a href=${photoHref(skip.id)}>${skipText(locale, skip)}</a></li>`)}
        </ul>
    </hcm-dialog>`;
}

/** The fields of the Author, source and licence form; `keep` leaves the licence as it is. */
export function stickyFrom(form: HTMLFormElement): StickyPort {
    const data = new FormData(form);
    const value = (name: string): string => {
        const entry = data.get(name);
        return typeof entry === 'string' ? entry : '';
    };
    const text = (name: string): string | undefined => textOf(value(name));
    const license = value('license');
    return {
        author: text('author'),
        sourceLabel: text('sourceLabel'),
        sourceUrl: text('sourceUrl'),
        rightsHolder: text('rightsHolder'),
        license: license === 'keep' || license === '' ? undefined : (license as FirestoreLicense),
    };
}

export function setFieldsDialog(
    locale: UiLocale,
    open: { readonly count: number } | null,
    handlers: { readonly apply: (fields: StickyPort) => void; readonly close: () => void },
): TemplateResult {
    const submit = (event: SubmitEvent): void => {
        event.preventDefault();
        handlers.apply(stickyFrom(event.currentTarget as HTMLFormElement));
    };
    const press = (event: Event): void => {
        (event.currentTarget as HTMLElement).closest('hcm-dialog')?.querySelector('form')?.requestSubmit();
    };
    const field = (name: 'author' | 'sourceLabel' | 'sourceUrl' | 'rightsHolder', type = 'text'): TemplateResult =>
        html`<div class="field">
            <label for=${partId('bulk', name)}>${photoText(locale, `adminContent.photos.field.${name}`)}</label>
            <input id=${partId('bulk', name)} name=${name} type=${type} maxlength=${type === 'url' ? 2048 : 200} />
        </div>`;
    return html`<hcm-dialog
        class="set-fields"
        .open=${open !== null}
        .headline=${photoText(locale, 'adminContent.photos.setFields.title')}
        .closeLabel=${photoText(locale, 'adminContent.photos.setFields.cancel')}
        @hcm-close=${handlers.close}
    >
        <form class="dialog-form" @submit=${submit} novalidate>
            <p>${photoText(locale, 'adminContent.photos.setFields.intro', { count: String(open?.count ?? 0) })}</p>
            ${field('author')}
            <div class="field">
                <label for="bulk-license">${photoText(locale, 'adminContent.photos.field.license')}</label>
                <select id="bulk-license" name="license">
                    <option value="keep">${photoText(locale, 'adminContent.photos.license.keep')}</option>
                    ${LICENSE_ORDER.map((license) => html`<option value=${license}>${licenseText(locale, license)}</option>`)}
                </select>
            </div>
            ${field('rightsHolder')} ${field('sourceLabel')} ${field('sourceUrl', 'url')}
        </form>
        <hcm-button slot="actions" variant="text" @click=${handlers.close}
            >${photoText(locale, 'adminContent.photos.setFields.cancel')}</hcm-button
        >
        <hcm-button slot="actions" variant="filled" @click=${press}>${photoText(locale, 'adminContent.photos.setFields.apply')}</hcm-button>
    </hcm-dialog>`;
}
