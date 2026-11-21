import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';

import { defineHcmIconButton } from './icon-button.js';
import { defineOnce, emit } from './internal.js';
import { baseStyles, focusRing, stateLayer, touchTarget, typeStyles, visuallyHidden } from './styles.js';

export const HCM_SNACKBAR_TAG = 'hcm-snackbar';

/**
 * How long after a message shows its text goes into the live region. Screen readers announce a change to a live region
 * that already exists; a region added together with its text (a snackbar created for one toast) stays silent.
 */
export const ANNOUNCE_DELAY_MS = 150;

export type SnackbarDismissReason = 'timeout' | 'close' | 'action';

/**
 * An M3 snackbar. It shows `message` until the visitor closes it or `timeoutMs` passes (6000 by default, 0 keeps it
 * until closed); the timer pauses while the pointer or the focus is on it. Fires `hcm-action` for the action button,
 * then `hcm-dismiss` with `{reason}` (`timeout`, `close` or `action`). A new `message` shows the snackbar again. The
 * message is announced through a polite live region that is always present and gets the text `ANNOUNCE_DELAY_MS` after
 * the message shows (WCAG 4.1.3), so it is announced even when the snackbar is created for it; the buttons are not part
 * of the announcement.
 */
export class HcmSnackbar extends LitElement {
    static override readonly properties = {
        message: { type: String },
        actionLabel: { type: String, attribute: 'action-label' },
        closeLabel: { type: String, attribute: 'close-label' },
        timeoutMs: { type: Number, attribute: 'timeout-ms' },
        stacked: { type: Boolean, reflect: true },
        dismissed: { state: true },
        announcement: { state: true },
    };

    static override readonly styles = [
        baseStyles,
        focusRing,
        stateLayer,
        touchTarget,
        typeStyles,
        visuallyHidden,
        css`
            :host {
                position: absolute;
                inset-inline: 0;
                bottom: 16px;
                z-index: var(--hcm-snackbar-z-index, 3);
                display: flex;
                justify-content: center;
                padding-inline: 16px;
                pointer-events: none;
            }

            .snackbar {
                display: flex;
                gap: 4px;
                align-items: center;
                box-sizing: border-box;
                width: min(100%, 560px);
                min-height: 48px;
                padding-inline: 16px 4px;
                border-radius: var(--md-sys-shape-corner-extra-small);
                background: var(--md-sys-color-inverse-surface);
                color: var(--md-sys-color-inverse-on-surface);
                box-shadow: var(--md-sys-elevation-level3);
                pointer-events: auto;

                --md-sys-color-on-surface-variant: var(--md-sys-color-inverse-on-surface);

                /* Secondary is too close to the inverse surface (1.62:1): the ring takes the inverse primary of the action. */
                --hcm-focus-ring-color: var(--md-sys-color-inverse-primary);
            }

            .message {
                flex: 1 1 auto;
                padding-block: 14px;
            }

            /* M3's longer action: the message on its own line, the action and Close under it (a narrow dock, text spacing). */
            :host([stacked]) .snackbar {
                flex-wrap: wrap;
                justify-content: flex-end;
                padding-block-end: 4px;
            }

            :host([stacked]) .message {
                flex-basis: 100%;
                padding-block-end: 4px;
            }

            /* The action keeps its label whole and its 48 px target (an editor's Undo on a phone, CR-M2c-17). */
            .action {
                flex: none;
                min-width: 48px;
                height: 40px;
                padding-inline: 12px;
                border: none;
                border-radius: var(--md-sys-shape-corner-full);
                background: none;
                color: var(--md-sys-color-inverse-primary);
            }

            @media (forced-colors: active) {
                .snackbar {
                    border: 1px solid CanvasText;
                }
            }
        `,
    ];

    declare message: string;
    declare actionLabel: string;
    declare closeLabel: string;
    declare timeoutMs: number;
    /** The message on a line of its own, the action and Close under it (M3's layout for a longer action). */
    declare stacked: boolean;
    declare dismissed: boolean;
    /** The live region's text: empty until `ANNOUNCE_DELAY_MS` after a message shows, and again once it is dismissed. */
    declare announcement: string;

    private timer: ReturnType<typeof setTimeout> | undefined;
    private announceTimer: ReturnType<typeof setTimeout> | undefined;

    constructor() {
        super();
        this.message = '';
        this.actionLabel = '';
        this.closeLabel = '';
        this.timeoutMs = 6000;
        this.stacked = false;
        this.dismissed = false;
        this.announcement = '';
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.stopTimer();
        clearTimeout(this.announceTimer);
    }

    protected override willUpdate(changed: PropertyValues<this>): void {
        if (changed.has('message')) {
            this.dismissed = false;
            this.announcement = '';
        }
    }

    protected override updated(changed: PropertyValues<this>): void {
        if (changed.has('message') || changed.has('timeoutMs')) {
            this.startTimer();
        }
        if (changed.has('message')) {
            this.scheduleAnnouncement();
        }
    }

    override render(): TemplateResult {
        const visible = this.message !== '' && !this.dismissed;
        return html`<div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">${this.announcement}</div>
            <div>${visible ? this.renderSnackbar() : nothing}</div>`;
    }

    private scheduleAnnouncement(): void {
        clearTimeout(this.announceTimer);
        if (this.message !== '') {
            this.announceTimer = setTimeout(() => {
                this.announcement = this.message;
            }, ANNOUNCE_DELAY_MS);
        }
    }

    private renderSnackbar(): TemplateResult {
        return html`<div
            class="snackbar"
            part="snackbar"
            @pointerenter=${this.stopTimer}
            @pointerleave=${this.startTimer}
            @focusin=${this.stopTimer}
            @focusout=${this.startTimer}
        >
            <span class="message body-medium">${this.message}</span>
            ${
                this.actionLabel === ''
                    ? nothing
                    : html`<button class="action interactive touch-target label-large" @click=${this.onAction}>${this.actionLabel}</button>`
            }
            <hcm-icon-button icon="close" label=${this.closeLabel} @click=${this.onClose}></hcm-icon-button>
        </div>`;
    }

    private readonly startTimer = (): void => {
        this.stopTimer();
        if (this.message !== '' && !this.dismissed && this.timeoutMs > 0) {
            this.timer = setTimeout(() => {
                this.dismiss('timeout');
            }, this.timeoutMs);
        }
    };

    private readonly stopTimer = (): void => {
        clearTimeout(this.timer);
        this.timer = undefined;
    };

    private dismiss(reason: SnackbarDismissReason): void {
        this.stopTimer();
        clearTimeout(this.announceTimer);
        this.dismissed = true;
        this.announcement = '';
        emit(this, 'hcm-dismiss', { reason });
    }

    private readonly onAction = (): void => {
        emit(this, 'hcm-action');
        this.dismiss('action');
    };

    private readonly onClose = (): void => {
        this.dismiss('close');
    };
}

export function defineHcmSnackbar(registry: CustomElementRegistry = customElements): void {
    defineHcmIconButton(registry);
    defineOnce(registry, HCM_SNACKBAR_TAG, HcmSnackbar);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-snackbar': HcmSnackbar;
    }
}
