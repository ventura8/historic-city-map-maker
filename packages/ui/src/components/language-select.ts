import { LitElement, css, html, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { live } from 'lit/directives/live.js';

import { defineOnce, emit } from './internal.js';
import type { SegmentOption } from './segmented-button.js';
import { baseStyles, focusRing } from './styles.js';

export const HCM_LANGUAGE_SELECT_TAG = 'hcm-language-select';

/**
 * A language picker as one dropdown (the owner, 2026-11-14: twenty-five languages are a dropdown, not a long list): a
 * native `<select>`, so the keyboard, a screen reader and a phone's own picker all work as the platform does them. Each
 * option is a language by its own name, in its own `lang` (WCAG 3.1.2); `label` names the list. A choice fires
 * `hcm-change` with `{value}` at once, as the segmented button does, and the host may put `value` back (a language whose
 * texts cannot be fetched leaves the page as it was). The control is at least 48 px tall.
 */
export class HcmLanguageSelect extends LitElement {
    static override readonly properties = {
        options: { attribute: false },
        value: { type: String },
        label: { type: String },
    };

    static override readonly styles = [
        baseStyles,
        focusRing,
        css`
            :host {
                display: inline-flex;
                max-inline-size: 100%;
            }

            select {
                box-sizing: border-box;
                min-block-size: 48px;
                min-inline-size: 12rem;
                max-inline-size: 100%;
                padding-inline: 16px;
                border: 1px solid var(--md-sys-color-outline);
                border-radius: var(--md-sys-shape-corner-small);
                background: var(--md-sys-color-surface-container-highest);
                color: var(--md-sys-color-on-surface);
                font-family: inherit;
                font-size: var(--md-sys-typescale-body-large-size);
                line-height: var(--md-sys-typescale-body-large-line-height);
                cursor: pointer;
            }

            option {
                background: var(--md-sys-color-surface-container-highest);
                color: var(--md-sys-color-on-surface);
            }
        `,
    ];

    declare options: readonly SegmentOption[];
    declare value: string;
    declare label: string;

    constructor() {
        super();
        this.options = [];
        this.value = '';
        this.label = '';
    }

    override render(): TemplateResult {
        const name = this.label === '' ? undefined : this.label;
        return html`<select aria-label=${ifDefined(name)} .value=${live(this.value)} @change=${this.#onChange}>
            ${this.options.map(
                (option) =>
                    html`<option value=${option.value} lang=${ifDefined(option.lang)} ?selected=${option.value === this.value}>
                        ${option.label}
                    </option>`,
            )}
        </select>`;
    }

    readonly #onChange = (event: Event): void => {
        this.value = (event.currentTarget as HTMLSelectElement).value;
        emit(this, 'hcm-change', { value: this.value });
    };
}

export function defineHcmLanguageSelect(registry: CustomElementRegistry = customElements): void {
    defineOnce(registry, HCM_LANGUAGE_SELECT_TAG, HcmLanguageSelect);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-language-select': HcmLanguageSelect;
    }
}
