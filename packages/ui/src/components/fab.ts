import { LitElement, css, html, nothing, type TemplateResult } from 'lit';

import { defineHcmIcon } from './icon.js';
import { defineOnce } from './internal.js';
import { baseStyles, focusRing, stateLayer, typeStyles } from './styles.js';

export const HCM_FAB_TAG = 'hcm-fab';

/** `small` 40 px (corner 12), `medium` 56 px, the M3 FAB (corner 16), `large` 96 px (corner 28). */
export type FabSize = 'small' | 'medium' | 'large';

/**
 * An M3 floating action button in the primary-container colour. `label` is the accessible name; with `extended` it is
 * also shown next to the icon (and is then the visible name). Fires the native `click`.
 */
export class HcmFab extends LitElement {
    static override readonly shadowRootOptions: ShadowRootInit = { ...LitElement.shadowRootOptions, delegatesFocus: true };

    static override readonly properties = {
        icon: { type: String },
        label: { type: String },
        extended: { type: Boolean, reflect: true },
        size: { type: String, reflect: true },
    };

    static override readonly styles = [
        baseStyles,
        focusRing,
        stateLayer,
        typeStyles,
        css`
            :host {
                display: inline-flex;
                vertical-align: middle;
            }

            button {
                display: inline-flex;
                gap: 12px;
                align-items: center;
                justify-content: center;
                box-sizing: border-box;
                min-width: 56px;
                height: 56px;
                padding-inline: 16px;
                margin: 0;
                border: none;
                border-radius: var(--md-sys-shape-corner-large);
                background: var(--md-sys-color-primary-container);
                color: var(--md-sys-color-on-primary-container);
                box-shadow: var(--md-sys-elevation-level3);
                transition: border-radius var(--md-sys-motion-spring-fast-spatial-duration) var(--md-sys-motion-spring-fast-spatial-easing);
            }

            button:active {
                border-radius: var(--md-sys-shape-corner-medium);
            }

            :host([size='small']) button {
                min-width: var(--hcm-control-size, 40px);
                height: var(--hcm-control-size, 40px);
                padding-inline: 8px;
                border-radius: var(--md-sys-shape-corner-medium);
            }

            :host([size='large']) button {
                min-width: 96px;
                height: 96px;
                padding-inline: 30px;
                border-radius: var(--md-sys-shape-corner-extra-large);

                --hcm-icon-size: 36px;
            }

            @media (forced-colors: active) {
                button {
                    border: 1px solid ButtonText;
                }
            }
        `,
    ];

    declare icon: string;
    declare label: string;
    declare extended: boolean;
    declare size: FabSize;

    constructor() {
        super();
        this.icon = '';
        this.label = '';
        this.extended = false;
        this.size = 'medium';
    }

    override render(): TemplateResult {
        return html`<button class="interactive label-large" part="button" aria-label=${this.extended ? nothing : this.label}>
            <hcm-icon name=${this.icon}></hcm-icon>${this.extended ? html`<span>${this.label}</span>` : nothing}
        </button>`;
    }
}

export function defineHcmFab(registry: CustomElementRegistry = customElements): void {
    defineHcmIcon(registry);
    defineOnce(registry, HCM_FAB_TAG, HcmFab);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-fab': HcmFab;
    }
}
