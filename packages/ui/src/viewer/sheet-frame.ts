/**
 * The frame every viewer sheet shares: a modal `<hcm-sheet>` (bottom on compact, side on medium and compact height),
 * or a docked standard side sheet in its own pane (expanded and wider) with a heading and a close button. The modal
 * sheet fires its own `hcm-close`; the docked one calls `onClose`. A docked sheet that `minimize`s (the extra-large Layers
 * pane) has a chevron instead, `aria-expanded="true"`.
 */
import { html, type TemplateResult } from 'lit';

import { EMPTY } from './empty.js';
import type { SheetMode } from './layout.js';

export interface SheetFrameOptions {
    readonly mode: SheetMode;
    readonly open: boolean;
    /** The sheet's heading and accessible name. */
    readonly label: string;
    readonly closeLabel: string;
    /** The accessible name of the bottom sheet's drag handle (`sheet.resize`). */
    readonly handleLabel: string;
    readonly onClose: () => void;
    /** The docked close minimizes the sheet to a rail: a chevron, and it says the sheet is expanded. */
    readonly minimize?: boolean | undefined;
    /**
     * A standard sheet beside a live map instead of a modal one: no scrim, the map stays visible and usable, the close
     * button and Esc close it (the Layers sheet, the owner, 2026-11-15). Default: modal.
     */
    readonly standard?: boolean | undefined;
}

export function renderSheetFrame(options: SheetFrameOptions, content: unknown): TemplateResult {
    const { mode, open, label, closeLabel, handleLabel, onClose, minimize, standard } = options;
    if (mode !== 'docked') {
        return html`<hcm-sheet
            ?modal=${standard !== true}
            .open=${open}
            .label=${label}
            .variant=${mode}
            .closeLabel=${closeLabel}
            .handleLabel=${handleLabel}
        >
            <h2 slot="header" class="sheet-title">${label}</h2>
            ${content}
        </hcm-sheet>`;
    }
    if (!open) {
        return EMPTY;
    }
    return html`<section class="docked" aria-label=${label}>
        <header>
            <h2 class="sheet-title">${label}</h2>
            <hcm-icon-button
                icon=${minimize === true ? 'chevron_left' : 'close'}
                .label=${closeLabel}
                .expanded=${minimize === true ? true : undefined}
                @click=${onClose}
            ></hcm-icon-button>
        </header>
        <div class="body">${content}</div>
    </section>`;
}

/** Dispatches the viewer-internal `hcm-close` of a docked sheet (it stays inside `<hcm-map-viewer>`). */
export function closeEvent(): CustomEvent<null> {
    return new CustomEvent('hcm-close', { bubbles: true, composed: false, detail: null });
}
