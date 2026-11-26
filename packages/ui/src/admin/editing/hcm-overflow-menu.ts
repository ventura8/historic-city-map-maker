/**
 * `<hcm-overflow-menu>`: an editor's or a selection's less frequent actions behind one button (the M3 overflow menu,
 * `docs/research/M2c-interfaces.md` §1.3, §1.5; the UX review of 2026-10-18, `DECISIONS-for-review.md` §42e). The
 * button (`more_vert`, named `label`) opens the kit's modal dialog headed `label`, which lists every action as a text
 * button with its icon, one under the other; as the account menu, a dialog keeps the focus inside it and gives it back
 * to the button when it closes. Choosing an action closes the dialog first, then fires `hcm-action` with `{id}`; Esc,
 * the close button and the scrim choose nothing. A disabled action is listed, disabled; with every action disabled (a
 * revoked admin's read-only editor) the button is disabled too.
 */
import { LitElement, css, html, type TemplateResult } from 'lit';

import { defineHcmButton } from '../../components/button.js';
import { defineHcmDialog, type HcmDialog } from '../../components/dialog.js';
import { defineHcmIconButton } from '../../components/icon-button.js';
import { defineOnce, emit } from '../../components/internal.js';
import { adminBase } from '../shell/admin-styles.js';

export const HCM_OVERFLOW_MENU_TAG = 'hcm-overflow-menu';

export interface OverflowAction {
    readonly id: string;
    /** Already in the admin's language: the button's text. */
    readonly label: string;
    readonly icon: string;
    readonly disabled?: boolean;
}

export class HcmOverflowMenu extends LitElement {
    static override readonly properties = {
        label: { type: String },
        closeLabel: { type: String, attribute: 'close-label' },
        actions: { attribute: false },
        open: { type: Boolean, reflect: true },
    };

    static override readonly styles = [
        adminBase,
        css`
            :host {
                display: inline-flex;
            }

            .menu {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 8px;
                margin: 0;

                /* The 40 px buttons' 48 px touch targets reach 4 px out: the dialog's scrolling content clipped the first
                   and the last to 44 px on a phone (the tour's target-size check on pois.more-actions). */
                padding: 4px 0;
                list-style: none;
            }
        `,
    ];

    declare label: string;
    declare closeLabel: string;
    declare actions: readonly OverflowAction[];
    declare open: boolean;
    /** The action chosen while the dialog closes: fired once it has closed (and the focus is back on the button). */
    #chosen: string | null = null;

    constructor() {
        super();
        this.label = '';
        this.closeLabel = '';
        this.actions = [];
        this.open = false;
    }

    override render(): TemplateResult {
        const none = this.actions.every((action) => action.disabled === true);
        return html`<hcm-icon-button
                exportparts="button: more-button"
                icon="more_vert"
                .label=${this.label}
                aria-haspopup="dialog"
                ?disabled=${none}
                @click=${() => {
                    this.open = true;
                }}
            ></hcm-icon-button>
            <hcm-dialog .open=${this.open} .headline=${this.label} .closeLabel=${this.closeLabel} @hcm-close=${this.#closed}>
                <ul class="menu">
                    ${this.actions.map((action) => this.#item(action))}
                </ul>
            </hcm-dialog>`;
    }

    #item(action: OverflowAction): TemplateResult {
        const choose = (): void => {
            this.#chosen = action.id;
            this.renderRoot.querySelector<HcmDialog>('hcm-dialog')?.close('action');
        };
        return html`<li>
            <hcm-button variant="text" icon=${action.icon} data-action=${action.id} ?disabled=${action.disabled === true} @click=${choose}
                >${action.label}</hcm-button
            >
        </li>`;
    }

    readonly #closed = (event: Event): void => {
        event.stopPropagation();
        this.open = false;
        const chosen = this.#chosen;
        this.#chosen = null;
        if (chosen !== null) {
            void this.#fire(chosen);
        }
    };

    /** Once the dialog has closed and given the focus back (a confirmation the action opens then starts from the button). */
    async #fire(id: string): Promise<void> {
        await this.renderRoot.querySelector<HcmDialog>('hcm-dialog')?.updateComplete;
        emit(this, 'hcm-action', { id });
    }
}

/** Registers `<hcm-overflow-menu>` and what it renders. */
export function defineHcmOverflowMenu(registry: CustomElementRegistry = customElements): void {
    defineHcmIconButton(registry);
    defineHcmButton(registry);
    defineHcmDialog(registry);
    defineOnce(registry, HCM_OVERFLOW_MENU_TAG, HcmOverflowMenu);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-overflow-menu': HcmOverflowMenu;
    }
}
