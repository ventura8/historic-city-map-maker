/**
 * The georeferencer's Suggestions panel (`docs/research/M4-interfaces.md` §2.5; behaviour A44): the pairs the automatic
 * matching was less sure of, best first, each a row with its label (`a1`, … as its dashed markers on both panes), its
 * confidence in words and as a bar, how far the page's current fit puts it (computed again as pairs are accepted), and
 * Accept and Reject named after it; Accept all above (the keyboard then lands on the panel's heading). The keyboard reaches each row's name: focused, its markers are the selected ones; Enter accepts it, Delete
 * rejects it. A version the matching left waiting says how many reliable pairs it found. Accepting only edits the
 * page's pairs: Save writes them. Text only: labels and numbers are never markup. Suggestions that would put the map outside
 * the city (`outsideCity`) are each "doubtful" with no percentage, the panel says why, and there is no Accept all.
 */
import { clamp, type UiLocale } from '@hcm/shared';
import { css, html, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import { cssProperties } from '../../components/css-properties.js';
import { numberText } from '../imagery/imagery-text.js';
import { when, withValue } from '../imagery/when.js';
import { contentText } from '../shell/text.js';
import type { SuggestionRowPort, SuggestionsViewPort } from './suggestions-port.js';

export type SuggestionDecision = 'accept' | 'reject';

export interface SuggestionsPanel {
    readonly locale: UiLocale;
    readonly view: SuggestionsViewPort;
    /** Nothing may change: the version takes no points, or the admin's access was removed. */
    readonly locked: boolean;
    /** Accept or Reject on row `index` (the page then keeps the keyboard's place). */
    readonly onDecide: (decision: SuggestionDecision, id: string, index: number) => void;
    readonly onAcceptAll: () => void;
    readonly onSelect: (id: string) => void;
}

/** The ids the panel's parts use inside the page's shadow root. */
export const SUGGESTIONS_HEADING_ID = 'suggestions-heading';
const KEYS_ID = 'suggestion-keys';

/** What a key does on a suggestion's name. */
const KEYS: Readonly<Record<string, SuggestionDecision | undefined>> = { Enter: 'accept', Delete: 'reject', Backspace: 'reject' };

function confidence(locale: UiLocale, row: SuggestionRowPort): string {
    if (row.level === 'doubtful') {
        return contentText(locale, 'adminContent.georef.suggestions.doubtful');
    }
    const level = contentText(locale, `adminContent.georef.suggestions.level.${row.level}`);
    const percent = String(Math.round((row.pair.score ?? 0) * 100));
    return contentText(locale, 'adminContent.georef.suggestions.confidence', { level, percent });
}

function offset(locale: UiLocale, row: SuggestionRowPort): string {
    const metres = row.offsetM;
    return metres === null
        ? contentText(locale, 'adminContent.georef.suggestions.noResidual')
        : contentText(locale, 'adminContent.georef.suggestions.residual', { metres: numberText(locale, metres, 1) });
}

function keyed(panel: SuggestionsPanel, id: string, index: number): (event: KeyboardEvent) => void {
    return (event) => {
        const decision = panel.locked ? undefined : KEYS[event.key];
        if (decision !== undefined) {
            event.preventDefault();
            panel.onDecide(decision, id, index);
        }
    };
}

function decideButton(panel: SuggestionsPanel, row: SuggestionRowPort, index: number, decision: SuggestionDecision): TemplateResult {
    const key = decision === 'accept' ? 'adminContent.georef.suggestions.accept' : 'adminContent.georef.suggestions.reject';
    return html`<hcm-button
        variant=${decision === 'accept' ? 'tonal' : 'text'}
        icon=${decision === 'accept' ? 'check' : 'close'}
        ?disabled=${panel.locked}
        @click=${() => {
            panel.onDecide(decision, row.pair.id, index);
        }}
        >${contentText(panel.locale, key, { label: row.label })}</hcm-button
    >`;
}

function row(panel: SuggestionsPanel, item: SuggestionRowPort, index: number): TemplateResult {
    const { locale, view } = panel;
    const selected = item.pair.id === view.selected;
    const fraction = item.level === 'doubtful' ? '0' : String(clamp(item.pair.score ?? 0, 0, 1));
    return html`<li ?data-selected=${selected} data-suggestion=${item.pair.id} data-level=${item.level}>
        <button
            class="suggestion"
            type="button"
            aria-current=${selected ? 'true' : 'false'}
            aria-describedby=${KEYS_ID}
            @focus=${() => {
                panel.onSelect(item.pair.id);
            }}
            @click=${() => {
                panel.onSelect(item.pair.id);
            }}
            @keydown=${keyed(panel, item.pair.id, index)}
        >
            ${contentText(locale, 'adminContent.georef.suggestions.name', { label: item.label })}
        </button>
        <span class="confidence">
            <span class="bar" aria-hidden="true"><span class="fill" ${cssProperties({ '--confidence': fraction })}></span></span>
            <span>${confidence(locale, item)}</span>
        </span>
        <span class="note">${offset(locale, item)}</span>
        <span class="decide">${decideButton(panel, item, index, 'accept')} ${decideButton(panel, item, index, 'reject')}</span>
    </li>`;
}

/** Accept all, or (the city guard) why there is none: the suggestions would put the map outside the city. */
function acceptAll(panel: SuggestionsPanel): TemplateResult {
    const { locale, view } = panel;
    if (view.outsideCity) {
        return html`<p class="alert" data-state="outside-city">
            ${contentText(locale, 'adminContent.georef.suggestions.outsideCity')}
            ${contentText(locale, 'adminContent.georef.suggestions.outsideCityFix')}
        </p>`;
    }
    return html`<div class="actions">
        <hcm-button variant="filled" icon="check" ?disabled=${panel.locked} @click=${panel.onAcceptAll}
            >${contentText(locale, 'adminContent.georef.suggestions.acceptAll')}</hcm-button
        >
    </div>`;
}

function list(panel: SuggestionsPanel): TemplateResult {
    const { locale, view } = panel;
    return html`<p class="note">${contentText(locale, 'adminContent.georef.suggestions.intro')}</p>
        <p class="note" id=${KEYS_ID}>${contentText(locale, 'adminContent.georef.suggestions.keys')}</p>
        ${acceptAll(panel)}
        <ul class="suggestion-list">
            ${repeat(
                view.pending,
                (item) => item.pair.id,
                (item, index) => row(panel, item, index),
            )}
        </ul>`;
}

/** Nothing left to decide: none was suggested, or every one was accepted or rejected. */
function settled(panel: SuggestionsPanel): TemplateResult {
    const key = panel.view.total === 0 ? 'adminContent.georef.suggestions.none' : 'adminContent.georef.suggestions.allDecided';
    return html`<p class="note" data-state="no-suggestions">${contentText(panel.locale, key)}</p>`;
}

function noMatch(panel: SuggestionsPanel): TemplateResult {
    return withValue(
        panel.view.confident,
        (pairs) =>
            html`<p class="note" data-state="no-match">
                ${contentText(
                    panel.locale,
                    panel.view.noSpread ? 'adminContent.georef.suggestions.noSpread' : 'adminContent.georef.suggestions.noMatch',
                    { pairs },
                )}
            </p>`,
    );
}

export function suggestionsPanel(panel: SuggestionsPanel): TemplateResult {
    return when(
        panel.view.matched,
        () =>
            html`<section class="suggestions" aria-labelledby=${SUGGESTIONS_HEADING_ID}>
                <h3 id=${SUGGESTIONS_HEADING_ID} tabindex="-1">${contentText(panel.locale, 'adminContent.georef.suggestions.title')}</h3>
                ${noMatch(panel)} ${panel.view.pending.length === 0 ? settled(panel) : list(panel)}
            </section>`,
    );
}

export const suggestionsStyles = css`
    .suggestions {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .suggestions h3 {
        margin: 0;
    }

    .suggestion-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    /* A row wraps under a narrow window: the name and the confidence first, the buttons under them. */
    .suggestion-list li {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 16px;
        padding: 4px 8px;
        border-block-end: 1px solid var(--md-sys-color-outline-variant, GrayText);
        border-radius: var(--md-sys-shape-corner-small, 8px);
    }

    .suggestion-list li[data-selected] {
        background: var(--md-sys-color-secondary-container, Highlight);
        color: var(--md-sys-color-on-secondary-container, HighlightText);

        --md-sys-color-on-surface-variant: var(--md-sys-color-on-secondary-container, HighlightText);
    }

    button.suggestion {
        min-block-size: 48px;
        min-inline-size: 48px;
        padding: 0 8px;
        border: none;
        border-radius: var(--md-sys-shape-corner-small, 8px);
        background: none;
        color: inherit;
        font: inherit;
        font-weight: var(--md-sys-typescale-title-small-weight, 500);
        cursor: pointer;
    }

    button.suggestion:focus-visible {
        outline: var(--md-sys-state-focus-indicator-thickness, 3px) solid var(--md-sys-color-secondary, Highlight);
        outline-offset: -3px;
    }

    .confidence {
        display: inline-flex;
        align-items: center;
        gap: 8px;
    }

    /* The confidence as a bar beside its words (the words carry it for a screen reader). */
    .bar {
        display: inline-block;
        inline-size: 64px;
        block-size: 8px;
        border: 1px solid var(--md-sys-color-outline, CanvasText);
        border-radius: var(--md-sys-shape-corner-full, 4px);
        overflow: hidden;
    }

    .fill {
        display: block;
        block-size: 100%;
        inline-size: calc(var(--confidence, 0) * 100%);
        background: var(--md-sys-color-tertiary, CanvasText);
    }

    .decide {
        display: inline-flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-inline-start: auto;
    }

    @media (forced-colors: active) {
        .fill {
            background: CanvasText;
            forced-color-adjust: none;
        }
    }
`;
