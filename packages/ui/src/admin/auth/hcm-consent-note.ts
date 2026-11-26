/**
 * `<hcm-consent-note>`: the inline explanation shown next to a button that opens Google's consent popup
 * (`docs/research/M2b-interfaces.md` §2.4): why the step asks for the scope, that the permission stays in this tab for at
 * most an hour and is never saved, and what to do on Google's "unverified app" screen (every scope the admin asks for is
 * a sensitive one). It is text next to the button, never a dialog in between, so every consent costs exactly one click.
 * Setup-ui places it in its cards too.
 */
import { DEFAULT_LOCALE, type UiLocale } from '@hcm/shared';
import { LitElement, css, html, type TemplateResult } from 'lit';

import { adminBase } from '../shell/admin-styles.js';
import { shellText } from '../shell/text.js';

export const HCM_CONSENT_NOTE_TAG = 'hcm-consent-note';

/** The Google scopes of `packages/admin/src/google/scopes.ts`. */
export type GoogleScopePort = 'cloudReadOnly' | 'cloudBilling' | 'cloudPlatform' | 'analyticsEdit' | 'analyticsRead';

export class HcmConsentNote extends LitElement {
    static override readonly properties = {
        locale: { type: String },
        scope: { type: String },
        projectId: { type: String, attribute: 'project-id' },
        amount: { type: String },
        domain: { type: String },
    };

    static override readonly styles = [
        adminBase,
        css`
            :host {
                display: block;
            }

            aside {
                display: flex;
                gap: 12px;
                padding: 12px 16px;
                border-radius: var(--md-sys-shape-corner-medium, 12px);
                background: var(--md-sys-color-secondary-container, Canvas);
                color: var(--md-sys-color-on-secondary-container, CanvasText);
                font-size: var(--md-sys-typescale-body-medium-size, 0.875rem);
                line-height: var(--md-sys-typescale-body-medium-line-height, 1.25rem);
            }

            .texts {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }

            .why {
                font-weight: var(--md-sys-typescale-title-small-weight, 500);
            }
        `,
    ];

    declare locale: UiLocale;
    declare scope: GoogleScopePort;
    declare projectId: string;
    /** The budget, already formatted (`5 USD`), for the billing scope's text. */
    declare amount: string;
    /** The auth domain Google's unverified-app screen names. */
    declare domain: string;

    constructor() {
        super();
        this.locale = DEFAULT_LOCALE;
        this.scope = 'cloudReadOnly';
        this.projectId = '';
        this.amount = '';
        this.domain = '';
    }

    override render(): TemplateResult {
        const locale = this.locale;
        const why = shellText(locale, `adminShell.oauth.why.${this.scope}`, { projectId: this.projectId, amount: this.amount });
        return html`<aside aria-label=${shellText(locale, 'adminShell.oauth.title')}>
            <hcm-icon name="info"></hcm-icon>
            <div class="texts">
                <p class="why">${why}</p>
                <p>${shellText(locale, 'adminShell.oauth.notKept')}</p>
                <p>
                    ${shellText(locale, 'adminShell.oauth.unverified')}
                    ${shellText(locale, 'adminShell.oauth.unverifiedHow', { domain: this.domain })}
                </p>
            </div>
        </aside>`;
    }
}

/** Registers `<hcm-consent-note>` once; calling it again is a no-op. */
export function defineHcmConsentNote(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_CONSENT_NOTE_TAG) === undefined) {
        registry.define(HCM_CONSENT_NOTE_TAG, HcmConsentNote);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-consent-note': HcmConsentNote;
    }
}
