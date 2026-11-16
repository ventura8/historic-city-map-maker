import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';

import { cssProperties } from './css-properties.js';
import { clamp, defineOnce, emit, logicalKey, snapToStep } from './internal.js';
import { baseStyles, focusRing, touchTarget } from './styles.js';

export const HCM_SLIDER_TAG = 'hcm-slider';

/** Track geometry of the M3 Expressive slider: a 4 px handle with a 6 px gap on each side. */
const HANDLE_SPAN_PX = 16;

/**
 * How far a finger travels before the slider decides between a drag (sideways) and a scroll of the page or the panel
 * (upwards or downwards): the Pixel Tablet (2026-11-12) set 1977 to 4 % with a swipe meant to scroll the Layers panel.
 */
export const TOUCH_SLOP_PX = 8;

/** A finger's press that has not yet moved past `TOUCH_SLOP_PX`: where it began. */
interface PendingTouch {
    readonly pointerId: number;
    readonly x: number;
    readonly y: number;
}

/** What a finger's move from `start` means: nothing yet, a drag of the value, or a scroll the slider leaves to the browser. */
export function touchIntent(start: { readonly x: number; readonly y: number }, x: number, y: number): 'wait' | 'drag' | 'scroll' {
    const dx = Math.abs(x - start.x);
    const dy = Math.abs(y - start.y);
    if (Math.max(dx, dy) < TOUCH_SLOP_PX) {
        return 'wait';
    }
    return dx > dy ? 'drag' : 'scroll';
}

/**
 * An M3 Expressive slider (`role="slider"` on the handle). Keyboard: arrows ±`step`, PageUp/PageDown ±a tenth of the
 * range (at least one step), Home/End to the ends; mouse and pen: press or drag anywhere on the track; a finger: a tap
 * sets the value, a sideways drag past `TOUCH_SLOP_PX` moves it, and an upward or downward swipe scrolls the page or the
 * panel and leaves the value alone (`touch-action: pan-y`; a cancelled pointer ends the drag). While the value
 * moves it fires `hcm-input` with `{value}` (once per animation frame while dragging, once per key press), and
 * `hcm-change` with `{value}` when the pointer or the key is released and the value changed. `valueText` becomes
 * `aria-valuetext` ("80 %"), `label` the accessible name.
 */
export class HcmSlider extends LitElement {
    static override readonly properties = {
        min: { type: Number },
        max: { type: Number },
        step: { type: Number },
        value: { type: Number },
        label: { type: String },
        valueText: { type: String, attribute: 'value-text' },
        disabled: { type: Boolean, reflect: true },
    };

    static override readonly styles = [
        baseStyles,
        focusRing,
        // The 4 px handle is the keyboard and screen-reader target; its pointer target is 48 × 48 px (the track takes drags).
        touchTarget,
        css`
            :host {
                display: block;
                min-width: 120px;
            }

            .track {
                position: relative;
                height: 48px;
                cursor: pointer;

                /* A finger may scroll the page or the panel upwards or downwards across the slider; sideways is the slider's. */
                touch-action: pan-y;

                /* 16px: HANDLE_SPAN_PX, the handle and its two gaps. */
                --used: calc(var(--fraction) * (100% - 16px));
            }

            .active,
            .inactive {
                position: absolute;
                top: 16px;
                height: 16px;
            }

            .active {
                inset-inline-start: 0;
                width: var(--used);
                border-start-start-radius: var(--md-sys-shape-corner-full);
                border-end-start-radius: var(--md-sys-shape-corner-full);
                border-start-end-radius: 2px;
                border-end-end-radius: 2px;
                background: var(--md-sys-color-primary);
            }

            .inactive {
                inset-inline: calc(var(--used) + 16px) 0;
                border-start-start-radius: 2px;
                border-end-start-radius: 2px;
                border-start-end-radius: var(--md-sys-shape-corner-full);
                border-end-end-radius: var(--md-sys-shape-corner-full);
                background: var(--md-sys-color-secondary-container);
            }

            .stop {
                position: absolute;
                inset-inline-end: 6px;
                top: 6px;
                width: 4px;
                height: 4px;
                border-radius: var(--md-sys-shape-corner-full);
                background: var(--md-sys-color-on-secondary-container);
            }

            /*
             * The handle's box is 24 px wide (WCAG 2.5.8's minimum on its own, even where a neighbour or the Layers panel's
             * pinned strip cuts its 48 px touch target: the tour, 2026-11-16): a 4 px bar, its colour clipped to the content
             * box between 10 px of padding on either side.
             */
            .handle {
                position: absolute;
                top: 2px;
                inset-inline-start: calc(var(--used) - 4px);
                box-sizing: content-box;
                width: 4px;
                height: 44px;
                padding-inline: 10px;
                border-radius: var(--md-sys-shape-corner-full);
                background: var(--md-sys-color-primary);
                background-clip: content-box;
                outline-offset: 2px;
            }

            .handle:focus-visible {
                width: 2px;
                padding-inline: 11px;
            }

            :host([disabled]) .track {
                cursor: default;
                opacity: 0.38;
            }

            @media (forced-colors: active) {
                .active,
                .handle {
                    background: Highlight;
                }

                .inactive {
                    border: 1px solid ButtonText;
                }
            }
        `,
    ];

    declare min: number;
    declare max: number;
    declare step: number;
    declare value: number;
    declare label: string;
    declare valueText: string;
    declare disabled: boolean;

    /** The value at the last `hcm-change` (or the last value the app set): a release fires only when it differs. */
    private committed = 0;
    /** True from a press or key down until its release: the app's own updates then do not move `committed`. */
    private interacting = false;
    private frame = 0;
    /** A finger's press waiting to become a drag, a tap or a scroll (none for a mouse or a pen). */
    private pending: PendingTouch | null = null;

    constructor() {
        super();
        this.min = 0;
        this.max = 100;
        this.step = 1;
        this.value = 0;
        this.label = '';
        this.valueText = '';
        this.disabled = false;
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.stopDrag();
        cancelAnimationFrame(this.frame);
        this.frame = 0;
        this.interacting = false;
    }

    protected override willUpdate(changed: PropertyValues<this>): void {
        if (changed.has('value') && !this.interacting) {
            this.committed = this.value;
        }
    }

    override render(): TemplateResult {
        const value = clamp(this.value, this.min, this.max);
        const range = this.max - this.min;
        const fraction = range > 0 ? (value - this.min) / range : 0;
        return html`<div class="track" part="track" ${cssProperties({ '--fraction': String(fraction) })} @pointerdown=${this.onPointerDown}>
            <span class="active"></span>
            <span class="inactive"><span class="stop"></span></span>
            <span
                class="handle touch-target"
                part="handle"
                role="slider"
                tabindex=${this.disabled ? '-1' : '0'}
                aria-label=${this.label}
                aria-valuemin=${String(this.min)}
                aria-valuemax=${String(this.max)}
                aria-valuenow=${String(value)}
                aria-valuetext=${this.valueText === '' ? nothing : this.valueText}
                aria-disabled=${this.disabled ? 'true' : nothing}
                @keydown=${this.onKeyDown}
                @keyup=${this.onKeyUp}
            ></span>
        </div>`;
    }

    /** The value a key moves to, or null for a key the slider does not handle. */
    private keyTarget(key: string): number | null {
        const big = Math.max(this.step, (this.max - this.min) / 10);
        const deltas: Readonly<Record<string, number>> = {
            ArrowRight: this.step,
            ArrowUp: this.step,
            ArrowLeft: -this.step,
            ArrowDown: -this.step,
            PageUp: big,
            PageDown: -big,
            Home: this.min - this.value,
            End: this.max - this.value,
        };
        const delta = deltas[logicalKey(key, this)];
        return delta === undefined ? null : snapToStep(this.value + delta, this.min, this.max, this.step);
    }

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        const next = this.keyTarget(event.key);
        if (next === null || this.disabled) {
            return;
        }
        event.preventDefault();
        this.interacting = true;
        if (next !== this.value) {
            this.value = next;
            emit(this, 'hcm-input', { value: next });
        }
    };

    private readonly onKeyUp = (event: KeyboardEvent): void => {
        if (this.keyTarget(event.key) !== null) {
            this.commit();
        }
    };

    private readonly onPointerDown = (event: PointerEvent): void => {
        if (this.disabled || event.button !== 0) {
            return;
        }
        this.stopDrag();
        const doc = this.ownerDocument;
        doc.addEventListener('pointermove', this.onPointerMove);
        doc.addEventListener('pointerup', this.onPointerUp);
        doc.addEventListener('pointercancel', this.onPointerCancel);
        if (event.pointerType === 'touch') {
            // No preventDefault: the browser may still scroll; the value waits for the finger's direction.
            this.pending = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
            return;
        }
        event.preventDefault();
        this.startDrag(event.clientX);
    };

    private startDrag(clientX: number): void {
        this.pending = null;
        this.focus();
        this.interacting = true;
        this.moveTo(clientX);
    }

    private readonly onPointerMove = (event: PointerEvent): void => {
        if (this.pending === null) {
            this.moveTo(event.clientX);
            return;
        }
        const intent = touchIntent(this.pending, event.clientX, event.clientY);
        if (intent === 'drag') {
            this.startDrag(event.clientX);
        } else if (intent === 'scroll') {
            this.stopDrag();
        }
    };

    /** A release ends a drag; a finger lifted before it moved is a tap, which sets the value where it began. */
    private readonly onPointerUp = (): void => {
        const tap = this.pending;
        if (tap !== null) {
            this.startDrag(tap.x);
        }
        this.endDrag();
    };

    /** The browser took the pointer (a scroll began, the window lost it): a drag ends where it is, a waiting press is no tap. */
    private readonly onPointerCancel = (): void => {
        if (this.pending === null) {
            this.endDrag();
        } else {
            this.stopDrag();
        }
    };

    private endDrag(): void {
        this.stopDrag();
        this.flushInput();
        this.commit();
    }

    private stopDrag(): void {
        this.pending = null;
        const doc = this.ownerDocument;
        doc.removeEventListener('pointermove', this.onPointerMove);
        doc.removeEventListener('pointerup', this.onPointerUp);
        doc.removeEventListener('pointercancel', this.onPointerCancel);
    }

    /** Moves the keyboard focus to the handle (the slider's only focusable part). */
    override focus(options?: FocusOptions): void {
        this.renderRoot.querySelector<HTMLElement>('.handle')?.focus(options);
    }

    private moveTo(clientX: number): void {
        const rect = this.renderRoot.querySelector('.track')?.getBoundingClientRect() ?? new DOMRect();
        // Right to left the track fills from the right: the handle's place mirrors.
        const along = fractionAt(clientX, rect);
        const fraction = this.matches(':dir(rtl)') ? 1 - along : along;
        const next = snapToStep(this.min + fraction * (this.max - this.min), this.min, this.max, this.step);
        if (next !== this.value) {
            this.value = next;
            this.scheduleInput();
        }
    }

    /** Coalesces drag updates: one `hcm-input` per animation frame, with the latest value. */
    private scheduleInput(): void {
        if (this.frame === 0) {
            this.frame = requestAnimationFrame(() => {
                this.frame = 0;
                emit(this, 'hcm-input', { value: this.value });
            });
        }
    }

    private flushInput(): void {
        if (this.frame !== 0) {
            cancelAnimationFrame(this.frame);
            this.frame = 0;
            emit(this, 'hcm-input', { value: this.value });
        }
    }

    private commit(): void {
        this.interacting = false;
        if (this.value !== this.committed) {
            this.committed = this.value;
            emit(this, 'hcm-change', { value: this.value });
        }
    }
}

/** The position of `clientX` along a track of `rect`, 0..1 (the handle's centre travels the width minus its span). */
export function fractionAt(clientX: number, rect: DOMRect): number {
    const usable = rect.width - HANDLE_SPAN_PX;
    return usable > 0 ? clamp((clientX - rect.left - HANDLE_SPAN_PX / 2) / usable, 0, 1) : 0;
}

export function defineHcmSlider(registry: CustomElementRegistry = customElements): void {
    defineOnce(registry, HCM_SLIDER_TAG, HcmSlider);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-slider': HcmSlider;
    }
}
