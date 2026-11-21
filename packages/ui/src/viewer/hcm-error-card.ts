/**
 * `<hcm-error-card>`: a boot or configuration error, localized, with Retry when retrying can help (scenarios V01,
 * V17). An invalid manifest also names its first issue (`issuePath: validation message`, S-V24-BAD-INVALID-POI), so the
 * city owner sees what to fix. It is an alert, so screen readers announce it; Retry fires `hcm-retry`. No error ever
 * leaves a blank map.
 *
 * Material 3: an error container (`error-container` with `on-error-container` text and icon) and Retry as a filled
 * tonal button with the refresh icon (the M1 UX review: a filled primary button shouted over the message).
 */
import { DEFAULT_LOCALE, isValidationCode, translate, type ViewerLocale } from '@hcm/shared';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';

import { EMPTY } from './empty.js';
import { baseStyles } from './shared-styles.js';
import type { ViewerError } from './store-port.js';

export const HCM_ERROR_CARD_TAG = 'hcm-error-card';

function paramsOf(error: ViewerError): Readonly<Record<string, string>> {
    return error.params ?? {};
}

/** `path: message` of the first validation issue an error carries (an invalid manifest), or `''`. */
function issueText(error: ViewerError, locale: ViewerLocale): string {
    const params = paramsOf(error);
    const code = params['issueCode'] ?? '';
    if (!isValidationCode(code)) {
        return '';
    }
    const message = translate(locale, code);
    const path = params['issuePath'] ?? '';
    return path === '' ? message : [path, message].join(': ');
}

export class HcmErrorCard extends LitElement {
    static override readonly properties = {
        error: { attribute: false },
        locale: { type: String },
    };

    static override readonly styles = [
        baseStyles,
        css`
            :host {
                display: block;
                max-inline-size: 480px;
            }

            .card {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 16px;
                padding: 24px;
                border-radius: var(--md-sys-shape-corner-large);
                background: var(--md-sys-color-error-container);
                color: var(--md-sys-color-on-error-container);
                overflow-wrap: anywhere;

                /* Secondary on the error container measured 2.38:1 (the tour): Retry's ring takes the container's text colour. */
                --hcm-focus-ring-color: var(--md-sys-color-on-error-container);
            }

            .card p {
                margin: 0;
                font-size: var(--md-sys-typescale-body-large-size);
                line-height: var(--md-sys-typescale-body-large-line-height);
            }

            .card hcm-icon {
                color: var(--md-sys-color-on-error-container);
            }

            .card .issue {
                font-family: var(--hcm-font-mono, ui-monospace, monospace);
                font-size: var(--md-sys-typescale-body-small-size);
                line-height: var(--md-sys-typescale-body-small-line-height);
            }
        `,
    ];

    declare error: ViewerError | null;
    declare locale: ViewerLocale;

    constructor() {
        super();
        this.error = null;
        this.locale = DEFAULT_LOCALE;
    }

    override render(): TemplateResult {
        const error = this.error;
        if (error === null) {
            return EMPTY;
        }
        const retry = (): void => {
            this.dispatchEvent(new CustomEvent('hcm-retry', { bubbles: true, detail: null }));
        };
        const issue = issueText(error, this.locale);
        return html`<div class="card" role="alert">
            <hcm-icon name="error"></hcm-icon>
            <p>${translate(this.locale, error.code, error.params)}</p>
            ${issue === '' ? nothing : html`<p class="issue">${issue}</p>`}
            ${
                error.retryable
                    ? html`<hcm-button variant="tonal" icon="refresh" @click=${retry}
                          >${translate(this.locale, 'action.retry')}</hcm-button
                      >`
                    : nothing
            }
        </div>`;
    }
}

/** Registers `<hcm-error-card>` once; calling it again is a no-op. */
export function defineHcmErrorCard(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_ERROR_CARD_TAG) === undefined) {
        registry.define(HCM_ERROR_CARD_TAG, HcmErrorCard);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-error-card': HcmErrorCard;
    }
}
