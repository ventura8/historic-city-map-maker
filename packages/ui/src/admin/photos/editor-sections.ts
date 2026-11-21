/**
 * The photo editor's sections (`docs/research/M2c-interfaces.md` §6.3): the texts in Romanian and English (English
 * optional, the visitor then reads Romanian), the date, author and rights, the source, links (at most five, https only) and
 * publishing (Published, with why it cannot be switched on yet, and Rights to check). Each change is a patch of the
 * draft; nothing is written until Save.
 */
import { PHOTO_KINDS, type FirestoreLicense, type UiLocale, type ValidationIssue } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import type { AssistActionsPort, AssistViewPort } from '../assist/assist-port.js';
import { draftAssist, titleAssist } from '../assist/assist-parts.js';
import type { FieldsLeft } from '../editing/number-fields.js';
import { EMPTY } from '../shell/empty.js';
import { dateParts, yearPatch } from './editor-date.js';
import { areaField, numberField, numberOf, selectField, textField, textOf } from './editor-fields.js';
import { LICENSE_ORDER, blockText, fieldIssue, licenseText, partId, photoText } from './photo-text.js';
import type { LocalizedPort, PhotoEditorPort, PhotoPatchPort, PhotoValuePort } from './photos-port.js';

/** Links per photo (the rules allow 5). */
const MAX_PHOTO_LINKS = 5;

export interface SectionInput {
    readonly locale: UiLocale;
    readonly value: PhotoValuePort;
    readonly issues: readonly ValidationIssue[];
    readonly edit: (patch: PhotoPatchPort) => void;
    /** The number fields left since the photo opened: only they say their problem. */
    readonly left: FieldsLeft;
    /** A revoked admin's editor: every field read-only, nothing that writes on (`DECISIONS-for-review.md` §42d). */
    readonly readOnly: boolean;
    /** M4 (CR-M4-4): the assists' state and intents; null: no assist slots. */
    readonly assist?: { readonly view: AssistViewPort; readonly actions: AssistActionsPort } | null;
}

/** The draft button of a Romanian and English pair, when the editor has assists. */
function pairDraft(input: SectionInput, field: 'title' | 'description' | 'dateText', text: LocalizedPort | undefined): TemplateResult {
    const assist = input.assist ?? null;
    if (assist === null) {
        return EMPTY;
    }
    return draftAssist({ ...assist, locale: input.locale, field, text, readOnly: input.readOnly });
}

/** The title's suggestions, when the editor has assists. */
function titleSuggestions(input: SectionInput): TemplateResult {
    const assist = input.assist ?? null;
    return assist === null ? EMPTY : titleAssist({ ...assist, locale: input.locale, id: 'photo-title', readOnly: input.readOnly });
}

/** Romanian and English as stored: absent when both are empty (an optional text). */
function compactText(ro: string, en: string | undefined): LocalizedPort | undefined {
    if (textOf(ro) === undefined && en === undefined) {
        return undefined;
    }
    return en === undefined ? { ro } : { ro, en };
}

/** A localized text with one language changed (Romanian as typed, an empty English left out). */
export function withLanguage(text: LocalizedPort | undefined, language: 'ro' | 'en', typed: string): LocalizedPort | undefined {
    const current = text ?? { ro: '' };
    const ro = language === 'ro' ? typed : current.ro;
    const en = language === 'en' ? textOf(typed) : current.en;
    return compactText(ro, en);
}

function localizedPair(
    input: SectionInput,
    field: 'description' | 'dateText',
    keys: { ro: 'descriptionRo' | 'dateTextRo'; en: 'descriptionEn' | 'dateTextEn' },
    limits: { readonly max: number; readonly sharedHint?: string },
): TemplateResult {
    const { max, sharedHint } = limits;
    const { locale, value, issues, edit } = input;
    const text = value[field];
    const make = (language: 'ro' | 'en', key: 'descriptionRo' | 'dateTextRo' | 'descriptionEn' | 'dateTextEn'): TemplateResult => {
        const options = {
            id: `photo-${field}-${language}`,
            label: photoText(locale, `adminContent.photos.field.${key}`),
            value: text?.[language] ?? '',
            error: fieldIssue(locale, issues, `${field}.${language}`),
            maxlength: max,
            readOnly: input.readOnly,
            ...(sharedHint === undefined ? {} : { sharedHint }),
        };
        const changed = (typed: string): void => {
            edit({ [field]: withLanguage(text, language, typed) });
        };
        return max > 200 ? areaField(options, changed) : textField(options, changed);
    };
    return html`${make('ro', keys.ro)} ${make('en', keys.en)} ${pairDraft(input, field, text)}`;
}

/** The one note above both "date as written" fields, which each name it. */
const DATE_TEXT_HINT = partId('photo-dateText', 'hint');

/** Street or aerial (the owner 2026-11-16): an aerial photo shows with its own marker and filter on the map. */
function kindField(input: SectionInput): TemplateResult {
    const { locale, value, edit } = input;
    const options = PHOTO_KINDS.map((kind) => ({ value: kind, label: photoText(locale, `adminContent.photos.kind.${kind}`) }));
    return selectField(
        {
            id: 'photo-kind',
            label: photoText(locale, 'adminContent.photos.field.kind'),
            value: value.kind ?? 'ground',
            error: null,
            options,
            readOnly: input.readOnly,
        },
        (chosen) => {
            edit({ kind: chosen === 'aerial' ? 'aerial' : undefined });
        },
    );
}

export function textsSection(input: SectionInput): TemplateResult {
    const { locale, value, issues, edit } = input;
    const title = value.title;
    return html`<fieldset>
        <legend>${photoText(locale, 'adminContent.photos.section.texts')}</legend>
        ${kindField(input)}
        ${textField(
            {
                id: 'photo-title-ro',
                label: photoText(locale, 'adminContent.photos.field.titleRo'),
                value: title.ro,
                error: fieldIssue(locale, issues, 'title.ro'),
                readOnly: input.readOnly,
            },
            (typed) => {
                edit({ title: title.en === undefined ? { ro: typed } : { ro: typed, en: title.en } });
            },
        )}
        ${titleSuggestions(input)}
        ${textField(
            {
                id: 'photo-title-en',
                label: photoText(locale, 'adminContent.photos.field.titleEn'),
                value: title.en ?? '',
                error: fieldIssue(locale, issues, 'title.en'),
                hint: photoText(locale, 'adminContent.photos.field.englishFallback'),
                readOnly: input.readOnly,
            },
            (typed) => {
                const en = textOf(typed);
                edit({ title: en === undefined ? { ro: title.ro } : { ro: title.ro, en } });
            },
        )}
        ${pairDraft(input, 'title', title)}
        ${localizedPair(input, 'description', { ro: 'descriptionRo', en: 'descriptionEn' }, { max: 5000 })}
    </fieldset>`;
}

export function datesSection(input: SectionInput): TemplateResult {
    const { locale, value, issues, edit } = input;
    const year = (field: 'year' | 'yearEnd', key: 'year' | 'yearEnd'): TemplateResult =>
        numberField(
            {
                id: `photo-${field}`,
                label: photoText(locale, `adminContent.photos.field.${key}`),
                value: value[field] === undefined ? '' : String(value[field]),
                error: fieldIssue(locale, issues, field),
                min: 1800,
                max: 2100,
                step: '1',
                readOnly: input.readOnly,
            },
            (typed) => {
                edit(field === 'year' ? yearPatch(typed) : { yearEnd: numberOf(typed) });
            },
            input.left,
        );
    return html`<fieldset>
        <legend>${photoText(locale, 'adminContent.photos.section.dates')}</legend>
        <div class="pair">${year('year', 'year')} ${year('yearEnd', 'yearEnd')}</div>
        ${dateParts(input)}
        <p class="note" id=${DATE_TEXT_HINT}>${photoText(locale, 'adminContent.photos.field.dateTextHint')}</p>
        ${localizedPair(input, 'dateText', { ro: 'dateTextRo', en: 'dateTextEn' }, { max: 100, sharedHint: DATE_TEXT_HINT })}
    </fieldset>`;
}

type CreditField = 'author' | 'rightsHolder' | 'sourceLabel' | 'sourceUrl' | 'permissionNote' | 'credit';

const CREDIT_MAX: Partial<Record<CreditField, number>> = { sourceUrl: 2048, permissionNote: 2000, credit: 100 };

/** The source's name says what it does at the field, where a screen reader hears it. */
function creditHint(locale: SectionInput['locale'], field: CreditField): { readonly hint?: string } {
    return field === 'sourceLabel' ? { hint: photoText(locale, 'adminContent.photos.field.sourceLabelHint') } : {};
}

function creditField(input: SectionInput, field: CreditField, type: 'text' | 'url' = 'text'): TemplateResult {
    const { locale, value, issues, edit } = input;
    const max = CREDIT_MAX[field] ?? 200;
    const options = {
        id: `photo-${field}`,
        label: photoText(locale, `adminContent.photos.field.${field}`),
        value: value[field] ?? '',
        error: fieldIssue(locale, issues, field),
        maxlength: max,
        readOnly: input.readOnly,
        ...creditHint(locale, field),
    };
    const changed = (typed: string): void => {
        edit({ [field]: textOf(typed) });
    };
    return field === 'permissionNote' ? areaField(options, changed) : textField({ ...options, type }, changed);
}

export function creditsSection(input: SectionInput): TemplateResult {
    const { locale, value, issues, edit } = input;
    const options = LICENSE_ORDER.map((license) => ({ value: license, label: licenseText(locale, license) }));
    return html`<fieldset>
        <legend>${photoText(locale, 'adminContent.photos.section.credits')}</legend>
        ${creditField(input, 'author')}
        ${selectField(
            {
                id: 'photo-license',
                label: photoText(locale, 'adminContent.photos.field.license'),
                value: value.license,
                error: fieldIssue(locale, issues, 'license'),
                options,
                readOnly: input.readOnly,
            },
            (chosen) => {
                edit({ license: chosen as FirestoreLicense });
            },
        )}
        ${creditField(input, 'rightsHolder')} ${creditField(input, 'permissionNote')} ${creditField(input, 'credit')}
    </fieldset>`;
}

/** Where the photo comes from: the link a visitor follows (`docs/research/photo-date-source.md` §2). */
export function sourceSection(input: SectionInput): TemplateResult {
    const { locale } = input;
    return html`<fieldset>
        <legend>${photoText(locale, 'adminContent.photos.section.source')}</legend>
        ${creditField(input, 'sourceUrl', 'url')} ${creditField(input, 'sourceLabel')}
    </fieldset>`;
}

interface Link {
    readonly url: string;
    readonly label: string;
}

/** One link: its text, its address, Remove. */
function linkRow(input: SectionInput, links: readonly Link[], index: number, set: (next: readonly Link[]) => void): TemplateResult {
    const { locale, issues } = input;
    const link = links[index] ?? { url: '', label: '' };
    const n = { n: String(index + 1) };
    const at = (part: 'label' | 'url'): string => ['links[', String(index), '].', part].join('');
    const change = (patch: Partial<Link>): void => {
        set(links.map((other, position) => (position === index ? { ...other, ...patch } : other)));
    };
    return html`<div class="link-row">
        ${textField(
            {
                id: partId('photo-link-label', String(index)),
                label: photoText(locale, 'adminContent.photos.links.label', n),
                value: link.label,
                error: fieldIssue(locale, issues, at('label')),
                readOnly: input.readOnly,
            },
            (label) => {
                change({ label });
            },
        )}
        ${textField(
            {
                id: partId('photo-link-url', String(index)),
                label: photoText(locale, 'adminContent.photos.links.url', n),
                value: link.url,
                error: fieldIssue(locale, issues, at('url')),
                type: 'url',
                maxlength: 2048,
                readOnly: input.readOnly,
            },
            (url) => {
                change({ url });
            },
        )}
        <hcm-icon-button
            icon="delete"
            .label=${photoText(locale, 'adminContent.photos.links.remove', n)}
            ?disabled=${input.readOnly}
            @click=${() => {
                set(links.filter((_link, position) => position !== index));
            }}
        ></hcm-icon-button>
    </div>`;
}

export function linksSection(input: SectionInput): TemplateResult {
    const { locale, value, edit } = input;
    const links = value.links ?? [];
    const set = (next: readonly Link[]): void => {
        edit({ links: next.length === 0 ? undefined : next });
    };
    const full = links.length >= MAX_PHOTO_LINKS;
    return html`<fieldset>
        <legend>${photoText(locale, 'adminContent.photos.section.links')}</legend>
        ${links.map((_link, index) => linkRow(input, links, index, set))}
        <div class="actions">
            <hcm-button
                variant="text"
                icon="add"
                ?disabled=${full || input.readOnly}
                @click=${() => {
                    set([...links, { url: 'https://', label: '' }]);
                }}
                >${photoText(locale, 'adminContent.photos.links.add')}</hcm-button
            >
            ${full ? html`<span class="note">${photoText(locale, 'adminContent.photos.links.max')}</span>` : nothing}
        </div>
    </fieldset>`;
}

export function publishingSection(input: SectionInput, editor: PhotoEditorPort): TemplateResult {
    const { locale, value, edit } = input;
    // M13 §2: an uploader's photo is published by its review, and never from here.
    if (editor.role === 'uploader') {
        return html`<fieldset>
            <legend>${photoText(locale, 'adminContent.photos.section.publishing')}</legend>
            <p class="note">${photoText(locale, 'adminContent.photos.review.note')}</p>
        </fieldset>`;
    }
    const blocked = editor.block !== null && !value.published;
    return html`<fieldset>
        <legend>${photoText(locale, 'adminContent.photos.section.publishing')}</legend>
        <div class="switch-row">
            <span id="published-label">${photoText(locale, 'adminContent.photos.field.published')}</span>
            <hcm-switch
                .checked=${value.published}
                ?disabled=${blocked || input.readOnly}
                .label=${photoText(locale, 'adminContent.photos.field.published')}
                @hcm-change=${(event: CustomEvent<{ checked: boolean }>) => {
                    edit({ published: event.detail.checked });
                }}
            ></hcm-switch>
        </div>
        ${editor.block === null ? nothing : html`<p class="note">${blockText(locale, editor.block)}</p>`}
        <div class="switch-row">
            <span>${photoText(locale, 'adminContent.photos.field.rightsReview')}</span>
            <hcm-switch
                .checked=${value.rightsReview === true}
                ?disabled=${input.readOnly}
                .label=${photoText(locale, 'adminContent.photos.field.rightsReview')}
                @hcm-change=${(event: CustomEvent<{ checked: boolean }>) => {
                    edit({ rightsReview: event.detail.checked });
                }}
            ></hcm-switch>
        </div>
    </fieldset>`;
}
