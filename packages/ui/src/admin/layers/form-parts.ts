/**
 * The pieces the layer editor and the settings sections share (`docs/research/M2c-interfaces.md` §1.6, §1.3): a native
 * field with its label, help and error (the problem at the field: `aria-invalid`, `aria-describedby`, the validation
 * key's text, or the action a required field asks for: `../editing/issue-text.ts`), a 0–100 % slider row with its value, the editor's top row (title, save state, Save, Discard) and the
 * conflict and gone banners (who saved the other version and when, the fields both changed by their names). A revoked
 * admin's page is read-only (`DECISIONS-for-review.md` §42d): a field is `readOnly`, a slider `disabled`, the save row's
 * `readOnly` turns Save and Discard off. Text only: every value is bound as a property or text, never as markup.
 */
import type { AdminContentKey, UiLocale, ValidationIssue } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';

import { conflictFields, NOBODY, savedByText, type ConflictPort, type WhoPort } from '../editing/conflict.js';
import { formatDateInput, parseDateInput } from '../editing/date-text.js';
import { issueText } from '../editing/issue-text.js';
import { EMPTY } from '../shell/empty.js';
import { contentText } from '../shell/text.js';

export interface FieldSpec {
    /** The input's id, unique in the page (the issue's path when it maps to one). */
    readonly id: string;
    readonly label: string;
    readonly value: string;
    /** The problem Save found at this field, or null. */
    readonly issue: ValidationIssue | null;
    /**
     * The id of a message several fields share (the city's four edges, refused together): the field is marked invalid and
     * described by it instead of repeating the problem under itself.
     */
    readonly issueShownAt?: string;
    readonly help?: string;
    /**
     * `date`: an ISO date (`YYYY-MM-DD`) typed in the admin's language (`zz.ll.aaaa`, `dd/mm/yyyy`) in a text field, never
     * the browser's date input, whose pattern follows the browser's language (`../editing/date-text.ts`).
     */
    readonly type?: 'text' | 'url' | 'date';
    /** A short hint inside the empty field (the date pattern). */
    readonly placeholder?: string;
    /** `decimal` for coordinates and zooms (a numeric keyboard); `numeric` for a year. */
    readonly inputMode?: 'decimal' | 'numeric';
    readonly multiline?: boolean;
    readonly required?: boolean;
    /** The value can be read and copied, not changed (a revoked admin's page). */
    readonly readOnly?: boolean;
    readonly onInput: (text: string) => void;
}

function describedBy(spec: FieldSpec): string | typeof nothing {
    const error = spec.issueShownAt ?? `${spec.id}-error`;
    const ids = [spec.help === undefined ? '' : `${spec.id}-help`, spec.issue === null ? '' : error].filter((id) => id !== '');
    return ids.length === 0 ? nothing : ids.join(' ');
}

function inputHandler(spec: FieldSpec): (event: Event) => void {
    return (event: Event): void => {
        spec.onInput((event.target as HTMLInputElement | HTMLTextAreaElement).value);
    };
}

function textareaOf(spec: FieldSpec): TemplateResult {
    return html`<textarea
        id=${spec.id}
        rows="5"
        ?readonly=${spec.readOnly === true}
        .value=${live(spec.value)}
        ?required=${spec.required === true}
        aria-invalid=${spec.issue === null ? 'false' : 'true'}
        aria-describedby=${describedBy(spec)}
        @input=${inputHandler(spec)}
    ></textarea>`;
}

/** The input's optional attributes: `nothing` leaves one out. */
function optional(spec: FieldSpec): { readonly inputMode: string | typeof nothing; readonly placeholder: string | typeof nothing } {
    return { inputMode: spec.inputMode ?? nothing, placeholder: spec.placeholder ?? nothing };
}

function inputOf(spec: FieldSpec): TemplateResult {
    if (spec.multiline === true) {
        return textareaOf(spec);
    }
    const { inputMode, placeholder } = optional(spec);
    return html`<input
        id=${spec.id}
        type=${spec.type ?? 'text'}
        inputmode=${inputMode}
        placeholder=${placeholder}
        ?readonly=${spec.readOnly === true}
        .value=${live(spec.value)}
        ?required=${spec.required === true}
        aria-invalid=${spec.issue === null ? 'false' : 'true'}
        aria-describedby=${describedBy(spec)}
        @input=${inputHandler(spec)}
    />`;
}

/**
 * A date field as a text field in the admin's language: the ISO value shown as `18.10.2026` (or `18/10/2026`), the pattern
 * as its hint, and what is typed handed on as an ISO date once it reads as one (a text that does not stays as typed, so
 * Save names the problem at the field).
 */
function dateSpec(locale: UiLocale, spec: FieldSpec): FieldSpec {
    const pattern = contentText(locale, 'adminContent.common.datePattern');
    return {
        ...spec,
        type: 'text',
        value: formatDateInput(locale, spec.value),
        placeholder: pattern,
        help: spec.help ?? contentText(locale, 'adminContent.common.dateHint', { pattern }),
        onInput: (text) => {
            spec.onInput(parseDateInput(text) ?? text);
        },
    };
}

/** One labelled field; its problem, when Save found one, is said under it and named to assistive technology. */
export function field(locale: UiLocale, given: FieldSpec): TemplateResult {
    const spec = given.type === 'date' ? dateSpec(locale, given) : given;
    const helpId = `${spec.id}-help`;
    const errorId = `${spec.id}-error`;
    return html`<div class="field" ?data-invalid=${spec.issue !== null}>
        <label for=${spec.id}>${spec.label}</label>
        ${inputOf(spec)} ${spec.help === undefined ? nothing : html`<span class="note" id=${helpId}>${spec.help}</span>`}
        ${
            spec.issue === null || spec.issueShownAt !== undefined
                ? nothing
                : html`<span class="error" id=${errorId}>${issueText(locale, spec.issue)}</span>`
        }
    </div>`;
}

/** The first issue at `path` or below it (`label` finds `label.ro`). */
export function issueAt(issues: readonly ValidationIssue[], path: string): ValidationIssue | null {
    return issues.find((issue) => issue.path === path || issue.path.startsWith(`${path}.`) || issue.path.startsWith(`${path}[`)) ?? null;
}

export interface SliderSpec {
    readonly label: string;
    readonly min: number;
    readonly max: number;
    readonly value: number;
    /** What the slider and its value say (`40 %`, `+20 %`). */
    readonly valueText: string;
    /** Every frame while it moves and on release. */
    readonly onValue: (value: number) => void;
    /** Once it settles (release, a key press): what to announce. */
    readonly onSettled: (value: number) => void;
    /** A revoked admin's page: the slider shows its value and does not move. */
    readonly disabled?: boolean;
}

function sliderValue(event: Event): number {
    event.stopPropagation();
    return (event as CustomEvent<{ value: number }>).detail.value;
}

/**
 * A labelled slider with its value beside it (the value is the slider's `aria-valuetext` too). The value is bound `live`:
 * a move the store refuses or clamps (the black level stopped at the white) is put back on the slider, which moved itself.
 */
export function sliderRow(spec: SliderSpec): TemplateResult {
    return html`<div class="slider-row">
        <span class="slider-label" aria-hidden="true">${spec.label}</span>
        <hcm-slider
            min=${spec.min}
            max=${spec.max}
            step="1"
            .value=${live(spec.value)}
            label=${spec.label}
            value-text=${spec.valueText}
            ?disabled=${spec.disabled === true}
            @hcm-input=${(event: Event) => {
                spec.onValue(sliderValue(event));
            }}
            @hcm-change=${(event: Event) => {
                const value = sliderValue(event);
                spec.onValue(value);
                spec.onSettled(value);
            }}
        ></hcm-slider>
        <span class="slider-value" aria-hidden="true">${spec.valueText}</span>
    </div>`;
}

export interface SaveTexts {
    readonly saved: AdminContentKey;
    readonly unsaved: AdminContentKey;
    readonly saving: AdminContentKey;
}

export interface SaveState {
    readonly dirty: boolean;
    readonly saving: boolean;
    /** A conflict to resolve, a deleted document or a problem in a field: Save is off. */
    readonly blocked: boolean;
    /** A revoked admin's page: Save and Discard are off and the row says the page is read only. */
    readonly readOnly?: boolean;
}

/** The save row's state of a draft: Save is off while there is a conflict, the document is gone or a field has a problem. */
export function saveStateOf(draft: {
    readonly dirty: boolean;
    readonly saving: boolean;
    readonly conflict: unknown;
    readonly gone: boolean;
    readonly issues: readonly unknown[];
}): SaveState {
    return { dirty: draft.dirty, saving: draft.saving, blocked: draft.conflict !== null || draft.gone || draft.issues.length > 0 };
}

function stateKey(texts: SaveTexts, state: SaveState): AdminContentKey {
    if (state.readOnly === true) {
        return 'adminContent.common.readOnly';
    }
    if (state.saving) {
        return texts.saving;
    }
    return state.dirty ? texts.unsaved : texts.saved;
}

/** The save state ("Saved", "Unsaved changes", "Saving…") in a polite region, Save and Discard. */
export interface SaveHandlers {
    readonly save: () => void;
    readonly discard: () => void;
}

export function saveBar(locale: UiLocale, texts: SaveTexts, state: SaveState, handlers: SaveHandlers): TemplateResult {
    const open = state.readOnly !== true && !state.saving;
    const canSave = state.dirty && open && !state.blocked;
    return html`<div class="save-bar">
        <p class="note save-state" role="status">${contentText(locale, stateKey(texts, state))}</p>
        <div class="actions">
            <hcm-button variant="text" ?disabled=${!state.dirty || !open} @click=${handlers.discard}
                >${contentText(locale, 'adminContent.common.discard')}</hcm-button
            >
            <hcm-button variant="filled" ?disabled=${!canSave} @click=${handlers.save}
                >${contentText(locale, 'adminContent.common.save')}</hcm-button
            >
        </div>
    </div>`;
}

export interface ConflictTexts {
    readonly conflict: AdminContentKey;
    readonly keepMine: AdminContentKey;
    readonly takeTheirs: AdminContentKey;
}

/** Keep mine and Take theirs; who reads the page, the names the shell knows and whether the page is read only. */
export interface BannerOptions {
    readonly keepMine: () => void;
    readonly takeTheirs: () => void;
    readonly who?: WhoPort;
    readonly readOnly?: boolean;
}

/**
 * Another admin saved the same fields meanwhile: the banner names who and when, and the fields both changed; the admin
 * keeps their own changes or takes the saved version (neither on a read-only page).
 */
export function conflictBanner(
    locale: UiLocale,
    texts: ConflictTexts,
    conflict: ConflictPort | null,
    options: BannerOptions,
): TemplateResult {
    if (conflict === null) {
        return EMPTY;
    }
    const off = options.readOnly === true;
    const handlers = options;
    return html`<div class="alert" role="alert">
        <hcm-icon name="warning"></hcm-icon>
        <div class="alert-body">
            <span>${savedByText(locale, conflict, options.who ?? NOBODY)}</span>
            <span>${contentText(locale, texts.conflict, { fields: conflictFields(locale, conflict) })}</span>
            <div class="actions">
                <hcm-button variant="text" ?disabled=${off} @click=${handlers.keepMine}>${contentText(locale, texts.keepMine)}</hcm-button>
                <hcm-button variant="text" ?disabled=${off} @click=${handlers.takeTheirs}
                    >${contentText(locale, texts.takeTheirs)}</hcm-button
                >
            </div>
        </div>
    </div>`;
}

/** A polite region that exists before its text, so the text is announced (a slider that settled, a reorder). */
export function announcer(text: string): TemplateResult {
    return html`<p class="visually-hidden" role="status" aria-live="polite">${text}</p>`;
}
