import { LitElement, css, html, type TemplateResult } from 'lit';

import { defineOnce } from './internal.js';
import { baseStyles, typeStyles } from './styles.js';

export const HCM_CARD_TAG = 'hcm-card';

export type CardVariant = 'elevated' | 'filled' | 'outlined';

/** An M3 card: a `headline` slot (title-medium), the content, and an `actions` slot at the end. */
export class HcmCard extends LitElement {
    static override readonly properties = {
        variant: { type: String, reflect: true },
    };

    static override readonly styles = [
        baseStyles,
        typeStyles,
        css`
            :host {
                display: block;
            }

            .card {
                display: flex;
                flex-direction: column;
                gap: 8px;
                box-sizing: border-box;
                padding: 16px;
                border-radius: var(--md-sys-shape-corner-medium);
                background: var(--md-sys-color-surface-container-low);
                color: var(--md-sys-color-on-surface);
                box-shadow: var(--md-sys-elevation-level1);
            }

            :host([variant='filled']) .card {
                background: var(--md-sys-color-surface-container-highest);
                box-shadow: none;
            }

            :host([variant='outlined']) .card {
                border: 1px solid var(--md-sys-color-outline-variant);
                background: var(--md-sys-color-surface);
                box-shadow: none;
            }

            .actions {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                justify-content: flex-end;
            }

            @media (forced-colors: active) {
                .card {
                    border: 1px solid CanvasText;
                }
            }
        `,
    ];

    declare variant: CardVariant;

    constructor() {
        super();
        this.variant = 'elevated';
    }

    override render(): TemplateResult {
        return html`<div class="card" part="card">
            <div class="title-medium"><slot name="headline"></slot></div>
            <div class="body-medium"><slot></slot></div>
            <div class="actions"><slot name="actions"></slot></div>
        </div>`;
    }
}

export function defineHcmCard(registry: CustomElementRegistry = customElements): void {
    defineOnce(registry, HCM_CARD_TAG, HcmCard);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-card': HcmCard;
    }
}
