import { LitElement, css, html, type TemplateResult } from 'lit';

import { defineOnce, logicalKey } from './internal.js';
import { baseStyles } from './styles.js';

export const HCM_TOOLBAR_TAG = 'hcm-toolbar';

export type ToolbarOrientation = 'horizontal' | 'vertical';

/** Keys that move the focus, per orientation: +1 next, -1 previous. */
const MOVE_KEYS: Readonly<Record<ToolbarOrientation, Readonly<Record<string, number>>>> = {
    horizontal: { ArrowRight: 1, ArrowLeft: -1 },
    vertical: { ArrowDown: 1, ArrowUp: -1 },
};

/**
 * The M3 Expressive floating toolbar (`role="toolbar"`, named by `label`): a 64 px pill on elevation 3 holding the
 * slotted controls (icon buttons, a slider, the timeline). One Tab stop; the arrow keys of its `orientation`, Home
 * and End move the focus between the controls (WAI-ARIA toolbar pattern). `vertical` is the compact-height layout.
 */
export class HcmToolbar extends LitElement {
    static override readonly properties = {
        label: { type: String },
        orientation: { type: String, reflect: true },
        vibrant: { type: Boolean, reflect: true },
    };

    static override readonly styles = [
        baseStyles,
        css`
            :host {
                display: inline-flex;
            }

            .toolbar {
                display: flex;
                gap: 4px;
                align-items: center;
                box-sizing: border-box;
                min-height: 64px;
                padding-inline: 8px;
                border-radius: var(--md-sys-shape-corner-full);
                background: var(--md-sys-color-surface-container);
                color: var(--md-sys-color-on-surface);
                box-shadow: var(--md-sys-elevation-level3);
            }

            :host([vibrant]) .toolbar {
                background: var(--md-sys-color-primary-container);
                color: var(--md-sys-color-on-primary-container);

                --md-sys-color-on-surface-variant: var(--md-sys-color-on-primary-container);
            }

            :host([orientation='vertical']) .toolbar {
                flex-direction: column;
                width: 64px;
                min-height: 0;
                padding-block: 8px;
                padding-inline: 0;
            }

            @media (forced-colors: active) {
                .toolbar {
                    border: 1px solid CanvasText;
                }
            }
        `,
    ];

    declare label: string;
    declare orientation: ToolbarOrientation;
    declare vibrant: boolean;

    private active = 0;

    constructor() {
        super();
        this.label = '';
        this.orientation = 'horizontal';
        this.vibrant = false;
    }

    override render(): TemplateResult {
        return html`<div
            class="toolbar"
            part="toolbar"
            role="toolbar"
            aria-label=${this.label}
            aria-orientation=${this.orientation}
            @keydown=${this.onKeyDown}
            @focusin=${this.onFocusIn}
        >
            <slot @slotchange=${this.onSlotChange}></slot>
        </div>`;
    }

    /** The slotted controls that can take focus, in order. */
    items(): HTMLElement[] {
        const slot = this.renderRoot.querySelector('slot');
        return (slot?.assignedElements({ flatten: true }) ?? []).filter(
            (element): element is HTMLElement => element instanceof HTMLElement && !element.hasAttribute('disabled'),
        );
    }

    /** One Tab stop: the active control has tabindex 0, the others -1 (which also hides their shadow trees from Tab). */
    private syncTabStops(): void {
        const items = this.items();
        this.active = Math.min(this.active, Math.max(0, items.length - 1));
        items.forEach((item, index) => {
            item.tabIndex = index === this.active ? 0 : -1;
        });
    }

    private readonly onSlotChange = (): void => {
        this.syncTabStops();
    };

    private readonly onFocusIn = (event: FocusEvent): void => {
        const index = this.items().findIndex((item) => event.composedPath().includes(item));
        if (index >= 0 && index !== this.active) {
            this.active = index;
            this.syncTabStops();
        }
    };

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        const items = this.items();
        const target = this.keyIndex(event.key, items.length);
        if (target === null) {
            return;
        }
        event.preventDefault();
        this.active = target;
        this.syncTabStops();
        items[target]?.focus();
    };

    private keyIndex(key: string, count: number): number | null {
        if (count === 0) {
            return null;
        }
        const step = MOVE_KEYS[this.orientation][logicalKey(key, this)];
        if (step !== undefined) {
            return (this.active + step + count) % count;
        }
        const ends: Readonly<Record<string, number>> = { Home: 0, End: count - 1 };
        return ends[key] ?? null;
    }
}

export function defineHcmToolbar(registry: CustomElementRegistry = customElements): void {
    defineOnce(registry, HCM_TOOLBAR_TAG, HcmToolbar);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-toolbar': HcmToolbar;
    }
}
