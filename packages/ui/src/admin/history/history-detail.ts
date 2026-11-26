/**
 * One history entry in the detail pane (`docs/research/M2c-interfaces.md` §9.2): who changed what and when, each changed
 * field before and after as text, and **Revert** (**Restore** for a deletion); a creation has nothing to restore.
 */
import type { UiLocale } from '@hcm/shared';
import { css, html, type TemplateResult } from 'lit';

import { fieldName } from '../editing/field-names.js';
import { contentText } from '../shell/text.js';
import { describeValue } from './describe.js';
import type { HistoryItemPort, HistoryViewState } from './history-port.js';

export const historyStyles = css`
    .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 16px;
    }

    .filters .field {
        flex: 1 1 140px;
    }

    .with-action {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 8px;
    }

    .with-action .row {
        flex: 1 1 200px;
        min-inline-size: 0;
    }

    button.row {
        inline-size: 100%;
        border: none;
        background: none;
        font: inherit;
        text-align: start;
        cursor: pointer;
    }

    button.row:hover {
        background: color-mix(in srgb, var(--md-sys-color-on-surface, CanvasText) 8%, transparent);
    }

    button.row[aria-current='true'] {
        background: var(--md-sys-color-secondary-container, Highlight);
        color: var(--md-sys-color-on-secondary-container, HighlightText);
    }

    .changes {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin: 0;
    }

    .change {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 12px 16px;
        border-radius: var(--md-sys-shape-corner-medium, 12px);
        background: var(--md-sys-color-surface-container-low, Canvas);
    }

    .change dt {
        font-weight: var(--md-sys-typescale-title-small-weight, 500);
    }

    .change dd {
        margin: 0;
    }

    .change .label {
        color: var(--md-sys-color-on-surface-variant, CanvasText);
    }
`;

export interface EntryContext {
    readonly locale: UiLocale;
    readonly entry: HistoryItemPort;
    readonly changes: HistoryViewState['changes'];
    readonly heading: string;
    /** The refused revert's alert (or nothing). */
    readonly refusal: TemplateResult;
    readonly reverting: boolean;
    /** Asks before reverting. */
    readonly ask: () => void;
}

function changesTemplate(locale: UiLocale, changes: HistoryViewState['changes']): TemplateResult {
    if (changes.length === 0) {
        return html`<p class="note">${contentText(locale, 'adminContent.history.noFields')}</p>`;
    }
    return html`<dl class="changes">
        ${changes.map(
            (change) =>
                html`<div class="change">
                    <dt>${fieldName(locale, change.field)}</dt>
                    <dd>
                        <span class="label">${contentText(locale, 'adminContent.history.before')}</span>
                        ${describeValue(locale, change.field, change.before)}
                    </dd>
                    <dd>
                        <span class="label">${contentText(locale, 'adminContent.history.after')}</span>
                        ${describeValue(locale, change.field, change.after)}
                    </dd>
                </div>`,
        )}
    </dl>`;
}

function revertTemplate(context: EntryContext): TemplateResult {
    const { locale, entry } = context;
    if (entry.action === 'create') {
        return html`<p class="note">${contentText(locale, 'adminContent.history.creationNote')}</p>`;
    }
    const restore = entry.action === 'delete';
    return html`<div class="actions">
        <hcm-button variant="tonal" icon=${restore ? 'restore' : 'undo'} ?disabled=${context.reverting} @click=${context.ask}
            >${contentText(locale, restore ? 'adminContent.history.restore' : 'adminContent.history.revert')}</hcm-button
        >
    </div>`;
}

export function entryDetail(context: EntryContext): TemplateResult {
    return html`<div class="pane">
        <h2 tabindex="-1" data-detail-heading>${context.heading}</h2>
        ${context.refusal}
        <h3>${contentText(context.locale, 'adminContent.history.changes')}</h3>
        ${changesTemplate(context.locale, context.changes)} ${revertTemplate(context)}
    </div>`;
}
