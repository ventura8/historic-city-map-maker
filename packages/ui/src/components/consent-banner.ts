import { LitElement, css, html, type TemplateResult } from 'lit';

import { defineHcmButton } from './button.js';
import { defineOnce, emit } from './internal.js';
import { baseStyles, typeStyles } from './styles.js';

export const HCM_CONSENT_BANNER_TAG = 'hcm-consent-banner';

export type ConsentDecision = 'granted' | 'denied';

/**
 * The analytics consent banner (PLAN Addendum 1, scenario V19): a non-modal region at the bottom of the map that never
 * takes the focus or blocks the map. Accept and Decline look the same (no nudging) and fire `hcm-consent` with
 * `{decision}`. Every text is passed in already localized (`consent.*` keys); the app removes the banner once a
 * decision is stored.
 */
export class HcmConsentBanner extends LitElement {
    static override readonly properties = {
        headline: { type: String },
        body: { type: String },
        acceptLabel: { type: String, attribute: 'accept-label' },
        declineLabel: { type: String, attribute: 'decline-label' },
    };

    static override readonly styles = [
        baseStyles,
        typeStyles,
        css`
            :host {
                display: block;
            }

            section {
                display: flex;
                flex-wrap: wrap;
                gap: 8px 16px;
                align-items: center;
                box-sizing: border-box;
                max-width: 640px;
                padding: 16px 16px 16px 24px;
                margin-inline: auto;
                border-radius: var(--md-sys-shape-corner-large);
                background: var(--md-sys-color-surface-container-high);
                color: var(--md-sys-color-on-surface);
                box-shadow: var(--md-sys-elevation-level2);
            }

            .text {
                flex: 1 1 280px;
            }

            h2 {
                margin: 0 0 4px;
            }

            p {
                margin: 0;
                color: var(--md-sys-color-on-surface-variant);
            }

            .actions {
                display: flex;
                gap: 8px;
            }

            @media (forced-colors: active) {
                section {
                    border: 1px solid CanvasText;
                }
            }
        `,
    ];

    declare headline: string;
    declare body: string;
    declare acceptLabel: string;
    declare declineLabel: string;

    constructor() {
        super();
        this.headline = '';
        this.body = '';
        this.acceptLabel = '';
        this.declineLabel = '';
    }

    override render(): TemplateResult {
        return html`<section part="banner" aria-labelledby="headline">
            <div class="text">
                <h2 id="headline" class="title-medium">${this.headline}</h2>
                <p class="body-medium">${this.body}</p>
            </div>
            <div class="actions">
                <hcm-button variant="tonal" @click=${this.onDecline}>${this.declineLabel}</hcm-button>
                <hcm-button variant="tonal" @click=${this.onAccept}>${this.acceptLabel}</hcm-button>
            </div>
        </section>`;
    }

    private readonly onAccept = (): void => {
        emit(this, 'hcm-consent', { decision: 'granted' satisfies ConsentDecision });
    };

    private readonly onDecline = (): void => {
        emit(this, 'hcm-consent', { decision: 'denied' satisfies ConsentDecision });
    };
}

export function defineHcmConsentBanner(registry: CustomElementRegistry = customElements): void {
    defineHcmButton(registry);
    defineOnce(registry, HCM_CONSENT_BANNER_TAG, HcmConsentBanner);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-consent-banner': HcmConsentBanner;
    }
}
