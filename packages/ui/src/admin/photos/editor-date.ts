/**
 * The photo editor's date fields at their precision (`docs/research/photo-date-source.md` §1): Month appears once there
 * is a year, Day once there is a month. Clearing a part clears the parts below it, so no hidden part is left behind. A
 * range (an end year after the year) dates no month: Month stays hidden, unless the photo already has one to clear.
 */
import { monthNames, type UiLocale, type ValidationIssue } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import type { FieldsLeft } from '../editing/number-fields.js';
import { EMPTY } from '../shell/empty.js';
import { numberField, numberOf, selectField } from './editor-fields.js';
import { fieldIssue, photoText } from './photo-text.js';
import type { PhotoPatchPort, PhotoValuePort } from './photos-port.js';

/** What these fields read of the editor's section input. */
interface DateInput {
    readonly locale: UiLocale;
    readonly value: PhotoValuePort;
    readonly issues: readonly ValidationIssue[];
    readonly edit: (patch: PhotoPatchPort) => void;
    readonly left: FieldsLeft;
    readonly readOnly: boolean;
}

/** The patch of a typed year: without a year, there is no month or day either. */
export function yearPatch(typed: string): PhotoPatchPort {
    const year = numberOf(typed);
    return year === undefined ? { year, month: undefined, day: undefined } : { year };
}

function monthPatch(chosen: string): PhotoPatchPort {
    const month = numberOf(chosen);
    return month === undefined ? { month, day: undefined } : { month };
}

function isRange({ year, yearEnd }: PhotoValuePort): boolean {
    return yearEnd !== undefined && yearEnd !== year;
}

function showsMonth(value: PhotoValuePort): boolean {
    return value.month !== undefined || (value.year !== undefined && !isRange(value));
}

function monthField(input: DateInput): TemplateResult {
    const { locale, value, issues, edit } = input;
    const none = { value: '', label: photoText(locale, 'adminContent.photos.field.monthNone') };
    const months = monthNames(locale).map((label, index) => ({ value: String(index + 1), label }));
    return selectField(
        {
            id: 'photo-month',
            label: photoText(locale, 'adminContent.photos.field.month'),
            value: value.month === undefined ? '' : String(value.month),
            error: fieldIssue(locale, issues, 'month'),
            options: [none, ...months],
            readOnly: input.readOnly,
        },
        (chosen) => {
            edit(monthPatch(chosen));
        },
    );
}

function dayField(input: DateInput): TemplateResult {
    const { locale, value, issues, edit } = input;
    return numberField(
        {
            id: 'photo-day',
            label: photoText(locale, 'adminContent.photos.field.day'),
            value: value.day === undefined ? '' : String(value.day),
            error: fieldIssue(locale, issues, 'day'),
            min: 1,
            max: 31,
            step: '1',
            readOnly: input.readOnly,
        },
        (typed) => {
            edit({ day: numberOf(typed) });
        },
        input.left,
    );
}

/** Month and Day, each once the part before it is set. */
export function dateParts(input: DateInput): TemplateResult {
    if (!showsMonth(input.value)) {
        return EMPTY;
    }
    const day = input.value.month === undefined ? EMPTY : dayField(input);
    return html`<div class="pair">${monthField(input)} ${day}</div>`;
}
