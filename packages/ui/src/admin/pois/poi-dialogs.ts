/**
 * The places page's dialogs (docs/research/M2c-interfaces.md §1.5, §7.2–§7.4, §9.5): the questions before a delete (one
 * place by its title, or the selection by its count, and what follows), a redraw that loses the drawn shape, and moving
 * the selection to a category; the photo picker (the city's photos by title with their thumbnail, at most twenty); and
 * the import (the file's preview: new, updated, unchanged and refused with the reasons, the category for features
 * without a known one, Import; then its progress and outcome).
 */
import { MAX_POI_PHOTOS, MAX_POIS, type UiLocale } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import type { ListStatePort } from '../area-port.js';
import { errorTemplate } from '../editing/states.js';
import { localized, poiText, reasonText, SHAPE_KEYS } from './poi-text.js';
import type { CategoryItemPort, ImportStatePort, PhotoChoicePort, PoiShapePort } from './pois-port.js';

export type PageDialog =
    | { readonly kind: 'delete'; readonly title: string }
    | { readonly kind: 'bulk-delete'; readonly count: number }
    | { readonly kind: 'redraw'; readonly shape: PoiShapePort }
    | { readonly kind: 'move'; readonly count: number }
    | { readonly kind: 'photos' };

export interface DialogHandlers {
    readonly confirm: () => void;
    readonly close: () => void;
}

interface ConfirmText {
    readonly headline: string;
    readonly body: string;
    readonly action: string;
}

/** The words of each question (a closed dialog keeps the last ones while it fades). */
const CONFIRM_TEXTS: { readonly [K in PageDialog['kind']]: (locale: UiLocale, dialog: Extract<PageDialog, { kind: K }>) => ConfirmText } = {
    delete: (locale, dialog) => ({
        headline: poiText(locale, 'adminContent.pois.deleteTitle', { title: dialog.title }),
        body: poiText(locale, 'adminContent.pois.deleteBody'),
        action: poiText(locale, 'adminContent.pois.deleteConfirm'),
    }),
    'bulk-delete': (locale, dialog) => ({
        headline: poiText(locale, 'adminContent.pois.bulk.deleteTitle', { count: String(dialog.count) }),
        body: poiText(locale, 'adminContent.pois.bulk.deleteBody'),
        action: poiText(locale, 'adminContent.pois.deleteConfirm'),
    }),
    redraw: (locale, dialog) => ({
        headline: poiText(locale, 'adminContent.pois.redrawTitle'),
        body: poiText(locale, 'adminContent.pois.redrawBody'),
        action: poiText(locale, 'adminContent.pois.redraw', { shape: poiText(locale, SHAPE_KEYS[dialog.shape]).toLocaleLowerCase(locale) }),
    }),
    move: () => ({ headline: '', body: '', action: '' }),
    photos: () => ({ headline: '', body: '', action: '' }),
};

function confirmText(locale: UiLocale, dialog: PageDialog | null): ConfirmText {
    if (dialog === null) {
        return { headline: '', body: '', action: '' };
    }
    return (CONFIRM_TEXTS[dialog.kind] as (locale: UiLocale, dialog: PageDialog) => ConfirmText)(locale, dialog);
}

/** The questions the confirmation dialog asks (the others have dialogs of their own). */
export type ConfirmedDialog = Extract<PageDialog, { readonly kind: 'delete' | 'bulk-delete' | 'redraw' }>;

const CONFIRMED: ReadonlySet<PageDialog['kind']> = new Set(['delete', 'bulk-delete', 'redraw']);

export function isConfirmed(dialog: PageDialog | null): dialog is ConfirmedDialog {
    return dialog !== null && CONFIRMED.has(dialog.kind);
}

/** The question before a delete or a redraw. */
export function confirmDialog(locale: UiLocale, dialog: PageDialog | null, handlers: DialogHandlers): TemplateResult {
    const open = isConfirmed(dialog);
    const text = confirmText(locale, dialog);
    return html`<hcm-confirm-dialog
        ?destructive=${dialog?.kind !== 'redraw'}
        .open=${open}
        .headline=${text.headline}
        .body=${text.body}
        .confirmLabel=${text.action}
        .cancelLabel=${poiText(locale, 'adminContent.common.cancel')}
        @hcm-confirm=${handlers.confirm}
        @hcm-cancel=${handlers.close}
    ></hcm-confirm-dialog>`;
}

/** Moving the selection: the category to move to. */
export function moveDialog(
    locale: UiLocale,
    dialog: PageDialog | null,
    categories: readonly CategoryItemPort[],
    handlers: { readonly move: (category: string) => void; readonly close: () => void },
): TemplateResult {
    const count = dialog?.kind === 'move' ? dialog.count : 0;
    const select = { value: categories[0]?.id ?? '' };
    return html`<hcm-dialog
        class="move-dialog"
        .open=${count > 0}
        .headline=${poiText(locale, 'adminContent.pois.bulk.moveTitle', { count: String(count) })}
        .closeLabel=${poiText(locale, 'adminContent.common.cancel')}
        @hcm-close=${handlers.close}
    >
        <div class="field">
            <label for="move-category">${poiText(locale, 'adminContent.pois.field.category')}</label>
            <select
                id="move-category"
                @change=${(event: Event) => {
                    select.value = (event.target as HTMLSelectElement).value;
                }}
            >
                ${categories.map((category) => html`<option value=${category.id}>${localized(locale, category.label)}</option>`)}
            </select>
        </div>
        <hcm-button slot="actions" variant="text" @click=${handlers.close}>${poiText(locale, 'adminContent.common.cancel')}</hcm-button>
        <hcm-button
            slot="actions"
            variant="filled"
            class="move-confirm"
            @click=${() => {
                handlers.move(select.value);
            }}
            >${poiText(locale, 'adminContent.pois.bulk.moveConfirm')}</hcm-button
        >
    </hcm-dialog>`;
}

function photoOption(locale: UiLocale, photo: PhotoChoicePort, chosen: readonly string[], toggle: (id: string) => void): TemplateResult {
    const checked = chosen.includes(photo.id);
    const full = chosen.length >= MAX_POI_PHOTOS && !checked;
    const year = photo.year === null ? poiText(locale, 'adminContent.pois.photoPicker.undated') : String(photo.year);
    return html`<li>
        <label>
            <input
                class="touch-target"
                type="checkbox"
                .checked=${checked}
                ?disabled=${full}
                @change=${() => {
                    toggle(photo.id);
                }}
            />
            ${photo.thumb === null ? nothing : html`<img src=${photo.thumb} alt="" loading="lazy" />`}
            <span>${[localized(locale, photo.title), ' (', year, ')'].join('')}</span>
        </label>
    </li>`;
}

interface PickerHandlers {
    readonly toggle: (id: string) => void;
    readonly close: () => void;
    readonly more: () => void;
    readonly retry: () => void;
}

/** The picker's list before its read started. */
const NOT_READ: ListStatePort<PhotoChoicePort> = { status: 'loading', items: [], hasMore: false, reconnecting: false, failure: null };

/** What the read gave so far: the words when the city has none, and Show more while there are others. */
function pickerList(
    locale: UiLocale,
    photos: ListStatePort<PhotoChoicePort>,
    chosen: readonly string[],
    handlers: PickerHandlers,
): TemplateResult {
    return html`${
            photos.status === 'ready' && photos.items.length === 0
                ? html`<p class="note">${poiText(locale, 'adminContent.pois.photoPicker.empty')}</p>`
                : nothing
        }
        <ul class="picker">
            ${photos.items.map((photo) => photoOption(locale, photo, chosen, handlers.toggle))}
        </ul>
        ${
            photos.hasMore
                ? html`<hcm-button class="more-photos" variant="text" @click=${handlers.more}
                      >${poiText(locale, 'adminContent.common.more')}</hcm-button
                  >`
                : nothing
        }`;
}

/** The photo picker: the city's photos, newest first, a page at a time, at most `MAX_POI_PHOTOS` chosen. */
export function photoPicker(
    locale: UiLocale,
    open: boolean,
    picker: { readonly photos: ListStatePort<PhotoChoicePort> | null; readonly chosen: readonly string[] },
    handlers: PickerHandlers,
): TemplateResult {
    const { chosen, photos } = picker;
    return html`<hcm-dialog
        class="photo-picker"
        .open=${open}
        .headline=${poiText(locale, 'adminContent.pois.photoPicker.title')}
        .closeLabel=${poiText(locale, 'adminContent.pois.photoPicker.done')}
        @hcm-close=${handlers.close}
    >
        <p class="note" role="status">
            ${poiText(locale, 'adminContent.pois.photoPicker.limit', { count: String(chosen.length), max: String(MAX_POI_PHOTOS) })}
        </p>
        ${
            photos?.status === 'error'
                ? errorTemplate(locale, photos.failure, handlers.retry)
                : pickerList(locale, photos ?? NOT_READ, chosen, handlers)
        }
        <hcm-button slot="actions" variant="filled" @click=${handlers.close}
            >${poiText(locale, 'adminContent.pois.photoPicker.done')}</hcm-button
        >
    </hcm-dialog>`;
}

function importCounts(locale: UiLocale, state: ImportStatePort): TemplateResult {
    const plan = state.plan;
    if (plan === null) {
        return html``;
    }
    const counts = [
        poiText(locale, 'adminContent.pois.import.created', { count: String(plan.created.length) }),
        poiText(locale, 'adminContent.pois.import.updated', { count: String(plan.updated.length) }),
        poiText(locale, 'adminContent.pois.import.unchanged', { count: String(plan.unchanged) }),
        poiText(locale, 'adminContent.pois.import.refused', { count: String(plan.refused.length) }),
    ];
    return html`<ul class="counts">
        ${counts.map((count) => html`<li class="tag">${count}</li>`)}
    </ul>`;
}

/** The refused features, each with its reason (after the category choice: the list can be long). */
function importRefusals(locale: UiLocale, state: ImportStatePort): TemplateResult {
    const plan = state.plan;
    if (plan === null) {
        return html``;
    }
    return html`<ul>
        ${plan.refused.map(
            (refusal) =>
                html`<li>
                    ${poiText(locale, 'adminContent.pois.import.refusedItem', {
                        number: String(refusal.number),
                        title: refusal.title ?? '',
                        reason: reasonText(locale, refusal.reason, refusal.path),
                    })}
                </li>`,
        )}
    </ul>`;
}

/** Features that need the chosen category: uncategorised ones planned, and those refused for an unknown category. */
function missingCategories(plan: ImportStatePort['plan']): number {
    if (plan === null) {
        return 0;
    }
    return plan.uncategorised + plan.refused.filter((refusal) => refusal.reason === 'unknown-category').length;
}

function importCategory(
    locale: UiLocale,
    state: ImportStatePort,
    categories: readonly CategoryItemPort[],
    choose: (category: string) => void,
): TemplateResult {
    const missing = missingCategories(state.plan);
    if (state.status !== 'preview' || (missing === 0 && state.fallbackCategory === null)) {
        return html``;
    }
    return html`<div class="field">
        <label for="import-category">${poiText(locale, 'adminContent.pois.import.category', { count: String(missing) })}</label>
        <select
            id="import-category"
            @change=${(event: Event) => {
                choose((event.target as HTMLSelectElement).value);
            }}
        >
            <option value="" ?selected=${state.fallbackCategory === null} disabled>
                ${poiText(locale, 'adminContent.pois.import.chooseCategory')}
            </option>
            ${categories.map(
                (category) =>
                    html`<option value=${category.id} ?selected=${category.id === state.fallbackCategory}>
                        ${localized(locale, category.label)}
                    </option>`,
            )}
        </select>
    </div>`;
}

/** Places the import writes: new and updated. */
function writes(plan: ImportStatePort['plan']): number {
    return plan === null ? 0 : plan.created.length + plan.updated.length;
}

const IMPORT_STATUS: Readonly<Record<ImportStatePort['status'], Parameters<typeof poiText>[1] | null>> = {
    reading: 'adminContent.pois.import.reading',
    refused: null,
    preview: 'adminContent.pois.import.dryRun',
    writing: 'adminContent.pois.import.writing',
    done: 'adminContent.pois.import.done',
    failed: 'adminContent.pois.import.failed',
};

function importStatus(locale: UiLocale, state: ImportStatePort): string {
    const key = IMPORT_STATUS[state.status];
    if (key !== null) {
        return poiText(locale, key, { written: String(state.written), total: String(writes(state.plan)) });
    }
    return state.refusal === null ? '' : poiText(locale, `adminContent.pois.import.file.${state.refusal}`, limitParams(state.limit));
}

/** The numbers of a refusal over the city's limit (none for the other refusals). */
function limitParams(limit: ImportStatePort['limit']): Readonly<Record<string, string>> {
    return limit === undefined || limit === null
        ? {}
        : { count: String(limit.existing), adding: String(limit.adding), limit: String(MAX_POIS) };
}

/** The body of an open import dialog. */
function importBody(
    locale: UiLocale,
    state: ImportStatePort,
    categories: readonly CategoryItemPort[],
    choose: (category: string) => void,
): TemplateResult {
    const alert = state.status === 'refused' || state.status === 'failed';
    return html`<p class=${alert ? 'alert' : 'note'} role="status">${importStatus(locale, state)}</p>
        ${importCounts(locale, state)} ${importCategory(locale, state, categories, choose)} ${importRefusals(locale, state)}`;
}

function importGo(locale: UiLocale, state: ImportStatePort | null, commit: () => void): TemplateResult {
    const writable = state?.status === 'preview' && writes(state.plan) > 0;
    return writable
        ? html`<hcm-button slot="actions" variant="filled" class="import-go" @click=${commit}
              >${poiText(locale, 'adminContent.pois.import.go')}</hcm-button
          >`
        : html``;
}

/** The import's dialog: the dry run's preview, then the writing and its outcome. */
export function importDialog(
    locale: UiLocale,
    state: ImportStatePort | null,
    categories: readonly CategoryItemPort[],
    handlers: { readonly choose: (category: string) => void; readonly commit: () => void; readonly close: () => void },
): TemplateResult {
    const file = state === null ? '' : state.fileName;
    return html`<hcm-dialog
        class="import-dialog"
        .open=${state !== null}
        .headline=${poiText(locale, 'adminContent.pois.import.title', { file })}
        .closeLabel=${poiText(locale, 'adminContent.common.close')}
        @hcm-close=${handlers.close}
    >
        ${state === null ? nothing : importBody(locale, state, categories, handlers.choose)}
        <hcm-button slot="actions" variant="text" @click=${handlers.close}>${poiText(locale, 'adminContent.common.close')}</hcm-button>
        ${importGo(locale, state, handlers.commit)}
    </hcm-dialog>`;
}
