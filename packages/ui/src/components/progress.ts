import { LitElement, css, html, nothing, type TemplateResult } from 'lit';

import { cssProperties } from './css-properties.js';
import { clamp, defineOnce } from './internal.js';
import { baseStyles } from './styles.js';

export const HCM_PROGRESS_TAG = 'hcm-progress';

export type ProgressKind = 'circular' | 'linear';

/** Circle geometry of the circular indicator (a 48 px box, 4 px stroke). */
const RADIUS = 20;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * An M3 progress indicator (`role="progressbar"`, named by `label`): `linear` (a track with a 4 px gap and a stop
 * dot) or `circular`. Determinate with `value` 0..1 (`aria-valuenow` in percent), or `indeterminate` (no value; the
 * animation slows to a pulse under reduced motion).
 */
export class HcmProgress extends LitElement {
    static override readonly properties = {
        kind: { type: String, reflect: true },
        value: { type: Number },
        indeterminate: { type: Boolean, reflect: true },
        label: { type: String },
    };

    static override readonly styles = [
        baseStyles,
        css`
            :host {
                display: block;
            }

            :host([kind='circular']) {
                display: inline-block;
                width: 48px;
                height: 48px;
            }

            .linear {
                position: relative;
                height: 4px;
                overflow: hidden;
            }

            .indicator,
            .track {
                position: absolute;
                top: 0;
                height: 4px;
                border-radius: var(--md-sys-shape-corner-full);
            }

            .indicator {
                inset-inline-start: 0;
                width: calc(var(--progress) * 100%);
                background: var(--md-sys-color-primary);
                transition: width var(--md-sys-motion-spring-default-effects-duration) var(--md-sys-motion-spring-default-effects-easing);
            }

            .track {
                inset-inline: calc(var(--progress) * 100% + 4px) 0;
                background: var(--md-sys-color-secondary-container);
            }

            .stop {
                position: absolute;
                top: 0;
                inset-inline-end: 0;
                width: 4px;
                height: 4px;
                border-radius: var(--md-sys-shape-corner-full);
                background: var(--md-sys-color-primary);
            }

            :host([indeterminate]) .indicator {
                width: 40%;
                animation: slide 1.6s var(--md-sys-motion-easing-standard) infinite;
            }

            /* Right to left (Arabic, Persian, Urdu) the bar starts at the right edge (inline start) and runs leftwards. */
            :host([indeterminate]:dir(rtl)) .indicator {
                animation-name: slide-rtl;
            }

            :host([indeterminate]) .track,
            :host([indeterminate]) .stop {
                display: none;
            }

            svg {
                width: 100%;
                height: 100%;
                transform: rotate(-90deg);
            }

            circle {
                fill: none;
                stroke-width: 4px;
                stroke-linecap: round;
            }

            .ring-track {
                stroke: var(--md-sys-color-secondary-container);
            }

            .ring {
                stroke: var(--md-sys-color-primary);
                transition: stroke-dashoffset var(--md-sys-motion-spring-default-effects-duration)
                    var(--md-sys-motion-spring-default-effects-easing);
            }

            :host([indeterminate]) svg {
                animation: spin 1.4s linear infinite;
            }

            @keyframes slide {
                from {
                    transform: translateX(-100%);
                }

                to {
                    transform: translateX(250%);
                }
            }

            @keyframes slide-rtl {
                from {
                    transform: translateX(100%);
                }

                to {
                    transform: translateX(-250%);
                }
            }

            @keyframes spin {
                from {
                    transform: rotate(0deg);
                }

                to {
                    transform: rotate(360deg);
                }
            }

            @keyframes pulse {
                50% {
                    opacity: 0.4;
                }
            }

            @media (prefers-reduced-motion: reduce) {
                :host([indeterminate]) .indicator,
                :host([indeterminate]) svg {
                    animation: pulse 2s linear infinite;
                }
            }

            @media (forced-colors: active) {
                .indicator,
                .stop {
                    background: Highlight;
                }

                .ring {
                    stroke: Highlight;
                }
            }
        `,
    ];

    declare kind: ProgressKind;
    declare value: number;
    declare indeterminate: boolean;
    declare label: string;

    constructor() {
        super();
        this.kind = 'linear';
        this.value = 0;
        this.indeterminate = false;
        this.label = '';
    }

    override render(): TemplateResult {
        const progress = clamp(this.value, 0, 1);
        return html`<div
            class="root"
            part="progress"
            role="progressbar"
            aria-label=${this.label}
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow=${this.indeterminate ? nothing : String(Math.round(progress * 100))}
        >
            ${this.kind === 'circular' ? this.renderCircular(progress) : this.renderLinear(progress)}
        </div>`;
    }

    private renderLinear(progress: number): TemplateResult {
        return html`<div class="linear" ${cssProperties({ '--progress': String(progress) })}>
            <span class="indicator"></span><span class="track"></span><span class="stop"></span>
        </div>`;
    }

    private renderCircular(progress: number): TemplateResult {
        const offset = this.indeterminate ? CIRCUMFERENCE * 0.7 : CIRCUMFERENCE * (1 - progress);
        return html`<svg viewBox="0 0 48 48" aria-hidden="true">
            <circle class="ring-track" cx="24" cy="24" r=${RADIUS}></circle>
            <circle class="ring" cx="24" cy="24" r=${RADIUS} stroke-dasharray=${CIRCUMFERENCE} stroke-dashoffset=${offset}></circle>
        </svg>`;
    }
}

export function defineHcmProgress(registry: CustomElementRegistry = customElements): void {
    defineOnce(registry, HCM_PROGRESS_TAG, HcmProgress);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-progress': HcmProgress;
    }
}
