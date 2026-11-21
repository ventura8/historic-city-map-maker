import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { defineHcmIcon } from './icon.js';
import { defineOnce, emit, logicalKey } from './internal.js';
import { baseStyles, focusRing, stateLayer, touchTarget, typeStyles } from './styles.js';

export const HCM_SEGMENTED_BUTTON_TAG = 'hcm-segmented-button';

export interface SegmentOption {
    readonly value: string;
    /** Already localized. */
    readonly label: string;
    readonly icon?: string;
    /** The label's own language, when it is not the page's (a language list's names: WCAG 3.1.2). */
    readonly lang?: string;
}

const NEXT_KEYS: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * What the segments draw, as one string: a parent that builds its options in `render` hands over a new array with the
 * same segments on every update, which must not undo the stacking (docs/LESSONS.md 295).
 */
function segmentsOf(options: readonly SegmentOption[] | undefined): string {
    return (options ?? []).map((option) => [option.value, option.label, option.icon ?? ''].join('\u0000')).join('\u0001');
}

/**
 * An M3 single-select segmented button, with radio-group semantics: one Tab stop on the selected segment, arrow keys
 * (wrapping), Home and End move and select, a click selects. Every selection fires `hcm-change` with `{value}`; the
 * selected segment shows a check mark. `label` names the group. When the segments do not fit side by side even with
 * their labels wrapped (single words, a narrow dialog, WCAG 1.4.12's text spacing), the group stacks them one per row
 * (`stacked`, set on the next frame after a resize) until its host is again as wide as they need: a row that ran past a
 * dialog's edge made the dialog scroll sideways (the visual audit of 2026-10-17, 360 px).
 */
export class HcmSegmentedButton extends LitElement {
    static override readonly properties = {
        options: { attribute: false },
        value: { type: String },
        label: { type: String },
        stacked: { type: Boolean, reflect: true },
    };

    static override readonly styles = [
        baseStyles,
        focusRing,
        stateLayer,
        touchTarget,
        typeStyles,
        css`
            /*
             * Each segment is as wide as its label (flex-basis auto: an equal-share basis of 0 wrapped the longest
             * Romanian label even on a wide screen) and never wider than its container: in a narrow one the segments
             * shrink to their longest word and a long label wraps inside a taller segment instead of scrolling the
             * page sideways (min-width: min-content keeps a label from spilling into its neighbour).
             */
            :host {
                display: inline-flex;
                max-inline-size: 100%;
            }

            .group {
                display: inline-flex;
                max-inline-size: 100%;
            }

            button {
                display: inline-flex;
                flex: 1 1 auto;
                gap: 8px;
                align-items: center;
                justify-content: center;
                box-sizing: border-box;
                min-width: min-content;
                min-height: var(--hcm-control-size, 40px);
                padding-inline: 12px;
                padding-block: 0;
                text-align: center;
                margin: 0;
                margin-inline-start: -1px;
                border: 1px solid var(--md-sys-color-outline);
                background: none;
                color: var(--md-sys-color-on-surface);
                overflow: visible;

                --hcm-icon-size: 18px;
            }

            /*
             * M3: a segment is at least 48 px wide (12 + 24 + 12), so the touch target never reaches past the group: a
             * two-letter label ("Nu") made a 46 px segment whose 48 px ring stuck out of a narrow container.
             */
            button > span {
                min-inline-size: 24px;
            }

            button:first-child {
                margin-inline-start: 0;
                border-start-start-radius: var(--md-sys-shape-corner-full);
                border-end-start-radius: var(--md-sys-shape-corner-full);
            }

            button:last-child {
                border-start-end-radius: var(--md-sys-shape-corner-full);
                border-end-end-radius: var(--md-sys-shape-corner-full);
            }

            button[aria-checked='true'] {
                background: var(--md-sys-color-secondary-container);
                color: var(--md-sys-color-on-secondary-container);
            }

            /* One segment per row: the host takes the whole line, so its width says when they fit side by side again. */
            :host([stacked]) {
                display: flex;
            }

            :host([stacked]) .group {
                flex-direction: column;
                inline-size: 100%;
            }

            /*
             * Rows touch, so each row is its own 48 px target: a 40 px row's ring lay under the row after it. A row after
             * the first draws no top border (the row above draws it), rather than overlapping it by 1 px: a row scrolled to
             * a strip under the dialog's header had its last pixel covered by the next one (25 languages, 360 px).
             */
            :host([stacked]) button {
                min-height: 48px;
                margin: 0;
                border-block-start-width: 0;
                border-radius: 0;
            }

            :host([stacked]) button:first-child {
                border-block-start-width: 1px;
                border-start-start-radius: var(--md-sys-shape-corner-large);
                border-start-end-radius: var(--md-sys-shape-corner-large);
            }

            :host([stacked]) button:last-child {
                border-end-start-radius: var(--md-sys-shape-corner-large);
                border-end-end-radius: var(--md-sys-shape-corner-large);
            }

            @media (forced-colors: active) {
                button[aria-checked='true'] {
                    outline: 2px solid Highlight;
                    outline-offset: -3px;
                }
            }
        `,
    ];

    declare options: readonly SegmentOption[];
    declare value: string;
    declare label: string;
    declare stacked: boolean;

    /** The width the segments need side by side, measured when they last overflowed. */
    private needed = 0;
    private frame = 0;
    private readonly resizes = new ResizeObserver(() => {
        this.scheduleArrange();
    });

    constructor() {
        super();
        this.options = [];
        this.value = '';
        this.label = '';
        this.stacked = false;
    }

    override connectedCallback(): void {
        super.connectedCallback();
        this.resizes.observe(this);
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.resizes.disconnect();
        cancelAnimationFrame(this.frame);
        this.frame = 0;
    }

    protected override updated(changed: PropertyValues<this>): void {
        // The segments too: capped at its container, the host keeps its size while a wider text (WCAG 1.4.12's spacing)
        // makes them overflow it.
        for (const segment of Array.from(this.renderRoot.querySelectorAll('button'))) {
            this.resizes.observe(segment);
        }
        if (changed.has('options') && segmentsOf(changed.get('options')) !== segmentsOf(this.options)) {
            // New labels: measure them side by side again (the same labels in a new array keep the arrangement).
            this.stacked = false;
            this.scheduleArrange();
        }
    }

    /** Arranges the segments on the next frame: changing the layout inside the ResizeObserver's callback would resize what it observes. */
    private scheduleArrange(): void {
        if (this.frame === 0) {
            this.frame = requestAnimationFrame(() => {
                this.frame = 0;
                this.arrange();
            });
        }
    }

    /** Stacks the segments while they overflow the host, and puts them side by side once the host is wide enough. */
    private arrange(): void {
        if (!this.stacked && this.scrollWidth > this.clientWidth + 1) {
            this.needed = this.scrollWidth;
            this.stacked = true;
        } else if (this.stacked && this.clientWidth >= this.needed) {
            this.stacked = false;
        }
    }

    override render(): TemplateResult {
        const tabStop = this.options.some((option) => option.value === this.value) ? this.value : this.options[0]?.value;
        return html`<div class="group" role="radiogroup" aria-label=${this.label} @keydown=${this.onKeyDown}>
            ${this.options.map((option) => this.renderOption(option, option.value === tabStop))}
        </div>`;
    }

    private renderOption(option: SegmentOption, tabStop: boolean): TemplateResult {
        const checked = option.value === this.value;
        const icon = checked ? 'check' : (option.icon ?? '');
        return html`<button
            class="interactive touch-target label-large"
            role="radio"
            aria-checked=${String(checked)}
            tabindex=${tabStop ? '0' : '-1'}
            data-value=${option.value}
            lang=${ifDefined(option.lang)}
            @click=${() => {
                this.select(option.value);
            }}
        >
            ${icon === '' ? nothing : html`<hcm-icon name=${icon}></hcm-icon>`}<span>${option.label}</span>
        </button>`;
    }

    private select(value: string): void {
        if (value !== this.value) {
            this.value = value;
            emit(this, 'hcm-change', { value });
        }
    }

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        const index = this.options.findIndex((option) => option.value === this.value);
        const target = this.options[this.keyIndex(event.key, index)];
        if (target === undefined) {
            return;
        }
        event.preventDefault();
        this.select(target.value);
        void this.updateComplete.then(() => {
            this.renderRoot.querySelector<HTMLElement>(`[aria-checked='true']`)?.focus();
        });
    };

    /** The option index a key moves to (wrapping), or -1 for a key the group does not handle. */
    private keyIndex(key: string, index: number): number {
        const count = this.options.length;
        const step = NEXT_KEYS[logicalKey(key, this)];
        if (step !== undefined) {
            return (Math.max(index, 0) + step + count) % count;
        }
        const ends: Readonly<Record<string, number>> = { Home: 0, End: count - 1 };
        return ends[key] ?? -1;
    }
}

export function defineHcmSegmentedButton(registry: CustomElementRegistry = customElements): void {
    defineHcmIcon(registry);
    defineOnce(registry, HCM_SEGMENTED_BUTTON_TAG, HcmSegmentedButton);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-segmented-button': HcmSegmentedButton;
    }
}
