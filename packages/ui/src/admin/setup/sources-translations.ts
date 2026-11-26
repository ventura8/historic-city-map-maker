/**
 * The Sources card's free translation options (M28, `docs/research/M28-sources.md` §11): one card each with its quality, its
 * free monthly (or daily) limit and what happens past it, whether sign-up asks for a card, what the provider does with the
 * texts, and the sign-up wizard: numbered steps, each with the provider's own page (or the app's) one press away. Text only.
 */
import { TRANSLATION_CATALOGUE, TRANSLATION_CHECKED_ON, type TranslationFacts } from '@hcm/shared/sources';
import { html, nothing, type TemplateResult } from 'lit';

import { actionLink, sourcesKey, type SourcesText } from './sources-parts.js';

/** How a figure is written in the page's language. */
export type FormatCount = (count: number) => string;

function limitText(t: SourcesText, facts: TranslationFacts, count: FormatCount): string {
    const { per, characters } = facts.limit;
    return per === 'none' ? t('adminSources.tr.limit.none') : t(sourcesKey(`adminSources.tr.limit.${per}`), { count: count(characters) });
}

/** One wizard step: its text and the page that does it (outside, in a new tab; or a place in the app). */
function step(t: SourcesText, facts: TranslationFacts, page: string | null, index: number): TemplateResult {
    const text = t(sourcesKey(`adminSources.tr.${facts.id}.step.${String(index + 1)}`));
    if (page === null) {
        return html`<li>${text}</li>`;
    }
    const external = page.startsWith('https://');
    const label = t(external ? 'adminSources.tr.step.open' : 'adminSources.tr.step.openApp');
    return html`<li>${text} ${actionLink(label, page, external)}</li>`;
}

function card(t: SourcesText, facts: TranslationFacts, count: FormatCount): TemplateResult {
    const overKey = sourcesKey(`adminSources.tr.over.${facts.overLimit}`);
    const over = facts.overLimit === 'none' ? nothing : html`<p>${t(overKey)}</p>`;
    return html`<li class="source" data-translation=${facts.id}>
        <h4 class="title-small">${t(sourcesKey(`adminSources.tr.${facts.id}.title`))}</h4>
        <h5 class="label-large">${t('adminSources.tr.section.quality')}</h5>
        <p>${t(sourcesKey(`adminSources.tr.quality.${facts.quality}`))}</p>
        <h5 class="label-large">${t('adminSources.tr.section.limit')}</h5>
        <p>${limitText(t, facts, count)}</p>
        ${over}
        <p>${t(sourcesKey(`adminSources.tr.card.${facts.card}`))}</p>
        <h5 class="label-large">${t('adminSources.tr.section.privacy')}</h5>
        <p>${t(sourcesKey(`adminSources.tr.privacy.${facts.privacy}`))}</p>
        <details class="details">
            <summary>${t('adminSources.tr.section.wizard')}</summary>
            <ol class="detail-body">
                ${facts.steps.map((page, index) => step(t, facts, page, index))}
            </ol>
            ${actionLink(t('adminSources.tr.prices', { host: new URL(facts.pricing).hostname }), facts.pricing, true)}
        </details>
    </li>`;
}

/** The group: its intro (what the app does with them today), the cards, the day the figures were read. */
export function translationOptions(t: SourcesText, count: FormatCount, day: (iso: string) => string): TemplateResult {
    return html`<section aria-labelledby="sources-translations">
        <h3 id="sources-translations" class="title-medium">${t('adminSources.group.translations')}</h3>
        <p class="note">${t('adminSources.tr.intro')}</p>
        <ul class="group">
            ${TRANSLATION_CATALOGUE.map((facts) => card(t, facts, count))}
        </ul>
        <p class="note">${t('adminSources.tr.checked', { date: day(TRANSLATION_CHECKED_ON) })}</p>
    </section>`;
}
