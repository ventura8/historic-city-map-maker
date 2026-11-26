import { LitElement, css, html, nothing, type TemplateResult } from 'lit';

import { defineOnce } from './internal.js';
import { baseStyles, focusRing, stateLayer, typeStyles } from './styles.js';

export const HCM_LIST_TAG = 'hcm-list';
export const HCM_LIST_ITEM_TAG = 'hcm-list-item';

/** An M3 list (`role="list"`) of `hcm-list-item` children. */
export class HcmList extends LitElement {
    static override readonly styles = [
        baseStyles,
        css`
            :host {
                display: block;
                padding-block: 8px;
            }
        `,
    ];

    override connectedCallback(): void {
        super.connectedCallback();
        if (!this.hasAttribute('role')) {
            this.setAttribute('role', 'list');
        }
    }

    override render(): TemplateResult {
        return html`<slot></slot>`;
    }
}

/**
 * An M3 list item (`role="listitem"`): `headline`, an optional `supportingText`, and `leading` / `trailing` slots
 * (an icon, a thumbnail, a switch). With `interactive` the row is a button and fires the native `click`.
 */
export class HcmListItem extends LitElement {
    static override readonly shadowRootOptions: ShadowRootInit = { ...LitElement.shadowRootOptions, delegatesFocus: true };

    static override readonly properties = {
        headline: { type: String },
        supportingText: { type: String, attribute: 'supporting-text' },
        interactive: { type: Boolean, reflect: true },
    };

    static override readonly styles = [
        baseStyles,
        focusRing,
        stateLayer,
        typeStyles,
        css`
            :host {
                display: block;
            }

            .item {
                display: flex;
                gap: 16px;
                align-items: center;
                box-sizing: border-box;
                width: 100%;
                min-height: 56px;
                padding: 8px 24px 8px 16px;
                margin: 0;
                border: none;
                background: none;
                color: var(--md-sys-color-on-surface);
                font: inherit;
                text-align: start;
            }

            .text {
                display: flex;
                flex: 1 1 auto;
                flex-direction: column;
                min-width: 0;
            }

            .supporting {
                color: var(--md-sys-color-on-surface-variant);
            }

            ::slotted([slot='leading']),
            ::slotted([slot='trailing']) {
                flex: none;
                color: var(--md-sys-color-on-surface-variant);
            }
        `,
    ];

    declare headline: string;
    declare supportingText: string;
    declare interactive: boolean;

    constructor() {
        super();
        this.headline = '';
        this.supportingText = '';
        this.interactive = false;
    }

    override connectedCallback(): void {
        super.connectedCallback();
        if (!this.hasAttribute('role')) {
            this.setAttribute('role', 'listitem');
        }
    }

    override render(): TemplateResult {
        const content = html`<slot name="leading"></slot>
            <span class="text">
                <span class="title-medium">${this.headline}</span>
                ${this.supportingText === '' ? nothing : html`<span class="supporting body-medium">${this.supportingText}</span>`}
            </span>
            <slot name="trailing"></slot>`;
        return this.interactive
            ? html`<button class="item interactive" part="item">${content}</button>`
            : html`<div class="item" part="item">${content}</div>`;
    }
}

export function defineHcmList(registry: CustomElementRegistry = customElements): void {
    defineOnce(registry, HCM_LIST_TAG, HcmList);
    defineOnce(registry, HCM_LIST_ITEM_TAG, HcmListItem);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-list': HcmList;
        'hcm-list-item': HcmListItem;
    }
}
