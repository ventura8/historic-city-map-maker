/**
 * `<hcm-direction-dial>`: the layer editor's compass dial for a satellite or aerial image's shot direction (V93, the owner
 * 2026-11-23). A round dial with the four cardinal points and a needle at the direction; a drag (mouse, pen or finger)
 * points the needle where the pointer is, the arrow keys turn it a degree (fifteen with Shift), Home points it north. It is an
 * ARIA slider (0–359°) named by `label`; empty (`value` null) it shows no needle and says so. Each turn fires `hcm-input`
 * with `{ value }`; the end of a drag, and every key, fires `hcm-change` too.
 */
import { LitElement, css, html, svg, type SVGTemplateResult, type TemplateResult } from 'lit';

import { defineOnce, emit } from '../../components/internal.js';
import { focusRing } from '../../components/styles.js';
import { wholeBearing } from './bearing.js';

const HCM_DIRECTION_DIAL_TAG = 'hcm-direction-dial';

/** The bearing of the point (`x`, `y`) seen from the dial's centre (`cx`, `cy`): 0 up (north), clockwise. */
export function bearingAt(x: number, y: number, cx: number, cy: number): number {
    return wholeBearing((Math.atan2(x - cx, cy - y) * 180) / Math.PI);
}

const STEPS: Readonly<Record<string, (value: number, wide: boolean) => number>> = {
    ArrowRight: (value, wide) => value + (wide ? 15 : 1),
    ArrowUp: (value, wide) => value + (wide ? 15 : 1),
    ArrowLeft: (value, wide) => value - (wide ? 15 : 1),
    ArrowDown: (value, wide) => value - (wide ? 15 : 1),
    Home: () => 0,
};

const CARDINALS = [
    ['N', 50, 14],
    ['E', 87, 51],
    ['S', 50, 88],
    ['W', 13, 51],
] as const;

/** The needle at `value`, or none. */
function needle(value: number | null): SVGTemplateResult {
    return value === null ? svg`` : svg`<line class="needle" x1="50" y1="50" x2="50" y2="20" transform="rotate(${value} 50 50)" />`;
}

export class HcmDirectionDial extends LitElement {
    static override readonly properties = {
        value: { type: Number },
        label: { type: String },
        disabled: { type: Boolean, reflect: true },
        empty: { type: String },
    };

    static override readonly styles = [
        focusRing,
        css`
            :host {
                display: inline-block;
                inline-size: 144px;
                block-size: 144px;
                touch-action: none;
            }

            /*
             * The ring is the svg's own border in outline (WCAG 1.4.11: 3:1 against the page in light and dark), not a stroke of
             * an svg circle: the tour's non-text contrast reads a control's borders and backgrounds, and found the stroked ring at
             * 1.00:1 (2026-11-24, docs/LESSONS.md).
             */
            .dial {
                display: block;
                box-sizing: border-box;
                inline-size: 100%;
                block-size: 100%;
                border: 2px solid var(--md-sys-color-outline);
                border-radius: 50%;
                background-color: var(--md-sys-color-surface-container-high);
                cursor: grab;
                outline-offset: 2px;
            }

            :host([disabled]) .dial {
                cursor: default;
                opacity: 0.6;
            }

            .tick {
                stroke: var(--md-sys-color-outline);
                stroke-width: 1.5;
            }

            .cardinal {
                fill: var(--md-sys-color-on-surface);
                font: 600 11px/1 var(--md-ref-typeface-plain, system-ui, sans-serif);
                text-anchor: middle;
                dominant-baseline: central;
            }

            .needle {
                stroke: var(--md-sys-color-primary);
                stroke-width: 4;
                stroke-linecap: round;
            }

            .hub {
                fill: var(--md-sys-color-primary);
            }
        `,
    ];

    /** Degrees clockwise from north, or null for none. */
    declare value: number | null;
    /** The slider's name. */
    declare label: string;
    declare disabled: boolean;
    /** What the slider says with no value. */
    declare empty: string;

    #dragging = false;

    constructor() {
        super();
        this.value = null;
        this.label = '';
        this.disabled = false;
        this.empty = '';
    }

    #turn(value: number, settled: boolean): void {
        this.value = wholeBearing(value);
        emit(this, 'hcm-input', { value: this.value });
        if (settled) {
            emit(this, 'hcm-change', { value: this.value });
        }
    }

    #pointAt(event: PointerEvent): void {
        const box = (event.currentTarget as Element).getBoundingClientRect();
        this.#turn(bearingAt(event.clientX, event.clientY, box.left + box.width / 2, box.top + box.height / 2), false);
    }

    readonly #down = (event: PointerEvent): void => {
        if (this.disabled) {
            return;
        }
        this.#dragging = true;
        // The dial keeps the drag while the pointer leaves it (only a live pointer can be captured: a mouse, a pen, a finger).
        if (event.isPrimary) {
            (event.currentTarget as Element).setPointerCapture(event.pointerId);
        }
        this.#pointAt(event);
    };

    readonly #move = (event: PointerEvent): void => {
        if (this.#dragging) {
            this.#pointAt(event);
        }
    };

    readonly #up = (): void => {
        if (this.#dragging && this.value !== null) {
            emit(this, 'hcm-change', { value: this.value });
        }
        this.#dragging = false;
    };

    readonly #key = (event: KeyboardEvent): void => {
        const step = STEPS[event.key];
        if (this.disabled || step === undefined) {
            return;
        }
        event.preventDefault();
        this.#turn(step(this.value ?? 0, event.shiftKey), true);
    };

    override render(): TemplateResult {
        const value = this.value;
        const valueText = value === null ? this.empty : `${String(value)}°`;
        return html`<svg
            class="dial interactive"
            viewBox="0 0 100 100"
            role="slider"
            tabindex=${this.disabled ? -1 : 0}
            aria-label=${this.label}
            aria-valuemin="0"
            aria-valuemax="359"
            aria-valuenow=${value ?? 0}
            aria-valuetext=${valueText}
            aria-disabled=${String(this.disabled)}
            @pointerdown=${this.#down}
            @pointermove=${this.#move}
            @pointerup=${this.#up}
            @pointercancel=${this.#up}
            @keydown=${this.#key}
        >
            ${[0, 90, 180, 270].map((angle) => svg`<line class="tick" x1="50" y1="4" x2="50" y2="9" transform="rotate(${angle} 50 50)" />`)}
            ${CARDINALS.map(([letter, x, y]) => svg`<text class="cardinal" x=${x} y=${y} aria-hidden="true">${letter}</text>`)}
            ${needle(value)}
            <circle class="hub" cx="50" cy="50" r="4"></circle>
        </svg>`;
    }
}

export function defineHcmDirectionDial(registry: CustomElementRegistry = customElements): void {
    defineOnce(registry, HCM_DIRECTION_DIAL_TAG, HcmDirectionDial);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-direction-dial': HcmDirectionDial;
    }
}
