import { LitElement, css, html, nothing, type TemplateResult } from 'lit';

import { defineHcmIcon } from './icon.js';
import { defineOnce, emit } from './internal.js';
import { baseStyles, focusRing, stateLayer, touchTarget } from './styles.js';

export const HCM_ICON_BUTTON_TAG = 'hcm-icon-button';

export type IconButtonVariant = 'standard' | 'filled' | 'tonal' | 'outlined';

/**
 * An M3 icon button (40 px in a 48 px target). `label` is the accessible name and is required. With `toggle` it is a
 * toggle button (`aria-pressed`): a click flips `selected` (the icon fills, the shape squares off) and fires
 * `hcm-change` with `{selected}`. Fires the native `click` either way. `variant` gives map controls a container so
 * they stay visible on any map. `softDisabled` (`soft-disabled`) looks disabled and says so (`aria-disabled`) but keeps
 * the focus and its place in the Tab order: the map's zoom buttons at the end of the zoom range, where a disabled button
 * would drop the focus of a visitor pressing Enter. Its clicks still fire; the owner ignores them (the map's zoom
 * buttons drop their listener). It shows no hover or pressed layer and turns GrayText in forced colours. `expanded`, when
 * set, is its `aria-expanded`: a button that collapses what it heads.
 */
export class HcmIconButton extends LitElement {
    static override readonly shadowRootOptions: ShadowRootInit = { ...LitElement.shadowRootOptions, delegatesFocus: true };

    static override readonly properties = {
        icon: { type: String },
        label: { type: String },
        toggle: { type: Boolean },
        selected: { type: Boolean, reflect: true },
        disabled: { type: Boolean, reflect: true },
        softDisabled: { type: Boolean, reflect: true, attribute: 'soft-disabled' },
        expanded: { attribute: false },
        variant: { type: String, reflect: true },
    };

    static override readonly styles = [
        baseStyles,
        focusRing,
        stateLayer,
        touchTarget,
        css`
            :host {
                display: inline-flex;
                vertical-align: middle;
            }

            button {
                display: inline-grid;
                place-items: center;
                box-sizing: border-box;
                width: var(--hcm-control-size, 40px);
                height: var(--hcm-control-size, 40px);
                padding: 0;
                margin: 0;
                border: none;
                border-radius: var(--md-sys-shape-corner-full);
                background: none;
                color: var(--md-sys-color-on-surface-variant);
                overflow: visible;
                transition: border-radius var(--md-sys-motion-spring-fast-spatial-duration) var(--md-sys-motion-spring-fast-spatial-easing);
            }

            button:active,
            :host([selected]) button {
                border-radius: var(--md-sys-shape-corner-medium);
            }

            :host([selected]) button {
                color: var(--md-sys-color-primary);
            }

            :host([variant='filled']) button {
                background: var(--md-sys-color-primary);
                color: var(--md-sys-color-on-primary);
            }

            :host([variant='tonal']) button {
                background: var(--md-sys-color-secondary-container);
                color: var(--md-sys-color-on-secondary-container);
            }

            :host([variant='outlined']) button {
                border: 1px solid var(--md-sys-color-outline-variant);
            }

            :host([disabled]) button,
            :host([soft-disabled]) button {
                background: none;
                color: color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent);
                cursor: default;
            }

            /* What a native disabled button gets from the state layer: no hover or pressed layer. */
            :host([soft-disabled]) button::before {
                opacity: 0;
            }

            @media (forced-colors: active) {
                :host([selected]) button {
                    border: 2px solid Highlight;
                }

                /* Forced colours drop the color-mix dimming; GrayText is what the browser gives a disabled button. */
                :host([soft-disabled]) button {
                    color: GrayText;
                }
            }
        `,
    ];

    declare icon: string;
    declare label: string;
    declare toggle: boolean;
    declare selected: boolean;
    declare disabled: boolean;
    declare softDisabled: boolean;
    declare expanded: boolean | undefined;
    declare variant: IconButtonVariant;

    constructor() {
        super();
        this.icon = '';
        this.label = '';
        this.toggle = false;
        this.selected = false;
        this.disabled = false;
        this.softDisabled = false;
        this.variant = 'standard';
    }

    override render(): TemplateResult {
        return html`<button
            class="interactive touch-target"
            part="button"
            aria-label=${this.label}
            aria-pressed=${this.toggle ? String(this.selected) : nothing}
            aria-expanded=${this.expanded ?? nothing}
            ?disabled=${this.disabled}
            aria-disabled=${this.softDisabled ? 'true' : nothing}
            @click=${this.onClick}
        >
            <hcm-icon name=${this.icon} ?filled=${this.toggle && this.selected}></hcm-icon>
        </button>`;
    }

    private readonly onClick = (): void => {
        if (this.toggle && !this.softDisabled) {
            this.selected = !this.selected;
            emit(this, 'hcm-change', { selected: this.selected });
        }
    };
}

export function defineHcmIconButton(registry: CustomElementRegistry = customElements): void {
    defineHcmIcon(registry);
    defineOnce(registry, HCM_ICON_BUTTON_TAG, HcmIconButton);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-icon-button': HcmIconButton;
    }
}
