/**
 * Settings → Wikipedia (`docs/research/M31-wikipedia.md` §3; S-A-WIKI-*): the switch that puts the Wikipedia overlay on the public
 * map, its languages, **Refresh now**, when the articles were last fetched (or why the last fetch failed, with the fix), and
 * the list of articles, each with Hide or Show. Save writes the switch, the languages and the hidden articles; the map is
 * rebuilt within minutes. A chunk of its own (`lazy-wikipedia.ts`).
 */
import {
    WIKIPEDIA_LANGUAGES,
    type UiLocale,
    type WikipediaLanguage,
    type WikipediaListedArticle,
    type WikipediaManageResponse,
    type WikipediaSettings,
} from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import { formatWhen } from '../editing/states.js';
import { EMPTY } from '../shell/empty.js';
import { contentText, noticeOf } from '../shell/text.js';
import { sectionRowTexts, type SectionContext } from './section-parts.js';

function switchRow(label: string, checked: boolean, off: boolean, change: (checked: boolean) => void): TemplateResult {
    return html`<div class="switch-row">
        <span aria-hidden="true">${label}</span>
        <hcm-switch
            .checked=${checked}
            ?disabled=${off}
            label=${label}
            @hcm-change=${(event: Event) => {
                change((event as CustomEvent<{ checked: boolean }>).detail.checked);
            }}
        ></hcm-switch>
    </div>`;
}

function languages(context: SectionContext, draft: WikipediaSettings, off: boolean): TemplateResult {
    const { locale } = context;
    const row = (language: WikipediaLanguage): TemplateResult => {
        const on = draft.languages.includes(language);
        // The last language stays: Wikipedia needs one to read.
        const last = on && draft.languages.length === 1;
        return switchRow(contentText(locale, `adminContent.settings.wikipedia.language.${language}`), on, off || last, (checked) => {
            context.intents?.setWikipediaLanguage(language, checked);
        });
    };
    return html`<fieldset class="group" data-wikipedia-languages>
        <legend>${contentText(locale, 'adminContent.settings.wikipedia.languages')}</legend>
        ${WIKIPEDIA_LANGUAGES.map(row)}
    </fieldset>`;
}

/** When the articles were fetched, a fetch waiting, or why the last one failed and what to do. */
function fetchStatus(locale: UiLocale, data: WikipediaManageResponse): TemplateResult {
    if (data.failure !== undefined) {
        return html`<p class="alert" role="alert" data-wikipedia-failure=${data.failure}>
            <span>${contentText(locale, `adminContent.settings.wikipedia.failure.${data.failure}`)}</span>
        </p>`;
    }
    const lines = [
        data.refreshedAt === undefined
            ? contentText(locale, 'adminContent.settings.wikipedia.never')
            : contentText(locale, 'adminContent.settings.wikipedia.refreshedAt', { date: formatWhen(locale, data.refreshedAt) }),
        ...(data.refreshRequested ? [contentText(locale, 'adminContent.settings.wikipedia.pending')] : []),
    ];
    return html`<p class="note" data-wikipedia-status>${lines.join(' ')}</p>`;
}

function articleRow(context: SectionContext, article: WikipediaListedArticle, hidden: boolean, off: boolean): TemplateResult {
    const { locale } = context;
    const key = hidden ? 'adminContent.settings.wikipedia.show' : 'adminContent.settings.wikipedia.hide';
    const toggle = (): void => {
        context.intents?.setWikipediaHidden(article.id, !hidden);
    };
    return html`<li class="row" data-wikipedia-article=${article.id} ?data-hidden=${hidden}>
        <span class="row-text">
            <span class="row-title" lang=${article.language}>${article.title}</span>
            ${hidden ? html`<span class="row-detail">${contentText(locale, 'adminContent.settings.wikipedia.hidden')}</span>` : nothing}
        </span>
        <hcm-button
            variant="text"
            icon=${hidden ? 'visibility' : 'visibility_off'}
            ?disabled=${off}
            .label=${contentText(locale, `${key}Named`, { title: article.title })}
            @click=${toggle}
            >${contentText(locale, key)}</hcm-button
        >
    </li>`;
}

function articles(context: SectionContext, data: WikipediaManageResponse, draft: WikipediaSettings, off: boolean): TemplateResult {
    const { locale } = context;
    if (data.articles.length === 0) {
        return html`<p class="note" data-wikipedia-empty>${contentText(locale, 'adminContent.settings.wikipedia.empty')}</p>`;
    }
    const hidden = new Set(draft.hidden);
    return html`<h3>${contentText(locale, 'adminContent.settings.wikipedia.articles', { count: String(data.articles.length) })}</h3>
        <ul class="rows" data-wikipedia-articles>
            ${data.articles.map((article) => articleRow(context, article, hidden.has(article.id), off))}
        </ul>`;
}

function actions(context: SectionContext, dirty: boolean, off: boolean): TemplateResult {
    const { locale, intents } = context;
    return html`<div class="actions">
        <hcm-button
            variant="filled"
            icon="check"
            ?disabled=${off || !dirty}
            data-wikipedia-save
            @click=${() => {
                void intents?.saveWikipedia();
            }}
            >${contentText(locale, 'adminContent.settings.wikipedia.save')}</hcm-button
        >
        <hcm-button
            variant="text"
            icon="refresh"
            ?disabled=${off || dirty}
            data-wikipedia-refresh
            @click=${() => {
                void intents?.refreshWikipedia();
            }}
            >${contentText(locale, 'adminContent.settings.wikipedia.refresh')}</hcm-button
        >
    </div>`;
}

function errorLine(context: SectionContext): TemplateResult {
    const error = context.view.wikipedia.error;
    return error === null
        ? EMPTY
        : html`<p class="alert" role="alert" data-wikipedia-error><span>${noticeOf(context.locale, error)}</span></p>`;
}

export function wikipediaSection(context: SectionContext): TemplateResult {
    const { locale, view } = context;
    const { data, draft, busy } = view.wikipedia;
    const heading = html`<h2 tabindex="-1" data-detail-heading>${sectionRowTexts(locale, 'wikipedia').title}</h2>`;
    if (data === null || draft === null) {
        return html`${heading} ${errorLine(context)}
            <p class="note" role="status" data-wikipedia-loading>
                ${busy ? contentText(locale, 'adminContent.settings.wikipedia.loading') : ''}
            </p>`;
    }
    const off = busy || context.readOnly;
    const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);
    return html`${heading}
        <section class="group" data-section="wikipedia">
            <p class="note">${contentText(locale, 'adminContent.settings.wikipedia.intro')}</p>
            ${switchRow(contentText(locale, 'adminContent.settings.wikipedia.enabled'), draft.enabled, off, (checked) => {
                context.intents?.setWikipediaEnabled(checked);
            })}
            ${languages(context, draft, off)} ${actions(context, dirty, off)} ${errorLine(context)} ${fetchStatus(locale, data)}
            ${articles(context, data, draft, off)}
            <p class="note">${contentText(locale, 'adminContent.settings.wikipedia.credit')}</p>
        </section>`;
}
