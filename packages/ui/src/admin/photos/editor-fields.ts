/**
 * Native fields of the photo editor (`docs/research/M2c-interfaces.md` §9.5 fields, §1.6 messages): a label, the input
 * (outlined, 48 px, the editing kit's styles), an optional hint, and the field's problem as text tied to it
 * (`aria-invalid`, `aria-describedby`). Texts and numbers are passed on every keystroke; a number keeps what the admin
 * typed while it is the same number (a half-typed `44.` is not rewritten under the cursor) and says its problem only
 * once it has been left (`../editing/number-fields.ts`, `DECISIONS-for-review.md` §35d).
 */
import { html, nothing, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';

import { numberValue, type FieldsLeft } from '../editing/number-fields.js';

import { partId } from './photo-text.js';

export interface FieldInput {
    readonly id: string;
    readonly label: string;
    readonly value: string;
    /** The field's problem, as text (null: none). */
    readonly error: string | null;
    readonly hint?: string;
    /** The id of a note outside the field that describes it too (one note above a pair of fields). */
    readonly sharedHint?: string;
    /** A revoked admin's editor (`DECISIONS-for-review.md` §42d): the value can be read and copied, not changed. */
    readonly readOnly?: boolean;
}

function describedBy(input: FieldInput): string | typeof nothing {
    const ids = [
        input.sharedHint ?? null,
        input.hint === undefined ? null : partId(input.id, 'hint'),
        input.error === null ? null : partId(input.id, 'error'),
    ].filter((id): id is string => id !== null);
    return ids.length === 0 ? nothing : ids.join(' ');
}

function notes(input: FieldInput): TemplateResult {
    const hint = input.hint === undefined ? nothing : html`<span class="note" id=${partId(input.id, 'hint')}>${input.hint}</span>`;
    const error = input.error === null ? nothing : html`<span class="error" id=${partId(input.id, 'error')}>${input.error}</span>`;
    return html`${hint} ${error}`;
}

const valueOf = (event: Event): string => (event.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;

/** A one-line text field (`type` text or url), reported on every keystroke. */
export function textField(
    input: FieldInput & { readonly type?: 'text' | 'url'; readonly maxlength?: number },
    changed: (value: string) => void,
): TemplateResult {
    return html`<div class="field" ?data-invalid=${input.error !== null}>
        <label for=${input.id}>${input.label}</label>
        <input
            id=${input.id}
            type=${input.type ?? 'text'}
            maxlength=${input.maxlength ?? 200}
            ?readonly=${input.readOnly === true}
            .value=${input.value}
            aria-invalid=${input.error === null ? 'false' : 'true'}
            aria-describedby=${describedBy(input)}
            @input=${(event: Event) => {
                changed(valueOf(event));
            }}
        />
        ${notes(input)}
    </div>`;
}

/** A multi-line text field, reported on every keystroke. */
export function areaField(input: FieldInput & { readonly maxlength: number }, changed: (value: string) => void): TemplateResult {
    return html`<div class="field" ?data-invalid=${input.error !== null}>
        <label for=${input.id}>${input.label}</label>
        <textarea
            id=${input.id}
            maxlength=${input.maxlength}
            ?readonly=${input.readOnly === true}
            .value=${input.value}
            aria-invalid=${input.error === null ? 'false' : 'true'}
            aria-describedby=${describedBy(input)}
            @input=${(event: Event) => {
                changed(valueOf(event));
            }}
        ></textarea>
        ${notes(input)}
    </div>`;
}

/** A number field, reported on every keystroke (`''` for an empty or unfinished one); its problem shows once it is left. */
export function numberField(
    input: FieldInput & { readonly min: number; readonly max: number; readonly step: string },
    changed: (value: string) => void,
    left: FieldsLeft,
): TemplateResult {
    const shown: FieldInput = left.has(input.id) ? input : { ...input, error: null };
    return html`<div class="field" ?data-invalid=${shown.error !== null}>
        <label for=${input.id}>${input.label}</label>
        <input
            id=${input.id}
            type="number"
            inputmode="decimal"
            min=${input.min}
            max=${input.max}
            step=${input.step}
            ?readonly=${input.readOnly === true}
            .value=${numberValue(input.value)}
            aria-invalid=${shown.error === null ? 'false' : 'true'}
            aria-describedby=${describedBy(shown)}
            @input=${(event: Event) => {
                changed(valueOf(event));
            }}
            @focusout=${() => {
                left.leave(input.id);
            }}
        />
        ${notes(shown)}
    </div>`;
}

/**
 * A choice among values, each with its label. The selection is a live property, never the `selected` attribute: an option
 * the admin has picked is dirty and ignores its attribute, so Discard, Take theirs or a remote change left the old choice
 * on screen (the draft said March, the field May).
 */
export function selectField(
    input: FieldInput & { readonly options: readonly { readonly value: string; readonly label: string }[] },
    changed: (value: string) => void,
): TemplateResult {
    return html`<div class="field" ?data-invalid=${input.error !== null}>
        <label for=${input.id}>${input.label}</label>
        <select
            id=${input.id}
            ?disabled=${input.readOnly === true}
            aria-invalid=${input.error === null ? 'false' : 'true'}
            aria-describedby=${describedBy(input)}
            @change=${(event: Event) => {
                changed((event.currentTarget as HTMLSelectElement).value);
            }}
        >
            ${input.options.map((option) => html`<option value=${option.value} .selected=${live(option.value === input.value)}>${option.label}</option>`)}
        </select>
        ${notes(input)}
    </div>`;
}

/** A number typed in a field, undefined when empty or not a number. */
export function numberOf(text: string): number | undefined {
    const value = Number.parseFloat(text);
    return text.trim() === '' || Number.isNaN(value) ? undefined : value;
}

/** A text, undefined when it is only spaces (an optional field left empty is absent, never blank). */
export function textOf(text: string): string | undefined {
    return text.trim() === '' ? undefined : text;
}
