import { LitElement, css, html, type TemplateResult } from 'lit';

import { defineHcmIcon } from './icon.js';
import { defineOnce, emit } from './internal.js';
import { baseStyles, focusRing, touchTarget } from './styles.js';

export const HCM_SWITCH_TAG = 'hcm-switch';

/**
 * An M3 switch (`role="switch"`). `label` is the accessible name (the visible text beside it belongs to the caller,
 * and should be part of the name). A click, Space or Enter flips `checked` and fires `hcm-change` with `{checked}`.
 * The selected handle shows a check mark, so the state never depends on colour alone.
 */
export class HcmSwitch extends LitElement {
    static override readonly shadowRootOptions: ShadowRootInit = { ...LitElement.shadowRootOptions, delegatesFocus: true };

    static override readonly properties = {
        checked: { type: Boolean, reflect: true },
        label: { type: String },
        disabled: { type: Boolean, reflect: true },
        compact: { type: Boolean, reflect: true },
    };

    static override readonly styles = [
        baseStyles,
        focusRing,
        touchTarget,
        css`
            :host {
                display: inline-flex;
                vertical-align: middle;
            }

            button {
                position: relative;
                display: inline-flex;
                align-items: center;
                box-sizing: border-box;
                width: 52px;
                height: 32px;
                padding: 0;
                margin: 0;
                border: 2px solid var(--md-sys-color-outline);
                border-radius: var(--md-sys-shape-corner-full);
                background: var(--md-sys-color-surface-container-highest);
                cursor: pointer;
                transition: background-color var(--md-sys-motion-spring-fast-effects-duration)
                    var(--md-sys-motion-spring-fast-effects-easing);
            }

            .handle {
                display: grid;
                place-items: center;
                width: 16px;
                height: 16px;
                margin-inline-start: 6px;
                border-radius: var(--md-sys-shape-corner-full);
                background: var(--md-sys-color-outline);
                color: var(--md-sys-color-on-primary-container);
                transition:
                    margin var(--md-sys-motion-spring-fast-spatial-duration) var(--md-sys-motion-spring-fast-spatial-easing),
                    width var(--md-sys-motion-spring-fast-spatial-duration) var(--md-sys-motion-spring-fast-spatial-easing),
                    height var(--md-sys-motion-spring-fast-spatial-duration) var(--md-sys-motion-spring-fast-spatial-easing);

                --hcm-icon-size: 16px;
            }

            hcm-icon {
                visibility: hidden;
            }

            button:active .handle {
                width: 28px;
                height: 28px;
                margin-inline-start: 2px;
            }

            :host([checked]) button {
                border-color: var(--md-sys-color-primary);
                background: var(--md-sys-color-primary);
            }

            :host([checked]) .handle {
                width: 24px;
                height: 24px;
                margin-inline-start: 22px;
                background: var(--md-sys-color-on-primary);
            }

            :host([checked]) hcm-icon {
                visibility: visible;
            }

            :host([disabled]) button {
                cursor: default;
                opacity: 0.38;
            }

            /*
             * Compact (thin) variant for dense lists such as the viewer's Layers panel: a 40 x 24 track with a 12 / 16 px
             * handle. The 48 px touch target stays (touchTarget), only the drawing is thinner.
             */
            :host([compact]) button {
                width: 40px;
                height: 24px;
            }

            :host([compact]) .handle {
                width: 12px;
                height: 12px;
                margin-inline-start: 4px;

                --hcm-icon-size: 12px;
            }

            /* The thin switch shows its state by the handle's place and colour; no check mark in a 16 px handle. */
            :host([compact]) hcm-icon {
                visibility: hidden;
            }

            :host([compact][checked]) .handle {
                width: 16px;
                height: 16px;
                margin-inline-start: 18px;
            }

            :host([compact]) button:active .handle {
                width: 20px;
                height: 20px;
                margin-inline-start: 0;
            }

            :host([checked]) button:active .handle {
                width: 28px;
                height: 28px;
                margin-inline-start: 20px;
            }

            :host([compact][checked]) button:active .handle {
                width: 20px;
                height: 20px;
                margin-inline-start: 16px;
            }

            @media (forced-colors: active) {
                .handle {
                    border: 1px solid ButtonText;
                }
            }
        `,
    ];

    declare checked: boolean;
    declare label: string;
    declare disabled: boolean;
    /** The thin M3 variant (40 x 24), the default; the touch target stays 48 px. */
    declare compact: boolean;

    constructor() {
        super();
        this.checked = false;
        this.label = '';
        this.disabled = false;
        // Thin by default everywhere, viewer and admin (the owner, 2026-11-22); `compact=false` asks for the full size.
        this.compact = true;
    }

    override render(): TemplateResult {
        return html`<button
            class="touch-target"
            part="switch"
            role="switch"
            aria-checked=${String(this.checked)}
            aria-label=${this.label}
            ?disabled=${this.disabled}
            @click=${this.onClick}
        >
            <span class="handle"><hcm-icon name="check"></hcm-icon></span>
        </button>`;
    }

    private readonly onClick = (): void => {
        this.checked = !this.checked;
        emit(this, 'hcm-change', { checked: this.checked });
    };
}

export function defineHcmSwitch(registry: CustomElementRegistry = customElements): void {
    defineHcmIcon(registry);
    defineOnce(registry, HCM_SWITCH_TAG, HcmSwitch);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-switch': HcmSwitch;
    }
}
