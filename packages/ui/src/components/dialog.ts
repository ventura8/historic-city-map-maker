import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';

import { deepActiveElement, restoreFocus, tabbableElements, trapTab } from './focus.js';
import { defineHcmIconButton } from './icon-button.js';
import { defineOnce, emit } from './internal.js';
import { reportModal } from './modal-registry.js';
import { baseStyles, focusRing, typeStyles } from './styles.js';

export const HCM_DIALOG_TAG = 'hcm-dialog';

/**
 * An M3 modal dialog on the native `<dialog>` (top layer, the page behind it inert). Tab and Shift+Tab wrap inside
 * it; Esc, the close button or a click on the scrim close it with `returnValue` `cancel`, `close` or `scrim`, and the
 * focus goes back to the element that had it before. Closing fires `hcm-close` with `{returnValue}`; `close(value)`
 * lets an action close it with its own value. `fullscreen` is the compact-window full-screen dialog. While it is open it
 * counts in the document's open modals (`modal-registry.ts`), which a map under its scrim follows. Slots: default
 * (content), `actions`. The headline row is a plain box, not a `header`: a dialog opened from a top bar put a banner
 * inside the page's banner (axe, the admin's account menu).
 */
export class HcmDialog extends LitElement {
    static override readonly properties = {
        open: { type: Boolean, reflect: true },
        headline: { type: String },
        closeLabel: { type: String, attribute: 'close-label' },
        fullscreen: { type: Boolean, reflect: true },
    };

    static override readonly styles = [
        baseStyles,
        focusRing,
        typeStyles,
        css`
            dialog {
                box-sizing: border-box;
                width: min(560px, calc(100% - 48px));
                max-height: calc(100% - 48px);
                padding: 0;
                border: none;
                border-radius: var(--md-sys-shape-corner-extra-large);
                background: var(--md-sys-color-surface-container-high);
                color: var(--md-sys-color-on-surface);
                box-shadow: var(--md-sys-elevation-level3);
            }

            dialog[open] {
                display: flex;
                flex-direction: column;
            }

            dialog::backdrop {
                background: color-mix(in srgb, var(--md-sys-color-scrim) 32%, transparent);
            }

            :host([fullscreen]) dialog {
                width: 100%;
                max-width: none;
                height: 100%;
                max-height: none;
                border-radius: 0;
            }

            .header {
                display: flex;
                gap: 8px;
                align-items: center;
                padding: 16px 12px 8px 24px;
            }

            h2 {
                flex: 1 1 auto;
                margin: 0;
            }

            .content {
                flex: 1 1 auto;
                padding: 0 24px 16px;
                overflow: auto;
                color: var(--md-sys-color-on-surface-variant);
            }

            /*
             * 4 px above the actions: their 48 px touch targets reach 4 px past a 40 px button, and would otherwise cover
             * the bottom of the control the scrolling content shows at its edge (CR-M2c-29; the tour's reflow check found
             * a select of the import preview and a field of the link dialog under them at 320 px).
             */
            .actions {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                justify-content: flex-end;
                padding: 4px 24px 24px;
            }

            @media (forced-colors: active) {
                dialog {
                    border: 1px solid CanvasText;
                }
            }
        `,
    ];

    declare open: boolean;
    declare headline: string;
    declare closeLabel: string;
    declare fullscreen: boolean;

    private opener: Element | null = null;

    constructor() {
        super();
        this.open = false;
        this.headline = '';
        this.closeLabel = '';
        this.fullscreen = false;
    }

    /** Closes the dialog (if open) and fires `hcm-close` with `{returnValue}`. */
    close(returnValue = 'close'): void {
        if (this.open) {
            this.open = false;
            emit(this, 'hcm-close', { returnValue });
        }
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.dialog()?.close();
        reportModal(this.ownerDocument, this, false);
    }

    protected override updated(changed: PropertyValues<this>): void {
        if (changed.has('open')) {
            this.sync(changed.get('open') === true);
        }
    }

    override render(): TemplateResult {
        return html`<dialog
            part="dialog"
            aria-labelledby="headline"
            @cancel=${this.onCancel}
            @click=${this.onClick}
            @keydown=${this.onKeyDown}
        >
            <div class="header">
                <h2 id="headline" class="headline-small">${this.headline}</h2>
                <hcm-icon-button icon="close" label=${this.closeLabel} @click=${this.onCloseClick}></hcm-icon-button>
            </div>
            <div class="content body-medium"><slot></slot></div>
            <div class="actions"><slot name="actions"></slot></div>
        </dialog>`;
    }

    private dialog(): HTMLDialogElement | null {
        return this.renderRoot.querySelector('dialog');
    }

    /** Shows or hides the native dialog to match `open`; focus goes in on open and back to the opener on close. */
    private sync(wasOpen: boolean): void {
        if (this.open) {
            this.show();
        } else if (wasOpen) {
            this.hide();
        }
    }

    private show(): void {
        const dialog = this.dialog();
        if (dialog === null || dialog.open) {
            return;
        }
        this.opener = deepActiveElement(this.ownerDocument);
        dialog.showModal();
        reportModal(this.ownerDocument, this, true);
        (tabbableElements(dialog)[0] ?? dialog).focus();
    }

    private hide(): void {
        this.dialog()?.close();
        reportModal(this.ownerDocument, this, false);
        restoreFocus(this.opener);
        this.opener = null;
    }

    /** Esc: the native dialog would close itself; the element closes instead, so `open` stays the truth. */
    private readonly onCancel = (event: Event): void => {
        event.preventDefault();
        this.close('cancel');
    };

    /** A click on the dialog element outside its box is a click on the backdrop (the scrim). */
    private readonly onClick = (event: MouseEvent): void => {
        const dialog = event.currentTarget as HTMLDialogElement;
        if (event.target === dialog && !isInside(event, dialog.getBoundingClientRect())) {
            this.close('scrim');
        }
    };

    private readonly onCloseClick = (): void => {
        this.close('close');
    };

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        trapTab(event, event.currentTarget as HTMLDialogElement);
    };
}

function isInside(event: MouseEvent, rect: DOMRect): boolean {
    return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
}

export function defineHcmDialog(registry: CustomElementRegistry = customElements): void {
    defineHcmIconButton(registry);
    defineOnce(registry, HCM_DIALOG_TAG, HcmDialog);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-dialog': HcmDialog;
    }
}
