/**
 * The texts section (`docs/research/M2c-interfaces.md` §8.5; behaviour A19): the city's name in both languages, About
 * and the privacy notice in the Markdown subset with a preview walked into DOM nodes exactly as the viewer's About
 * (`../../viewer/markdown.ts`, reused), the lines whose links are not https named (S-A19-BAD-MARKDOWN-LINK; typed HTML
 * stays characters), and the credits: a label in both languages, an optional https address, moved and removed one by one.
 */
import { type CityDoc, type Credit, type Locale } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import { renderMarkdown } from '../../viewer/markdown.js';
import { field, issueAt } from '../layers/form-parts.js';
import { contentText } from '../shell/text.js';
import { cityHead, cityOf, sectionTitle, type SectionContext } from './section-parts.js';

/** The credits a city lists at most. */
const MAX_CREDITS = 50;

type MarkdownName = 'about' | 'privacy';

function textValue(text: { readonly ro: string; readonly en?: string | undefined } | undefined, locale: Locale): string {
    return (locale === 'ro' ? text?.ro : text?.en) ?? '';
}

function nameFields(context: SectionContext, city: CityDoc): TemplateResult {
    const { locale, intents } = context;
    const issues = context.view.citySection.draft.issues;
    return html`<div class="fields">
        ${(['ro', 'en'] as const).map((lang) =>
            field(locale, {
                id: `name-${lang}`,
                label: contentText(locale, lang === 'ro' ? 'adminContent.settings.nameRo' : 'adminContent.settings.nameEn'),
                value: textValue(city.name, lang),
                issue: issueAt(issues, `name.${lang}`),
                readOnly: context.readOnly,
                ...(lang === 'ro' ? { required: true } : {}),
                onInput: (text) => {
                    intents?.setText('name', lang, text);
                },
            }),
        )}
    </div>`;
}

function markdownField(context: SectionContext, city: CityDoc, name: MarkdownName, lang: Locale): TemplateResult {
    const { locale, intents } = context;
    const value = textValue(city[name], lang);
    const lines = context.view.citySection.linkLines[name][lang];
    const labelKey = `adminContent.settings.${name}${lang === 'ro' ? 'Ro' : 'En'}` as const;
    const label = contentText(locale, labelKey);
    return html`${field(locale, {
        id: `${name}-${lang}`,
        label,
        value,
        multiline: true,
        readOnly: context.readOnly,
        help: contentText(locale, 'adminContent.settings.markdownHelp'),
        issue: issueAt(context.view.citySection.draft.issues, `${name}.${lang}`),
        onInput: (text) => {
            intents?.setText(name, lang, text);
        },
    })}
    ${lines.length === 0 ? nothing : html`<p class="alert" role="alert"><span>${contentText(locale, 'adminContent.settings.linkLines', { lines: lines.join(', ') })}</span></p>`}
    ${
        value.trim() === ''
            ? nothing
            : html`<figure class="preview" aria-label=${contentText(locale, 'adminContent.settings.preview', { field: label })}>
                  ${renderMarkdown(value)}
              </figure>`
    }`;
}

function creditRow(context: SectionContext, credit: Credit, row: number, count: number): TemplateResult {
    const { locale, intents } = context;
    const n = String(row + 1);
    const issues = context.view.citySection.draft.issues;
    const input = (name: 'ro' | 'en' | 'url', key: Parameters<typeof contentText>[1], value: string, path: string): TemplateResult =>
        field(locale, {
            id: `credit-${n}-${name}`,
            label: contentText(locale, key, { n }),
            value,
            issue: issueAt(issues, `credits[${String(row)}].${path}`),
            readOnly: context.readOnly,
            ...(name === 'url' ? { type: 'url' as const } : {}),
            onInput: (text) => {
                intents?.editCredit(row, name, text);
            },
        });
    return html`<li class="credit">
        <div class="fields">
            ${input('ro', 'adminContent.settings.creditRo', credit.label.ro, 'label.ro')}
            ${input('en', 'adminContent.settings.creditEn', credit.label.en, 'label.en')}
            ${input('url', 'adminContent.settings.creditUrl', credit.url ?? '', 'url')}
        </div>
        <div class="actions">
            <hcm-icon-button
                icon="arrow_upward"
                label=${contentText(locale, 'adminContent.settings.creditUp', { n })}
                ?disabled=${context.readOnly}
                @click=${() => intents?.moveCredit(row, -1)}
            ></hcm-icon-button>
            <hcm-icon-button
                icon="arrow_downward"
                label=${contentText(locale, 'adminContent.settings.creditDown', { n })}
                ?disabled=${context.readOnly}
                @click=${() => intents?.moveCredit(row, 1)}
            ></hcm-icon-button>
            <hcm-icon-button
                icon="delete"
                label=${contentText(locale, 'adminContent.settings.removeCredit', { n })}
                ?disabled=${context.readOnly}
                @click=${() => intents?.removeCredit(row)}
            ></hcm-icon-button>
        </div>
        ${row < count - 1 ? html`<hr />` : nothing}
    </li>`;
}

function credits(context: SectionContext, city: CityDoc): TemplateResult {
    const { locale, intents } = context;
    const list = city.credits ?? [];
    return html`<section class="group">
        <h3>${contentText(locale, 'adminContent.settings.credits')}</h3>
        <ul class="credits">
            ${list.map((credit, row) => creditRow(context, credit, row, list.length))}
        </ul>
        <div class="actions">
            ${
                list.length >= MAX_CREDITS
                    ? html`<p class="note">${contentText(locale, 'adminContent.settings.creditsLimit', { max: String(MAX_CREDITS) })}</p>`
                    : html`<hcm-button variant="tonal" icon="add" ?disabled=${context.readOnly} @click=${() => intents?.addCredit()}
                          >${contentText(locale, 'adminContent.settings.addCredit')}</hcm-button
                      >`
            }
        </div>
    </section>`;
}

export function textsSection(context: SectionContext): TemplateResult {
    const { locale } = context;
    const city = cityOf(context);
    if (city === null) {
        return html`<h2 tabindex="-1" data-detail-heading>${sectionTitle(locale, 'texts')}</h2>`;
    }
    return html`${cityHead(context, sectionTitle(locale, 'texts'))} ${nameFields(context, city)}
    ${(['about', 'privacy'] as const).map(
        (name) => html`<section class="group">${(['ro', 'en'] as const).map((lang) => markdownField(context, city, name, lang))}</section>`,
    )}
    ${credits(context, city)}`;
}
