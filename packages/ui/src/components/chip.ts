import { LitElement, css, html, nothing, type TemplateResult } from 'lit';

import { defineHcmIcon } from './icon.js';
import { defineOnce, emit } from './internal.js';
import { baseStyles, focusRing, stateLayer, touchTarget, typeStyles } from './styles.js';

export const HCM_CHIP_TAG = 'hcm-chip';

/**
 * An M3 filter chip: a toggle button (`aria-pressed`) labelled `label`. A click flips `selected` and fires
 * `hcm-change` with `{selected}`; a selected chip shows a check mark in place of its `icon`.
 */
export class HcmChip extends LitElement {
    static override readonly shadowRootOptions: ShadowRootInit = { ...LitElement.shadowRootOptions, delegatesFocus: true };

    static override readonly properties = {
        label: { type: String },
        icon: { type: String },
        selected: { type: Boolean, reflect: true },
        disabled: { type: Boolean, reflect: true },
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
                box-sizing: border-box;
                height: var(--hcm-chip-size, 32px);
                padding-inline: 8px 16px;
                margin: 0;
                border: 1px solid var(--md-sys-color-outline-variant);
                border-radius: var(--md-sys-shape-corner-small);
                background: none;
                color: var(--md-sys-color-on-surface-variant);
                overflow: visible;

                --hcm-icon-size: 18px;
            }

            :host([selected]) button {
                border-color: transparent;
                background: var(--md-sys-color-secondary-container);
                color: var(--md-sys-color-on-secondary-container);
            }

            :host([disabled]) button {
                color: color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent);
            }

            @media (forced-colors: active) {
                :host([selected]) button {
                    border: 2px solid Highlight;
                }
            }
        `,
    ];

    declare label: string;
    declare icon: string;
    declare selected: boolean;
    declare disabled: boolean;

    constructor() {
        super();
        this.label = '';
        this.icon = '';
        this.selected = false;
        this.disabled = false;
    }

    override render(): TemplateResult {
        const icon = this.selected ? 'check' : this.icon;
        return html`<button
            class="interactive touch-target label-large"
            part="chip"
            aria-pressed=${String(this.selected)}
            ?disabled=${this.disabled}
            @click=${this.onClick}
        >
            ${icon === '' ? nothing : html`<hcm-icon name=${icon}></hcm-icon>`}<span>${this.label}</span>
        </button>`;
    }

    private readonly onClick = (): void => {
        this.selected = !this.selected;
        emit(this, 'hcm-change', { selected: this.selected });
    };
}

export function defineHcmChip(registry: CustomElementRegistry = customElements): void {
    defineHcmIcon(registry);
    defineOnce(registry, HCM_CHIP_TAG, HcmChip);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-chip': HcmChip;
    }
}
