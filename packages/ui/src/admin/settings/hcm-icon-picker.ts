/**
 * `<hcm-icon-picker>`: the POI category's icon (`docs/research/M2c-interfaces.md` §8.5; behaviour A39), a radio group of
 * the bundled `POI_ICONS`, each named in the admin's language (`labels`). One Tab stop: the arrow keys, Home and End
 * move the choice (and the focus), as in a native radio group. An icon outside the bundle stays chosen and is explained:
 * the map draws it as the pin (S-A39-BAD-UNBUNDLED-ICON). Fires `hcm-change` `{value}`.
 */
import { POI_ICONS } from '@hcm/shared';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';

import { defineHcmIcon } from '../../components/icon.js';
import { defineOnce, emit } from '../../components/internal.js';
import { baseStyles, focusRing } from '../../components/styles.js';

export const HCM_ICON_PICKER_TAG = 'hcm-icon-picker';

const STEP: Readonly<Record<string, (index: number, count: number, columns: number) => number>> = {
    ArrowRight: (index, count) => (index + 1) % count,
    ArrowDown: (index, count, columns) => Math.min(index + columns, count - 1),
    ArrowLeft: (index, count) => (index - 1 + count) % count,
    ArrowUp: (index, _count, columns) => Math.max(index - columns, 0),
    Home: () => 0,
    End: (_index, count) => count - 1,
};

export class HcmIconPicker extends LitElement {
    static override readonly properties = {
        value: { type: String },
        label: { type: String },
        labels: { attribute: false },
        unbundledText: { type: String, attribute: 'unbundled-text' },
        disabled: { type: Boolean, reflect: true },
    };

    static override readonly styles = [
        baseStyles,
        focusRing,
        css`
            :host {
                display: block;
            }

            .grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, 48px);
                gap: 8px;
                padding: 4px;
            }

            [role='radio'] {
                display: grid;
                place-items: center;
                box-sizing: border-box;
                inline-size: 48px;
                block-size: 48px;
                padding: 0;
                border: 1px solid var(--md-sys-color-outline, CanvasText);
                border-radius: var(--md-sys-shape-corner-medium, 12px);
                background: transparent;
                color: var(--md-sys-color-on-surface, CanvasText);
                cursor: pointer;
            }

            [role='radio'][aria-checked='true'] {
                border-width: 2px;
                border-color: var(--md-sys-color-primary, Highlight);
                background: var(--md-sys-color-secondary-container, Highlight);
                color: var(--md-sys-color-on-secondary-container, HighlightText);
            }

            .note {
                margin: 8px 0 0;
                color: var(--md-sys-color-on-surface-variant, CanvasText);
            }
        `,
    ];

    declare value: string;
    declare label: string;
    /** Each icon's name in the admin's language. */
    declare labels: Readonly<Record<string, string>>;
    /** Shown while `value` is not bundled. */
    declare unbundledText: string;
    /** A revoked admin's read-only page (`DECISIONS-for-review.md` §42d): the icon shows, no other can be chosen. */
    declare disabled: boolean;

    constructor() {
        super();
        this.value = '';
        this.label = '';
        this.labels = {};
        this.unbundledText = '';
        this.disabled = false;
    }

    override render(): TemplateResult {
        const icons: readonly string[] = POI_ICONS;
        const chosen = icons.includes(this.value) ? this.value : null;
        return html`<div class="grid" role="radiogroup" aria-label=${this.label} @keydown=${this.#onKeyDown}>
                ${icons.map((icon, index) => this.#radio(icon, chosen === null ? index === 0 : icon === chosen))}
            </div>
            ${this.#unbundled(chosen)}`;
    }

    /** The note under the grid while the chosen icon is not one of the bundle's. */
    #unbundled(chosen: string | null): TemplateResult | typeof nothing {
        return chosen === null && this.value !== '' ? html`<p class="note" role="status">${this.unbundledText}</p>` : nothing;
    }

    #radio(icon: string, tabbable: boolean): TemplateResult {
        return html`<button
            type="button"
            role="radio"
            data-icon=${icon}
            aria-checked=${icon === this.value ? 'true' : 'false'}
            aria-label=${this.labels[icon] ?? icon}
            tabindex=${tabbable ? '0' : '-1'}
            ?disabled=${this.disabled}
            @click=${() => {
                this.#choose(icon);
            }}
        >
            <hcm-icon name=${icon}></hcm-icon>
        </button>`;
    }

    #choose(icon: string): void {
        if (icon !== this.value) {
            this.value = icon;
            emit(this, 'hcm-change', { value: icon });
        }
    }

    readonly #onKeyDown = (event: KeyboardEvent): void => {
        const step = STEP[event.key];
        const radios = [...this.renderRoot.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
        const index = radios.findIndex((radio) => radio === this.renderRoot.querySelector(':focus'));
        const next = step === undefined || index < 0 ? undefined : radios[step(index, radios.length, columnsOf(radios))];
        if (next !== undefined) {
            event.preventDefault();
            next.focus();
            this.#choose(String(next.dataset['icon']));
        }
    };
}

/** How many radios one row of the grid holds (the rows are told apart by their top edge). */
function columnsOf(radios: readonly HTMLElement[]): number {
    const rows = new Set(radios.map((radio) => radio.offsetTop)).size;
    return Math.max(1, Math.round(radios.length / Math.max(1, rows)));
}

export function defineHcmIconPicker(registry: CustomElementRegistry = customElements): void {
    defineHcmIcon(registry);
    defineOnce(registry, HCM_ICON_PICKER_TAG, HcmIconPicker);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-icon-picker': HcmIconPicker;
    }
}
