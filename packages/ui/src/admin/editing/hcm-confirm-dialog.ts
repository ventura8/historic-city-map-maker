/**
 * `<hcm-confirm-dialog>`: the question before a destructive or lasting action (`docs/research/M2c-interfaces.md` §9.5):
 * the kit's modal dialog with a headline, what follows (`body`, text), Cancel (the focus starts there) and the action,
 * in the error colour when `destructive`. Confirming fires `hcm-confirm`; Cancel, Esc, the close button and the scrim
 * fire `hcm-cancel`. The page keeps `open` in its own state and closes it on either event.
 */
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';

import { defineHcmButton } from '../../components/button.js';
import { defineHcmDialog } from '../../components/dialog.js';
import { defineOnce, emit } from '../../components/internal.js';
import { adminBase } from '../shell/admin-styles.js';

export const HCM_CONFIRM_DIALOG_TAG = 'hcm-confirm-dialog';

export class HcmConfirmDialog extends LitElement {
    static override readonly properties = {
        open: { type: Boolean, reflect: true },
        headline: { type: String },
        body: { type: String },
        confirmLabel: { type: String, attribute: 'confirm-label' },
        cancelLabel: { type: String, attribute: 'cancel-label' },
        closeLabel: { type: String, attribute: 'close-label' },
        destructive: { type: Boolean, reflect: true },
    };

    static override readonly styles = [
        adminBase,
        css`
            /* It takes no room where it is placed: the dialog itself opens in the top layer. */
            :host {
                display: contents;
            }

            :host([destructive]) .confirm {
                --md-sys-color-primary: var(--md-sys-color-error);
                --md-sys-color-on-primary: var(--md-sys-color-on-error);
            }
        `,
    ];

    declare open: boolean;
    declare headline: string;
    declare body: string;
    declare confirmLabel: string;
    declare cancelLabel: string;
    /** The name of the dialog's close (X) button ("Close"): two buttons named alike would confuse a screen reader. */
    declare closeLabel: string;
    declare destructive: boolean;

    constructor() {
        super();
        this.open = false;
        this.headline = '';
        this.body = '';
        this.confirmLabel = '';
        this.cancelLabel = '';
        this.closeLabel = '';
        this.destructive = false;
    }

    protected override updated(changed: PropertyValues<this>): void {
        if (changed.has('open') && this.open) {
            void this.#focusCancel();
        }
    }

    /** Once the dialog is open (it focuses its first control), Cancel takes the focus: the safe choice. */
    async #focusCancel(): Promise<void> {
        await this.renderRoot.querySelector('hcm-dialog')?.updateComplete;
        this.renderRoot.querySelector<HTMLElement>('.cancel')?.focus();
    }

    override render(): TemplateResult {
        const closed = (event: CustomEvent<{ readonly returnValue: string }>): void => {
            event.stopPropagation();
            emit(this, event.detail.returnValue === 'confirm' ? 'hcm-confirm' : 'hcm-cancel');
        };
        const close = (value: string) => (): void => {
            this.renderRoot.querySelector('hcm-dialog')?.close(value);
        };
        return html`<hcm-dialog
            .open=${this.open}
            .headline=${this.headline}
            .closeLabel=${this.closeLabel === '' ? this.cancelLabel : this.closeLabel}
            @hcm-close=${closed}
        >
            <p>${this.body}</p>
            <hcm-button slot="actions" class="cancel" variant="text" @click=${close('cancel')}>${this.cancelLabel}</hcm-button>
            <hcm-button slot="actions" class="confirm" variant="filled" @click=${close('confirm')}>${this.confirmLabel}</hcm-button>
        </hcm-dialog>`;
    }
}

/** Registers `<hcm-confirm-dialog>` and what it renders. */
export function defineHcmConfirmDialog(registry: CustomElementRegistry = customElements): void {
    defineHcmDialog(registry);
    defineHcmButton(registry);
    defineOnce(registry, HCM_CONFIRM_DIALOG_TAG, HcmConfirmDialog);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-confirm-dialog': HcmConfirmDialog;
    }
}
