import { LitElement, css, html, type TemplateResult } from 'lit';

import { defineOnce } from './internal.js';
import { baseStyles } from './styles.js';

export const HCM_LOADING_INDICATOR_TAG = 'hcm-loading-indicator';

/**
 * The M3 Expressive loading indicator: a 38 px shape that morphs and turns inside a 48 px box, for waits shorter than
 * a few seconds (the viewer's boot). Web has no official shape morph yet, so the morph is drawn with animated corner
 * radii; under reduced motion it only pulses. `contained` puts it on a primary-container disc (over the map).
 * `role="progressbar"` without a value, named by `label`.
 */
export class HcmLoadingIndicator extends LitElement {
    static override readonly properties = {
        label: { type: String },
        contained: { type: Boolean, reflect: true },
    };

    static override readonly styles = [
        baseStyles,
        css`
            :host {
                display: inline-grid;
                place-items: center;
                width: 48px;
                height: 48px;
                border-radius: var(--md-sys-shape-corner-full);
            }

            :host([contained]) {
                background: var(--md-sys-color-primary-container);
            }

            .shape {
                width: 38px;
                height: 38px;
                background: var(--md-sys-color-primary);
                animation: morph 2.4s var(--md-sys-motion-spring-default-spatial-easing) infinite;
            }

            :host([contained]) .shape {
                width: 32px;
                height: 32px;
                background: var(--md-sys-color-on-primary-container);
            }

            @keyframes morph {
                0% {
                    border-radius: 50%;
                    transform: rotate(0deg) scale(0.9);
                }

                25% {
                    border-radius: 30% 70% 70% 30% / 30% 30% 70% 70%;
                    transform: rotate(90deg) scale(1);
                }

                50% {
                    border-radius: 22%;
                    transform: rotate(180deg) scale(0.85);
                }

                75% {
                    border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%;
                    transform: rotate(270deg) scale(1);
                }

                100% {
                    border-radius: 50%;
                    transform: rotate(360deg) scale(0.9);
                }
            }

            @keyframes pulse {
                50% {
                    opacity: 0.4;
                }
            }

            @media (prefers-reduced-motion: reduce) {
                .shape {
                    border-radius: 50%;
                    animation: pulse 2s linear infinite;
                }
            }

            @media (forced-colors: active) {
                .shape {
                    background: Highlight;
                }
            }
        `,
    ];

    declare label: string;
    declare contained: boolean;

    constructor() {
        super();
        this.label = '';
        this.contained = false;
    }

    override render(): TemplateResult {
        return html`<div class="shape" part="indicator" role="progressbar" aria-label=${this.label}></div>`;
    }
}

export function defineHcmLoadingIndicator(registry: CustomElementRegistry = customElements): void {
    defineOnce(registry, HCM_LOADING_INDICATOR_TAG, HcmLoadingIndicator);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-loading-indicator': HcmLoadingIndicator;
    }
}
