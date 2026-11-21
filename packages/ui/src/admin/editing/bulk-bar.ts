/**
 * The selection's bar (`docs/research/M2c-interfaces.md` §1.5; the UX review of 2026-10-18, `DECISIONS-for-review.md`
 * §42e): M3's contextual action bar in two short rows wherever the list is, instead of a block of eight buttons that
 * took half a phone's screen. The first row: Clear the selection (an icon button at the leading edge), how many are
 * selected (a polite status), Select all; the second: the area's frequent actions as buttons, the others in the
 * overflow menu (`hcm-overflow-menu`). Every action is off while one runs, and for a revoked admin's read-only page.
 */
import { css, html, type TemplateResult } from 'lit';

import type { OverflowAction } from './hcm-overflow-menu.js';

/** One of the bar's buttons: the first is filled (the area's main action), the others tonal. */
interface BulkButton {
    readonly id: string;
    readonly label: string;
    readonly icon: string;
}

export interface BulkBarInput {
    /** The bar's name ("Selection actions"). */
    readonly label: string;
    /** "Selected: 4". */
    readonly count: string;
    readonly selectAll: string;
    readonly clear: string;
    readonly buttons: readonly BulkButton[];
    readonly more: readonly OverflowAction[];
    readonly moreLabel: string;
    readonly closeLabel: string;
    /** An action runs, or the page is read only: the actions are off (Select all and Clear still work). */
    readonly off: boolean;
    readonly onSelectAll: () => void;
    readonly onClear: () => void;
    readonly onAction: (id: string) => void;
}

function button(input: BulkBarInput, spec: BulkButton, index: number): TemplateResult {
    return html`<hcm-button
        variant=${index === 0 ? 'filled' : 'tonal'}
        icon=${spec.icon}
        class=${spec.id}
        ?disabled=${input.off}
        @click=${() => {
            input.onAction(spec.id);
        }}
        >${spec.label}</hcm-button
    >`;
}

export function bulkBar(input: BulkBarInput): TemplateResult {
    const more = input.more.map((action) => ({ ...action, disabled: input.off || action.disabled === true }));
    return html`<section class="bulk-bar" aria-label=${input.label}>
        <div class="bulk-top">
            <hcm-icon-button class="clear" icon="close" .label=${input.clear} @click=${input.onClear}></hcm-icon-button>
            <p class="count" role="status">${input.count}</p>
            <hcm-button variant="text" icon="select_all" class="select-all" @click=${input.onSelectAll}>${input.selectAll}</hcm-button>
        </div>
        <div class="bulk-actions">
            ${input.buttons.map((spec, index) => button(input, spec, index))}
            <hcm-overflow-menu
                class="bulk-more"
                .label=${input.moreLabel}
                .closeLabel=${input.closeLabel}
                .actions=${more}
                @hcm-action=${(event: CustomEvent<{ readonly id: string }>) => {
                    input.onAction(event.detail.id);
                }}
            ></hcm-overflow-menu>
        </div>
    </section>`;
}

/** The bar's look: the secondary container, two rows, the count taking the room between Clear and Select all. */
export const bulkBarStyles = css`
    .bulk-bar {
        display: flex;
        flex-direction: column;

        /* 8 px between the two rows and around them: the 40 px controls' 48 px touch targets reach 4 px out, and 4 px
           cut the top row's to 44 on a phone (the tour's target-size check on photos.bulk). */
        gap: 8px;
        padding: 8px;
        border-radius: var(--md-sys-shape-corner-large, 16px);
        background: var(--md-sys-color-secondary-container, Canvas);
        color: var(--md-sys-color-on-secondary-container, CanvasText);
    }

    /* The bar's icon buttons (Clear, and the overflow menu's through its exported part) draw in the bar's own colour: the
       surface-variant tone reached 1.99:1 on the secondary container in high contrast (the tour's checkers). Its dialog
       keeps the kit's colours. */
    .bulk-bar hcm-icon-button::part(button),
    .bulk-bar hcm-overflow-menu::part(more-button) {
        color: var(--md-sys-color-on-secondary-container);
    }

    .bulk-top,
    .bulk-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
    }

    .bulk-top .count {
        flex: 1 1 auto;
        min-inline-size: 0;
    }
`;
