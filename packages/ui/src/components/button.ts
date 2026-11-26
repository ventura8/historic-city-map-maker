import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { defineHcmIcon } from './icon.js';
import { defineOnce } from './internal.js';
import { baseStyles, focusRing, stateLayer, touchTarget, typeStyles } from './styles.js';

export const HCM_BUTTON_TAG = 'hcm-button';

export type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text';

/**
 * An M3 Expressive common button (small size: 40 px high in a 48 px target, pill shape that squares off while
 * pressed). The label is the default slot, so it is the accessible name. Fires the native `click`. A toggle button sets
 * `pressed` (true or false), which its inner button states as `aria-pressed`: ARIA on the host would name nothing, since
 * the host is not the focused element (Draw the area, `DECISIONS-for-review.md` §42a); undefined is no toggle. For the
 * same reason `popup` (`aria-haspopup`), `current` (`aria-current`) and `label` (`aria-label`, a name that holds the
 * visible text) reach the inner button (the city menu: `docs/LESSONS.md` 249).
 */
export class HcmButton extends LitElement {
    static override readonly shadowRootOptions: ShadowRootInit = { ...LitElement.shadowRootOptions, delegatesFocus: true };

    static override readonly properties = {
        variant: { type: String, reflect: true },
        icon: { type: String },
        disabled: { type: Boolean, reflect: true },
        pressed: { attribute: false },
        popup: { attribute: false },
        current: { attribute: false },
        label: { attribute: false },
    };

    static override readonly styles = [
        baseStyles,
        focusRing,
        stateLayer,
        touchTarget,
        typeStyles,
        css`
            :host {
                display: inline-flex;
                vertical-align: middle;
            }

            button {
                display: inline-flex;
                gap: 8px;
                align-items: center;
                justify-content: center;
                box-sizing: border-box;
                min-width: 48px;
                height: var(--hcm-control-size, 40px);
                padding-inline: 16px;
                margin: 0;
                border: none;
                border-radius: var(--md-sys-shape-corner-full);
                background: var(--md-sys-color-primary);
                color: var(--md-sys-color-on-primary);
                overflow: visible;
                transition: border-radius var(--md-sys-motion-spring-fast-spatial-duration) var(--md-sys-motion-spring-fast-spatial-easing);

                --hcm-icon-size: 20px;
            }

            button:active {
                border-radius: var(--md-sys-shape-corner-small);
            }

            :host([variant='tonal']) button {
                background: var(--md-sys-color-secondary-container);
                color: var(--md-sys-color-on-secondary-container);
            }

            :host([variant='outlined']) button {
                border: 1px solid var(--md-sys-color-outline-variant);
                background: none;
                color: var(--md-sys-color-on-surface-variant);
            }

            :host([variant='text']) button {
                padding-inline: 12px;
                background: none;
                color: var(--md-sys-color-primary);
            }

            :host([disabled]) button {
                background: color-mix(in srgb, var(--md-sys-color-on-surface) 10%, transparent);
                color: color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent);
            }

            @media (forced-colors: active) {
                button {
                    border: 1px solid ButtonText;
                }
            }
        `,
    ];

    declare variant: ButtonVariant;
    declare icon: string;
    declare disabled: boolean;
    declare pressed: boolean | undefined;
    declare popup: 'dialog' | undefined;
    declare current: boolean | undefined;
    declare label: string | undefined;

    constructor() {
        super();
        this.variant = 'filled';
        this.icon = '';
        this.disabled = false;
    }

    override render(): TemplateResult {
        return html`<button
            class="interactive touch-target label-large"
            part="button"
            ?disabled=${this.disabled}
            aria-pressed=${this.pressed === undefined ? nothing : String(this.pressed)}
            aria-haspopup=${ifDefined(this.popup)}
            aria-current=${ifDefined(this.current === true ? 'true' : undefined)}
            aria-label=${ifDefined(this.label)}
        >
            ${this.icon === '' ? nothing : html`<hcm-icon name=${this.icon}></hcm-icon>`}<slot></slot>
        </button>`;
    }
}

export function defineHcmButton(registry: CustomElementRegistry = customElements): void {
    defineHcmIcon(registry);
    defineOnce(registry, HCM_BUTTON_TAG, HcmButton);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-button': HcmButton;
    }
}
