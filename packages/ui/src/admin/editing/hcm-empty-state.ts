/**
 * `<hcm-empty-state>`: what an empty list or an unselected detail shows (`docs/research/M2c-interfaces.md` §1.4, §9.5):
 * an icon, one sentence (`text`), an optional second line that says where the items come from (`hint`; finding 44 of
 * `docs/research/manual-test-2026-10-25.md`: the Jobs page's "No jobs yet." alone), and the page's primary action in the
 * default slot.
 */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';

import { defineHcmIcon } from '../../components/icon.js';
import { defineOnce } from '../../components/internal.js';
import { adminBase } from '../shell/admin-styles.js';

export const HCM_EMPTY_STATE_TAG = 'hcm-empty-state';

export class HcmEmptyState extends LitElement {
    static override readonly properties = {
        icon: { type: String },
        text: { type: String },
        hint: { type: String },
    };

    static override readonly styles = [
        adminBase,
        css`
            :host {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 16px;
                box-sizing: border-box;
                padding: 32px 16px;
                text-align: center;
                color: var(--md-sys-color-on-surface-variant, CanvasText);
                overflow-wrap: anywhere;

                --hcm-icon-size: 48px;
            }

            p {
                margin: 0;
                max-inline-size: 40ch;
                font-size: var(--md-sys-typescale-body-large-size, 1rem);
                line-height: var(--md-sys-typescale-body-large-line-height, 1.5rem);
            }
        `,
    ];

    declare icon: string;
    declare text: string;
    declare hint: string;

    constructor() {
        super();
        this.icon = 'info';
        this.text = '';
        this.hint = '';
    }

    override render(): TemplateResult {
        return html`<hcm-icon name=${this.icon} aria-hidden="true"></hcm-icon>
            <p>${this.text}</p>
            ${this.hint === '' ? nothing : html`<p class="hint">${this.hint}</p>`}
            <slot></slot>`;
    }
}

export function defineHcmEmptyState(registry: CustomElementRegistry = customElements): void {
    defineHcmIcon(registry);
    defineOnce(registry, HCM_EMPTY_STATE_TAG, HcmEmptyState);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-empty-state': HcmEmptyState;
    }
}
