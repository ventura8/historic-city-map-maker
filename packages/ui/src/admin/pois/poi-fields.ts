/**
 * The place editor's fields (docs/research/M2c-interfaces.md §7.2): category, titles and descriptions in Romanian and
 * English (the description in the Markdown subset, previewed as DOM by the viewer's own renderer: markup stays text),
 * the years (one at least, either open), the links (at most five, https), the linked photos and Published. Every field shows its
 * problem at the field (`aria-invalid`, `aria-describedby`) in the viewer's validation words; a year once it has been
 * left (it commits on every key, `../editing/number-fields.ts`); a required field's problem says what to do ("Add a title in
 * Romanian", "Choose a category": `../editing/issue-text.ts`). A city without categories gets, instead of an empty select,
 * the starter categories in one click or a link to add one (finding 35 of 2026-11-01). Native inputs, styled by the
 * editing kit.
 */
import { MAX_LINKS, STARTER_POI_CATEGORIES, type AdminContentKey, type CityRole, type UiLocale, type ValidationIssue } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import { renderMarkdown } from '../../viewer/markdown.js';
import { numberValue, type FieldsLeft } from '../editing/number-fields.js';
import { EMPTY } from '../shell/empty.js';
import { fieldIssue, issueText, localized, poiText } from './poi-text.js';
import type { CategoryItemPort, PhotoChoicePort, PoiLinkPort, PoiPatchPort, PoiTextPort, PoiValuePort } from './pois-port.js';

export interface FieldContext {
    readonly locale: UiLocale;
    readonly value: PoiValuePort;
    readonly issues: readonly ValidationIssue[];
    readonly edit: (patch: PoiPatchPort) => void;
    /** The number fields left since the place opened: only they say their problem. */
    readonly left: FieldsLeft;
    /** A revoked admin's editor: the fields are read-only, nothing that writes is on (`DECISIONS-for-review.md` §42d). */
    readonly readOnly: boolean;
    /** M13: the admin's role in the city. */
    readonly role?: CityRole | null;
}

type Language = 'ro' | 'en';

function inputOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
}

/** A note line, or nothing when `shown` is false. */
function noteIf(shown: boolean, locale: UiLocale, key: AdminContentKey, params?: Readonly<Record<string, string>>): TemplateResult {
    return shown ? html`<p class="note">${poiText(locale, key, params)}</p>` : EMPTY;
}

function errorId(id: string): string {
    return [id, 'error'].join('-');
}

interface Problem {
    readonly invalid: 'true' | typeof nothing;
    /** The ids that describe the control: its error line, then `hints`. */
    readonly describedBy: string | typeof nothing;
    readonly line: TemplateResult;
}

/** A field's error line and the attributes that tie it to its control. */
function problem(context: FieldContext, field: string, spec: { readonly id: string; readonly hints?: string }): Problem {
    const issue = fieldIssue(context.issues, field);
    const hints = spec.hints ?? '';
    if (issue === undefined) {
        return { invalid: nothing, describedBy: hints === '' ? nothing : hints, line: EMPTY };
    }
    const line = html`<p class="error" id=${errorId(spec.id)}>${issueText(context.locale, issue)}</p>`;
    return { invalid: 'true', describedBy: [errorId(spec.id), hints].join(' ').trim(), line };
}

interface TextSpec {
    readonly id: string;
    readonly field: string;
    readonly label: string;
    readonly value: string;
    readonly set: (text: string) => void;
}

function textField(context: FieldContext, spec: TextSpec): TemplateResult {
    const { invalid, describedBy, line } = problem(context, spec.field, spec);
    return html`<div class="field" ?data-invalid=${invalid !== nothing}>
        <label for=${spec.id}>${spec.label}</label>
        <input
            id=${spec.id}
            autocomplete="off"
            ?readonly=${context.readOnly}
            .value=${spec.value}
            aria-invalid=${invalid}
            aria-describedby=${describedBy}
            @input=${(event: Event) => {
                spec.set(inputOf(event));
            }}
        />
        ${line}
    </div>`;
}

/** The category field's choices, and the starter categories a city without any is offered (finding 35 of 2026-11-01). */
export interface CategoryChoice {
    readonly categories: readonly CategoryItemPort[];
    /** The city's categories were listed: an empty list then means the city has none. */
    readonly known: boolean;
    /** The starter categories are being written. */
    readonly adding: boolean;
    readonly addStarters: () => void;
}

/**
 * A city without categories: instead of an empty select, the field says why a place cannot be saved yet and offers the
 * starter categories in one click, or a category of the admin's own in the city settings.
 */
function noCategories(context: FieldContext, choice: CategoryChoice): TemplateResult {
    const { locale } = context;
    const { invalid, describedBy, line } = problem(context, 'category', { id: 'category', hints: 'category-none' });
    const names = STARTER_POI_CATEGORIES.map((category) => localized(locale, category.label)).join(', ');
    return html`<div class="field no-categories" role="group" aria-labelledby="category-label" ?data-invalid=${invalid !== nothing}>
        <span class="label" id="category-label">${poiText(locale, 'adminContent.pois.field.category')}</span>
        <p class="note" id="category-none">${poiText(locale, 'adminContent.pois.noCategories')}</p>
        <div class="actions">
            <hcm-button
                variant="tonal"
                icon="add"
                class="add-starters"
                ?disabled=${context.readOnly || choice.adding}
                aria-describedby=${['category-starters', describedBy === nothing ? '' : describedBy].join(' ').trim()}
                @click=${choice.addStarters}
                >${poiText(locale, 'adminContent.pois.addStarters')}</hcm-button
            >
            <a class="external add-category" href="#/settings/categories/_new">${poiText(locale, 'adminContent.pois.addCategory')}</a>
        </div>
        <p class="note" id="category-starters">${poiText(locale, 'adminContent.pois.startersHint', { names })}</p>
        ${line}
    </div>`;
}

export function categoryField(context: FieldContext, choice: CategoryChoice): TemplateResult {
    if (choice.known && choice.categories.length === 0) {
        return noCategories(context, choice);
    }
    const categories = choice.categories;
    const { invalid, describedBy, line } = problem(context, 'category', { id: 'category' });
    return html`<div class="field" ?data-invalid=${invalid !== nothing}>
        <label for="category">${poiText(context.locale, 'adminContent.pois.field.category')}</label>
        <select
            id="category"
            ?disabled=${context.readOnly}
            aria-invalid=${invalid}
            aria-describedby=${describedBy}
            @change=${(event: Event) => {
                context.edit({ category: inputOf(event) });
            }}
        >
            ${categories.map(
                (category) =>
                    html`<option value=${category.id} ?selected=${category.id === context.value.category}>
                        ${localized(context.locale, category.label)}
                    </option>`,
            )}
        </select>
        ${line}
    </div>`;
}

/** `{ro, en?}` with one language typed (an empty English is no English). */
export function withText(text: PoiTextPort | undefined, language: Language, typed: string): PoiTextPort {
    const current = text ?? { ro: '' };
    const next = { ro: current.ro, en: current.en ?? '', [language]: typed };
    return next.en === '' ? { ro: next.ro } : { ro: next.ro, en: next.en };
}

export function titleFields(context: FieldContext): TemplateResult {
    const { value, locale } = context;
    const set =
        (language: Language) =>
        (typed: string): void => {
            context.edit({ title: withText(value.title, language, typed) });
        };
    return html`<div class="pair">
        ${textField(context, { id: 'title-ro', field: 'title.ro', label: poiText(locale, 'adminContent.pois.field.titleRo'), value: value.title.ro, set: set('ro') })}
        ${textField(context, { id: 'title-en', field: 'title.en', label: poiText(locale, 'adminContent.pois.field.titleEn'), value: value.title.en ?? '', set: set('en') })}
    </div>`;
}

const DESCRIPTION_KEYS: Readonly<Record<Language, AdminContentKey>> = {
    ro: 'adminContent.pois.field.descriptionRo',
    en: 'adminContent.pois.field.descriptionEn',
};

/** The description after one language was typed: none at all once both are empty. */
function described(context: FieldContext, language: Language, typed: string): PoiPatchPort {
    const description = withText(context.value.description, language, typed);
    return { description: description.ro === '' && description.en === undefined ? undefined : description };
}

function preview(locale: UiLocale, language: Language, text: string): TemplateResult {
    const label = poiText(locale, 'adminContent.pois.field.preview', {
        language: poiText(locale, `adminContent.pois.language.${language}`),
    });
    const body = text.trim() === '' ? noteIf(true, locale, 'adminContent.pois.field.previewEmpty') : renderMarkdown(text);
    return html`<section class="preview" aria-label=${label}>${body}</section>`;
}

function descriptionField(context: FieldContext, language: Language): TemplateResult {
    const id = ['description', language].join('-');
    const { invalid, describedBy, line } = problem(context, ['description', language].join('.'), { id, hints: 'markdown-hint' });
    const text = context.value.description?.[language] ?? '';
    return html`<div class="field" ?data-invalid=${invalid !== nothing}>
        <label for=${id}>${poiText(context.locale, DESCRIPTION_KEYS[language])}</label>
        <textarea
            id=${id}
            maxlength="5000"
            ?readonly=${context.readOnly}
            aria-invalid=${invalid}
            aria-describedby=${describedBy}
            .value=${text}
            @input=${(event: Event) => {
                context.edit(described(context, language, inputOf(event)));
            }}
        ></textarea>
        ${line} ${preview(context.locale, language, text)}
    </div>`;
}

export function descriptionFields(context: FieldContext): TemplateResult {
    return html`${descriptionField(context, 'ro')} ${descriptionField(context, 'en')}
        <p class="note" id="markdown-hint">${poiText(context.locale, 'adminContent.pois.field.markdownHint')}</p>
        ${noteIf(true, context.locale, 'adminContent.pois.field.englishFallback')}`;
}

/** A typed year: a whole number, or nothing (an empty field). */
export function yearOf(typed: string): number | undefined {
    const year = Number(typed.trim());
    return typed.trim() === '' || !Number.isInteger(year) ? undefined : year;
}

const YEAR_KEYS: Readonly<Record<'yearStart' | 'yearEnd', AdminContentKey>> = {
    yearStart: 'adminContent.pois.field.yearStart',
    yearEnd: 'adminContent.pois.field.yearEnd',
};

/**
 * The problems a year field says: all of them once it has been left; before that only a missing year (a place needs one,
 * owner request of 2026-11-12), so a place stored without one says so as it opens.
 */
function shownYearIssues(context: FieldContext, field: 'yearStart' | 'yearEnd'): readonly ValidationIssue[] {
    return context.left.has(field) ? context.issues : context.issues.filter((issue) => issue.code === 'validation.required');
}

function yearField(context: FieldContext, field: 'yearStart' | 'yearEnd'): TemplateResult {
    const shownIssues = shownYearIssues(context, field);
    const { invalid, describedBy, line } = problem({ ...context, issues: shownIssues }, field, { id: field, hints: 'years-hint' });
    return html`<div class="field" ?data-invalid=${invalid !== nothing}>
        <label for=${field}>${poiText(context.locale, YEAR_KEYS[field])}</label>
        <input
            id=${field}
            type="number"
            inputmode="numeric"
            min="1800"
            max="2100"
            ?readonly=${context.readOnly}
            .value=${numberValue(String(context.value[field] ?? ''))}
            aria-invalid=${invalid}
            aria-describedby=${describedBy}
            @input=${(event: Event) => {
                const year = yearOf(inputOf(event));
                context.edit(field === 'yearStart' ? { yearStart: year } : { yearEnd: year });
            }}
            @focusout=${() => {
                context.left.leave(field);
            }}
        />
        ${line}
    </div>`;
}

export function yearFields(context: FieldContext): TemplateResult {
    return html`<div class="pair">${yearField(context, 'yearStart')} ${yearField(context, 'yearEnd')}</div>
        <p class="note" id="years-hint">${poiText(context.locale, 'adminContent.pois.field.yearsHint')}</p>`;
}

function linkRow(context: FieldContext, link: PoiLinkPort, index: number): TemplateResult {
    const number = String(index + 1);
    const links = context.value.links;
    const set =
        (key: keyof PoiLinkPort) =>
        (typed: string): void => {
            context.edit({ links: links.map((current, at) => (at === index ? { ...current, [key]: typed } : current)) });
        };
    const path = ['links[', String(index), ']'].join('');
    return html`<div class="link-row">
        ${textField(context, {
            id: ['link-url', number].join('-'),
            field: [path, 'url'].join('.'),
            label: poiText(context.locale, 'adminContent.pois.field.linkUrl', { number }),
            value: link.url,
            set: set('url'),
        })}
        ${textField(context, {
            id: ['link-label', number].join('-'),
            field: [path, 'label'].join('.'),
            label: poiText(context.locale, 'adminContent.pois.field.linkLabel', { number }),
            value: link.label,
            set: set('label'),
        })}
        <hcm-icon-button
            icon="delete"
            .label=${poiText(context.locale, 'adminContent.pois.field.removeLink', { number })}
            ?disabled=${context.readOnly}
            @click=${() => {
                context.edit({ links: links.filter((_link, at) => at !== index) });
            }}
        ></hcm-icon-button>
    </div>`;
}

export function linkFields(context: FieldContext): TemplateResult {
    const links = context.value.links;
    const full = links.length >= MAX_LINKS;
    return html`${noteIf(links.length === 0, context.locale, 'adminContent.pois.field.noLinks')}
        ${links.map((link, index) => linkRow(context, link, index))}
        <div class="actions">
            <hcm-button
                variant="outlined"
                icon="link"
                class="add-link"
                ?disabled=${full || context.readOnly}
                @click=${() => {
                    context.edit({ links: [...links, { url: 'https://', label: '' }] });
                }}
                >${poiText(context.locale, 'adminContent.pois.field.addLink')}</hcm-button
            >
            ${noteIf(full, context.locale, 'adminContent.pois.field.linksLimit', { max: String(MAX_LINKS) })}
        </div>`;
}

function chosenPhoto(context: FieldContext, id: string, title: string): TemplateResult {
    const ids = context.value.photoIds;
    return html`<li>
        <span>${title}</span>
        <hcm-icon-button
            icon="close"
            .label=${poiText(context.locale, 'adminContent.pois.field.removePhoto', { title })}
            ?disabled=${context.readOnly}
            @click=${() => {
                context.edit({ photoIds: ids.filter((chosen) => chosen !== id) });
            }}
        ></hcm-icon-button>
    </li>`;
}

export function photoFields(context: FieldContext, photos: readonly PhotoChoicePort[], pick: () => void): TemplateResult {
    const ids = context.value.photoIds;
    const titleOf = (id: string): string => {
        const photo = photos.find((choice) => choice.id === id);
        return photo === undefined ? id : localized(context.locale, photo.title);
    };
    return html`${noteIf(ids.length === 0, context.locale, 'adminContent.pois.field.noPhotos')}
        <ul class="chosen">
            ${ids.map((id) => chosenPhoto(context, id, titleOf(id)))}
        </ul>
        <div class="actions">
            <hcm-button variant="outlined" icon="photo_library" class="choose-photos" ?disabled=${context.readOnly} @click=${pick}
                >${poiText(context.locale, 'adminContent.pois.field.choosePhotos')}</hcm-button
            >
        </div>`;
}

export function publishedField(context: FieldContext): TemplateResult {
    // M13 §2: an uploader's place is published by its review, and never from here.
    if (context.role === 'uploader') {
        return html`<p class="note">${poiText(context.locale, 'adminContent.pois.review.note')}</p>`;
    }
    const label = poiText(context.locale, 'adminContent.pois.field.published');
    return html`<div class="actions">
            <hcm-switch
                class="published"
                .label=${label}
                ?disabled=${context.readOnly}
                ?checked=${context.value.published}
                @hcm-change=${(event: CustomEvent<{ readonly checked: boolean }>) => {
                    context.edit({ published: event.detail.checked });
                }}
            ></hcm-switch>
            <span aria-hidden="true">${label}</span>
        </div>
        ${noteIf(true, context.locale, 'adminContent.pois.field.publishedHint')}`;
}
